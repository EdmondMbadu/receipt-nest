import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ReceiptIssuesService, waitingSince } from './receipt-issues.service';

@Component({
  selector: 'app-receipt-issues-card', standalone: true, imports: [CommonModule, RouterLink],
  template: `
    <section class="rounded-2xl border p-5 sm:p-6" [class]="issues.error() ? 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/20' : 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20'">
      <div class="flex flex-wrap items-center justify-between gap-5">
        <div class="flex items-start gap-4">
          <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm dark:bg-slate-900 dark:text-emerald-400">
            <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 3H5v18l3-2 4 2 4-2 3 2V3h-4M9 3v3h6V3H9zm3 7v4m0 3h.01" /></svg>
          </div>
          <div>
            <h2 class="text-base font-semibold text-slate-900 dark:text-white">Receipts needing attention</h2>
            @if (issues.error()) {
              <p class="mt-2 max-w-xl text-sm text-rose-700 dark:text-rose-300" role="alert">{{ issues.error() }}</p>
              <button class="mt-2 text-sm font-semibold text-emerald-700 underline dark:text-emerald-400" (click)="issues.load()">Try again</button>
            } @else if (!issues.loaded()) {
              <p class="mt-2 text-sm text-slate-500 dark:text-slate-400" role="status">Checking receipt health…</p>
            } @else {
              <p class="mt-2 text-slate-900 dark:text-white"><span class="text-3xl font-semibold tracking-tight">{{ issues.unresolved().length | number }}</span><span class="ml-2 text-sm">unresolved · {{ issues.affectedUsers() }} affected users</span></p>
              <p class="mt-2 text-sm text-slate-600 dark:text-slate-300">{{ count('failed') }} failed · {{ count('stuck') }} stuck · {{ count('incomplete') }} incomplete @if (issues.oldest()) { <span class="mx-1">/</span> Oldest: {{ waiting(issues.oldest()) }} }</p>
            }
          </div>
        </div>
        <a routerLink="/app/admin/receipt-issues" class="inline-flex items-center gap-3 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600">Review receipts <span aria-hidden="true">→</span></a>
      </div>
    </section>
  `,
})
export class ReceiptIssuesCardComponent implements OnInit {
  readonly issues = inject(ReceiptIssuesService);
  readonly waiting = waitingSince;
  count(kind: string) { return this.issues.unresolved().filter(row => row.kind === kind).length; }
  ngOnInit() { void this.issues.load(false); }
}
