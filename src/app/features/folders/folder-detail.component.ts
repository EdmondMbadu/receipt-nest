import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

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

@Component({
  selector: 'app-folder-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './folder-detail.component.html',
  styleUrl: './folder-detail.component.css'
})
export class FolderDetailComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly receiptService = inject(ReceiptService);
  private readonly folderService = inject(FolderService);
  private readonly pdfThumbnailService = inject(PdfThumbnailService);

  readonly folderId = signal<string | null>(null);

  readonly folders = this.folderService.folders;
  readonly foldersLoading = this.folderService.isLoading;
  readonly foldersError = this.folderService.error;

  readonly receipts = this.receiptService.receipts;
  readonly receiptsLoading = this.receiptService.isLoading;

  readonly addModalOpen = signal(false);
  readonly removeModalOpen = signal(false);
  readonly deleteModalOpen = signal(false);

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

  readonly folder = computed<Folder | null>(() => {
    const id = this.folderId();
    if (!id) {
      return null;
    }
    return this.folders().find((entry) => entry.id === id) ?? null;
  });

  readonly folderReceipts = computed(() => {
    const targetFolder = this.folder();
    if (!targetFolder) {
      return [];
    }

    const map = this.receiptMap();
    return targetFolder.receiptIds
      .map((receiptId) => map.get(receiptId))
      .filter((receipt): receipt is Receipt => !!receipt)
      .sort((a, b) => this.getReceiptDateValue(b) - this.getReceiptDateValue(a));
  });

  readonly folderReceiptsByMonth = computed(() => this.groupReceiptsByMonth(this.folderReceipts()));
  readonly allReceiptsByMonth = computed(() => this.groupReceiptsByMonth(this.receipts()));

  readonly selectedCount = computed(() => this.selectedReceiptIds().size);
  readonly canAddPictures = computed(() => this.selectedCount() > 0 && !this.mutationLoading());
  readonly canRemovePictures = computed(() => this.selectedCount() > 0 && !this.mutationLoading());

  readonly totalAmount = computed(() => this.folderReceipts().reduce((sum, receipt) => sum + (receipt.totalAmount || 0), 0));

  private readonly imageEffect = effect(() => {
    const list = this.receipts();
    for (const receipt of list) {
      this.loadImageUrl(receipt);
    }
  });

  ngOnInit(): void {
    this.receiptService.subscribeToReceipts();
    this.folderService.subscribeToFolders();
    this.folderId.set(this.route.snapshot.paramMap.get('id'));
    this.paramMapSubscription = this.route.paramMap.subscribe((params) => {
      this.folderId.set(params.get('id'));
    });
  }

  ngOnDestroy(): void {
    this.paramMapSubscription?.unsubscribe();
    this.folderService.unsubscribeFromFolders();
    this.receiptService.unsubscribeFromReceipts();
  }

  private paramMapSubscription: { unsubscribe: () => void } | null = null;

  openAddModal(): void {
    this.selectedReceiptIds.set(new Set());
    this.mutationError.set(null);
    this.addModalOpen.set(true);
  }

  openRemoveModal(): void {
    this.selectedReceiptIds.set(new Set());
    this.mutationError.set(null);
    this.removeModalOpen.set(true);
  }

  openDeleteModal(): void {
    this.mutationError.set(null);
    this.deleteModalOpen.set(true);
  }

  closeAllModals(): void {
    this.addModalOpen.set(false);
    this.removeModalOpen.set(false);
    this.deleteModalOpen.set(false);
    this.selectedReceiptIds.set(new Set());
    this.mutationError.set(null);
    this.mutationLoading.set(false);
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

  isReceiptInFolder(receiptId: string): boolean {
    const targetFolder = this.folder();
    if (!targetFolder) {
      return false;
    }
    return targetFolder.receiptIds.includes(receiptId);
  }

  async addPictures(): Promise<void> {
    if (!this.canAddPictures()) {
      return;
    }

    const targetFolder = this.folder();
    if (!targetFolder) {
      return;
    }

    this.mutationLoading.set(true);
    this.mutationError.set(null);

    try {
      await this.folderService.addReceiptsToFolder(targetFolder, Array.from(this.selectedReceiptIds()));
      this.closeAllModals();
    } catch (error: any) {
      this.mutationError.set(error?.message || 'Unable to add pictures to this folder.');
      this.mutationLoading.set(false);
    }
  }

  async removePictures(): Promise<void> {
    if (!this.canRemovePictures()) {
      return;
    }

    const targetFolder = this.folder();
    if (!targetFolder) {
      return;
    }

    this.mutationLoading.set(true);
    this.mutationError.set(null);

    try {
      await this.folderService.removeReceiptsFromFolder(targetFolder, Array.from(this.selectedReceiptIds()));
      this.closeAllModals();
    } catch (error: any) {
      this.mutationError.set(error?.message || 'Unable to remove pictures from this folder.');
      this.mutationLoading.set(false);
    }
  }

  async deleteFolder(): Promise<void> {
    if (this.mutationLoading()) {
      return;
    }

    const targetFolder = this.folder();
    if (!targetFolder) {
      return;
    }

    this.mutationLoading.set(true);
    this.mutationError.set(null);

    try {
      await this.folderService.deleteFolder(targetFolder.id);
      this.closeAllModals();
      await this.router.navigate(['/app/folders']);
    } catch (error: any) {
      this.mutationError.set(error?.message || 'Unable to delete folder.');
      this.mutationLoading.set(false);
    }
  }

  getImageUrl(receipt: Receipt): string | null {
    return this.imageUrls()[receipt.id] ?? null;
  }

  isImageLoading(receiptId: string): boolean {
    return this.loadingImages().has(receiptId);
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

  formatDate(receipt: Receipt): string {
    const date = this.extractReceiptDate(receipt);
    if (!date) {
      return 'No date';
    }

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  trackGroup(_: number, group: MonthGroup): string {
    return group.key;
  }

  trackReceipt(_: number, receipt: Receipt): string {
    return receipt.id;
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
      console.error('Failed to load folder detail image:', error);
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
