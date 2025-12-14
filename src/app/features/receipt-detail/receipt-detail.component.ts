import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ReceiptService } from '../../services/receipt.service';
import { ThemeService } from '../../services/theme.service';
import { Receipt, ReceiptStatus } from '../../models/receipt.model';
import { DEFAULT_CATEGORIES, Category } from '../../models/category.model';

@Component({
  selector: 'app-receipt-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './receipt-detail.component.html',
  styleUrl: './receipt-detail.component.css'
})
export class ReceiptDetailComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly receiptService = inject(ReceiptService);
  private readonly theme = inject(ThemeService);

  readonly isDarkMode = this.theme.isDarkMode;
  readonly categories = DEFAULT_CATEGORIES;

  // State
  readonly receipt = signal<Receipt | null>(null);
  readonly isLoading = signal(true);
  readonly isSaving = signal(false);
  readonly error = signal<string | null>(null);
  readonly imageUrl = signal<string | null>(null);
  readonly showImageModal = signal(false);

  // Edit form values
  readonly editMerchant = signal('');
  readonly editAmount = signal<number | null>(null);
  readonly editDate = signal('');
  readonly editCategory = signal('other');
  readonly editNotes = signal('');

  // Computed
  readonly isEdited = computed(() => {
    const r = this.receipt();
    if (!r) return false;

    return (
      this.editMerchant() !== (r.merchant?.canonicalName || '') ||
      this.editAmount() !== (r.totalAmount || null) ||
      this.editDate() !== (r.date || '') ||
      this.editCategory() !== (r.category?.id || 'other') ||
      this.editNotes() !== (r.notes || '')
    );
  });

  readonly needsReview = computed(() => {
    const r = this.receipt();
    return r?.status === 'needs_review' || r?.status === 'extracted';
  });

  private receiptId: string = '';

  ngOnInit(): void {
    this.route.params.subscribe(params => {
      this.receiptId = params['id'];
      this.loadReceipt();
    });
  }

  ngOnDestroy(): void {
    // Cleanup if needed
  }

  async loadReceipt(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const receipt = await this.receiptService.getReceipt(this.receiptId);
      if (!receipt) {
        this.error.set('Receipt not found');
        return;
      }

      this.receipt.set(receipt);
      this.initEditForm(receipt);

      // Load image URL
      if (receipt.file?.storagePath) {
        try {
          const url = await this.receiptService.getReceiptFileUrl(receipt.file.storagePath);
          this.imageUrl.set(url);
        } catch (e) {
          console.warn('Could not load receipt image:', e);
        }
      }
    } catch (e: any) {
      this.error.set(e.message || 'Failed to load receipt');
    } finally {
      this.isLoading.set(false);
    }
  }

  private initEditForm(receipt: Receipt): void {
    this.editMerchant.set(receipt.merchant?.canonicalName || receipt.extraction?.supplierName?.value || '');
    this.editAmount.set(receipt.totalAmount ?? receipt.extraction?.totalAmount?.value ?? null);
    this.editDate.set(receipt.date || receipt.extraction?.date?.value || '');
    this.editCategory.set(receipt.category?.id || 'other');
    this.editNotes.set(receipt.notes || '');
  }

  async saveChanges(): Promise<void> {
    if (!this.receipt()) return;

    this.isSaving.set(true);
    this.error.set(null);

    try {
      const category = this.categories.find(c => c.id === this.editCategory());

      await this.receiptService.updateReceipt(this.receiptId, {
        merchant: {
          canonicalName: this.editMerchant(),
          rawName: this.receipt()!.merchant?.rawName || this.editMerchant(),
          matchConfidence: 1.0,
          matchedBy: 'manual'
        },
        totalAmount: this.editAmount() || undefined,
        date: this.editDate() || undefined,
        category: category ? {
          id: category.id,
          name: category.name,
          confidence: 1.0,
          assignedBy: 'user'
        } : undefined,
        notes: this.editNotes() || undefined,
        status: 'final' as ReceiptStatus
      });

      // Reload to get updated data
      await this.loadReceipt();
    } catch (e: any) {
      this.error.set(e.message || 'Failed to save changes');
    } finally {
      this.isSaving.set(false);
    }
  }

  async confirmReceipt(): Promise<void> {
    await this.saveChanges();
  }

  async deleteReceipt(): Promise<void> {
    if (!confirm('Are you sure you want to delete this receipt? This cannot be undone.')) {
      return;
    }

    try {
      await this.receiptService.deleteReceipt(this.receiptId);
      await this.router.navigateByUrl('/app');
    } catch (e: any) {
      this.error.set(e.message || 'Failed to delete receipt');
    }
  }

  openImageModal(): void {
    if (this.imageUrl()) {
      this.showImageModal.set(true);
    }
  }

  closeImageModal(): void {
    this.showImageModal.set(false);
  }

  toggleTheme(): void {
    this.theme.toggleTheme();
  }

  // Status badge styling
  getStatusBadgeClass(status: ReceiptStatus): string {
    switch (status) {
      case 'uploaded':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
      case 'processing':
        return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
      case 'extracted':
        return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';
      case 'needs_review':
        return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
      case 'final':
        return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
      default:
        return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400';
    }
  }

  getStatusLabel(status: ReceiptStatus): string {
    switch (status) {
      case 'uploaded': return 'Uploaded';
      case 'processing': return 'Processing';
      case 'extracted': return 'Extracted';
      case 'needs_review': return 'Needs Review';
      case 'final': return 'Confirmed';
      default: return status;
    }
  }

  formatCurrency(amount?: number | null): string {
    if (amount === undefined || amount === null) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  }

  formatConfidence(confidence?: number): string {
    if (confidence === undefined) return '-';
    return `${Math.round(confidence * 100)}%`;
  }

  isPdf(): boolean {
    return this.receipt()?.file?.mimeType === 'application/pdf';
  }
}
