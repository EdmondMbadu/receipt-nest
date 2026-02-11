import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { Folder } from '../../models/folder.model';
import { Receipt } from '../../models/receipt.model';
import { FolderService } from '../../services/folder.service';
import { PdfThumbnailService } from '../../services/pdf-thumbnail.service';
import { ReceiptService } from '../../services/receipt.service';

interface MonthGroup {
  key: string;
  year: number;
  month: number;
  label: string;
  receipts: Receipt[];
}

interface FolderListItem {
  folder: Folder;
  receiptCount: number;
  totalAmount: number;
}

@Component({
  selector: 'app-folders',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './folders.component.html',
  styleUrl: './folders.component.css'
})
export class FoldersComponent implements OnInit, OnDestroy {
  private readonly receiptService = inject(ReceiptService);
  private readonly folderService = inject(FolderService);
  private readonly pdfThumbnailService = inject(PdfThumbnailService);

  readonly folders = this.folderService.folders;
  readonly foldersLoading = this.folderService.isLoading;
  readonly foldersError = this.folderService.error;

  readonly receipts = this.receiptService.receipts;
  readonly receiptsLoading = this.receiptService.isLoading;

  readonly createModalOpen = signal(false);
  readonly folderName = signal('');
  readonly selectedReceiptIds = signal<Set<string>>(new Set());

  readonly mutationLoading = signal(false);
  readonly mutationError = signal<string | null>(null);

  readonly imageUrls = signal<Record<string, string>>({});
  readonly loadingImages = signal<Set<string>>(new Set());

  readonly receiptMap = computed(() => {
    const map = new Map<string, Receipt>();
    for (const receipt of this.receipts()) {
      map.set(receipt.id, receipt);
    }
    return map;
  });

  readonly folderItems = computed<FolderListItem[]>(() => {
    const map = this.receiptMap();

    return this.folders().map((folder) => {
      const receipts = folder.receiptIds
        .map((receiptId) => map.get(receiptId))
        .filter((receipt): receipt is Receipt => !!receipt);

      return {
        folder,
        receiptCount: folder.receiptIds.length,
        totalAmount: receipts.reduce((sum, receipt) => sum + (receipt.totalAmount || 0), 0)
      };
    });
  });

  readonly allReceiptsByMonth = computed(() => this.groupReceiptsByMonth(this.receipts()));

  readonly hasFolders = computed(() => this.folders().length > 0);

  readonly selectedCount = computed(() => this.selectedReceiptIds().size);

  readonly canCreateFolder = computed(() => {
    return this.folderName().trim().length > 0 && this.selectedCount() > 0 && !this.mutationLoading();
  });

  private readonly imageEffect = effect(() => {
    const receipts = this.receipts();
    for (const receipt of receipts) {
      this.loadImageUrl(receipt);
    }
  });

  private readonly autoFolderSyncEffect = effect(() => {
    if (this.receiptsLoading() || this.foldersLoading()) {
      return;
    }

    const receipts = this.receipts();
    void this.folderService.syncAutoFolders(receipts).catch((error) => {
      console.error('Failed to sync automatic folders:', error);
    });
  });

  ngOnInit(): void {
    this.receiptService.subscribeToReceipts();
    this.folderService.subscribeToFolders();
  }

  ngOnDestroy(): void {
    this.folderService.unsubscribeFromFolders();
    this.receiptService.unsubscribeFromReceipts();
  }

  openCreateModal(): void {
    this.folderName.set('');
    this.selectedReceiptIds.set(new Set());
    this.mutationError.set(null);
    this.createModalOpen.set(true);
  }

  closeCreateModal(): void {
    this.createModalOpen.set(false);
    this.mutationLoading.set(false);
    this.mutationError.set(null);
    this.selectedReceiptIds.set(new Set());
  }

  toggleReceiptSelection(receiptId: string, disabled = false): void {
    if (disabled || this.mutationLoading()) {
      return;
    }

    this.selectedReceiptIds.update((current) => {
      const next = new Set(current);
      if (next.has(receiptId)) {
        next.delete(receiptId);
      } else {
        next.add(receiptId);
      }
      return next;
    });
  }

