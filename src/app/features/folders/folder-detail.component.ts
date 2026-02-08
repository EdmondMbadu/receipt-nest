import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './folder-detail.component.html',
  styleUrl: './folder-detail.component.css'
})
export class FolderDetailComponent implements OnInit, OnDestroy {
  private pdfLibPromise: Promise<typeof import('pdf-lib')> | null = null;
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
  readonly renameModalOpen = signal(false);
  readonly renameFolderName = signal('');

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
  readonly downloadingPdfKey = signal<string | null>(null);
  readonly downloadingCsvKey = signal<string | null>(null);
  readonly downloadMenuOpenKey = signal<string | null>(null);
  readonly pdfDownloadError = signal<{ key: string; message: string } | null>(null);
  readonly csvDownloadError = signal<{ key: string; message: string } | null>(null);

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

  openRenameModal(): void {
    this.renameFolderName.set(this.folder()?.name || '');
    this.mutationError.set(null);
    this.renameModalOpen.set(true);
  }

  toggleDownloadMenu(key: string): void {
    this.downloadMenuOpenKey.update((openKey) => (openKey === key ? null : key));
  }

  closeDownloadMenu(): void {
    this.downloadMenuOpenKey.set(null);
  }

  closeAllModals(): void {
    this.addModalOpen.set(false);
    this.removeModalOpen.set(false);
    this.deleteModalOpen.set(false);
    this.renameModalOpen.set(false);
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

  async renameFolder(): Promise<void> {
    if (this.mutationLoading()) {
      return;
    }

    const targetFolder = this.folder();
    if (!targetFolder) {
      return;
    }

    const nextName = this.renameFolderName().trim();
    if (!nextName) {
      this.mutationError.set('Folder name is required.');
      return;
    }

    if (nextName === targetFolder.name) {
      this.closeAllModals();
      return;
    }

    this.mutationLoading.set(true);
    this.mutationError.set(null);

    try {
      await this.folderService.renameFolder(targetFolder.id, nextName);
      this.closeAllModals();
    } catch (error: any) {
      this.mutationError.set(error?.message || 'Unable to rename folder.');
      this.mutationLoading.set(false);
    }
  }

  downloadFolderCsv(): void {
    const folderName = this.folder()?.name || 'Folder';
    this.downloadReceiptsCsv(this.folderReceipts(), `${folderName} receipts`, 'folder');
  }

  async downloadFolderPdf(): Promise<void> {
    const folderName = this.folder()?.name || 'Folder';
    await this.downloadReceiptsPdf(this.folderReceipts(), `${folderName} receipts`, 'folder');
  }

  async downloadMonthPdf(group: MonthGroup): Promise<void> {
    await this.downloadReceiptsPdf(group.receipts, `${group.label} receipts`, group.key);
  }

  downloadMonthCsv(group: MonthGroup): void {
    this.downloadReceiptsCsv(group.receipts, `${group.label} receipts`, group.key);
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

  getMonthTotal(group: MonthGroup): number {
    return group.receipts.reduce((sum, receipt) => sum + (receipt.totalAmount || 0), 0);
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

  private downloadReceiptsCsv(receipts: Receipt[], label: string, key: string): void {
    if (this.downloadingCsvKey()) {
      return;
    }

    this.downloadingCsvKey.set(key);
    this.csvDownloadError.set(null);

    try {
      if (!receipts.length) {
        throw new Error('No receipts available for export.');
      }

      const rows: string[] = [];
      rows.push(['Merchant', 'Date', 'Amount'].map(this.escapeCsvValue).join(','));

      let total = 0;
      for (const receipt of receipts) {
        const merchant = receipt.merchant?.canonicalName
          || receipt.merchant?.rawName
          || receipt.extraction?.supplierName?.value
          || 'Unknown';
        const date = receipt.date || receipt.extraction?.date?.value || '';
        const amountValue = receipt.totalAmount ?? receipt.extraction?.totalAmount?.value;
        const amount = typeof amountValue === 'number' ? amountValue : null;
        if (amount !== null) {
          total += amount;
        }

        rows.push([
          merchant,
          date,
          amount !== null ? amount.toFixed(2) : ''
        ].map(this.escapeCsvValue).join(','));
      }

      rows.push(['Total', '', total.toFixed(2)].map(this.escapeCsvValue).join(','));

      const csv = rows.join('\n');
      const csvBlob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const downloadUrl = URL.createObjectURL(csvBlob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `${this.toSafeFileLabel(label)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 250);
    } catch (error: any) {
      this.csvDownloadError.set({
        key,
        message: error?.message || 'Failed to export CSV. Please try again.'
      });
    } finally {
      this.downloadingCsvKey.set(null);
      this.closeDownloadMenu();
    }
  }

  private async downloadReceiptsPdf(receipts: Receipt[], label: string, key: string): Promise<void> {
    if (this.downloadingPdfKey()) {
      return;
    }

    this.downloadingPdfKey.set(key);
    this.pdfDownloadError.set(null);

    try {
      if (!receipts.length) {
        throw new Error('No receipts available for export.');
      }

      const { PDFDocument } = await this.loadPdfLib();
      const pdfDoc = await PDFDocument.create();
      let appendedPages = 0;

      for (const receipt of receipts) {
        try {
          if (!receipt.file?.storagePath) {
            continue;
          }

          const blob = await this.fetchReceiptBlob(receipt);
          const mimeType = this.getReceiptMimeType(receipt, blob);

          if (this.isPdf(receipt) || mimeType === 'application/pdf') {
            const sourcePdf = await PDFDocument.load(await blob.arrayBuffer());
            const copiedPages = await pdfDoc.copyPages(sourcePdf, sourcePdf.getPageIndices());
            copiedPages.forEach((page) => pdfDoc.addPage(page));
            appendedPages += copiedPages.length;
          } else {
            const { bytes, type } = await this.normalizeImageBlob(blob, receipt);
            const embeddedImage = type === 'png'
              ? await pdfDoc.embedPng(bytes)
              : await pdfDoc.embedJpg(bytes);

            const pageWidth = 612;
            const pageHeight = 792;
            const margin = 36;
            const maxWidth = pageWidth - margin * 2;
            const maxHeight = pageHeight - margin * 3;

            const dimensions = embeddedImage.scale(1);
            const scale = Math.min(maxWidth / dimensions.width, maxHeight / dimensions.height, 1);
            const scaledWidth = dimensions.width * scale;
            const scaledHeight = dimensions.height * scale;

            const page = pdfDoc.addPage([pageWidth, pageHeight]);
            page.drawImage(embeddedImage, {
              x: (pageWidth - scaledWidth) / 2,
              y: margin * 1.5,
              width: scaledWidth,
              height: scaledHeight
            });

            const caption = this.buildReceiptCaption(receipt);
            const text = caption.length > 90 ? `${caption.slice(0, 87)}…` : caption;
            page.drawText(text, {
              x: margin,
              y: margin / 2,
              size: 12,
              maxWidth: pageWidth - margin * 2
            });

            appendedPages += 1;
          }
        } catch (innerError) {
          console.error('Failed to add receipt to export PDF', innerError);
        }
      }

      if (appendedPages === 0) {
        throw new Error('Unable to prepare this PDF right now. Please try again later.');
      }

      const pdfBytes = await pdfDoc.save();
      const pdfBuffer = pdfBytes.buffer.slice(0) as ArrayBuffer;
      const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' });
      const downloadUrl = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `${this.toSafeFileLabel(label)}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 250);
    } catch (error: any) {
      this.pdfDownloadError.set({
        key,
        message: error?.message || 'Failed to export PDF. Please try again.'
      });
    } finally {
      this.downloadingPdfKey.set(null);
      this.closeDownloadMenu();
    }
  }

  private escapeCsvValue(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
  }

  private toSafeFileLabel(label: string): string {
    return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'receipts';
  }

  private loadPdfLib(): Promise<typeof import('pdf-lib')> {
    if (!this.pdfLibPromise) {
      this.pdfLibPromise = import('pdf-lib');
    }
    return this.pdfLibPromise;
  }

  private buildReceiptCaption(receipt: Receipt): string {
    const parts: string[] = [];

    if (receipt.merchant?.canonicalName) {
      parts.push(receipt.merchant.canonicalName);
    } else if (receipt.merchant?.rawName) {
      parts.push(receipt.merchant.rawName);
    } else if (receipt.file?.originalName) {
      parts.push(receipt.file.originalName);
    }

    if (receipt.totalAmount !== undefined && receipt.totalAmount !== null) {
      parts.push(this.formatCurrency(receipt.totalAmount));
    }

    if (receipt.date) {
      const parsed = new Date(receipt.date);
      if (!Number.isNaN(parsed.getTime())) {
        parts.push(parsed.toLocaleDateString('en-US'));
      }
    }

    return parts.join(' • ') || 'Receipt';
  }

  private getReceiptMimeType(receipt: Receipt, blob: Blob): string {
    return blob?.type || receipt.file?.mimeType || '';
  }

  private async fetchReceiptBlob(receipt: Receipt): Promise<Blob> {
    if (!receipt.file?.storagePath) {
      throw new Error('Missing file path for receipt.');
    }

    const url = await this.receiptService.getReceiptFileUrl(receipt.file.storagePath);
    return this.fetchBlobWithXHR(url);
  }

  private async normalizeImageBlob(blob: Blob, receipt: Receipt): Promise<{ bytes: Uint8Array; type: 'jpg' | 'png' }> {
    const mimeType = this.getReceiptMimeType(receipt, blob).toLowerCase();
    const fileName = receipt.file?.originalName?.toLowerCase() || '';
    const asUint8Array = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

    const isPng = mimeType.includes('png') || fileName.endsWith('.png');
    if (isPng) {
      return { bytes: await asUint8Array(blob), type: 'png' };
    }

    const isJpeg = mimeType.includes('jpeg') || mimeType.includes('jpg') || fileName.endsWith('.jpg') || fileName.endsWith('.jpeg');
    if (isJpeg) {
      return { bytes: await asUint8Array(blob), type: 'jpg' };
    }

    const isWebp = mimeType.includes('webp') || fileName.endsWith('.webp');
    if (isWebp) {
      const converted = await this.convertImageViaCanvas(blob, 'image/png');
      return { bytes: await asUint8Array(converted), type: 'png' };
    }

    const isHeic = mimeType.includes('heic') || mimeType.includes('heif') || fileName.endsWith('.heic') || fileName.endsWith('.heif');
    if (isHeic) {
      const heic2anyModule = await import('heic2any');
      const heic2any = (heic2anyModule as any).default ?? heic2anyModule;
      const converted = await heic2any({
        blob,
        toType: 'image/jpeg',
        quality: 0.9
      });
      const normalizedBlob = Array.isArray(converted) ? converted[0] : converted;
      return { bytes: await asUint8Array(normalizedBlob), type: 'jpg' };
    }

    const fallback = await this.convertImageViaCanvas(blob, 'image/jpeg');
    return { bytes: await asUint8Array(fallback), type: 'jpg' };
  }

  private convertImageViaCanvas(blob: Blob, outputType: 'image/png' | 'image/jpeg'): Promise<Blob> {
    if (typeof document === 'undefined') {
      return Promise.reject(new Error('Image conversion is not supported in this environment.'));
    }

    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.crossOrigin = 'anonymous';

      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth || image.width || 0;
        canvas.height = image.naturalHeight || image.height || 0;
        const context = canvas.getContext('2d');

        if (!context) {
          URL.revokeObjectURL(url);
          reject(new Error('Unable to convert image.'));
          return;
        }

        context.drawImage(image, 0, 0);
        canvas.toBlob((converted) => {
          URL.revokeObjectURL(url);
          if (converted) {
            resolve(converted);
          } else {
            reject(new Error('Image conversion failed.'));
          }
        }, outputType, 0.95);
      };

      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image for conversion.'));
      };

      image.src = url;
    });
  }

  private fetchBlobWithXHR(url: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'blob';

      xhr.onload = () => {
        if (xhr.status === 200) {
          resolve(xhr.response);
        } else {
          reject(new Error(`Failed to download receipt (${xhr.status}).`));
        }
      };

      xhr.onerror = () => {
        reject(new Error('Network error while downloading receipt.'));
      };

      xhr.send();
    });
  }
}
