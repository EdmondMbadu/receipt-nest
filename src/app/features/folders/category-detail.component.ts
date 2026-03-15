import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { Receipt } from '../../models/receipt.model';
import { Category, getCategoryById } from '../../models/category.model';
import { ReceiptService } from '../../services/receipt.service';

type TimeRange = 'month' | 'year' | 'allTime';

interface PeriodOption {
  key: string;
  label: string;
}

@Component({
  selector: 'app-category-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="min-h-screen bg-white dark:bg-slate-950">
      <div class="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div class="absolute -top-24 left-8 h-96 w-96 rounded-full bg-emerald-400/10 blur-[120px] dark:bg-emerald-500/15"></div>
        <div class="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-cyan-300/10 blur-[130px] dark:bg-cyan-500/10"></div>
      </div>

      <div class="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        <!-- Header -->
        <section class="rounded-3xl border border-slate-200/80 bg-white/85 p-5 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80 sm:p-7">
          <a routerLink="/app/folders" class="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 mb-4">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Collections
          </a>

          @if (category()) {
            <div class="flex items-center gap-4">
              <div class="inline-flex h-14 w-14 items-center justify-center rounded-2xl text-3xl" [style.background-color]="category()!.color + '18'">
                {{ category()!.icon }}
              </div>
              <div>
                <h1 class="text-2xl font-semibold text-slate-900 dark:text-white">{{ category()!.name }}</h1>
                <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {{ filteredReceipts().length }} receipt{{ filteredReceipts().length === 1 ? '' : 's' }}
                  · {{ formatCurrency(filteredTotal()) }}
                  @if (activeRange() !== 'allTime') {
                    <span class="text-slate-400 dark:text-slate-500"> · All time: {{ formatCurrency(totalAmount()) }}</span>
                  }
                </p>
              </div>
            </div>
          }

          <!-- Time range selector -->
          <div class="mt-5 flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            <button type="button" (click)="setTimeRange('month')"
              class="flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition"
              [class]="activeRange() === 'month'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'">
              Month
            </button>
            <button type="button" (click)="setTimeRange('year')"
              class="flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition"
              [class]="activeRange() === 'year'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'">
              Year
            </button>
            <button type="button" (click)="setTimeRange('allTime')"
              class="flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition"
              [class]="activeRange() === 'allTime'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'">
              All Time
            </button>
          </div>

          <!-- Period navigator -->
          @if (activeRange() !== 'allTime' && periods().length > 0) {
            <div class="relative mt-3 flex items-center rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <button type="button" (click)="prevPeriod()" [disabled]="!hasPrevPeriod()"
                class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-l-xl transition hover:bg-slate-50 disabled:opacity-20 dark:hover:bg-slate-800">
                <svg class="h-5 w-5 text-slate-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button type="button" (click)="togglePicker()" class="flex min-w-0 flex-1 items-center justify-center gap-1.5 py-2.5 transition hover:bg-slate-50 dark:hover:bg-slate-800">
                <span class="text-sm font-bold text-slate-900 dark:text-white">{{ activePeriodLabel() }}</span>
                <svg class="h-4 w-4 text-slate-400 transition" [class.rotate-180]="pickerOpen()" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              <button type="button" (click)="nextPeriod()" [disabled]="!hasNextPeriod()"
                class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-r-xl transition hover:bg-slate-50 disabled:opacity-20 dark:hover:bg-slate-800">
                <svg class="h-5 w-5 text-slate-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>

              @if (pickerOpen()) {
                <div class="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  @for (p of periods(); track p.key) {
                    <button type="button" (click)="selectPeriod(p.key)"
                      class="flex w-full items-center justify-between px-4 py-3 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800"
                      [class]="p.key === activePeriod()
                        ? 'bg-emerald-50 font-bold text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
                        : 'text-slate-700 dark:text-slate-300'">
                      <span>{{ p.label }}</span>
                      @if (p.key === activePeriod()) {
                        <svg class="h-4 w-4 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      }
                    </button>
                  }
                </div>
              }
            </div>
          }
        </section>

        <!-- Empty state -->
        @if (filteredReceipts().length === 0) {
          <section class="rounded-3xl border border-dashed border-slate-300 bg-white/80 p-10 text-center dark:border-slate-700 dark:bg-slate-900/60">
            <h2 class="text-xl font-semibold text-slate-900 dark:text-white">
              {{ activeRange() === 'allTime' ? 'No receipts in this category' : 'No receipts for this period' }}
            </h2>
            <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">
              {{ activeRange() === 'allTime' ? 'Receipts classified under this category will appear here.' : 'Try selecting a different period.' }}
            </p>
          </section>
        } @else {
          <!-- Receipt list -->
          <section class="rounded-3xl border border-slate-200/80 bg-white/85 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80 overflow-hidden">
            <div class="divide-y divide-slate-100 dark:divide-slate-800">
              @for (receipt of filteredReceipts(); track receipt.id) {
                <a [routerLink]="['/app/receipt', receipt.id]"
                   class="flex items-center gap-4 px-5 py-4 transition hover:bg-slate-50 dark:hover:bg-slate-800/50 sm:px-7">
                  <div class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
                       [style.background-color]="category()!.color + '18'"
                       [style.color]="category()!.color">
                    {{ getInitials(getMerchant(receipt)) }}
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-semibold text-slate-900 dark:text-white">{{ getMerchant(receipt) }}</p>
                    <p class="text-xs text-slate-500 dark:text-slate-400">{{ receipt.date || 'No date' }}</p>
                  </div>
                  <p class="text-sm font-semibold text-slate-900 dark:text-white">{{ formatCurrency(receipt.totalAmount || 0) }}</p>
                  <svg class="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9 6l6 6-6 6" />
                  </svg>
                </a>
              }
            </div>
          </section>
        }
      </div>
    </div>
  `,
  styles: [`:host { display: block; }`]
})
export class CategoryDetailComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly receiptService = inject(ReceiptService);

  readonly categoryId = signal<string>('other');
  readonly activeRange = signal<TimeRange>('month');
  readonly selectedPeriod = signal<string | null>(null);
  readonly pickerOpen = signal(false);

  readonly category = computed<Category | undefined>(() => {
    return getCategoryById(this.categoryId());
  });

  readonly categoryReceipts = computed<Receipt[]>(() => {
    const id = this.categoryId();
    return this.receiptService.receipts()
      .filter(r => (r.category?.id || 'other') === id)
      .sort((a, b) => {
        const da = a.date || '';
        const db = b.date || '';
        return db.localeCompare(da);
      });
  });

  readonly totalAmount = computed(() => {
    return this.categoryReceipts().reduce((sum, r) => sum + (r.totalAmount || 0), 0);
  });

  readonly periods = computed<PeriodOption[]>(() => {
    const range = this.activeRange();
    if (range === 'allTime') return [];

    const seen = new Map<string, PeriodOption>();
    for (const r of this.categoryReceipts()) {
      const d = this.parseDate(r.date);
      if (!d) continue;
      const key = range === 'month'
        ? `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
        : `${d.getFullYear()}`;
      if (!seen.has(key)) {
        const label = range === 'month'
          ? d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
          : `${d.getFullYear()}`;
        seen.set(key, { key, label });
      }
    }
    return Array.from(seen.values()).sort((a, b) => b.key.localeCompare(a.key));
  });

  readonly activePeriod = computed<string | null>(() => {
    const range = this.activeRange();
    if (range === 'allTime') return null;
    const periods = this.periods();
    const selected = this.selectedPeriod();
    if (selected && periods.some(p => p.key === selected)) return selected;
    return periods.length > 0 ? periods[0].key : null;
  });

  readonly activePeriodLabel = computed(() => {
    const key = this.activePeriod();
    if (!key) return '';
    return this.periods().find(p => p.key === key)?.label ?? '';
  });

  readonly activePeriodIndex = computed(() => {
    const key = this.activePeriod();
    return this.periods().findIndex(p => p.key === key);
  });

  readonly hasPrevPeriod = computed(() => {
    return this.activePeriodIndex() < this.periods().length - 1;
  });

  readonly hasNextPeriod = computed(() => {
    return this.activePeriodIndex() > 0;
  });

  readonly filteredReceipts = computed<Receipt[]>(() => {
    const range = this.activeRange();
    const receipts = this.categoryReceipts();
    if (range === 'allTime') return receipts;

    const period = this.activePeriod();
    if (!period) return [];

    return receipts.filter(r => {
      const d = this.parseDate(r.date);
      if (!d) return false;
      const key = range === 'month'
        ? `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
        : `${d.getFullYear()}`;
      return key === period;
    });
  });

  readonly filteredTotal = computed(() => {
    return this.filteredReceipts().reduce((sum, r) => sum + (r.totalAmount || 0), 0);
  });

  ngOnInit(): void {
    this.receiptService.subscribeToReceipts();
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.categoryId.set(id);
    }
  }

  ngOnDestroy(): void {
    this.receiptService.unsubscribeFromReceipts();
  }

  setTimeRange(range: TimeRange): void {
    this.activeRange.set(range);
    this.selectedPeriod.set(null);
    this.pickerOpen.set(false);
  }

  prevPeriod(): void {
    const periods = this.periods();
    const idx = this.activePeriodIndex();
    if (idx < periods.length - 1) {
      this.selectedPeriod.set(periods[idx + 1].key);
    }
  }

  nextPeriod(): void {
    const periods = this.periods();
    const idx = this.activePeriodIndex();
    if (idx > 0) {
      this.selectedPeriod.set(periods[idx - 1].key);
    }
  }

  selectPeriod(key: string): void {
    this.selectedPeriod.set(key);
    this.pickerOpen.set(false);
  }

  togglePicker(): void {
    this.pickerOpen.update(v => !v);
  }

  getMerchant(receipt: Receipt): string {
    return receipt.merchant?.canonicalName || receipt.merchant?.rawName || receipt.file?.originalName || 'Unknown';
  }

  getInitials(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.length >= 2 ? name.substring(0, 2).toUpperCase() : name.toUpperCase();
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  }

  private parseDate(dateStr?: string): Date | null {
    if (!dateStr) return null;
    // YYYY-MM-DD must be parsed as local time, not UTC
    const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      return new Date(+iso[1], +iso[2] - 1, +iso[3]);
    }
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }
}
