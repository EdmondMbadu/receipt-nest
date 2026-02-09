import {
  Component,
  EventEmitter,
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

import { ReceiptService, UploadProgress, MAX_FILE_SIZE } from '../../services/receipt.service';
import { Receipt } from '../../models/receipt.model';

@Component({
  selector: 'app-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './upload.component.html',
  styleUrl: './upload.component.css'
})
export class UploadComponent implements AfterViewInit, OnDestroy {
  private readonly receiptService = inject(ReceiptService);

  @Output() uploadComplete = new EventEmitter<Receipt>();
  @Output() uploadError = new EventEmitter<string>();
  @Output() close = new EventEmitter<void>();

  @ViewChild('videoElement') videoElement?: ElementRef<HTMLVideoElement>;
  @ViewChild('scannerInput') scannerInput?: ElementRef<HTMLInputElement>;
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  // State
  readonly isDragging = signal(false);
  readonly isUploading = signal(false);
  readonly uploadProgress = signal<UploadProgress | null>(null);
  readonly selectedFile = signal<File | null>(null);
  readonly previewUrl = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly showCamera = signal(false);
  readonly scanMode = signal(true);
  readonly isProcessingScan = signal(false);
  readonly isScannedFile = signal(false);
  private videoStream: MediaStream | null = null;
  private autoScannerTriggered = false;

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
    if (this.isTouchDevice() && !this.autoScannerTriggered) {
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

  readonly allowedTypesDisplay = 'JPEG, PNG, WebP, HEIC, PDF';
  readonly maxSizeDisplay = `${MAX_FILE_SIZE / 1024 / 1024}MB`;

  // Drag and drop handlers
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.handleFile(files[0]);
    }
  }

  // File input handler
  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handleFile(input.files[0]);
    }
    input.value = '';
  }

  onScannerFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handleFile(input.files[0]);
    }
    // Allow selecting the same file/capture again.
    input.value = '';
  }

  // Handle selected file
  private async handleFile(file: File): Promise<void> {
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
        this.errorMessage.set('Free plan includes up to 200 receipts total. Upgrade to add more.');
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
  }

  openScanner(): void {
    this.errorMessage.set(null);

    if (this.isTouchDevice() && this.scannerInput?.nativeElement) {
      this.scannerInput.nativeElement.click();
      return;
    }

    this.openCamera();
  }

  openFilePicker(): void {
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
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });

      this.videoStream = stream;
      this.videoElement.nativeElement.srcObject = stream;
    } catch (error: any) {
      console.error('Failed to access camera:', error);
      this.errorMessage.set('Failed to access camera. Please check permissions.');
      this.showCamera.set(false);
    }
  }

  // Stop camera stream
  stopCamera(): void {
    if (this.videoStream) {
      this.videoStream.getTracks().forEach(track => track.stop());
      this.videoStream = null;
    }
    if (this.videoElement?.nativeElement) {
      this.videoElement.nativeElement.srcObject = null;
    }
  }

  // Capture photo from camera
  capturePhoto(videoElement: HTMLVideoElement): void {
    if (!videoElement.videoWidth || !videoElement.videoHeight) {
      this.errorMessage.set('Camera not ready. Please wait a moment.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      this.errorMessage.set('Failed to capture photo');
      return;
    }

    ctx.drawImage(videoElement, 0, 0);

    canvas.toBlob((blob) => {
      if (!blob) {
        this.errorMessage.set('Failed to create image from capture');
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
      this.handleFile(file);
    }, 'image/jpeg', 0.95);
  }

  // Cancel camera
  cancelCamera(): void {
    this.stopCamera();
    this.showCamera.set(false);
  }

  private isTouchDevice(): boolean {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return false;
    }

    const hasTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    return hasTouch || coarsePointer;
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
    const corners = this.detectDocumentCorners(originalCtx, image.width, image.height);

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

  private detectDocumentCorners(
    sourceCtx: CanvasRenderingContext2D,
    sourceWidth: number,
    sourceHeight: number
  ): { tl: Point; tr: Point; br: Point; bl: Point } | null {
    const maxDetectSize = 1000;
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
    const threshold = Math.max(130, Math.min(245, Math.round(mean + std * 0.25 + 12)));

    const mask = new Uint8Array(detectW * detectH);
    for (let i = 0; i < gray.length; i++) {
      mask[i] = gray[i] >= threshold ? 1 : 0;
    }

    const largest = this.findLargestComponent(mask, detectW, detectH);
    if (!largest) return null;

    const areaRatio = largest.area / (detectW * detectH);
    if (areaRatio < 0.12) {
      return null;
    }

    const hull = this.convexHull(largest.boundary);
    if (hull.length < 4) return null;

    const quad = this.extractQuadFromHull(hull);
    if (!quad) return null;

    const scaled = {
      tl: { x: quad.tl.x / scale, y: quad.tl.y / scale },
      tr: { x: quad.tr.x / scale, y: quad.tr.y / scale },
      br: { x: quad.br.x / scale, y: quad.br.y / scale },
      bl: { x: quad.bl.x / scale, y: quad.bl.y / scale }
    };

    const polygonArea = this.quadArea(scaled);
    if (polygonArea < sourceWidth * sourceHeight * 0.08) {
      return null;
    }

    return scaled;
  }

  private perspectiveWarpFromCorners(
    sourceCtx: CanvasRenderingContext2D,
    corners: { tl: Point; tr: Point; br: Point; bl: Point }
  ): HTMLCanvasElement | null {
    const ordered = this.orderCorners(corners);
    const topWidth = this.distance(ordered.tl, ordered.tr);
    const bottomWidth = this.distance(ordered.bl, ordered.br);
    const leftHeight = this.distance(ordered.tl, ordered.bl);
    const rightHeight = this.distance(ordered.tr, ordered.br);

    const targetW = Math.round(Math.max(topWidth, bottomWidth));
    const targetH = Math.round(Math.max(leftHeight, rightHeight));

    if (targetW < 80 || targetH < 80) {
      return null;
    }

    const maxOut = 2200;
    const outScale = Math.min(1, maxOut / Math.max(targetW, targetH));
    const outW = Math.max(1, Math.round(targetW * outScale));
    const outH = Math.max(1, Math.round(targetH * outScale));

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
      const left = this.lerpPoint(ordered.tl, ordered.bl, v);
      const right = this.lerpPoint(ordered.tr, ordered.br, v);

      for (let x = 0; x < outW; x++) {
        const u = outW <= 1 ? 0 : x / (outW - 1);
        const src = this.lerpPoint(left, right, u);
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

    const pad = Math.round(Math.min(w, h) * 0.03);
    const cropX = Math.max(0, minX - pad);
    const cropY = Math.max(0, minY - pad);
    const cropW = Math.min(w - cropX, maxX - minX + 1 + pad * 2);
    const cropH = Math.min(h - cropY, maxY - minY + 1 + pad * 2);

    if (cropW < 100 || cropH < 100) return null;

    const out = document.createElement('canvas');
    out.width = cropW;
    out.height = cropH;
    const outCtx = out.getContext('2d');
    if (!outCtx) return null;
    outCtx.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    return out;
  }

  private enhanceDocumentCanvas(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    let minLum = 255;
    let maxLum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      if (lum < minLum) minLum = lum;
      if (lum > maxLum) maxLum = lum;
    }

    const range = Math.max(1, maxLum - minLum);
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const normalized = (lum - minLum) / range;
      const boosted = Math.pow(Math.max(0, Math.min(1, normalized)), 0.74);

      let tone = Math.round(boosted * 255);
      if (tone > 236) tone = 255;
      if (tone < 18) tone = 0;

      data[i] = tone;
      data[i + 1] = tone;
      data[i + 2] = tone;
    }

    ctx.putImageData(imageData, 0, 0);
  }

  private findLargestComponent(
    mask: Uint8Array,
    width: number,
    height: number
  ): { area: number; boundary: Point[] } | null {
    const visited = new Uint8Array(mask.length);
    let bestArea = 0;
    let bestPixels: number[] = [];

    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || visited[i]) continue;

      const queue: number[] = [i];
      visited[i] = 1;
      const pixels: number[] = [];
      let head = 0;

      while (head < queue.length) {
        const idx = queue[head++];
        pixels.push(idx);

        const x = idx % width;
        const y = (idx / width) | 0;

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

      if (pixels.length > bestArea) {
        bestArea = pixels.length;
        bestPixels = pixels;
      }
    }

    if (!bestArea) return null;

    const pixelSet = new Uint8Array(mask.length);
    for (const p of bestPixels) pixelSet[p] = 1;

    const boundary: Point[] = [];
    for (const p of bestPixels) {
      const x = p % width;
      const y = (p / width) | 0;
      let isBoundary = false;
      for (let oy = -1; oy <= 1 && !isBoundary; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            isBoundary = true;
            break;
          }
          if (!pixelSet[ny * width + nx]) {
            isBoundary = true;
            break;
          }
        }
      }
      if (isBoundary) {
        boundary.push({ x, y });
      }
    }

    return { area: bestArea, boundary };
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

  private lerpPoint(a: Point, b: Point, t: number): Point {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t
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
}

type Point = {
  x: number;
  y: number;
};
