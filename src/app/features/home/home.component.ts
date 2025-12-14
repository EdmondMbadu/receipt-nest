import { Component, ElementRef, HostListener, OnDestroy, OnInit, computed, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';
import { ReceiptService } from '../../services/receipt.service';
import { PdfThumbnailService } from '../../services/pdf-thumbnail.service';
import { UploadComponent } from '../../components/upload/upload.component';
import { Receipt, ReceiptStatus } from '../../models/receipt.model';
import { DEFAULT_CATEGORIES, getCategoryById, Category } from '../../models/category.model';

// Interface for grouped receipts by month
interface MonthGroup {
  year: number;
  month: number;
  label: string;
  receipts: Receipt[];
}

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
  private readonly pdfThumbnailService = inject(PdfThumbnailService);

  readonly user = this.authService.user;
  readonly isDarkMode = this.theme.isDarkMode;
  readonly menuOpen = signal(false);
  readonly showUploadModal = signal(false);
  readonly showMonthPickerCard = signal(false);
  readonly showMonthPickerGraph = signal(false);
  readonly searchQuery = signal('');
  readonly searchFocused = signal(false);
  readonly showAllReceipts = signal(false);
  readonly hoveredDay = signal<{ day: number; amount: number; cumulative: number } | null>(null);
  readonly selectedDay = signal<{ day: number; month: number; year: number } | null>(null);

  // Expose Math for template
  readonly Math = Math;

  // Gallery view state
  readonly visibleMonthCount = signal(2); // Start with 2 months
  readonly imageUrls = signal<Record<string, string>>({}); // Cache for image URLs
  readonly loadingImages = signal<Set<string>>(new Set());
  readonly isLoadingMore = signal(false);
  readonly hasMoreMonths = computed(() => {
    return this.visibleMonthCount() < this.receiptsGroupedByMonth().length;
  });

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

  // Month picker - Card (stats section)
  toggleMonthPickerCard(): void {
    this.showMonthPickerCard.set(!this.showMonthPickerCard());
    this.showMonthPickerGraph.set(false); // Close the other picker
  }

  closeMonthPickerCard(): void {
    this.showMonthPickerCard.set(false);
  }

  // Month picker - Graph section
  toggleMonthPickerGraph(): void {
    this.showMonthPickerGraph.set(!this.showMonthPickerGraph());
    this.showMonthPickerCard.set(false); // Close the other picker
  }

  closeMonthPickerGraph(): void {
    this.showMonthPickerGraph.set(false);
  }

  closeAllMonthPickers(): void {
    this.showMonthPickerCard.set(false);
    this.showMonthPickerGraph.set(false);
  }

  selectMonthFromCard(year: number, month: number): void {
    this.receiptService.selectedYear.set(year);
    this.receiptService.selectedMonth.set(month);
    this.closeMonthPickerCard();
  }

  selectMonthFromGraph(year: number, month: number): void {
    this.receiptService.selectedYear.set(year);
    this.receiptService.selectedMonth.set(month);
    this.closeMonthPickerGraph();
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

  toggleShowAllReceipts(): void {
    this.showAllReceipts.update(show => !show);
  }

  onSearchBlur(): void {
    // Delay to allow clicking on results
    setTimeout(() => {
      this.searchFocused.set(false);
    }, 200);
  }

  // Recent receipts (last 5 or all if expanded) - now uses filtered if searching
  readonly recentReceipts = computed(() => {
    if (this.searchQuery().trim()) {
      return this.filteredReceipts();
    }
    if (this.showAllReceipts()) {
      return this.receipts();
    }
    return this.receipts().slice(0, 5);
  });

  // Get first receipt that needs review
  getFirstNeedsReviewId(): string {
    const receipt = this.receipts().find(r => r.status === 'needs_review');
    return receipt?.id || '';
  }

  // Group all receipts by month for gallery view
  readonly receiptsGroupedByMonth = computed(() => {
    const receipts = this.receipts();
    const groups: Map<string, MonthGroup> = new Map();

    for (const receipt of receipts) {
      let year: number;
      let month: number;

      // Use receipt date if available, otherwise use createdAt
      if (receipt.date) {
        const date = new Date(receipt.date);
        year = date.getFullYear();
        month = date.getMonth();
      } else if (receipt.createdAt) {
        const date = (receipt.createdAt as any).toDate
          ? (receipt.createdAt as any).toDate()
          : new Date(receipt.createdAt as any);
        year = date.getFullYear();
        month = date.getMonth();
      } else {
        // Skip receipts without any date
        continue;
      }

      const key = `${year}-${month}`;
      if (!groups.has(key)) {
        const label = new Date(year, month, 1).toLocaleDateString('en-US', {
          month: 'long',
          year: 'numeric'
        });
        groups.set(key, { year, month, label, receipts: [] });
      }
      groups.get(key)!.receipts.push(receipt);
    }

    // Sort groups by date (newest first)
    return Array.from(groups.values()).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
  });

  // Get visible month groups based on infinite scroll
  // Prioritizes the selected month to appear first
  readonly visibleMonthGroups = computed(() => {
    const allGroups = this.receiptsGroupedByMonth();
    const selectedMonth = this.receiptService.selectedMonth();
    const selectedYear = this.receiptService.selectedYear();

    // Find if the selected month exists in groups
    const selectedIndex = allGroups.findIndex(
      g => g.month === selectedMonth && g.year === selectedYear
    );

    // If selected month is found and not already first, reorder
    if (selectedIndex > 0) {
      const reordered = [...allGroups];
      const [selectedGroup] = reordered.splice(selectedIndex, 1);
      reordered.unshift(selectedGroup);
      return reordered.slice(0, this.visibleMonthCount());
    }

    return allGroups.slice(0, this.visibleMonthCount());
  });

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

  // Effect to load image URLs when receipts or visible months change
  private receiptsEffect = effect(() => {
    // React to changes in visible month groups (which depends on receipts)
    const visibleGroups = this.visibleMonthGroups();
    if (visibleGroups.length > 0) {
      // Load image URLs for visible receipts
      this.loadVisibleImageUrls();
    }
  });

  ngOnInit(): void {
    // Subscribe to real-time receipt updates
    this.receiptService.subscribeToReceipts();
  }

  ngOnDestroy(): void {
    this.receiptService.unsubscribeFromReceipts();
  }

  // Load image URLs for visible month groups
  async loadVisibleImageUrls(): Promise<void> {
    const visibleReceipts = this.visibleMonthGroups().flatMap(g => g.receipts);
    for (const receipt of visibleReceipts) {
      if (receipt.file?.storagePath && !this.imageUrls()[receipt.id]) {
        this.loadImageUrl(receipt);
      }
    }
  }

  // Load a single image URL (handles both images and PDFs)
  async loadImageUrl(receipt: Receipt): Promise<void> {
    const receiptId = receipt.id;
    const storagePath = receipt.file?.storagePath;

    if (!storagePath) return;

    // Skip if already loaded or loading
    if (this.imageUrls()[receiptId] || this.loadingImages().has(receiptId)) {
      return;
    }

    // Mark as loading
    this.loadingImages.update(set => {
      const newSet = new Set(set);
      newSet.add(receiptId);
      return newSet;
    });

    try {
      const url = await this.receiptService.getReceiptFileUrl(storagePath);

      // Check if it's a PDF - if so, generate a thumbnail
      if (this.isPdf(receipt)) {
        try {
          const thumbnailUrl = await this.pdfThumbnailService.generateThumbnail(url, 0.8);
          this.imageUrls.update(urls => ({
            ...urls,
            [receiptId]: thumbnailUrl
          }));
        } catch (pdfError) {
          console.error('Failed to generate PDF thumbnail:', pdfError);
          // Store the original URL as fallback (will show PDF icon)
          this.imageUrls.update(urls => ({
            ...urls,
            [receiptId]: url
          }));
        }
      } else {
        // Regular image - just store the URL
        this.imageUrls.update(urls => ({
          ...urls,
          [receiptId]: url
        }));
      }
    } catch (error) {
      console.error('Failed to load image URL:', error);
    } finally {
      this.loadingImages.update(set => {
        const newSet = new Set(set);
        newSet.delete(receiptId);
        return newSet;
      });
    }
  }

  // Handle scroll for infinite loading
  @HostListener('window:scroll')
  onScroll(): void {
    if (this.isLoadingMore() || !this.hasMoreMonths()) {
      return;
    }

    const scrollPosition = window.innerHeight + window.scrollY;
    const documentHeight = document.documentElement.scrollHeight;
    const threshold = 300; // Load more when 300px from bottom

    if (scrollPosition >= documentHeight - threshold) {
      this.loadMoreMonths();
    }
  }

  // Load more months
  async loadMoreMonths(): Promise<void> {
    if (this.isLoadingMore() || !this.hasMoreMonths()) {
      return;
    }

    this.isLoadingMore.set(true);

    // Simulate a small delay for smooth UX
    await new Promise(resolve => setTimeout(resolve, 200));

    this.visibleMonthCount.update(count => count + 2);

    // Load image URLs for newly visible receipts
    await this.loadVisibleImageUrls();

    this.isLoadingMore.set(false);
  }

  // Get image URL for a receipt
  getImageUrl(receipt: Receipt): string | null {
    return this.imageUrls()[receipt.id] || null;
  }

  // Check if image is loading
  isImageLoading(receiptId: string): boolean {
    return this.loadingImages().has(receiptId);
  }

  // Check if file is a PDF
  isPdf(receipt: Receipt): boolean {
    return receipt.file?.mimeType === 'application/pdf' ||
      receipt.file?.originalName?.toLowerCase().endsWith('.pdf');
  }

  // Navigate to receipt detail
  navigateToReceipt(receiptId: string): void {
    this.router.navigate(['/app/receipt', receiptId]);
  }

  // TrackBy functions for ngFor performance
  trackMonthGroup(index: number, group: MonthGroup): string {
    return `${group.year}-${group.month}`;
  }

  trackReceipt(index: number, receipt: Receipt): string {
    return receipt.id;
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

  // Click on a day in the graph to filter receipts
  onDayClick(day: { day: number; amount: number; cumulative: number }): void {
    const currentSelection = this.selectedDay();
    const selectedMonth = this.receiptService.selectedMonth();
    const selectedYear = this.receiptService.selectedYear();

    // Toggle off if same day is clicked
    if (currentSelection &&
        currentSelection.day === day.day &&
        currentSelection.month === selectedMonth &&
        currentSelection.year === selectedYear) {
      this.selectedDay.set(null);
    } else {
      this.selectedDay.set({
        day: day.day,
        month: selectedMonth,
        year: selectedYear
      });
    }
  }

  // Clear day selection
  clearDaySelection(): void {
    this.selectedDay.set(null);
  }

  // Check if a receipt matches the selected day
  isReceiptForSelectedDay(receipt: Receipt): boolean {
    const selection = this.selectedDay();
    if (!selection) return true; // No selection means all receipts are "selected"

    if (!receipt.date) return false;

    const receiptDate = new Date(receipt.date);
    return receiptDate.getDate() === selection.day &&
           receiptDate.getMonth() === selection.month &&
           receiptDate.getFullYear() === selection.year;
  }

  // Check if a receipt matches the active day (selected or hovered)
  // Selected takes priority over hovered
  isReceiptForActiveDay(receipt: Receipt): boolean {
    const selection = this.selectedDay();
    const hovered = this.hoveredDay();

    // If there's a selection, use that
    if (selection) {
      return this.isReceiptForSelectedDay(receipt);
    }

    // If hovering, check against hovered day
    if (hovered) {
      if (!receipt.date) return false;

      const receiptDate = new Date(receipt.date);
      const selectedMonth = this.receiptService.selectedMonth();
      const selectedYear = this.receiptService.selectedYear();

      return receiptDate.getDate() === hovered.day &&
             receiptDate.getMonth() === selectedMonth &&
             receiptDate.getFullYear() === selectedYear;
    }

    return true; // No active day means all receipts are shown
  }

  // Get amount for a specific day from daily spending data
  getAmountForDay(day: number): number {
    const data = this.dailySpendingData();
    const dayData = data.find(d => d.day === day);
    return dayData?.amount ?? 0;
  }

  // Chart helper methods for Robinhood-style graph
  getChartX(day: number): number {
    const data = this.dailySpendingData();
    if (data.length <= 1) return 100;
    return ((day - 1) / (data.length - 1)) * 200;
  }

  getChartY(amount: number): number {
    const data = this.dailySpendingData();
    const maxValue = Math.max(...data.map(d => d.amount), 1);
    const height = 100;
    const padding = 5;
    const chartHeight = height - padding * 2;
    return padding + chartHeight - (amount / maxValue) * chartHeight;
  }

  @HostListener('document:click', ['$event'])
  closeOnOutsideClick(event: Event) {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.menuOpen.set(false);
    }
  }
}

