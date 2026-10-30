import { Component, DestroyRef, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DEFAULT_CATEGORIES } from '../../models/category.model';
import { ISSUE_CAUSE_OPTIONS, IssueDetail, ReceiptIssuesService, issueLabel, waitingSince } from './receipt-issues.service';

interface ReceiptFormValues {
  merchant: string; amount: number | null; currency: string; date: string; categoryId: string;
}

@Component({
  selector: 'app-receipt-issue-detail', standalone: true, imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './receipt-issue-detail.component.html', styleUrls: ['./receipt-issues-layout.css', './receipt-issues-base.css', './receipt-issues.css', './receipt-issues-support.css', './receipt-issue-detail.css', './receipt-issues-responsive.css'],
})
export class ReceiptIssueDetailComponent implements OnInit, OnDestroy {
  readonly issues = inject(ReceiptIssuesService);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  readonly detail = signal<IssueDetail | null>(null);
  readonly loading = signal(true);
  readonly busy = signal('');
  readonly error = signal('');
  readonly success = signal('');
  readonly previewUrl = signal('');
  readonly originalUrl = signal('');
  readonly safePdf = signal<SafeResourceUrl | null>(null);
  readonly previewError = signal('');
  readonly previewLoading = signal(false);
  readonly cause = signal('unknown');
  readonly notes = signal('');
  readonly merchant = signal('');
  readonly amount = signal<number | null>(null);
  readonly currency = signal('');
  readonly date = signal('');
  readonly categoryId = signal('other');
  readonly categories = DEFAULT_CATEGORIES;
  readonly causes = ISSUE_CAUSE_OPTIONS;
  readonly label = issueLabel;
  readonly waiting = waitingSince;
  readonly active = computed(() => {
    const detail = this.detail();
    return !!detail && (detail.row ? detail.row.active : ['uploaded', 'processing'].includes(detail.receipt.status));
  });
  readonly fieldsDirty = computed(() => {
    const receipt = this.detail()?.receipt;
    return !!receipt && (this.merchant() !== receipt.merchant || this.amount() !== receipt.totalAmount || this.currency() !== receipt.currency || this.date() !== receipt.date || this.categories.find(item => item.id === this.categoryId())?.name !== receipt.category);
  });
  readonly canCorrect = computed(() => !!this.merchant().trim() && typeof this.amount() === 'number' && this.amount()! > 0 && /^[A-Z]{3}$/.test(this.currency()) && !!this.date());
  private userId = '';
  private receiptId = '';
  private timer?: ReturnType<typeof setInterval>;
  private requestId = 0;
  private previewRequestId = 0;
  private formRevision = 0;
  private formSeed: ReceiptFormValues | null = null;
  private retryDraft: Partial<ReceiptFormValues> | null = null;
  private destroyed = false;

