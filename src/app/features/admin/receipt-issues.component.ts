import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IssueFilter, ReceiptIssueRow, ReceiptIssuesService, issueLabel, waitingSince } from './receipt-issues.service';

type IssueSort = 'priority' | 'oldest' | 'newest';

@Component({
  selector: 'app-receipt-issues', standalone: true, imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './receipt-issues.component.html', styleUrls: ['./receipt-issues-layout.css', './receipt-issues-base.css', './receipt-issues.css', './receipt-issues-support.css', './receipt-issues-responsive.css', './receipt-issues-queue.css'],
})
export class ReceiptIssuesComponent implements OnInit, OnDestroy {
  readonly issues = inject(ReceiptIssuesService);
  private readonly router = inject(Router);
  readonly label = issueLabel;
  readonly waiting = waitingSince;
  readonly filter = signal<IssueFilter>('all');
  readonly search = signal('');
  readonly pattern = signal('');
  readonly page = signal(1);
  readonly sort = signal<IssueSort>('priority');
  readonly sortDescription = computed(() => this.sort() === 'newest' ? 'Newest dates first, across all issue types.' : this.sort() === 'oldest' ? 'Oldest dates first, across all issue types.' : this.filter() === 'resolved' ? 'Most recently resolved first.' : 'Failures first, then the oldest receipts in each group.');
  readonly dateSort = computed(() => this.sort() === 'newest' || (this.sort() === 'priority' && this.filter() === 'resolved') ? 'descending' : this.sort() === 'oldest' ? 'ascending' : 'none');
  readonly filters: IssueFilter[] = ['all', 'failed', 'stuck', 'incomplete', 'awaiting_user', 'resolved', 'all_history'];
  readonly lookupUser = signal('');
  readonly lookupReceipt = signal('');
  private timer?: ReturnType<typeof setInterval>;
  readonly filtered = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.issues.rows().filter(row => {
      const filter = this.filter();
      const matches = filter === 'all_history' ? true : filter === 'resolved' ? row.state === 'resolved' : filter === 'awaiting_user' ? row.state === 'awaiting_user' : row.state !== 'resolved' && (filter === 'all' || row.kind === filter);
      return matches && (!this.pattern() || `${row.cause}|${row.reason}` === this.pattern()) && (!search || [row.receiptId, row.email, row.userId, row.merchant, row.fileName, row.reason, row.notes].some(value => value?.toLowerCase().includes(search)));
    }).sort((a, b) => {
      if (this.sort() !== 'priority') return this.compareDate(a, b, this.sort() === 'newest');
      if (this.filter() === 'resolved') return this.compareDate(a, b, true);
      const rank = { failed: 0, stuck: 1, incomplete: 2 };
      return Number(a.state === 'resolved') - Number(b.state === 'resolved') || rank[a.kind] - rank[b.kind] || this.compareDate(a, b, false);
    });
  });
  readonly pages = computed(() => Math.max(1, Math.ceil(this.filtered().length / 25)));
  readonly currentPage = computed(() => Math.min(this.page(), this.pages()));
  readonly visible = computed(() => this.filtered().slice((this.currentPage() - 1) * 25, this.currentPage() * 25));
  readonly patterns = computed(() => {
    const groups = new Map<string, { key: string; reason: string; cause: string; count: number; users: Set<string>; open: number }>();
    for (const row of this.issues.rows()) {
      const key = `${row.cause}|${row.reason}`;
      const group = groups.get(key) || { key, reason: row.reason, cause: row.cause, count: 0, users: new Set<string>(), open: 0 };
      group.count++; group.users.add(row.userId); if (row.state !== 'resolved') group.open++;
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  });
  count(filter: IssueFilter) {
    return this.issues.rows().filter(row => filter === 'all_history' ? true : filter === 'resolved' ? row.state === 'resolved' : filter === 'awaiting_user' ? row.state === 'awaiting_user' : row.state !== 'resolved' && (filter === 'all' || row.kind === filter)).length;
  }
  setFilter(value: IssueFilter) { this.filter.set(value); this.page.set(1); }
  setSort(value: IssueSort) { this.sort.set(value); this.page.set(1); }
  toggleDateSort() { this.setSort(this.dateSort() === 'descending' ? 'oldest' : 'newest'); }
  dateFor(row: ReceiptIssueRow) {
    const value = row.state === 'resolved' ? row.resolvedAt : row.openedAt;
    return value && Number.isFinite(Date.parse(value)) ? value : null;
  }
  private compareDate(a: ReceiptIssueRow, b: ReceiptIssueRow, newest: boolean) {
    const aTime = Date.parse(this.dateFor(a) || '');
    const bTime = Date.parse(this.dateFor(b) || '');
    if (Number.isFinite(aTime) !== Number.isFinite(bTime)) return Number.isFinite(aTime) ? -1 : 1;
    const difference = Number.isFinite(aTime) && Number.isFinite(bTime) ? (aTime - bTime) * (newest ? -1 : 1) : 0;
    return difference || `${a.userId}/${a.receiptId}`.localeCompare(`${b.userId}/${b.receiptId}`);
  }
  receiptTitle(row: ReceiptIssueRow) {
    if (row.merchant && row.merchant !== 'Unknown merchant' && row.merchant !== 'Unknown') return row.merchant;
    return /^(image_picker_|scaled_|img[_-]|pxl_|dsc[_-])/i.test(row.fileName) ? 'Receipt image' : row.fileName;
  }
  isPdf(row: ReceiptIssueRow) { return /\.pdf$/i.test(row.fileName); }
  selectPattern(key: string) { this.pattern.set(key); this.setFilter('all_history'); }
  lookup() {
    if (this.lookupUser().trim() && this.lookupReceipt().trim()) void this.router.navigate(['/app/admin/receipt-issues', this.lookupUser().trim(), this.lookupReceipt().trim()]);
  }
  ngOnInit() {
    void this.issues.load();
    this.timer = setInterval(() => { if (document.visibilityState === 'visible') void this.issues.load(); }, 60000);
  }
  ngOnDestroy() { clearInterval(this.timer); }
}
