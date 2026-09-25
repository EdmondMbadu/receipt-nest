import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { app } from '../../../../environments/environments';
import { ThemeService } from '../../services/theme.service';

interface UnsubscribeContextResponse {
  ok: boolean;
  email: string;
  unsubscribed: boolean;
}

interface UnsubscribeResponse {
  ok: boolean;
  email: string;
  alreadyUnsubscribed: boolean;
}

interface UnsubscribeLinkResponse {
  ok: boolean;
}

@Component({
  selector: 'app-unsubscribe',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './unsubscribe.component.html',
  styleUrl: './unsubscribe.component.css'
})
export class UnsubscribeComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly functions = getFunctions(app);
  private readonly theme = inject(ThemeService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  readonly isDarkMode = this.theme.isDarkMode;
  readonly currentYear = new Date().getFullYear();
  readonly loading = signal(true);
  readonly submitting = signal(false);
  readonly email = signal('');
  readonly reason = signal('');
  readonly otherReason = signal('');
  readonly success = signal(false);
  readonly alreadyUnsubscribed = signal(false);
  readonly error = signal<string | null>(null);
  readonly requestEmail = signal('');
  readonly requestingLink = signal(false);
  readonly requestLinkSent = signal(false);
  readonly requestLinkError = signal<string | null>(null);

  private readonly token = this.route.snapshot.queryParamMap.get('token')?.trim() ?? '';

  constructor() {
    this.title.setTitle('Unsubscribe - ReceiptNest');
    this.meta.updateTag({
      name: 'description',
      content: 'Manage non-essential ReceiptNest email preferences.'
    });
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    this.meta.updateTag({ name: 'googlebot', content: 'noindex, nofollow' });
    void this.loadContext();
  }

  toggleTheme(): void {
    this.theme.toggleTheme();
  }

  async unsubscribe(event?: SubmitEvent): Promise<void> {
    event?.preventDefault();
    if (this.submitting() || !this.token || !this.email()) {
      return;
    }

    this.error.set(null);
    this.submitting.set(true);
    try {
      const callable = httpsCallable<
        { token: string; reason: string },
        UnsubscribeResponse
      >(this.functions, 'submitEmailUnsubscribe');
      const response = await callable({ token: this.token, reason: this.selectedReason() });
      this.alreadyUnsubscribed.set(response.data.alreadyUnsubscribed);
      this.success.set(true);
    } catch (error) {
      console.error('Failed to unsubscribe email', error);
      this.error.set('We could not update your email preference right now. Please try again.');
    } finally {
      this.submitting.set(false);
    }
  }

  async requestUnsubscribeLink(event?: SubmitEvent): Promise<void> {
    event?.preventDefault();
    if (this.requestingLink()) {
      return;
    }

    const email = this.requestEmail().trim().toLowerCase();
    this.requestLinkError.set(null);
    if (!/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email)) {
      this.requestLinkError.set('Enter a valid email address.');
      return;
    }

    this.requestingLink.set(true);
    try {
      const callable = httpsCallable<{ email: string }, UnsubscribeLinkResponse>(
        this.functions,
        'requestEmailUnsubscribeLink'
      );
      await callable({ email });
      this.requestEmail.set(email);
      this.requestLinkSent.set(true);
    } catch (error) {
      console.error('Failed to request unsubscribe link', error);
      this.requestLinkError.set('We could not send a confirmation link right now. Please try again later.');
    } finally {
      this.requestingLink.set(false);
    }
  }

  private async loadContext(): Promise<void> {
    if (!this.token) {
      this.loading.set(false);
      return;
    }

    try {
      const callable = httpsCallable<{ token: string }, UnsubscribeContextResponse>(
        this.functions,
        'getEmailUnsubscribeContext'
      );
      const response = await callable({ token: this.token });
      this.email.set(response.data.email);
      this.alreadyUnsubscribed.set(response.data.unsubscribed);
      this.success.set(response.data.unsubscribed);
    } catch (error) {
      console.error('Failed to load unsubscribe link', error);
      this.error.set('This unsubscribe link is invalid. Please use the latest link from your email.');
    } finally {
      this.loading.set(false);
    }
  }

  private selectedReason(): string {
    if (this.reason() === 'Other') {
      const detail = this.otherReason().trim();
      return detail ? `Other: ${detail}` : 'Other';
    }
    return this.reason();
  }
}