  ngOnInit() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.userId = params.get('userId') || ''; this.receiptId = params.get('receiptId') || '';
      this.retryDraft = null; this.formSeed = null; this.previewRequestId++;
      this.detail.set(null); this.success.set(''); this.previewUrl.set(''); this.originalUrl.set(''); this.safePdf.set(null);
      void this.load(true);
    });
    this.timer = setInterval(() => { if (this.active() && !this.busy() && document.visibilityState === 'visible') void this.load(false); }, 5000);
  }
  ngOnDestroy() { this.destroyed = true; clearInterval(this.timer); this.requestId++; this.previewRequestId++; }
  async load(reset: boolean) {
    const id = ++this.requestId;
    if (!this.detail()) this.loading.set(true);
    this.error.set('');
    try {
      const previousActive = this.active();
      const detail = await this.issues.detail(this.userId, this.receiptId);
      if (id !== this.requestId || this.destroyed) return;
      this.detail.set(detail);
      if (reset || previousActive && !this.active()) {
        const receipt = detail.receipt;
        const seed: ReceiptFormValues = {
          merchant: receipt.merchant || receipt.extraction?.supplierName?.value || '',
          amount: receipt.totalAmount ?? receipt.extraction?.totalAmount?.value ?? null,
          currency: receipt.currency || receipt.extraction?.currency?.value || '',
          date: receipt.date || receipt.extraction?.date?.value || '',
          categoryId: this.categories.find(category => category.name === receipt.category)?.id || 'other',
        };
        this.formSeed = seed;
        const values = { ...seed, ...this.retryDraft };
        this.merchant.set(values.merchant); this.amount.set(values.amount); this.currency.set(values.currency);
        this.date.set(values.date); this.categoryId.set(values.categoryId);
        this.cause.set(detail.issue?.cause || detail.row?.cause || 'unknown'); this.notes.set(detail.issue?.notes || '');
        this.formRevision = detail.revision;
        if (this.retryDraft && !this.active()) {
          this.retryDraft = null;
          if (detail.row?.kind === 'failed' || ['uploaded', 'processing'].includes(receipt.status)) {
            this.success.set('');
            this.error.set('Run again could not finish. Your edits were kept. Enter the remaining values and save the receipt manually.');
          } else {
            this.success.set('Run again is complete. Review any detected values, enter what is missing, and save. Your edits were kept.');
          }
        }
      }
      if (reset) void this.loadPreview(detail, ++this.previewRequestId);
    } catch (error) {
      if (id === this.requestId) this.error.set(this.issues.message(error, 'This receipt could not be loaded. Please try again.'));
    } finally { if (id === this.requestId) this.loading.set(false); }
  }
  private async loadPreview(detail: IssueDetail, id: number) {
    this.previewLoading.set(true); this.previewError.set(''); this.previewUrl.set(''); this.originalUrl.set(''); this.safePdf.set(null);
    try {
      const preview = await this.issues.preview(detail.receipt.userId, detail.receipt.id);
      if (id !== this.previewRequestId || this.destroyed) return;
      this.originalUrl.set(preview.originalUrl);
      this.previewUrl.set(preview.imageUrl);
      if (preview.pdfUrl) this.safePdf.set(this.sanitizer.bypassSecurityTrustResourceUrl(preview.pdfUrl));
      this.previewError.set(preview.error);
    } catch (error) {
      if (id === this.previewRequestId) this.previewError.set(this.issues.message(error, 'The original file could not be loaded. You can still enter and save the receipt values.'));
    } finally { if (id === this.previewRequestId) this.previewLoading.set(false); }
  }
  reloadPreview() {
    const detail = this.detail();
    if (detail && !this.previewLoading()) void this.loadPreview(detail, ++this.previewRequestId);
  }
  previewFailed() { this.previewUrl.set(''); this.previewError.set('This image could not be displayed. Open the original file to inspect it.'); }
  async act(action: string) {
    const detail = this.detail();
    if (!detail || this.busy() || this.active()) return;
    if (['awaiting_user', 'flag'].includes(action) && !this.notes().trim()) { this.error.set('Add a note explaining the problem or what the user needs to provide.'); return; }
    this.busy.set(action); this.error.set(''); this.success.set('');
    try {
      const draft: Partial<ReceiptFormValues> = {};
      if (action === 'retry' && this.formSeed) {
        const values: ReceiptFormValues = { merchant: this.merchant(), amount: this.amount(), currency: this.currency(), date: this.date(), categoryId: this.categoryId() };
        for (const key of Object.keys(values) as (keyof ReceiptFormValues)[]) {
          if (values[key] !== this.formSeed[key]) Object.assign(draft, { [key]: values[key] });
        }
      }
      const category = this.categories.find(item => item.id === this.categoryId())!;
      await this.issues.act({
        userId: this.userId, receiptId: this.receiptId, action,
        revision: action === 'correct' ? this.formRevision : detail.revision, cause: this.cause(), notes: this.notes(),
        ...(action === 'correct' ? { values: { merchant: this.merchant().trim(), totalAmount: this.amount(), currency: this.currency(), date: this.date(), category: category.name, categoryId: category.id } } : {}),
      });
      if (action === 'retry') this.retryDraft = draft;
      this.success.set(({ retry: 'Run again started. Available fields will fill automatically. Your manual edits are kept.', correct: 'Saved to the user’s receipt. The corrected values are now visible in their account.', resolve: 'Receipt verified and issue resolved.', awaiting_user: 'Marked as awaiting user. No message has been sent.', reopen: 'Issue reopened for investigation.', flag: 'Receipt added to the issues queue.' } as Record<string, string>)[action]);
      await this.load(true); void this.issues.load();
    } catch (error) { this.error.set(this.issues.message(error, 'The action could not be completed. Please try again.')); }
    finally { this.busy.set(''); }
  }
}