  isReceiptSelected(receiptId: string): boolean {
    return this.selectedReceiptIds().has(receiptId);
  }

  async createFolder(): Promise<void> {
    if (!this.canCreateFolder()) {
      return;
    }

    this.mutationLoading.set(true);
    this.mutationError.set(null);

    try {
      await this.folderService.createFolder(
        this.folderName().trim(),
        Array.from(this.selectedReceiptIds())
      );
      this.closeCreateModal();
    } catch (error: any) {
      this.mutationError.set(error?.message || 'Unable to create folder.');
      this.mutationLoading.set(false);
    }
  }

  getImageUrl(receipt: Receipt): string | null {
    return this.imageUrls()[receipt.id] ?? null;
  }

  isPdf(receipt: Receipt): boolean {
    return receipt.file?.mimeType === 'application/pdf' || receipt.file?.originalName?.toLowerCase().endsWith('.pdf');
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  }

  trackGroup(_: number, group: MonthGroup): string {
    return group.key;
  }

  trackReceipt(_: number, receipt: Receipt): string {
    return receipt.id;
  }

  trackFolder(_: number, item: FolderListItem): string {
    return item.folder.id;
  }

  private groupReceiptsByMonth(receipts: Receipt[]): MonthGroup[] {
    const groups = new Map<string, MonthGroup>();

    for (const receipt of receipts) {
      const date = this.extractReceiptDate(receipt);
      if (!date) {
        continue;
      }

      const year = date.getFullYear();
      const month = date.getMonth();
      const key = `${year}-${month}`;

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          year,
          month,
          label: new Date(year, month, 1).toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric'
          }),
          receipts: []
        });
      }

      groups.get(key)?.receipts.push(receipt);
    }

    return Array.from(groups.values())
      .sort((a, b) => {
        if (a.year !== b.year) {
          return b.year - a.year;
        }
        return b.month - a.month;
      })
      .map((group) => ({
        ...group,
        receipts: [...group.receipts].sort((a, b) => this.getReceiptDateValue(b) - this.getReceiptDateValue(a))
      }));
  }

  private async loadImageUrl(receipt: Receipt): Promise<void> {
    const storagePath = receipt.file?.storagePath;
    if (!storagePath) {
      return;
    }

    if (this.imageUrls()[receipt.id] || this.loadingImages().has(receipt.id)) {
      return;
    }

    this.loadingImages.update((current) => {
      const next = new Set(current);
      next.add(receipt.id);
      return next;
    });

    try {
      const url = await this.receiptService.getReceiptFileUrl(storagePath);

      if (this.isPdf(receipt)) {
        try {
          const thumbnail = await this.pdfThumbnailService.generateThumbnail(url, 0.7);
          this.imageUrls.update((current) => ({
            ...current,
            [receipt.id]: thumbnail
          }));
        } catch {
          this.imageUrls.update((current) => ({
            ...current,
            [receipt.id]: url
          }));
        }
      } else {
        this.imageUrls.update((current) => ({
          ...current,
          [receipt.id]: url
        }));
      }
    } catch (error) {
      console.error('Failed to load folder preview image:', error);
    } finally {
      this.loadingImages.update((current) => {
        const next = new Set(current);
        next.delete(receipt.id);
        return next;
      });
    }
  }

  private extractReceiptDate(receipt: Receipt): Date | null {
    if (receipt.date) {
      const parsed = new Date(receipt.date);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    if (receipt.createdAt) {
      const value = (receipt.createdAt as { toDate?: () => Date }).toDate
        ? (receipt.createdAt as { toDate: () => Date }).toDate()
        : new Date(receipt.createdAt as unknown as string | number | Date);

      if (!Number.isNaN(value.getTime())) {
        return value;
      }
    }

    return null;
  }

  private getReceiptDateValue(receipt: Receipt): number {
    return this.extractReceiptDate(receipt)?.getTime() ?? 0;
  }
}
