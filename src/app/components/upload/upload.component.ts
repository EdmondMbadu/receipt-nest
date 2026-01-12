import {
  Component,
  EventEmitter,
  Output,
  inject,
  signal,
  computed,
  ViewChild,
  ElementRef,
  effect
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { ReceiptService, UploadProgress, ALLOWED_FILE_TYPES, MAX_FILE_SIZE } from '../../services/receipt.service';
import { Receipt } from '../../models/receipt.model';

@Component({
  selector: 'app-upload',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './upload.component.html',
  styleUrl: './upload.component.css'
})
export class UploadComponent {
  private readonly receiptService = inject(ReceiptService);

  @Output() uploadComplete = new EventEmitter<Receipt>();
  @Output() uploadError = new EventEmitter<string>();
  @Output() close = new EventEmitter<void>();

  @ViewChild('videoElement') videoElement?: ElementRef<HTMLVideoElement>;

  // State
  readonly isDragging = signal(false);
  readonly isUploading = signal(false);
  readonly uploadProgress = signal<UploadProgress | null>(null);
  readonly selectedFile = signal<File | null>(null);
  readonly previewUrl = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly showCamera = signal(false);
  private videoStream: MediaStream | null = null;

  constructor() {
    // Watch for camera state changes and initialize camera
    effect(() => {
      if (this.showCamera()) {
        // Small delay to ensure video element is available
        setTimeout(() => this.initializeCamera(), 100);
      }
    });
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
  }

  // Handle selected file
  private async handleFile(file: File): Promise<void> {
    this.errorMessage.set(null);

    // Validate file
    const validation = this.receiptService.validateFile(file);
    if (!validation.valid) {
      this.errorMessage.set(validation.error || 'Invalid file');
      return;
    }

    this.selectedFile.set(file);

    // Check if it's a HEIC file (browsers can't display these natively)
    const isHeic = file.type === 'image/heic' || file.type === 'image/heif' ||
      file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif');

    // Create preview for images
    if (file.type.startsWith('image/')) {
      if (isHeic) {
        // Convert HEIC to JPEG for preview
        await this.convertHeicForPreview(file);
      } else {
        // Regular image - show directly
        const reader = new FileReader();
        reader.onload = (e) => {
          this.previewUrl.set(e.target?.result as string);
        };
        reader.readAsDataURL(file);
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
}

