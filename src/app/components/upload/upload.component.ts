import {
  Component,
  EventEmitter,
  Output,
  inject,
  signal,
  computed
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

  // State
  readonly isDragging = signal(false);
  readonly isUploading = signal(false);
  readonly uploadProgress = signal<UploadProgress | null>(null);
  readonly selectedFile = signal<File | null>(null);
  readonly previewUrl = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);

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
  private handleFile(file: File): void {
    this.errorMessage.set(null);

    // Validate file
    const validation = this.receiptService.validateFile(file);
    if (!validation.valid) {
      this.errorMessage.set(validation.error || 'Invalid file');
      return;
    }

    this.selectedFile.set(file);

    // Create preview for images
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.previewUrl.set(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      // PDF - show icon instead
      this.previewUrl.set(null);
    }
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
      this.errorMessage.set(error.message || 'Upload failed');
      this.uploadError.emit(error.message);
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
    this.reset();
    this.close.emit();
  }
}
