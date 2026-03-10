import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { Receipt } from '../../models/receipt.model';
import { Category, DEFAULT_CATEGORIES, getCategoryById } from '../../models/category.model';
import { ReceiptService } from '../../services/receipt.service';

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
            Back to Folders
          </a>

          @if (category()) {
            <div class="flex items-center gap-4">
              <div class="inline-flex h-14 w-14 items-center justify-center rounded-2xl text-3xl" [style.background-color]="category()!.color + '18'">
                {{ category()!.icon }}
              </div>
              <div>
                <h1 class="text-2xl font-semibold text-slate-900 dark:text-white">{{ category()!.name }}</h1>
                <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {{ categoryReceipts().length }} receipt{{ categoryReceipts().length === 1 ? '' : 's' }}
                  · {{ formatCurrency(totalAmount()) }}
                </p>
              </div>
            </div>
          }
        </section>

        <!-- Receipts -->
        @if (categoryReceipts().length === 0) {
          <section class="rounded-3xl border border-dashed border-slate-300 bg-white/80 p-10 text-center dark:border-slate-700 dark:bg-slate-900/60">
            <h2 class="text-xl font-semibold text-slate-900 dark:text-white">No receipts in this category</h2>
            <p class="mt-2 text-sm text-slate-500 dark:text-slate-400">Receipts classified under this category will appear here.</p>
          </section>
        } @else {
          <section class="rounded-3xl border border-slate-200/80 bg-white/85 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/80 overflow-hidden">
            <div class="divide-y divide-slate-100 dark:divide-slate-800">
              @for (receipt of categoryReceipts(); track receipt.id) {
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
}
