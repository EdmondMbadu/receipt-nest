import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  Firestore,
  Timestamp,
  collection,
  doc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Unsubscribe
} from 'firebase/firestore';

import { app } from '../../../../environments/environments';
import {
  DEFAULT_FREE_PLAN_RECEIPT_LIMIT,
  PUBLIC_BILLING_CONFIG_COLLECTION,
  PUBLIC_BILLING_CONFIG_DOC_ID,
  normalizeFreePlanReceiptLimit
} from '../../config/subscription.constants';
import { UserProfile } from '../../models/user.model';
import { AuthService } from '../../services/auth.service';

type AdminUser = UserProfile;
type SummaryEmailPeriod = 'week' | 'month';
type SummaryNotificationPeriod = 'week' | 'month';
type WeeklyScheduleDay = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';

interface SpendSummaryScheduleResponse {
  timeZone: string;
  weekly: {
    enabled: boolean;
    dayOfWeek: WeeklyScheduleDay;
    time: string;
    lastPeriodSent: string | null;
    lastSentAt: string | null;
  };
  monthly: {
    enabled: boolean;
    dayOfMonth: number;
    time: string;
    lastPeriodSent: string | null;
    lastSentAt: string | null;
  };
}

interface SpendSummaryNotificationResponse {
  ok: boolean;
  dryRun: boolean;
  title: string;
  body: string;
  rangeLabel: string;
  receiptCount: number;
  totalSpend: number;
  tokenCount: number;
  sentCount?: number;
  failedCount?: number;
}

interface ReceiptCountBackfillResponse {
  ok: boolean;
  updatedCount: number;
}

