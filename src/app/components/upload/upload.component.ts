import {
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
  computed,
  ViewChild,
  ElementRef,
  effect,
  AfterViewInit,
  OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { AppConfigService } from '../../services/app-config.service';
import { ReceiptService, UploadProgress, MAX_FILE_SIZE } from '../../services/receipt.service';
import { Receipt } from '../../models/receipt.model';

const AUTO_CAPTURE_INTERVAL_MS = 350;
const AUTO_CAPTURE_STABLE_FRAMES = 9;
const AUTO_CAPTURE_MIN_SHARPNESS = 18;
const AUTO_CAPTURE_FOCUS_DELAY_MS = 1200;

@Component({
  selector: 'app-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './upload.component.html',
  styleUrl: './upload.component.css'
})
export class UploadComponent implements AfterViewInit, OnDestroy {
  private readonly appConfig = inject(AppConfigService);
  private readonly receiptService = inject(ReceiptService);

  @Input() autoOpenScannerOnTouch = true;
  @Output() uploadComplete = new EventEmitter<Receipt>();
  @Output() uploadError = new EventEmitter<string>();
  @Output() close = new EventEmitter<void>();

  @ViewChild('videoElement') videoElement?: ElementRef<HTMLVideoElement>;
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  // State
  readonly isUploading = signal(false);
  readonly uploadProgress = signal<UploadProgress | null>(null);
  readonly selectedFile = signal<File | null>(null);
  readonly previewUrl = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly showCamera = signal(false);
  readonly scanMode = signal(true);
  readonly isProcessingScan = signal(false);
  readonly isScannedFile = signal(false);
  readonly autoCaptureStatus = signal<'searching' | 'focusing' | 'detected' | 'capturing' | 'unavailable'>('searching');
  readonly autoCaptureProgress = signal(0);
  readonly detectedDocumentOutline = signal<string | null>(null);
  private videoStream: MediaStream | null = null;
  private autoScannerTriggered = false;
  private autoCaptureTimer: ReturnType<typeof setInterval> | null = null;
  private autoCaptureTriggered = false;
  private stableDetections = 0;
  private lastDetection: { centerX: number; centerY: number; area: number } | null = null;
  private noDetectionTicks = 0;
  private frameProbeCanvas: HTMLCanvasElement | null = null;
  private frameProbeCtx: CanvasRenderingContext2D | null = null;
  private autoCaptureStartedAt = 0;
  private captureInFlight = false;

  constructor() {
    // Watch for camera state changes and initialize camera
    effect(() => {
      if (this.showCamera()) {
        // Small delay to ensure video element is available
        setTimeout(() => this.initializeCamera(), 100);
      }
    });
  }

  ngAfterViewInit(): void {
    // On touch devices, start in scanner flow so users can capture directly.
    if (this.autoOpenScannerOnTouch && this.isTouchDevice() && !this.autoScannerTriggered) {
      this.autoScannerTriggered = true;
      setTimeout(() => this.openScanner(), 50);
    }
  }

  ngOnDestroy(): void {
    this.stopCamera();
  }

  // Computed
  readonly progressPercent = computed(() => {
    const progress = this.uploadProgress();
    return progress ? Math.round(progress.progress) : 0;
  });
  readonly autoCaptureMessage = computed(() => {
    const status = this.autoCaptureStatus();
    if (status === 'capturing') return 'Document locked. Capturing...';
    if (status === 'detected') return 'Receipt border detected. Keep holding still.';
    if (status === 'focusing') return 'Hold still. Waiting for the camera to focus.';
    if (status === 'unavailable') return 'Could not auto-detect. Use manual capture below.';
    return 'Fit the receipt inside the frame with a small margin around each edge.';
  });
  readonly detectedDocumentOutlineClosed = computed(() => {
    const outline = this.detectedDocumentOutline();
    return outline ? `${outline} ${outline.split(' ')[0]}` : null;
  });

  readonly maxSizeDisplay = `${MAX_FILE_SIZE / 1024 / 1024}MB`;

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handleFile(input.files[0], 'upload');
    }
    input.value = '';
  }

  // Handle selected file
  private async handleFile(file: File, source: 'upload' | 'camera' = 'upload'): Promise<void> {
    this.errorMessage.set(null);
    this.isScannedFile.set(false);

    // Validate file
    const validation = this.receiptService.validateFile(file);
    if (!validation.valid) {
      this.errorMessage.set(validation.error || 'Invalid file');
      return;
    }

    let processedFile = file;
    const canScan =
      source === 'camera' &&
      this.scanMode() &&
      file.type.startsWith('image/') &&
      file.type !== 'image/heic' &&
      file.type !== 'image/heif' &&
      !file.name.toLowerCase().endsWith('.heic') &&
      !file.name.toLowerCase().endsWith('.heif');

    if (canScan) {
      this.isProcessingScan.set(true);
      try {
        processedFile = await this.createScannedFile(file);
        this.isScannedFile.set(true);
      } catch (error) {
        console.error('Scan processing failed, using original image:', error);
      } finally {
        this.isProcessingScan.set(false);
      }
    }

    this.selectedFile.set(processedFile);

    // Check if it's a HEIC file (browsers can't display these natively)
    const isHeic = processedFile.type === 'image/heic' || processedFile.type === 'image/heif' ||
      processedFile.name.toLowerCase().endsWith('.heic') || processedFile.name.toLowerCase().endsWith('.heif');

    // Create preview for images
    if (processedFile.type.startsWith('image/')) {
      if (isHeic) {
        // Convert HEIC to JPEG for preview
        await this.convertHeicForPreview(processedFile);
      } else {
        // Regular image - show directly
        const reader = new FileReader();
        reader.onload = (e) => {
          this.previewUrl.set(e.target?.result as string);
        };
        reader.readAsDataURL(processedFile);
      }
    } else {
      // PDF - show icon instead
      this.previewUrl.set(null);
    }
  }

  // Convert HEIC to JPEG for preview using heic2any
  private async convertHeicForPreview(file: File): Promise<void> {
    try {
      // Dynamically import heic2any
      const heic2any = (await import('heic2any')).default;

      // Convert HEIC to JPEG blob
      const convertedBlob = await heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.9
      });

      // Handle both single blob and array of blobs
      const blob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;

      // Create preview URL from converted blob
      const reader = new FileReader();
      reader.onload = (e) => {
        this.previewUrl.set(e.target?.result as string);
      };
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error('Failed to convert HEIC for preview:', error);
      // If conversion fails, just show no preview
      this.previewUrl.set(null);
    }
  }

  // Check if selected file is HEIC
  isHeicFile(): boolean {
    const file = this.selectedFile();
    if (!file) return false;
    return file.type === 'image/heic' || file.type === 'image/heif' ||
      file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif');
  }

  // Check if selected file is PDF
  isPdfFile(): boolean {
    const file = this.selectedFile();
    if (!file) return false;
    return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  }

  // Upload the file
  async upload(): Promise<void> {
    const file = this.selectedFile();
    if (!file) return;

    this.isUploading.set(true);
    this.errorMessage.set(null);

    try {
      const receipt = await this.receiptService.uploadReceipt(
        file,
        (progress) => this.uploadProgress.set(progress)
      );

      this.uploadComplete.emit(receipt);
      this.reset();
    } catch (error: any) {
      if (error?.message === 'FREE_PLAN_LIMIT_REACHED') {
        this.errorMessage.set(
          `Free plan includes up to ${this.appConfig.freePlanReceiptLimit()} receipts total. Upgrade to add more.`
        );
        this.uploadError.emit('FREE_PLAN_LIMIT_REACHED');
      } else {
        this.errorMessage.set(error.message || 'Upload failed');
        this.uploadError.emit(error.message);
      }
    } finally {
      this.isUploading.set(false);
    }
  }

  // Cancel/reset
  reset(): void {
    this.selectedFile.set(null);
    this.previewUrl.set(null);
    this.uploadProgress.set(null);
    this.errorMessage.set(null);
    this.isUploading.set(false);
    this.isProcessingScan.set(false);
    this.isScannedFile.set(false);
  }

  // Remove selected file
  removeFile(): void {
    this.reset();
  }

  // Format file size
  formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Close modal
  onClose(): void {
    this.stopCamera();
    this.reset();
    this.close.emit();
  }

  // Open camera to take a picture
  openCamera(): void {
    this.showCamera.set(true);
    this.errorMessage.set(null);
    this.autoCaptureStatus.set('searching');
    this.autoCaptureProgress.set(0);
  }

  openScanner(): void {
    this.errorMessage.set(null);
    this.openCamera();
  }

  openFilePicker(): void {
    this.errorMessage.set(null);
    this.fileInput?.nativeElement.click();
  }

  // Initialize camera stream
  async initializeCamera(): Promise<void> {
    if (!this.videoElement) {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // Use back camera on mobile devices
          width: { ideal: 2560 },
          height: { ideal: 1440 },
          frameRate: { ideal: 30, max: 30 }
        }
      });

      this.videoStream = stream;
      await this.optimizeCameraTrack(stream.getVideoTracks()[0]);
      const video = this.videoElement.nativeElement;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      this.startAutoCaptureDetection();
    } catch (error: any) {
      console.error('Failed to access camera:', error);
      this.errorMessage.set('Failed to access camera. Please check permissions.');
      this.showCamera.set(false);
    }
  }

  private async optimizeCameraTrack(track: MediaStreamTrack | undefined): Promise<void> {
    if (!track?.applyConstraints || !track.getCapabilities) {
      return;
    }

    const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
      focusMode?: string[];
      exposureMode?: string[];
      whiteBalanceMode?: string[];
    };
    const advanced: Array<MediaTrackConstraintSet & {
      focusMode?: string;
      exposureMode?: string;
      whiteBalanceMode?: string;
    }> = [];

    if (capabilities.focusMode?.includes('continuous')) {
      advanced.push({ focusMode: 'continuous' });
    }
    if (capabilities.exposureMode?.includes('continuous')) {
      advanced.push({ exposureMode: 'continuous' });
    }
    if (capabilities.whiteBalanceMode?.includes('continuous')) {
      advanced.push({ whiteBalanceMode: 'continuous' });
    }

    if (!advanced.length) {
      return;
    }

    await track.applyConstraints({ advanced }).catch(() => undefined);
  }

  // Stop camera stream
  stopCamera(): void {
    this.stopAutoCaptureDetection();
    this.captureInFlight = false;
    if (this.videoStream) {
      this.videoStream.getTracks().forEach(track => track.stop());
      this.videoStream = null;
    }
    if (this.videoElement?.nativeElement) {
      this.videoElement.nativeElement.srcObject = null;
    }
  }

  // Capture photo from camera
  async capturePhoto(videoElement: HTMLVideoElement): Promise<void> {
    if (this.isUploading() || this.isProcessingScan() || this.captureInFlight) {
      return;
    }

    if (!videoElement.videoWidth || !videoElement.videoHeight) {
      this.errorMessage.set('Camera not ready. Please wait a moment.');
      return;
    }

    this.captureInFlight = true;
    if (!this.autoCaptureTriggered) {
      this.autoCaptureStatus.set('focusing');
      this.autoCaptureProgress.set(Math.max(this.autoCaptureProgress(), 65));
      await this.delay(700);
    }

    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      this.errorMessage.set('Failed to capture photo');
      this.captureInFlight = false;
      return;
    }

    ctx.drawImage(videoElement, 0, 0);

    canvas.toBlob((blob) => {
      if (!blob) {
        this.errorMessage.set('Failed to create image from capture');
        this.captureInFlight = false;
        return;
      }

      // Create a File object from the blob
      const timestamp = Date.now();
      const file = new File([blob], `receipt-${timestamp}.jpg`, {
        type: 'image/jpeg',
        lastModified: timestamp
      });

      this.stopCamera();
      this.showCamera.set(false);
      this.handleFile(file, 'camera');
      this.captureInFlight = false;
    }, 'image/jpeg', 0.95);
  }

  // Cancel camera
  cancelCamera(): void {
    this.stopCamera();
    this.showCamera.set(false);
  }

  private startAutoCaptureDetection(): void {
    this.stopAutoCaptureDetection();
    this.autoCaptureTriggered = false;
    this.stableDetections = 0;
    this.lastDetection = null;
    this.noDetectionTicks = 0;
    this.autoCaptureStartedAt = Date.now();
    this.autoCaptureStatus.set('searching');
    this.autoCaptureProgress.set(0);

    this.autoCaptureTimer = setInterval(() => {
      this.processAutoCaptureFrame();
    }, AUTO_CAPTURE_INTERVAL_MS);
  }

  private stopAutoCaptureDetection(): void {
    if (this.autoCaptureTimer) {
      clearInterval(this.autoCaptureTimer);
      this.autoCaptureTimer = null;
    }
    this.frameProbeCanvas = null;
    this.frameProbeCtx = null;
    this.detectedDocumentOutline.set(null);
  }

  private processAutoCaptureFrame(): void {
    if (this.autoCaptureTriggered || !this.showCamera()) {
      return;
    }

    const video = this.videoElement?.nativeElement;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return;
    }

    const maxFrame = 420;
    const frameScale = Math.min(1, maxFrame / Math.max(video.videoWidth, video.videoHeight));
    const frameW = Math.max(1, Math.round(video.videoWidth * frameScale));
    const frameH = Math.max(1, Math.round(video.videoHeight * frameScale));

    if (!this.frameProbeCanvas || this.frameProbeCanvas.width !== frameW || this.frameProbeCanvas.height !== frameH) {
      this.frameProbeCanvas = document.createElement('canvas');
      this.frameProbeCanvas.width = frameW;
      this.frameProbeCanvas.height = frameH;
      this.frameProbeCtx = this.frameProbeCanvas.getContext('2d');
    }

    if (!this.frameProbeCtx || !this.frameProbeCanvas) {
      return;
    }

    this.frameProbeCtx.drawImage(video, 0, 0, frameW, frameH);
    const frameData = this.frameProbeCtx.getImageData(0, 0, frameW, frameH);
    const sharpness = this.measureSharpness(frameData, frameW, frameH);
    const detection = this.detectDocument(this.frameProbeCtx, frameW, frameH, 420);
    const corners = detection?.corners ?? null;

    if (!corners) {
      this.noDetectionTicks += 1;
      this.stableDetections = Math.max(0, this.stableDetections - 1);
      this.autoCaptureProgress.set(Math.max(0, Math.round((this.stableDetections / AUTO_CAPTURE_STABLE_FRAMES) * 100)));
      this.autoCaptureStatus.set(this.noDetectionTicks > 25 ? 'unavailable' : 'searching');
      this.lastDetection = null;
      this.detectedDocumentOutline.set(null);
      return;
    }

    this.detectedDocumentOutline.set(this.toOverlayPoints(corners, frameW, frameH));
    this.noDetectionTicks = 0;
    if (Date.now() - this.autoCaptureStartedAt < AUTO_CAPTURE_FOCUS_DELAY_MS || sharpness < AUTO_CAPTURE_MIN_SHARPNESS) {
      this.stableDetections = Math.max(0, this.stableDetections - 1);
      this.lastDetection = null;
      this.autoCaptureStatus.set('focusing');
      this.autoCaptureProgress.set(Math.min(90, Math.round((sharpness / AUTO_CAPTURE_MIN_SHARPNESS) * 60)));
      return;
    }

    const centerX = (corners.tl.x + corners.tr.x + corners.br.x + corners.bl.x) / 4;
    const centerY = (corners.tl.y + corners.tr.y + corners.br.y + corners.bl.y) / 4;
    const area = this.quadArea(corners);

    let isStable = false;
    if (this.lastDetection) {
      const dx = centerX - this.lastDetection.centerX;
      const dy = centerY - this.lastDetection.centerY;
      const centerDistance = Math.sqrt(dx * dx + dy * dy);
      const diag = Math.sqrt(frameW * frameW + frameH * frameH);
      const areaDrift = Math.abs(area - this.lastDetection.area) / Math.max(1, this.lastDetection.area);
      isStable = centerDistance < diag * 0.025 && areaDrift < 0.16;
    } else {
      isStable = true;
    }

    this.lastDetection = { centerX, centerY, area };
    this.stableDetections = isStable ? this.stableDetections + 1 : 1;
    this.autoCaptureStatus.set('detected');
    const progress = Math.min(100, Math.round((this.stableDetections / AUTO_CAPTURE_STABLE_FRAMES) * 100));
    this.autoCaptureProgress.set(progress);

    if (this.stableDetections >= AUTO_CAPTURE_STABLE_FRAMES) {
      this.autoCaptureTriggered = true;
      this.autoCaptureStatus.set('capturing');
      this.autoCaptureProgress.set(100);
      this.stopAutoCaptureDetection();
      this.capturePhoto(video);
    }
  }

  private isTouchDevice(): boolean {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return false;
    }

    const hasTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    return hasTouch || coarsePointer;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private measureSharpness(imageData: ImageData, width: number, height: number): number {
    const gray = new Uint8ClampedArray(width * height);
    for (let i = 0, p = 0; i < imageData.data.length; i += 4, p++) {
      gray[p] = Math.round(
        0.299 * imageData.data[i] + 0.587 * imageData.data[i + 1] + 0.114 * imageData.data[i + 2]
      );
    }

    let sum = 0;
    let sumSquares = 0;
    let count = 0;
    const step = 2;
    for (let y = step; y < height - step; y += step) {
      for (let x = step; x < width - step; x += step) {
        const p = y * width + x;
        const laplacian = Math.abs(
          gray[p - width] + gray[p + width] + gray[p - 1] + gray[p + 1] - gray[p] * 4
        );
        sum += laplacian;
        sumSquares += laplacian * laplacian;
        count++;
      }
    }

    if (!count) {
      return 0;
    }

    const mean = sum / count;
    return Math.sqrt(Math.max(0, sumSquares / count - mean * mean));
  }

  private async createScannedFile(file: File): Promise<File> {
    const image = await this.loadImageFromFile(file);
    const originalCanvas = document.createElement('canvas');
    originalCanvas.width = image.width;
    originalCanvas.height = image.height;
    const originalCtx = originalCanvas.getContext('2d');
    if (!originalCtx) {
      throw new Error('Failed to initialize scan canvas');
    }
    originalCtx.drawImage(image, 0, 0);

    let outputCanvas = originalCanvas;
    const corners = this.detectDocument(originalCtx, image.width, image.height)?.corners ?? null;

    if (corners) {
      const warped = this.perspectiveWarpFromCorners(originalCtx, corners);
      if (warped) {
        outputCanvas = warped;
      }
    } else {
      const fallback = this.autoCropCanvas(originalCanvas);
      if (fallback) {
        outputCanvas = fallback;
      }
    }

    this.enhanceDocumentCanvas(outputCanvas);

    const scannedBlob = await this.canvasToBlob(outputCanvas, 'image/jpeg', 0.94);
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const timestamp = Date.now();

    return new File([scannedBlob], `${baseName || 'receipt'}-scan-${timestamp}.jpg`, {
      type: 'image/jpeg',
      lastModified: timestamp
    });
  }

  private loadImageFromFile(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to load image for scan'));
      };
      image.src = objectUrl;
    });
  }

  private canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Failed to create scanned image'));
          return;
        }
        resolve(blob);
      }, type, quality);
    });
  }

  private detectDocument(
    sourceCtx: CanvasRenderingContext2D,
    sourceWidth: number,
    sourceHeight: number,
    maxDetectSize = 1000
  ): ScanDetection | null {
    const scale = Math.min(1, maxDetectSize / Math.max(sourceWidth, sourceHeight));
    const detectW = Math.max(1, Math.round(sourceWidth * scale));
    const detectH = Math.max(1, Math.round(sourceHeight * scale));

    const detectCanvas = document.createElement('canvas');
    detectCanvas.width = detectW;
    detectCanvas.height = detectH;
    const detectCtx = detectCanvas.getContext('2d');
    if (!detectCtx) return null;

    detectCtx.drawImage(sourceCtx.canvas, 0, 0, sourceWidth, sourceHeight, 0, 0, detectW, detectH);
    const imageData = detectCtx.getImageData(0, 0, detectW, detectH);
    const gray = new Uint8ClampedArray(detectW * detectH);

    let mean = 0;
    for (let i = 0, p = 0; i < imageData.data.length; i += 4, p++) {
      const lum = Math.round(
        0.299 * imageData.data[i] + 0.587 * imageData.data[i + 1] + 0.114 * imageData.data[i + 2]
      );
      gray[p] = lum;
      mean += lum;
    }
    mean /= gray.length;

    let variance = 0;
    for (let i = 0; i < gray.length; i++) {
      const d = gray[i] - mean;
      variance += d * d;
    }
    const std = Math.sqrt(variance / gray.length);

    const smoothed = this.boxBlurGray(gray, detectW, detectH, 2);
    const thresholds = Array.from(new Set([
      Math.round(mean + std * 0.08 + 6),
      Math.round(mean + std * 0.22 + 10),
      Math.round(mean + std * 0.38 + 14),
      160,
      180,
      205
    ].map((value) => this.clamp(Math.round(value), 85, 245))));

    let best: ScanDetection | null = null;

    for (const threshold of thresholds) {
      const mask = new Uint8Array(detectW * detectH);
      for (let i = 0; i < smoothed.length; i++) {
        mask[i] = smoothed[i] >= threshold ? 1 : 0;
      }

      this.closeMask(mask, detectW, detectH);
      const candidates = this.findComponentCandidates(mask, detectW, detectH, 5);
      for (const candidate of candidates) {
        const detection = this.detectionFromComponent(candidate, detectW, detectH, sourceWidth, sourceHeight, scale);
        if (detection && (!best || detection.score > best.score)) {
          best = detection;
        }
      }
    }

    return best;
  }

  private detectionFromComponent(
    candidate: ComponentCandidate,
    detectW: number,
    detectH: number,
    sourceWidth: number,
    sourceHeight: number,
    scale: number
  ): ScanDetection | null {
    const areaRatio = candidate.area / (detectW * detectH);
    if (areaRatio < 0.06 || areaRatio > 0.82 || candidate.boundary.length < 16) {
      return null;
    }

    const hull = this.convexHull(candidate.boundary);
    if (hull.length < 4) return null;

    const quad = this.extractQuadFromHull(hull);
    if (!quad) return null;

    const scaled = this.orderCorners({
      tl: { x: quad.tl.x / scale, y: quad.tl.y / scale },
      tr: { x: quad.tr.x / scale, y: quad.tr.y / scale },
      br: { x: quad.br.x / scale, y: quad.br.y / scale },
      bl: { x: quad.bl.x / scale, y: quad.bl.y / scale }
    });

    const score = this.scoreDocumentQuad(scaled, sourceWidth, sourceHeight, areaRatio);
    if (score === null) {
      return null;
    }

    return { corners: scaled, score };
  }

  private scoreDocumentQuad(
    corners: DocumentCorners,
    sourceWidth: number,
    sourceHeight: number,
    componentAreaRatio: number
  ): number | null {
    const polygonArea = this.quadArea(corners);
    const frameArea = sourceWidth * sourceHeight;
    const areaRatio = polygonArea / Math.max(1, frameArea);
    if (areaRatio < 0.08 || areaRatio > 0.84) {
      return null;
    }

    if (this.touchesTooMuchFrame(corners, sourceWidth, sourceHeight)) {
      return null;
    }

    const topWidth = this.distance(corners.tl, corners.tr);
    const bottomWidth = this.distance(corners.bl, corners.br);
    const leftHeight = this.distance(corners.tl, corners.bl);
    const rightHeight = this.distance(corners.tr, corners.br);
    const avgWidth = (topWidth + bottomWidth) / 2;
    const avgHeight = (leftHeight + rightHeight) / 2;
    if (avgWidth < sourceWidth * 0.12 || avgHeight < sourceHeight * 0.12) {
      return null;
    }

    const aspect = avgWidth / Math.max(1, avgHeight);
    if (aspect < 0.16 || aspect > 4.4) {
      return null;
    }

    const widthBalance = Math.min(topWidth, bottomWidth) / Math.max(topWidth, bottomWidth);
    const heightBalance = Math.min(leftHeight, rightHeight) / Math.max(leftHeight, rightHeight);
    const boundingBoxArea = this.boundingBoxArea(corners);
    const rectangularity = polygonArea / Math.max(1, boundingBoxArea);
    const edgeBalance = Math.min(widthBalance, heightBalance);
    if (rectangularity < 0.38 || edgeBalance < 0.3) {
      return null;
    }

    const centerX = (corners.tl.x + corners.tr.x + corners.br.x + corners.bl.x) / 4;
    const centerY = (corners.tl.y + corners.tr.y + corners.br.y + corners.bl.y) / 4;
    const frameCenterX = sourceWidth / 2;
    const frameCenterY = sourceHeight / 2;
    const centerDrift =
      Math.hypot(centerX - frameCenterX, centerY - frameCenterY) /
      Math.max(1, Math.hypot(frameCenterX, frameCenterY));
    const centerScore = 1 - Math.min(1, centerDrift);

    return areaRatio * 5 + componentAreaRatio * 2 + rectangularity + edgeBalance + centerScore;
  }

  private touchesTooMuchFrame(corners: DocumentCorners, sourceWidth: number, sourceHeight: number): boolean {
    const xs = [corners.tl.x, corners.tr.x, corners.br.x, corners.bl.x];
    const ys = [corners.tl.y, corners.tr.y, corners.br.y, corners.bl.y];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const marginX = sourceWidth * 0.025;
    const marginY = sourceHeight * 0.025;
    const touchedEdges = [
      minX <= marginX,
      maxX >= sourceWidth - marginX,
      minY <= marginY,
      maxY >= sourceHeight - marginY
    ].filter(Boolean).length;

    return touchedEdges >= 3;
  }

  private boundingBoxArea(corners: DocumentCorners): number {
    const xs = [corners.tl.x, corners.tr.x, corners.br.x, corners.bl.x];
    const ys = [corners.tl.y, corners.tr.y, corners.br.y, corners.bl.y];
    return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  }

  private toOverlayPoints(corners: DocumentCorners, width: number, height: number): string {
    const points = [corners.tl, corners.tr, corners.br, corners.bl];
    return points
      .map((point) => {
        const x = this.clamp((point.x / width) * 100, 0, 100).toFixed(2);
        const y = this.clamp((point.y / height) * 100, 0, 100).toFixed(2);
        return `${x},${y}`;
      })
      .join(' ');
  }

  private closeMask(mask: Uint8Array, width: number, height: number): void {
    const dilated = this.dilateMask(mask, width, height);
    const closed = this.erodeMask(dilated, width, height);
    mask.set(closed);
  }

  private dilateMask(mask: Uint8Array, width: number, height: number): Uint8Array {
    const out = new Uint8Array(mask.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let value = 0;
        for (let oy = -1; oy <= 1 && !value; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (mask[ny * width + nx]) {
              value = 1;
              break;
            }
          }
        }
        out[y * width + x] = value;
      }
    }
    return out;
  }

  private erodeMask(mask: Uint8Array, width: number, height: number): Uint8Array {
    const out = new Uint8Array(mask.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let value = 1;
        for (let oy = -1; oy <= 1 && value; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height || !mask[ny * width + nx]) {
              value = 0;
              break;
            }
          }
        }
        out[y * width + x] = value;
      }
    }
    return out;
  }

  private perspectiveWarpFromCorners(
    sourceCtx: CanvasRenderingContext2D,
    corners: { tl: Point; tr: Point; br: Point; bl: Point }
  ): HTMLCanvasElement | null {
    const ordered = this.orderCorners(corners);
    const padded = this.expandQuadWithMargin(ordered, sourceCtx.canvas.width, sourceCtx.canvas.height);
    const topWidth = this.distance(padded.tl, padded.tr);
    const bottomWidth = this.distance(padded.bl, padded.br);
    const leftHeight = this.distance(padded.tl, padded.bl);
    const rightHeight = this.distance(padded.tr, padded.br);

    const targetW = Math.round(Math.max(topWidth, bottomWidth));
    const targetH = Math.round(Math.max(leftHeight, rightHeight));

    if (targetW < 80 || targetH < 80) {
      return null;
    }

    const maxOut = 2800;
    const outScale = Math.min(1, maxOut / Math.max(targetW, targetH));
    const outW = Math.max(1, Math.round(targetW * outScale));
    const outH = Math.max(1, Math.round(targetH * outScale));

    const transform = this.projectUnitSquareToQuad(padded);
    const sourceData = sourceCtx.getImageData(0, 0, sourceCtx.canvas.width, sourceCtx.canvas.height);
    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) return null;

    const outImage = outCtx.createImageData(outW, outH);
    const outPixels = outImage.data;
    const srcPixels = sourceData.data;
    const srcW = sourceData.width;
    const srcH = sourceData.height;

    for (let y = 0; y < outH; y++) {
      const v = outH <= 1 ? 0 : y / (outH - 1);

      for (let x = 0; x < outW; x++) {
        const u = outW <= 1 ? 0 : x / (outW - 1);
        const src = this.applyProjectiveTransform(transform, u, v);
        const sample = this.sampleBilinear(srcPixels, srcW, srcH, src.x, src.y);
        const i = (y * outW + x) * 4;
        outPixels[i] = sample.r;
        outPixels[i + 1] = sample.g;
        outPixels[i + 2] = sample.b;
        outPixels[i + 3] = 255;
      }
    }

    outCtx.putImageData(outImage, 0, 0);
    return outCanvas;
  }

  private autoCropCanvas(sourceCanvas: HTMLCanvasElement): HTMLCanvasElement | null {
    const ctx = sourceCanvas.getContext('2d');
    if (!ctx) return null;
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    let count = 0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (lum < 245) {
          count++;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (!count) return null;

    // Keep extra headroom to avoid clipping merchant/title at the top.
    const padX = Math.round(Math.min(w, h) * 0.03);
    const padTop = Math.round(Math.min(w, h) * 0.07);
    const padBottom = Math.round(Math.min(w, h) * 0.035);
    const cropX = Math.max(0, minX - padX);
    const cropY = Math.max(0, minY - padTop);
    const cropW = Math.min(w - cropX, maxX - minX + 1 + padX * 2);
    const cropH = Math.min(h - cropY, maxY - minY + 1 + padTop + padBottom);

    if (cropW < 100 || cropH < 100) return null;

    const out = document.createElement('canvas');
    out.width = cropW;
    out.height = cropH;
    const outCtx = out.getContext('2d');
    if (!outCtx) return null;
    outCtx.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    return out;
  }

  private boxBlurGray(gray: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
    if (radius <= 0) {
      return new Uint8ClampedArray(gray);
    }

    const integral = new Uint32Array((width + 1) * (height + 1));
    for (let y = 1; y <= height; y++) {
      let rowSum = 0;
      for (let x = 1; x <= width; x++) {
        rowSum += gray[(y - 1) * width + (x - 1)];
        integral[y * (width + 1) + x] = integral[(y - 1) * (width + 1) + x] + rowSum;
      }
    }

    const out = new Uint8ClampedArray(gray.length);
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height - 1, y + radius);
      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - radius);
        const x1 = Math.min(width - 1, x + radius);
        const integralX0 = x0;
        const integralY0 = y0;
        const integralX1 = x1 + 1;
        const integralY1 = y1 + 1;
        const sum =
          integral[integralY1 * (width + 1) + integralX1] -
          integral[integralY0 * (width + 1) + integralX1] -
          integral[integralY1 * (width + 1) + integralX0] +
          integral[integralY0 * (width + 1) + integralX0];
        out[y * width + x] = Math.round(sum / ((x1 - x0 + 1) * (y1 - y0 + 1)));
      }
    }

    return out;
  }

  private enhanceDocumentCanvas(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const pixelCount = canvas.width * canvas.height;
    const gray = new Uint8ClampedArray(pixelCount);

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      gray[p] = lum;
    }

    const backgroundRadius = Math.max(16, Math.round(Math.min(canvas.width, canvas.height) / 22));
    const background = this.boxBlurGray(gray, canvas.width, canvas.height, backgroundRadius);
    const adjusted = new Uint8ClampedArray(pixelCount);
    const histogram = new Uint32Array(256);

    for (let p = 0; p < pixelCount; p++) {
      const flattened = this.clamp(gray[p] + 238 - background[p], 0, 255);
      adjusted[p] = flattened;
      histogram[flattened]++;
    }

    const low = this.histogramPercentile(histogram, pixelCount, 0.015);
    const high = Math.max(low + 24, this.histogramPercentile(histogram, pixelCount, 0.985));
    const tones = new Uint8ClampedArray(pixelCount);

    for (let p = 0; p < pixelCount; p++) {
      const normalized = this.clamp((adjusted[p] - low) / (high - low), 0, 1);
      let tone = Math.round(Math.pow(normalized, 0.72) * 255);
      if (tone > 246) tone = 255;
      if (tone < 10) tone = 0;
      tones[p] = tone;
    }

    const sharpened = new Uint8ClampedArray(pixelCount);
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const p = y * canvas.width + x;
        if (x === 0 || y === 0 || x === canvas.width - 1 || y === canvas.height - 1) {
          sharpened[p] = tones[p];
          continue;
        }

        const neighborAverage =
          (tones[p - 1] + tones[p + 1] + tones[p - canvas.width] + tones[p + canvas.width]) / 4;
        sharpened[p] = this.clamp(Math.round(tones[p] * 1.48 - neighborAverage * 0.48), 0, 255);
      }
    }

    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const tone = sharpened[p];
      data[i] = tone;
      data[i + 1] = tone;
      data[i + 2] = tone;
      data[i + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
  }

  private histogramPercentile(histogram: Uint32Array, total: number, percentile: number): number {
    const target = total * percentile;
    let running = 0;
    for (let i = 0; i < histogram.length; i++) {
      running += histogram[i];
      if (running >= target) {
        return i;
      }
    }
    return histogram.length - 1;
  }

  private findComponentCandidates(
    mask: Uint8Array,
    width: number,
    height: number,
    limit: number
  ): ComponentCandidate[] {
    const visited = new Uint8Array(mask.length);
    const candidates: ComponentCandidate[] = [];
    const minArea = Math.max(80, Math.round(width * height * 0.015));

    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || visited[i]) continue;

      const queue: number[] = [i];
      visited[i] = 1;
      const pixels: number[] = [];
      let head = 0;
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;

      while (head < queue.length) {
        const idx = queue[head++];
        pixels.push(idx);

        const x = idx % width;
        const y = (idx / width) | 0;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;

        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oy === 0) continue;
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const ni = ny * width + nx;
            if (!mask[ni] || visited[ni]) continue;
            visited[ni] = 1;
            queue.push(ni);
          }
        }
      }

      if (pixels.length < minArea) {
        continue;
      }

      const boxW = maxX - minX + 1;
      const boxH = maxY - minY + 1;
      if (boxW < width * 0.12 || boxH < height * 0.12) {
        continue;
      }

      const pixelSet = new Uint8Array(mask.length);
      for (const p of pixels) pixelSet[p] = 1;

      const boundary: Point[] = [];
      const stride = Math.max(1, Math.floor(pixels.length / 5000));
      for (let pi = 0; pi < pixels.length; pi += stride) {
        const p = pixels[pi];
        const x = p % width;
        const y = (p / width) | 0;
        let isBoundary = false;
        for (let oy = -1; oy <= 1 && !isBoundary; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height || !pixelSet[ny * width + nx]) {
              isBoundary = true;
              break;
            }
          }
        }
        if (isBoundary) {
          boundary.push({ x, y });
        }
      }

      candidates.push({ area: pixels.length, boundary });
    }

    return candidates.sort((a, b) => b.area - a.area).slice(0, limit);
  }

  private convexHull(points: Point[]): Point[] {
    if (points.length <= 3) return points;

    const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
    const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

    const lower: Point[] = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.pop();
      }
      lower.push(p);
    }

    const upper: Point[] = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.pop();
      }
      upper.push(p);
    }

    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  private extractQuadFromHull(hull: Point[]): { tl: Point; tr: Point; br: Point; bl: Point } | null {
    if (hull.length < 4) return null;
    let tl = hull[0];
    let tr = hull[0];
    let br = hull[0];
    let bl = hull[0];

    for (const p of hull) {
      const sum = p.x + p.y;
      const diff = p.x - p.y;
      const tlSum = tl.x + tl.y;
      const brSum = br.x + br.y;
      const trDiff = tr.x - tr.y;
      const blDiff = bl.x - bl.y;

      if (sum < tlSum) tl = p;
      if (sum > brSum) br = p;
      if (diff > trDiff) tr = p;
      if (diff < blDiff) bl = p;
    }

    const unique = new Set([`${tl.x},${tl.y}`, `${tr.x},${tr.y}`, `${br.x},${br.y}`, `${bl.x},${bl.y}`]);
    if (unique.size < 4) return null;
    return { tl, tr, br, bl };
  }

  private orderCorners(corners: { tl: Point; tr: Point; br: Point; bl: Point }): { tl: Point; tr: Point; br: Point; bl: Point } {
    const points = [corners.tl, corners.tr, corners.br, corners.bl];
    const bySum = [...points].sort((a, b) => (a.x + a.y) - (b.x + b.y));
    const byDiff = [...points].sort((a, b) => (a.x - a.y) - (b.x - b.y));
    return {
      tl: bySum[0],
      br: bySum[bySum.length - 1],
      bl: byDiff[0],
      tr: byDiff[byDiff.length - 1]
    };
  }

  private quadArea(corners: { tl: Point; tr: Point; br: Point; bl: Point }): number {
    const pts = [corners.tl, corners.tr, corners.br, corners.bl];
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      area += p1.x * p2.y - p2.x * p1.y;
    }
    return Math.abs(area) / 2;
  }

  private distance(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private projectUnitSquareToQuad(quad: DocumentCorners): ProjectiveTransform {
    const dx1 = quad.tr.x - quad.br.x;
    const dy1 = quad.tr.y - quad.br.y;
    const dx2 = quad.bl.x - quad.br.x;
    const dy2 = quad.bl.y - quad.br.y;
    const dx3 = quad.tl.x - quad.tr.x + quad.br.x - quad.bl.x;
    const dy3 = quad.tl.y - quad.tr.y + quad.br.y - quad.bl.y;

    if (Math.abs(dx3) < 0.0001 && Math.abs(dy3) < 0.0001) {
      return {
        a: quad.tr.x - quad.tl.x,
        b: quad.bl.x - quad.tl.x,
        c: quad.tl.x,
        d: quad.tr.y - quad.tl.y,
        e: quad.bl.y - quad.tl.y,
        f: quad.tl.y,
        g: 0,
        h: 0
      };
    }

    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) < 0.0001) {
      return {
        a: quad.tr.x - quad.tl.x,
        b: quad.bl.x - quad.tl.x,
        c: quad.tl.x,
        d: quad.tr.y - quad.tl.y,
        e: quad.bl.y - quad.tl.y,
        f: quad.tl.y,
        g: 0,
        h: 0
      };
    }

    const g = (dx3 * dy2 - dx2 * dy3) / det;
    const h = (dx1 * dy3 - dx3 * dy1) / det;

    return {
      a: quad.tr.x - quad.tl.x + g * quad.tr.x,
      b: quad.bl.x - quad.tl.x + h * quad.bl.x,
      c: quad.tl.x,
      d: quad.tr.y - quad.tl.y + g * quad.tr.y,
      e: quad.bl.y - quad.tl.y + h * quad.bl.y,
      f: quad.tl.y,
      g,
      h
    };
  }

  private applyProjectiveTransform(transform: ProjectiveTransform, u: number, v: number): Point {
    const denominator = transform.g * u + transform.h * v + 1;
    return {
      x: (transform.a * u + transform.b * v + transform.c) / denominator,
      y: (transform.d * u + transform.e * v + transform.f) / denominator
    };
  }

  private sampleBilinear(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    x: number,
    y: number
  ): { r: number; g: number; b: number } {
    const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
    const x1 = Math.max(0, Math.min(width - 1, x0 + 1));
    const y1 = Math.max(0, Math.min(height - 1, y0 + 1));

    const tx = Math.max(0, Math.min(1, x - x0));
    const ty = Math.max(0, Math.min(1, y - y0));

    const i00 = (y0 * width + x0) * 4;
    const i10 = (y0 * width + x1) * 4;
    const i01 = (y1 * width + x0) * 4;
    const i11 = (y1 * width + x1) * 4;

    const r = this.bilerp(pixels[i00], pixels[i10], pixels[i01], pixels[i11], tx, ty);
    const g = this.bilerp(pixels[i00 + 1], pixels[i10 + 1], pixels[i01 + 1], pixels[i11 + 1], tx, ty);
    const b = this.bilerp(pixels[i00 + 2], pixels[i10 + 2], pixels[i01 + 2], pixels[i11 + 2], tx, ty);
    return { r, g, b };
  }

  private bilerp(c00: number, c10: number, c01: number, c11: number, tx: number, ty: number): number {
    const a = c00 + (c10 - c00) * tx;
    const b = c01 + (c11 - c01) * tx;
    return Math.round(a + (b - a) * ty);
  }

  private expandQuadWithMargin(
    quad: { tl: Point; tr: Point; br: Point; bl: Point },
    maxW: number,
    maxH: number
  ): { tl: Point; tr: Point; br: Point; bl: Point } {
    const centerX = (quad.tl.x + quad.tr.x + quad.br.x + quad.bl.x) / 4;
    const centerY = (quad.tl.y + quad.tr.y + quad.br.y + quad.bl.y) / 4;
    const uniformScale = 1.012;
    const topLift = maxH * 0.012;
    const bottomDrop = maxH * 0.004;

    const scaleFromCenter = (p: Point): Point => ({
      x: centerX + (p.x - centerX) * uniformScale,
      y: centerY + (p.y - centerY) * uniformScale
    });

    const tl = scaleFromCenter(quad.tl);
    const tr = scaleFromCenter(quad.tr);
    const br = scaleFromCenter(quad.br);
    const bl = scaleFromCenter(quad.bl);

    tl.y -= topLift;
    tr.y -= topLift;
    bl.y += bottomDrop;
    br.y += bottomDrop;

    return {
      tl: { x: this.clamp(tl.x, 0, maxW - 1), y: this.clamp(tl.y, 0, maxH - 1) },
      tr: { x: this.clamp(tr.x, 0, maxW - 1), y: this.clamp(tr.y, 0, maxH - 1) },
      br: { x: this.clamp(br.x, 0, maxW - 1), y: this.clamp(br.y, 0, maxH - 1) },
      bl: { x: this.clamp(bl.x, 0, maxW - 1), y: this.clamp(bl.y, 0, maxH - 1) }
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}

type Point = {
  x: number;
  y: number;
};

type DocumentCorners = {
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
};

type ScanDetection = {
  corners: DocumentCorners;
  score: number;
};

type ComponentCandidate = {
  area: number;
  boundary: Point[];
};

type ProjectiveTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  g: number;
  h: number;
};
