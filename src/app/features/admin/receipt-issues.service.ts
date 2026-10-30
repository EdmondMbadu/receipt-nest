import { Injectable, computed, signal } from '@angular/core';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../../../environments/environments';

export type IssueFilter = 'all' | 'failed' | 'stuck' | 'incomplete' | 'awaiting_user' | 'resolved' | 'all_history';
export interface ReceiptIssueRow {
  userId: string; receiptId: string; email: string; fileName: string; merchant: string;
  kind: 'failed' | 'stuck' | 'incomplete'; state: 'open' | 'awaiting_user' | 'resolved';
  reason: string; recommendation: string; cause: string; notes: string;
  openedAt: string | null; updatedAt: string | null; resolvedAt: string | null; active: boolean;
  model: string; pipelineVersion: string;
}
export interface IssueDetail {
  row: ReceiptIssueRow | null; revision: number;
  receipt: {
    id: string; userId: string; status: string; totalAmount: number | null; currency: string;
    date: string; merchant: string; category: string; createdAt: string; updatedAt: string;
    file?: { storagePath: string; mimeType: string; originalName: string; sizeBytes: number };
    email?: { previewStoragePath?: string; pdfStoragePath?: string };
    extraction?: { source?: string; overallConfidence?: number; totalAmount?: { value: number }; supplierName?: { value: string }; currency?: { value: string }; date?: { value: string } };
    processingAttempt?: { id: string; state: string; stage: string; startedAt: string; reason?: string; code?: string; model?: string; pipelineVersion?: string };
  };
  issue: { cause?: string; notes?: string; state?: string; resolution?: string } | null;
  events: Array<{ id: string; at: string; action: string; actor: string; cause?: string; notes?: string; reason?: string; outcome: string; before?: Record<string, unknown>; after?: Record<string, unknown>; extracted?: Record<string, unknown>; previousExtraction?: Record<string, unknown>; code?: string; stage?: string; model?: string; pipelineVersion?: string }>;
  historyLimited: boolean;
}
export interface ReceiptPreview {
  imageUrl: string; pdfUrl: string; originalUrl: string; error: string;
}
export const ISSUE_CAUSE_OPTIONS = [
  { value: 'unknown', label: 'Unknown / investigate' },
  { value: 'service_error', label: 'Service error' },
  { value: 'file_problem', label: 'File or conversion problem' },
  { value: 'unreadable_image', label: 'Unreadable image' },
  { value: 'extraction_mistake', label: 'Extraction mistake' },
  { value: 'classification_mistake', label: 'Category or merchant mistake' },
];
export function issueLabel(value: string): string {
  return ({ all: 'All unresolved', all_history: 'All history', failed: 'Failed', stuck: 'Stuck', incomplete: 'Incomplete', awaiting_user: 'Awaiting user', resolved: 'Resolved', open: 'Open', processing: 'Initial processing', retry_requested: 'Retry requested', retry: 'Processing retry', correct: 'Fields corrected', resolve: 'Verified & resolved', reopen: 'Reopened', flag: 'Flagged for review', succeeded: 'Validated', verified: 'Verified', service_error: 'Service error', file_problem: 'File problem', unreadable_image: 'Unreadable image', extraction_mistake: 'Extraction mistake', classification_mistake: 'Category or merchant mistake', unknown: 'Unknown / investigate' } as Record<string, string>)[value] || value.replace(/_/g, ' ');
}
export function waitingSince(value: string | null | undefined, now = Date.now()): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Time unknown';
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`;
}

@Injectable({ providedIn: 'root' })
export class ReceiptIssuesService {
  private readonly functions = getFunctions(app);
  readonly rows = signal<ReceiptIssueRow[]>([]);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly error = signal('');
  readonly fetchedAt = signal<string | null>(null);
  readonly unresolved = computed(() => this.rows().filter(row => row.state !== 'resolved'));
  readonly affectedUsers = computed(() => new Set(this.unresolved().map(row => row.userId)).size);
  readonly oldest = computed(() => this.unresolved().map(row => row.openedAt).filter((v): v is string => !!v).sort()[0]);
  async load() {
    if (this.loading()) return;
    this.loading.set(true); this.error.set('');
    try {
      const response = await httpsCallable<void, { rows: ReceiptIssueRow[]; fetchedAt: string }>(this.functions, 'getAdminReceiptIssues')();
      this.rows.set(response.data.rows); this.fetchedAt.set(response.data.fetchedAt); this.loaded.set(true);
    } catch (error) { this.error.set(this.message(error, 'Receipt issues could not be loaded. Please try again.')); }
    finally { this.loading.set(false); }
  }
  async detail(userId: string, receiptId: string): Promise<IssueDetail> {
    const result = await httpsCallable<{ userId: string; receiptId: string }, IssueDetail>(this.functions, 'getAdminReceiptIssue')({ userId, receiptId });
    return result.data;
  }
  async preview(userId: string, receiptId: string): Promise<ReceiptPreview> {
    const result = await httpsCallable<{ userId: string; receiptId: string }, ReceiptPreview>(this.functions, 'getAdminReceiptPreview')({ userId, receiptId });
    return result.data;
  }
  async act(data: Record<string, unknown>) {
    return httpsCallable(this.functions, 'actOnAdminReceiptIssue')(data);
  }
  message(error: unknown, fallback: string) {
    const value = error as { code?: string; message?: string };
    if (value?.code === 'functions/not-found') return 'The receipt or admin service was not found. Check that the receipt still exists and the latest functions are deployed.';
    return value?.message && value?.code !== 'functions/internal' && value.message.toLowerCase() !== 'internal' ? value.message : fallback;
  }
}
