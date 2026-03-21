import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  Firestore,
  Timestamp,
  collection,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  Unsubscribe
} from 'firebase/firestore';

import { app } from '../../../../environments/environments';
import { UserProfile } from '../../models/user.model';
import { AuthService } from '../../services/auth.service';

type AdminUser = UserProfile;
type SummaryEmailPeriod = 'week' | 'month';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.css'
})
export class AdminComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly db: Firestore = getFirestore(app);
  private readonly functions = getFunctions(app);
  private usersUnsubscribe: Unsubscribe | null = null;

  readonly users = signal<AdminUser[]>([]);
  readonly isLoading = signal(true);
  readonly error = signal<string | null>(null);
  readonly testEmailTo = signal('');
  readonly testEmailSubject = signal('Test Email');
  readonly testEmailMessage = signal('This is a test email from ReceiptNest AI.');
  readonly testEmailSending = signal(false);
  readonly testEmailError = signal<string | null>(null);
  readonly testEmailSuccess = signal<string | null>(null);
  readonly summaryEmailTo = signal('');
  readonly summaryUserId = signal('');
  readonly selectedSummaryWeek = signal(this.getCurrentWeekValue());
  readonly selectedSummaryMonth = signal(this.getCurrentMonthValue());
  readonly weeklySummarySending = signal(false);
  readonly monthlySummarySending = signal(false);
  readonly summaryEmailError = signal<string | null>(null);
  readonly summaryEmailSuccess = signal<string | null>(null);

  readonly totalUsers = computed(() => this.users().length);
  readonly adminCount = computed(() => this.users().filter((user) => user.role === 'admin').length);
  readonly proCount = computed(() => this.users().filter((user) => user.subscriptionPlan === 'pro').length);
  readonly summaryUsers = computed(() =>
    [...this.users()].sort((a, b) => this.displayName(a).localeCompare(this.displayName(b)))
  );
  readonly selectedSummaryUser = computed(() =>
    this.summaryUsers().find((user) => user.id === this.summaryUserId()) ?? null
  );
  readonly weeklySummaryLabel = computed(() => this.getWeekRangeLabel(this.selectedSummaryWeek()));
  readonly monthlySummaryLabel = computed(() => this.getMonthLabel(this.selectedSummaryMonth()));

  constructor() {
    effect(() => {
      const authUser = this.auth.user();
      const users = this.summaryUsers();

      if (authUser?.email) {
        if (!this.testEmailTo()) {
          this.testEmailTo.set(authUser.email);
        }

        if (!this.summaryEmailTo()) {
          this.summaryEmailTo.set(authUser.email);
        }
      }

      if (!this.summaryUserId() && authUser?.id && users.some((user) => user.id === authUser.id)) {
        this.summaryUserId.set(authUser.id);
      }
    });
  }

  ngOnInit(): void {
    const usersRef = collection(this.db, 'users');
    const usersQuery = query(usersRef, orderBy('createdAt', 'desc'));

    this.usersUnsubscribe = onSnapshot(
      usersQuery,
      (snapshot) => {
        const users = snapshot.docs.map((doc) => {
          const data = doc.data() as Omit<UserProfile, 'id'>;
          return { id: doc.id, ...data };
        });
        this.users.set(users);
        this.isLoading.set(false);
      },
      (error) => {
        console.error('Failed to load users', error);
        this.error.set('Unable to load users right now.');
        this.isLoading.set(false);
      }
    );
  }

  ngOnDestroy(): void {
    this.usersUnsubscribe?.();
  }

  displayName(user: AdminUser): string {
    const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
    return fullName || user.email;
  }

  async sendSpendSummaryEmail(period: SummaryEmailPeriod): Promise<void> {
    this.summaryEmailError.set(null);
    this.summaryEmailSuccess.set(null);

    const to = this.summaryEmailTo().trim();
    if (!to) {
      this.summaryEmailError.set('Please enter a recipient email address for the summary.');
      return;
    }

    const userId = this.summaryUserId().trim();
    if (!userId) {
      this.summaryEmailError.set('Please choose which user account the summary should use.');
      return;
    }

    const selectedUser = this.selectedSummaryUser();
    const selectedValue = period === 'week' ? this.selectedSummaryWeek().trim() : this.selectedSummaryMonth().trim();
    if (!selectedValue) {
      this.summaryEmailError.set(period === 'week' ? 'Please choose a week.' : 'Please choose a month.');
      return;
    }

    const setSending = period === 'week' ? this.weeklySummarySending : this.monthlySummarySending;
    setSending.set(true);

    try {
      const callable = httpsCallable(this.functions, 'sendSpendSummaryEmail');
      await callable({
        to,
        userId,
        periodType: period,
        week: period === 'week' ? selectedValue : undefined,
        month: period === 'month' ? selectedValue : undefined,
        timeZone: this.getBrowserTimeZone()
      });

      const userLabel = selectedUser ? `${this.displayName(selectedUser)} (${selectedUser.email})` : userId;
      const periodLabel = period === 'week' ? this.weeklySummaryLabel() : this.monthlySummaryLabel();
      this.summaryEmailSuccess.set(
        `${period === 'week' ? 'Weekly' : 'Monthly'} summary sent to ${to} for ${userLabel} (${periodLabel}).`
      );
    } catch (error) {
      console.error(`Failed to send ${period} summary email`, error);
      this.summaryEmailError.set(
        `Unable to send the ${period === 'week' ? 'weekly' : 'monthly'} summary email right now.`
      );
    } finally {
      setSending.set(false);
    }
  }

  async sendTestEmail(): Promise<void> {
    this.testEmailError.set(null);
    this.testEmailSuccess.set(null);

    const to = this.testEmailTo().trim();
    if (!to) {
      this.testEmailError.set('Please enter a recipient email address.');
      return;
    }

    const subject = this.testEmailSubject().trim() || 'Test Email';
    const message = this.testEmailMessage().trim() || 'This is a test email from ReceiptNest AI.';

    this.testEmailSending.set(true);
    try {
      const callable = httpsCallable(this.functions, 'sendTestEmail');
      await callable({ to, subject, message });
      this.testEmailSuccess.set(`Test email sent to ${to}.`);
    } catch (error) {
      console.error('Failed to send test email', error);
      this.testEmailError.set('Unable to send the test email right now.');
    } finally {
      this.testEmailSending.set(false);
    }
  }

  formatDate(value?: UserProfile['createdAt'] | null): string {
    if (!value || !(value instanceof Timestamp)) {
      return '—';
    }

    try {
      return value.toDate().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return '—';
    }
  }

  private getCurrentMonthValue(): string {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  }

  private getCurrentWeekValue(): string {
    return this.formatIsoWeek(new Date());
  }

  private formatIsoWeek(date: Date): string {
    const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = utcDate.getUTCDay() || 7;
    utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);

    const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
    const weekNumber = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

    return `${utcDate.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
  }

  private getWeekRangeLabel(isoWeek: string): string {
    const match = isoWeek.match(/^(\d{4})-W(\d{2})$/);
    if (!match) {
      return 'Selected week';
    }

    const year = Number(match[1]);
    const week = Number(match[2]);
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7;
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);

    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);

    const sameMonth = monday.getUTCMonth() === sunday.getUTCMonth() && monday.getUTCFullYear() === sunday.getUTCFullYear();
    const startLabel = monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const endLabel = sunday.toLocaleDateString(
      'en-US',
      sameMonth
        ? { day: 'numeric', year: 'numeric' }
        : { month: 'short', day: 'numeric', year: 'numeric' }
    );

    return `${startLabel} - ${endLabel}`;
  }

  private getMonthLabel(monthValue: string): string {
    const match = monthValue.match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      return 'Selected month';
    }

    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    return new Date(year, month, 1).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric'
    });
  }

  private getBrowserTimeZone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
    } catch {
      return 'America/Los_Angeles';
    }
  }
}
