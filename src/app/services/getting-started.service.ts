import { Injectable, inject, signal } from '@angular/core';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../../environments/environments';
import { AuthService } from './auth.service';
import { GuideChange, GuideProgress, trackGettingStarted } from '../utils/getting-started';

@Injectable({ providedIn: 'root' })
export class GettingStartedService {
  private readonly auth = inject(AuthService);
  private readonly functions = getFunctions(app, 'us-central1');
  private uid: string | null = null;
  private retryChange: GuideChange | null = null;
  private pending: Promise<void> = Promise.resolve();
  readonly receiptCount = signal<number | null>(null);
  readonly progress = signal<GuideProgress | null>(null);
  readonly error = signal<string | null>(null);
  readonly ready = signal(false);

  async load(): Promise<void> {
    const uid = this.auth.user()?.id;
    if (!uid) return;
    if (this.uid !== uid) { this.progress.set(null); this.retryChange = null; }
    this.uid = uid;
    this.ready.set(false);
    this.receiptCount.set(null);
    this.error.set(null);
    try {
      const call = httpsCallable<void, { receiptCount: number; progress: GuideProgress | null }>(this.functions, 'getGettingStartedState');
      const { data } = await call();
      if (this.auth.user()?.id !== uid) return;
      this.receiptCount.set(data.receiptCount);
      this.progress.set(data.progress);
      this.ready.set(true);
    } catch {
      if (this.auth.user()?.id === uid) this.error.set('Getting started is unavailable right now. You can still add receipts or watch the walkthrough.');
    }
  }

  retry(): void { if (this.retryChange) this.save(this.retryChange); else void this.load(); }

  save(change: GuideChange): void {
    const uid = this.uid;
    if (!uid) return;
    this.pending = this.pending.then(async () => {
      if (this.auth.user()?.id !== uid) return;
      try {
        const call = httpsCallable<GuideChange, { progress: GuideProgress }>(this.functions, 'saveGettingStartedProgress');
        const { data } = await call(change);
        if (this.auth.user()?.id !== uid) return;
        this.progress.set(data.progress);
        this.error.set(null);
        this.retryChange = null;
        if (change.action === 'complete' || change.action === 'dismiss') trackGettingStarted('onboarding_' + change.action, 'dashboard');
      } catch {
        if (this.auth.user()?.id !== uid) return;
        this.retryChange = change;
        this.error.set('Your guide progress could not be saved. Please try again when you are connected.');
      }
    });
  }
}