const RECEIPT_COUNT_BACKFILL_BATCH_SIZE = 50;

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
  private billingConfigUnsubscribe: Unsubscribe | null = null;
  private readonly backfilledReceiptCountUserIds = new Set<string>();

  readonly users = signal<AdminUser[]>([]);
  readonly isLoading = signal(true);
  readonly error = signal<string | null>(null);
  readonly receiptCountSyncing = signal(false);
  readonly receiptCountSyncError = signal<string | null>(null);
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
  readonly weeklyNotificationSending = signal(false);
  readonly monthlyNotificationSending = signal(false);
  readonly weeklyNotificationPreviewLoading = signal(false);
  readonly monthlyNotificationPreviewLoading = signal(false);
  readonly summaryNotificationError = signal<string | null>(null);
  readonly summaryNotificationSuccess = signal<string | null>(null);
  readonly weeklyNotificationPreviewTitle = signal<string | null>(null);
  readonly weeklyNotificationPreviewBody = signal<string | null>(null);
  readonly weeklyNotificationPreviewMeta = signal<string | null>(null);
  readonly monthlyNotificationPreviewTitle = signal<string | null>(null);
  readonly monthlyNotificationPreviewBody = signal<string | null>(null);
  readonly monthlyNotificationPreviewMeta = signal<string | null>(null);
  readonly scheduleLoading = signal(true);
  readonly scheduleSaving = signal<'week' | 'month' | null>(null);
  readonly scheduleError = signal<string | null>(null);
  readonly scheduleSuccess = signal<string | null>(null);
  readonly scheduleTimeZone = signal(this.getBrowserTimeZone());
  readonly weeklyAutomationEnabled = signal(false);
  readonly weeklyAutomationDay = signal<WeeklyScheduleDay>('monday');
  readonly weeklyAutomationTime = signal('08:00');
  readonly weeklyAutomationLastPeriod = signal<string | null>(null);
  readonly weeklyAutomationLastSentAt = signal<string | null>(null);
  readonly monthlyAutomationEnabled = signal(false);
  readonly monthlyAutomationDay = signal(1);
  readonly monthlyAutomationTime = signal('08:00');
  readonly monthlyAutomationLastPeriod = signal<string | null>(null);
  readonly monthlyAutomationLastSentAt = signal<string | null>(null);
  readonly freePlanReceiptLimit = signal(DEFAULT_FREE_PLAN_RECEIPT_LIMIT);
  readonly freePlanReceiptLimitInput = signal(DEFAULT_FREE_PLAN_RECEIPT_LIMIT);
  readonly freePlanReceiptLimitSaving = signal(false);
  readonly freePlanReceiptLimitError = signal<string | null>(null);
  readonly freePlanReceiptLimitSuccess = signal<string | null>(null);

  readonly totalUsers = computed(() => this.users().length);
  readonly adminCount = computed(() => this.users().filter((user) => user.role === 'admin').length);
  readonly proCount = computed(() => this.users().filter((user) => user.subscriptionPlan === 'pro').length);
  readonly summaryUsers = computed(() =>
    [...this.users()].sort((a, b) => this.displayName(a).localeCompare(this.displayName(b)))
  );
  readonly selectedSummaryUser = computed(() =>
    this.summaryUsers().find((user) => user.id === this.summaryUserId()) ?? null
  );
  readonly selectedSummaryUserDeviceCount = computed(() => this.selectedSummaryUser()?.notificationTokens?.length ?? 0);
  readonly selectedSummaryUserNotificationTimeZone = computed(() =>
    this.selectedSummaryUser()?.notificationTimeZone || 'Not captured yet'
  );
  readonly weeklySummaryLabel = computed(() => this.getWeekRangeLabel(this.selectedSummaryWeek()));
  readonly monthlySummaryLabel = computed(() => this.getMonthLabel(this.selectedSummaryMonth()));
  readonly weeklyAutomationDescription = computed(() =>
    `${this.getWeekdayLabel(this.weeklyAutomationDay())} at ${this.formatTimeLabel(this.weeklyAutomationTime())}`
  );
  readonly monthlyAutomationDescription = computed(() =>
    `Day ${this.monthlyAutomationDay()} at ${this.formatTimeLabel(this.monthlyAutomationTime())}`
  );
  readonly weekdayOptions: Array<{ value: WeeklyScheduleDay; label: string }> = [
    { value: 'sunday', label: 'Sunday' },
    { value: 'monday', label: 'Monday' },
    { value: 'tuesday', label: 'Tuesday' },
    { value: 'wednesday', label: 'Wednesday' },
    { value: 'thursday', label: 'Thursday' },
    { value: 'friday', label: 'Friday' },
    { value: 'saturday', label: 'Saturday' }
  ];
  readonly monthDayOptions = Array.from({ length: 31 }, (_, index) => index + 1);

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
    void this.loadSpendSummarySchedule();

    const usersRef = collection(this.db, 'users');
    const usersQuery = query(usersRef, orderBy('createdAt', 'desc'));
    const billingConfigRef = doc(this.db, PUBLIC_BILLING_CONFIG_COLLECTION, PUBLIC_BILLING_CONFIG_DOC_ID);

    this.billingConfigUnsubscribe = onSnapshot(
      billingConfigRef,
      (snapshot) => {
        const limit = normalizeFreePlanReceiptLimit(snapshot.data()?.['freePlanReceiptLimit']);
        this.freePlanReceiptLimit.set(limit);
        this.freePlanReceiptLimitInput.set(limit);
      },
      (error) => {
        console.error('Failed to load billing config', error);
        this.freePlanReceiptLimitError.set('Unable to load the free-plan receipt limit right now.');
      }
    );

    this.usersUnsubscribe = onSnapshot(
      usersQuery,
      (snapshot) => {
        const users = snapshot.docs.map((doc) => {
          const data = doc.data() as Omit<UserProfile, 'id'>;
          return { id: doc.id, ...data };
        });
        this.users.set(users);
        this.isLoading.set(false);
        void this.backfillMissingReceiptCounts(users);
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
    this.billingConfigUnsubscribe?.();
  }

  displayName(user: AdminUser): string {
    const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
    return fullName || user.email;
  }

  setFreePlanReceiptLimitInput(value: string | number): void {
    const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
    this.freePlanReceiptLimitInput.set(Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0);
  }

  async saveFreePlanReceiptLimit(): Promise<void> {
    this.freePlanReceiptLimitError.set(null);
    this.freePlanReceiptLimitSuccess.set(null);

    const rawValue = this.freePlanReceiptLimitInput();
    if (!Number.isFinite(rawValue) || rawValue < 1) {
      this.freePlanReceiptLimitError.set('Enter a whole number greater than 0.');
      return;
    }

    this.freePlanReceiptLimitSaving.set(true);
    try {
      await setDoc(
        doc(this.db, PUBLIC_BILLING_CONFIG_COLLECTION, PUBLIC_BILLING_CONFIG_DOC_ID),
        {
          freePlanReceiptLimit: Math.floor(rawValue),
          updatedAt: serverTimestamp(),
          updatedBy: this.auth.user()?.id ?? null
        },
        { merge: true }
      );
      this.freePlanReceiptLimitSuccess.set('Free-plan receipt limit saved.');
    } catch (error) {
      console.error('Failed to save free-plan receipt limit', error);
      this.freePlanReceiptLimitError.set('Unable to save the free-plan receipt limit right now.');
    } finally {
      this.freePlanReceiptLimitSaving.set(false);
    }
  }

  async saveSpendSummarySchedule(period: 'week' | 'month'): Promise<void> {
    this.scheduleError.set(null);
    this.scheduleSuccess.set(null);
    this.scheduleSaving.set(period);

    try {
      const callable = httpsCallable<{
        timeZone: string;
        weekly: { enabled: boolean; dayOfWeek: WeeklyScheduleDay; time: string };
        monthly: { enabled: boolean; dayOfMonth: number; time: string };
      }, SpendSummaryScheduleResponse>(this.functions, 'updateSpendSummaryEmailSchedule');

      const response = await callable({
        timeZone: this.scheduleTimeZone(),
        weekly: {
          enabled: this.weeklyAutomationEnabled(),
          dayOfWeek: this.weeklyAutomationDay(),
          time: this.weeklyAutomationTime()
        },
        monthly: {
          enabled: this.monthlyAutomationEnabled(),
          dayOfMonth: this.monthlyAutomationDay(),
          time: this.monthlyAutomationTime()
        }
      });

      this.applyScheduleResponse(response.data);
      this.scheduleSuccess.set(
        period === 'week'
          ? 'Weekly automation schedule saved.'
          : 'Monthly automation schedule saved.'
      );
    } catch (error) {
      console.error(`Failed to save ${period} summary automation schedule`, error);
      this.scheduleError.set('Unable to save the automation schedule right now.');
    } finally {
      this.scheduleSaving.set(null);
    }
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

  async previewSpendSummaryNotification(period: SummaryNotificationPeriod): Promise<void> {
    await this.runSpendSummaryNotification(period, true);
  }

  async sendSpendSummaryNotification(period: SummaryNotificationPeriod): Promise<void> {
    await this.runSpendSummaryNotification(period, false);
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

  formatDateTime(value?: UserProfile['lastLoginAt'] | null): string {
    if (!value || !(value instanceof Timestamp)) {
      return 'Never';
    }

    try {
      return value.toDate().toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    } catch {
      return 'Never';
    }
  }

  private async backfillMissingReceiptCounts(users: AdminUser[]): Promise<void> {
    if (this.receiptCountSyncing()) {
      return;
    }

    const userIds = users
      .filter((user) => user.receiptCount == null && !this.backfilledReceiptCountUserIds.has(user.id))
      .map((user) => user.id)
      .slice(0, RECEIPT_COUNT_BACKFILL_BATCH_SIZE);

    if (userIds.length === 0) {
      return;
    }

    this.receiptCountSyncError.set(null);
    this.receiptCountSyncing.set(true);
    userIds.forEach((userId) => this.backfilledReceiptCountUserIds.add(userId));

    try {
      const callable = httpsCallable<{ userIds: string[] }, ReceiptCountBackfillResponse>(
        this.functions,
        'backfillUserReceiptCounts'
      );
      await callable({ userIds });
    } catch (error) {
      console.error('Failed to backfill user receipt counts', error);
      userIds.forEach((userId) => this.backfilledReceiptCountUserIds.delete(userId));
      this.receiptCountSyncError.set('Unable to sync receipt counts for some legacy users right now.');
    } finally {
      this.receiptCountSyncing.set(false);
    }
  }

  private getCurrentMonthValue(): string {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  }

  private async loadSpendSummarySchedule(): Promise<void> {
    this.scheduleLoading.set(true);
    this.scheduleError.set(null);

    try {
      const callable = httpsCallable<void, SpendSummaryScheduleResponse>(this.functions, 'getSpendSummaryEmailSchedule');
      const response = await callable();
      this.applyScheduleResponse(response.data);
    } catch (error) {
      console.error('Failed to load spend summary automation schedule', error);
      this.scheduleError.set('Unable to load the automation schedule right now.');
    } finally {
      this.scheduleLoading.set(false);
    }
  }

  private applyScheduleResponse(schedule: SpendSummaryScheduleResponse): void {
    this.scheduleTimeZone.set(schedule.timeZone || this.getBrowserTimeZone());
    this.weeklyAutomationEnabled.set(schedule.weekly.enabled);
    this.weeklyAutomationDay.set(schedule.weekly.dayOfWeek);
    this.weeklyAutomationTime.set(schedule.weekly.time);
    this.weeklyAutomationLastPeriod.set(schedule.weekly.lastPeriodSent);
    this.weeklyAutomationLastSentAt.set(schedule.weekly.lastSentAt);
    this.monthlyAutomationEnabled.set(schedule.monthly.enabled);
    this.monthlyAutomationDay.set(schedule.monthly.dayOfMonth);
    this.monthlyAutomationTime.set(schedule.monthly.time);
    this.monthlyAutomationLastPeriod.set(schedule.monthly.lastPeriodSent);
    this.monthlyAutomationLastSentAt.set(schedule.monthly.lastSentAt);
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

  private getWeekdayLabel(day: WeeklyScheduleDay): string {
    return this.weekdayOptions.find((option) => option.value === day)?.label ?? day;
  }

  private formatTimeLabel(value: string): string {
    if (!/^\d{2}:\d{2}$/.test(value)) {
      return value;
    }

    const [hours, minutes] = value.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  formatScheduleTimestamp(value: string | null): string {
    if (!value) {
      return 'Not sent yet';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return 'Not sent yet';
    }

    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  private async runSpendSummaryNotification(
    period: SummaryNotificationPeriod,
    dryRun: boolean
  ): Promise<void> {
    this.summaryNotificationError.set(null);
    this.summaryNotificationSuccess.set(null);

    const userId = this.summaryUserId().trim();
    if (!userId) {
      this.summaryNotificationError.set('Please choose which user account should receive the notification.');
      return;
    }

    const selectedValue = period === 'week' ? this.selectedSummaryWeek().trim() : this.selectedSummaryMonth().trim();
    if (!selectedValue) {
      this.summaryNotificationError.set(period === 'week' ? 'Please choose a week.' : 'Please choose a month.');
      return;
    }

    const selectedUser = this.selectedSummaryUser();
    const setLoading = dryRun
      ? (period === 'week' ? this.weeklyNotificationPreviewLoading : this.monthlyNotificationPreviewLoading)
      : (period === 'week' ? this.weeklyNotificationSending : this.monthlyNotificationSending);
    setLoading.set(true);

    try {
      const callable = httpsCallable<{
        userId: string;
        periodType: SummaryNotificationPeriod;
        week?: string;
        month?: string;
        timeZone: string;
        dryRun: boolean;
      }, SpendSummaryNotificationResponse>(this.functions, 'sendSpendSummaryNotification');

      const response = await callable({
        userId,
        periodType: period,
        week: period === 'week' ? selectedValue : undefined,
        month: period === 'month' ? selectedValue : undefined,
        timeZone: this.getBrowserTimeZone(),
        dryRun
      });

      this.applyNotificationPreview(period, response.data);

      const periodLabel = period === 'week' ? this.weeklySummaryLabel() : this.monthlySummaryLabel();
      const userLabel = selectedUser ? `${this.displayName(selectedUser)} (${selectedUser.email})` : userId;
      if (dryRun) {
        this.summaryNotificationSuccess.set(
          `${period === 'week' ? 'Weekly' : 'Monthly'} notification preview loaded for ${userLabel} (${periodLabel}).`
        );
      } else {
        this.summaryNotificationSuccess.set(
          `${period === 'week' ? 'Weekly' : 'Monthly'} notification sent to ${userLabel}. Delivered to ${response.data.sentCount ?? 0} device${(response.data.sentCount ?? 0) === 1 ? '' : 's'}.`
        );
      }
    } catch (error: any) {
      console.error(`Failed to ${dryRun ? 'preview' : 'send'} ${period} summary notification`, error);
      this.summaryNotificationError.set(
        error?.message ||
          `Unable to ${dryRun ? 'preview' : 'send'} the ${period === 'week' ? 'weekly' : 'monthly'} notification right now.`
      );
    } finally {
      setLoading.set(false);
    }
  }

  private applyNotificationPreview(
    period: SummaryNotificationPeriod,
    response: SpendSummaryNotificationResponse
  ): void {
    const meta = `${response.rangeLabel} • ${response.receiptCount} receipt${response.receiptCount === 1 ? '' : 's'} • ${response.tokenCount} registered device${response.tokenCount === 1 ? '' : 's'}`;

    if (period === 'week') {
      this.weeklyNotificationPreviewTitle.set(response.title);
      this.weeklyNotificationPreviewBody.set(response.body);
      this.weeklyNotificationPreviewMeta.set(meta);
      return;
    }

    this.monthlyNotificationPreviewTitle.set(response.title);
    this.monthlyNotificationPreviewBody.set(response.body);
    this.monthlyNotificationPreviewMeta.set(meta);
  }
}
