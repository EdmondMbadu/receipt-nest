import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IssueFilter, ReceiptIssuesService, issueLabel, waitingSince } from './receipt-issues.service';

@Component({
  selector: 'app-receipt-issues', standalone: true, imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './receipt-issues.component.html', styleUrls: ['./receipt-issues-layout.css', './receipt-issues-base.css', './receipt-issues.css', './receipt-issues-support.css', './receipt-issues-responsive.css'],
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
      if (this.filter() === 'resolved') return (b.resolvedAt || '').localeCompare(a.resolvedAt || '');
      const rank = { failed: 0, stuck: 1, incomplete: 2 };
      return rank[a.kind] - rank[b.kind] || (a.openedAt || '').localeCompare(b.openedAt || '');
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
