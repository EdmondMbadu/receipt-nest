import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';
import { ReceiptService } from '../../services/receipt.service';
import { UploadComponent } from '../../components/upload/upload.component';
import { Receipt, ReceiptStatus } from '../../models/receipt.model';
import { DEFAULT_CATEGORIES, getCategoryById, Category } from '../../models/category.model';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, UploadComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly theme = inject(ThemeService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly receiptService = inject(ReceiptService);

  readonly user = this.authService.user;
  readonly isDarkMode = this.theme.isDarkMode;
  readonly menuOpen = signal(false);
  readonly showUploadModal = signal(false);
  readonly showMonthPicker = signal(false);
  readonly searchQuery = signal('');
  readonly searchFocused = signal(false);

  // Receipts from service
  readonly receipts = this.receiptService.receipts;
  readonly isLoadingReceipts = this.receiptService.isLoading;
  readonly receiptCount = this.receiptService.receiptCount;
  readonly needsReviewCount = this.receiptService.needsReviewCount;

  readonly displayName = computed(() => {
    const profile = this.user();
    if (!profile) {
      return '';
    }

    const name = `${profile.firstName} ${profile.lastName}`.trim();
    return name || profile.email;
  });

  readonly userInitials = computed(() => {
    const profile = this.user();
    if (!profile) {
      return '?';
    }

    const initials = `${profile.firstName?.[0] ?? ''}${profile.lastName?.[0] ?? ''}`.trim().toUpperCase();
    if (initials) {
      return initials;
    }

    const emailInitial = profile.email?.[0];
    return emailInitial ? emailInitial.toUpperCase() : '?';
  });

  // Month selection from service
  readonly selectedMonthSpend = this.receiptService.selectedMonthSpend;
  readonly selectedMonthLabel = this.receiptService.selectedMonthLabel;
  readonly selectedMonthReceipts = this.receiptService.selectedMonthReceipts;
  readonly isCurrentMonth = this.receiptService.isCurrentMonth;

  // Chart data from service
  readonly dailySpendingData = this.receiptService.dailySpendingData;
  readonly chartPathData = this.receiptService.chartPathData;

  // Keep for backward compatibility
  readonly currentMonthSpend = this.selectedMonthSpend;

  readonly selectedMonthReceiptCount = computed(() => {
    return this.selectedMonthReceipts().length;
  });

  // Keep for backward compatibility
  readonly currentMonthReceiptCount = this.selectedMonthReceiptCount;

  // Month navigation
  goToPreviousMonth(): void {
    this.receiptService.goToPreviousMonth();
  }

  goToNextMonth(): void {
    this.receiptService.goToNextMonth();
  }

  goToCurrentMonth(): void {
    this.receiptService.goToCurrentMonth();
  }

  // Month picker
  toggleMonthPicker(): void {
    this.showMonthPicker.set(!this.showMonthPicker());
  }

  closeMonthPicker(): void {
    this.showMonthPicker.set(false);
  }

  selectMonth(year: number, month: number): void {
    this.receiptService.selectedYear.set(year);
    this.receiptService.selectedMonth.set(month);
    this.closeMonthPicker();
  }

  // Available months for picker (last 24 months)
  readonly availableMonths = computed(() => {
    const months: { year: number; month: number; label: string }[] = [];
    const now = new Date();

    for (let i = 0; i < 24; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        year: date.getFullYear(),
        month: date.getMonth(),
        label: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      });
    }

    return months;
  });

  // Search functionality
  readonly filteredReceipts = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const receipts = this.receipts();

    if (!query) {
      return receipts.slice(0, 10); // Show last 10 when no search
    }

    return receipts.filter(r => {
      // Search by merchant name
      const merchantMatch = r.merchant?.canonicalName?.toLowerCase().includes(query) ||
        r.merchant?.rawName?.toLowerCase().includes(query);

      // Search by amount (as string)
      const amountMatch = r.totalAmount?.toString().includes(query);

      // Search by date
      const dateMatch = r.date?.includes(query);

      // Search by file name
      const fileMatch = r.file?.originalName?.toLowerCase().includes(query);

      return merchantMatch || amountMatch || dateMatch || fileMatch;
    });
  });

  clearSearch(): void {
    this.searchQuery.set('');
    this.searchFocused.set(false);
  }

  onSearchBlur(): void {
    // Delay to allow clicking on results
    setTimeout(() => {
      this.searchFocused.set(false);
    }, 200);
  }

  // Recent receipts (last 5) - now uses filtered if searching
  readonly recentReceipts = computed(() => {
    if (this.searchQuery().trim()) {
      return this.filteredReceipts();
    }
    return this.receipts().slice(0, 5);
  });

  // Get first receipt that needs review
  getFirstNeedsReviewId(): string {
    const receipt = this.receipts().find(r => r.status === 'needs_review');
    return receipt?.id || '';
  }

  // Spending by category for current month
  readonly categorySpending = computed(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Filter receipts for current month with final status
    const monthReceipts = this.receipts().filter(r => {
      if (!r.date || !r.totalAmount) return false;
      const receiptDate = new Date(r.date);
      return receiptDate.getMonth() === currentMonth &&
        receiptDate.getFullYear() === currentYear &&
        (r.status === 'final' || r.status === 'extracted');
    });

    // Group by category
    const categoryTotals: Record<string, { total: number; category: Category }> = {};
    let maxTotal = 0;

    for (const receipt of monthReceipts) {
      const categoryId = receipt.category?.id || 'other';
      const category = getCategoryById(categoryId) || DEFAULT_CATEGORIES.find(c => c.id === 'other')!;

      if (!categoryTotals[categoryId]) {
        categoryTotals[categoryId] = { total: 0, category };
      }
      categoryTotals[categoryId].total += receipt.totalAmount || 0;
      maxTotal = Math.max(maxTotal, categoryTotals[categoryId].total);
    }

    // Convert to array and sort by total
    return Object.values(categoryTotals)
      .map(({ total, category }) => ({
        id: category.id,
        name: category.name,
        icon: category.icon,
        color: category.color,
        total,
        percentage: maxTotal > 0 ? (total / maxTotal) * 100 : 0
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5); // Top 5 categories
  });

  ngOnInit(): void {
    // Subscribe to real-time receipt updates
    this.receiptService.subscribeToReceipts();
  }

  ngOnDestroy(): void {
    this.receiptService.unsubscribeFromReceipts();
  }

  async logout() {
    this.menuOpen.set(false);
    await this.authService.logout();
    await this.router.navigateByUrl('/login');
  }

  toggleTheme() {
    this.theme.toggleTheme();
  }

  toggleMenu() {
    this.menuOpen.update((open) => !open);
  }

  openUploadModal() {
    this.showUploadModal.set(true);
  }

  closeUploadModal() {
    this.showUploadModal.set(false);
  }

  onUploadComplete(receipt: Receipt) {
    this.showUploadModal.set(false);
    // Receipt will appear automatically via real-time subscription
  }

  onUploadError(error: string) {
    console.error('Upload error:', error);
    // Could show a toast notification here
  }

  async deleteReceipt(receipt: Receipt, event: Event) {
    event.stopPropagation();

    if (!confirm('Are you sure you want to delete this receipt?')) {
      return;
    }

    try {
      await this.receiptService.deleteReceipt(receipt.id);
    } catch (error) {
      console.error('Failed to delete receipt:', error);
    }
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
      case 'final': return 'Complete';
      default: return status;
    }
  }

  // Get category info
  getCategoryIcon(categoryId?: string): string {
    if (!categoryId) return '📦';
    const category = getCategoryById(categoryId);
    return category?.icon || '📦';
  }

  getCategoryName(categoryId?: string): string {
    if (!categoryId) return 'Uncategorized';
    const category = getCategoryById(categoryId);
    return category?.name || 'Other';
  }

  // Format currency
  formatCurrency(amount?: number): string {
    if (amount === undefined || amount === null) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  }

  // Format date
  formatDate(dateString?: string): string {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
  }

  // Format file upload date from Firestore timestamp
  formatUploadDate(timestamp: any): string {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  @HostListener('document:click', ['$event'])
  closeOnOutsideClick(event: Event) {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.menuOpen.set(false);
    }
  }
}
