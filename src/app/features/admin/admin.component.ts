import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  Firestore,
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  Unsubscribe
} from 'firebase/firestore';

import { app } from '../../../../environments/environments';
import {
  BillingMode,
  DEFAULT_FREE_PLAN_RECEIPT_LIMIT,
  PUBLIC_BILLING_CONFIG_COLLECTION,
  PUBLIC_BILLING_CONFIG_DOC_ID,
  normalizeBillingMode,
  normalizeFreePlanReceiptLimit
} from '../../config/subscription.constants';
import { FeedbackMessage } from '../../models/feedback.model';
import { UserProfile } from '../../models/user.model';
import { AuthService } from '../../services/auth.service';
import {
  EffectiveSubscriptionSource,
  getEffectiveSubscriptionPlan,
  getEffectiveSubscriptionSource,
  hasManualProOverride
} from '../../utils/subscription.utils';

type AdminUser = UserProfile;
type AdminFeedback = FeedbackMessage;
type SummaryEmailPeriod = 'week' | 'month';
type SummaryNotificationPeriod = 'week' | 'month';
type WeeklyScheduleDay = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';
type UserSortColumn = 'name' | 'email' | 'role' | 'plan' | 'receipts' | 'lastLogin' | 'lastSeen' | 'created';
type SortDirection = 'asc' | 'desc';
type CustomEmailPlanFilter = 'all' | 'free' | 'pro';
type CustomEmailRoleFilter = 'all' | 'admin' | 'user';
type CustomEmailProSourceFilter = 'all' | 'paid' | 'admin' | 'none';
type CustomEmailBillingFilter = 'all' | 'live' | 'test';
type CustomEmailReceiptFilter = 'all' | 'hasReceipts' | 'noReceipts';
type UserGrowthView = 'year' | 'month';
type ReceiptProcessingUserView = 'day' | 'month';
type UserDirectoryView = 'real' | 'all';

interface UserGrowthMonth {
  index: number;
  shortLabel: string;
  longLabel: string;
  count: number;
  cumulative: number;
  isCurrentMonth: boolean;
  isFuture: boolean;
}

interface UserGrowthSummary {
  months: UserGrowthMonth[];
  total: number;
  maxCount: number;
  activeMonthCount: number;
  averagePerMonth: number;
  peakMonth: UserGrowthMonth | null;
}

interface UserGrowthDay {
  day: number;
  count: number;
  cumulative: number;
  isCurrentDay: boolean;
  isFuture: boolean;
}

interface UserGrowthDaySummary {
  days: UserGrowthDay[];
  total: number;
  maxCount: number;
  activeDayCount: number;
  averagePerDay: number;
  peakDay: UserGrowthDay | null;
}

interface ReceiptProcessingDay {
  day: number;
  count: number;
  cumulative: number;
  isCurrentDay: boolean;
  isFuture: boolean;
}

interface ReceiptProcessingSummary {
  days: ReceiptProcessingDay[];
  total: number;
  maxCount: number;
  activeDayCount: number;
  averagePerDay: number;
  peakDay: ReceiptProcessingDay | null;
}

interface ReceiptProcessingStatsResponse {
  ok: boolean;
  allTimeTotal: number;
  year: number;
  month: number;
  days: Array<{ day: number; count: number; latestProcessedAt?: string }>;
  users?: ReceiptProcessingUserCount[];
  generatedAt?: string;
}

interface ReceiptProcessingUserCount {
  userId: string;
  monthCount: number;
  days: Array<{ day: number; count: number; latestProcessedAt?: string }>;
  latestProcessedAt?: string;
}

interface ReceiptProcessingUserRow {
  user: AdminUser | null;
  userId: string;
  name: string;
  email: string;
  count: number;
  monthCount: number;
  latestProcessedAt?: string;
}

interface CustomEmailRecipient {
  key: string;
  source: 'system' | 'csv';
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  userId?: string;
  role?: string;
  plan?: 'free' | 'pro';
  planSource?: EffectiveSubscriptionSource;
  billingMode?: BillingMode;
  receiptCount?: number;
}

interface CustomEmailHtmlTemplate {
  id: string;
  name: string;
  html: string;
  updatedAt: string;
}

interface CustomEmailSendResponse {
  ok: boolean;
  sentCount: number;
  failedCount: number;
  failedRecipients?: Array<{ email: string; reason: string }>;
}

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

interface UserProAccessResponse {
  ok: boolean;
  userId: string;
  effectivePlan: 'free' | 'pro';
  manualOverrideActive: boolean;
}

interface BillingModeStatusResponse {
  ok: boolean;
  defaultBillingMode: BillingMode;
  hasLiveConfig: boolean;
  hasTestConfig: boolean;
}

interface UserBillingModeResponse {
  ok: boolean;
  userId: string;
  billingMode: BillingMode;
}

type UserProAccessMode = 'grant' | 'revoke';

const RECEIPT_COUNT_BACKFILL_BATCH_SIZE = 50;
const CUSTOM_EMAIL_TEMPLATE_STORAGE_KEY = 'receiptNestAdminCustomEmailHtmlTemplates';
const MONTH_LABELS = [
  { short: 'Jan', long: 'January' },
  { short: 'Feb', long: 'February' },
  { short: 'Mar', long: 'March' },
  { short: 'Apr', long: 'April' },
  { short: 'May', long: 'May' },
  { short: 'Jun', long: 'June' },
  { short: 'Jul', long: 'July' },
  { short: 'Aug', long: 'August' },
  { short: 'Sep', long: 'September' },
  { short: 'Oct', long: 'October' },
  { short: 'Nov', long: 'November' },
  { short: 'Dec', long: 'December' }
] as const;

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
  private feedbackUnsubscribe: Unsubscribe | null = null;
  private billingConfigUnsubscribe: Unsubscribe | null = null;
  private readonly backfilledReceiptCountUserIds = new Set<string>();
  private receiptProcessingStatsRequestId = 0;

  readonly users = signal<AdminUser[]>([]);
  readonly feedback = signal<AdminFeedback[]>([]);
  readonly isLoading = signal(true);
  readonly feedbackLoading = signal(true);
  readonly error = signal<string | null>(null);
  readonly feedbackError = signal<string | null>(null);
  readonly feedbackSuccess = signal<string | null>(null);
  readonly feedbackActionPendingId = signal<string | null>(null);
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
  readonly defaultBillingMode = signal<BillingMode>('live');
  readonly billingModeLoading = signal(true);
  readonly billingModeError = signal<string | null>(null);
  readonly hasLiveBillingConfig = signal(false);
  readonly hasTestBillingConfig = signal(false);
  readonly userBillingModeActionPendingUserId = signal<string | null>(null);
  readonly userBillingModeActionError = signal<string | null>(null);
  readonly userBillingModeActionSuccess = signal<string | null>(null);
  readonly userPlanActionPendingUserId = signal<string | null>(null);
  readonly userPlanActionError = signal<string | null>(null);
  readonly userPlanActionSuccess = signal<string | null>(null);
  readonly userSortColumn = signal<UserSortColumn>('created');
  readonly userSortDirection = signal<SortDirection>('desc');
  readonly userDirectoryView = signal<UserDirectoryView>('real');
  readonly selectedGrowthView = signal<UserGrowthView>('year');
  readonly selectedGrowthYear = signal(new Date().getFullYear());
  readonly selectedGrowthMonth = signal(new Date().getMonth());
  readonly selectedReceiptProcessingYear = signal(new Date().getFullYear());
  readonly selectedReceiptProcessingMonth = signal(new Date().getMonth());
  readonly selectedReceiptProcessingDay = signal(new Date().getDate());
  readonly receiptProcessingUserView = signal<ReceiptProcessingUserView>('day');
  readonly receiptProcessingStats = signal<ReceiptProcessingStatsResponse | null>(null);
  readonly receiptProcessingOverviewStats = signal<ReceiptProcessingStatsResponse | null>(null);
  readonly receiptProcessingLoading = signal(true);
  readonly receiptProcessingError = signal<string | null>(null);
  readonly customEmailSubject = signal('Unlock Pro in ReceiptNest AI');
  readonly customEmailPreheader = signal('A quick note from ReceiptNest AI about your account.');
  readonly customEmailHtml = signal(this.getDefaultCustomEmailHtml());
  readonly customEmailText = signal(
    'Dear {{firstName}},\n\nYou signed up for ReceiptNest AI, and Pro is ready when you want unlimited receipt capture and deeper spending insights.\n\nOpen your account: https://receipt-nest.com/app/pricing\n\nReceiptNest AI'
  );
  readonly customEmailSearch = signal('');
  readonly customEmailPlanFilter = signal<CustomEmailPlanFilter>('free');
  readonly customEmailRoleFilter = signal<CustomEmailRoleFilter>('all');
  readonly customEmailProSourceFilter = signal<CustomEmailProSourceFilter>('all');
  readonly customEmailBillingFilter = signal<CustomEmailBillingFilter>('all');
  readonly customEmailReceiptFilter = signal<CustomEmailReceiptFilter>('all');
  readonly customEmailCsvRecipients = signal<CustomEmailRecipient[]>([]);
  readonly customEmailSelectedKeys = signal<Set<string>>(new Set());
  readonly customEmailSending = signal(false);
  readonly customEmailError = signal<string | null>(null);
  readonly customEmailSuccess = signal<string | null>(null);
  readonly customEmailCsvError = signal<string | null>(null);
  readonly customEmailPreviewKey = signal<string | null>(null);
  readonly customEmailTemplateName = signal('');
  readonly customEmailTemplates = signal<CustomEmailHtmlTemplate[]>([]);
  readonly customEmailTemplateError = signal<string | null>(null);
  readonly customEmailTemplateSuccess = signal<string | null>(null);

  readonly totalUsers = computed(() => this.users().length);
  readonly realUsers = computed(() => this.users().filter((user) => !this.isLikelyBotUser(user)));
  readonly realUserCount = computed(() => this.realUsers().length);
  readonly likelyBotCount = computed(() => Math.max(0, this.totalUsers() - this.realUserCount()));
  readonly visibleDirectoryUsers = computed(() =>
    this.userDirectoryView() === 'real' ? this.realUsers() : this.users()
  );
  readonly adminCount = computed(() => this.users().filter((user) => user.role === 'admin').length);
  readonly proCount = computed(() => this.users().filter((user) => this.effectivePlan(user) === 'pro').length);
  readonly openFeedbackCount = computed(() => this.feedback().filter((item) => item.status !== 'archived').length);
  readonly archivedFeedbackCount = computed(() => this.feedback().filter((item) => item.status === 'archived').length);
  readonly availableGrowthYears = computed(() => {
    const years = new Set<number>([new Date().getFullYear()]);
    this.users().forEach((user) => {
      const createdAt = this.userCreatedDate(user);
      if (createdAt) {
        years.add(createdAt.getFullYear());
      }
    });

    return [...years].sort((a, b) => b - a);
  });
  readonly userGrowthSummary = computed<UserGrowthSummary>(() => {
    const selectedYear = this.selectedGrowthYear();
    const today = new Date();
    const activeMonthCount = selectedYear === today.getFullYear() ? today.getMonth() + 1 : 12;
    const counts = Array.from({ length: 12 }, () => 0);

    this.users().forEach((user) => {
      const createdAt = this.userCreatedDate(user);
      if (!createdAt || createdAt.getFullYear() !== selectedYear) {
        return;
      }

      counts[createdAt.getMonth()] += 1;
    });

    let cumulative = 0;
    const months = counts.map((count, index) => {
      cumulative += count;
      return {
        index,
        shortLabel: MONTH_LABELS[index].short,
        longLabel: MONTH_LABELS[index].long,
        count,
        cumulative,
        isCurrentMonth: selectedYear === today.getFullYear() && index === today.getMonth(),
        isFuture: selectedYear === today.getFullYear() && index > today.getMonth()
      };
    });
    const total = counts.reduce((sum, count) => sum + count, 0);
    const maxCount = Math.max(...counts, 0);
    const peakMonth = maxCount > 0
      ? months.reduce((peak, month) => (month.count > peak.count ? month : peak), months[0])
      : null;

    return {
      months,
      total,
      maxCount,
      activeMonthCount,
      averagePerMonth: total / activeMonthCount,
      peakMonth
    };
  });
  readonly userGrowthRangeLabel = computed(() => {
    const selectedYear = this.selectedGrowthYear();
    const today = new Date();
    const endMonthIndex = selectedYear === today.getFullYear() ? today.getMonth() : 11;
    return `Jan - ${MONTH_LABELS[endMonthIndex].short} ${selectedYear}`;
  });
  readonly userGrowthPeakLabel = computed(() => {
    const peakMonth = this.userGrowthSummary().peakMonth;
    return peakMonth ? `${peakMonth.longLabel} (${peakMonth.count})` : 'No signups yet';
  });
  readonly userGrowthYAxisTicks = computed(() => this.buildHistogramTicks(this.userGrowthSummary().maxCount));
  readonly isSelectedGrowthYearCurrent = computed(() => this.selectedGrowthYear() === new Date().getFullYear());
  readonly growthMonthOptions = MONTH_LABELS.map((month, index) => ({ ...month, index }));
  readonly selectedGrowthMonthLabel = computed(() =>
    `${MONTH_LABELS[this.selectedGrowthMonth()].long} ${this.selectedGrowthYear()}`
  );
  readonly userGrowthDaySummary = computed<UserGrowthDaySummary>(() => {
    const selectedYear = this.selectedGrowthYear();
    const selectedMonth = this.selectedGrowthMonth();
    const today = new Date();
    const isCurrentMonth = selectedYear === today.getFullYear() && selectedMonth === today.getMonth();
    const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
    const activeDayCount = isCurrentMonth ? today.getDate() : daysInMonth;
    const counts = Array.from({ length: daysInMonth }, () => 0);

    this.users().forEach((user) => {
      const createdAt = this.userCreatedDate(user);
      if (
        !createdAt ||
        createdAt.getFullYear() !== selectedYear ||
        createdAt.getMonth() !== selectedMonth
      ) {
        return;
      }

      counts[createdAt.getDate() - 1] += 1;
    });

    let cumulative = 0;
    const days = counts.map((count, index) => {
      const day = index + 1;
      cumulative += count;
      return {
        day,
        count,
        cumulative,
        isCurrentDay: isCurrentMonth && day === today.getDate(),
        isFuture: isCurrentMonth && day > today.getDate()
      };
    });
    const total = counts.reduce((sum, count) => sum + count, 0);
    const maxCount = Math.max(...counts, 0);
    const peakDay = maxCount > 0
      ? days.reduce((peak, day) => (day.count > peak.count ? day : peak), days[0])
      : null;

    return {
      days,
      total,
      maxCount,
      activeDayCount,
      averagePerDay: total / activeDayCount,
      peakDay
    };
  });
  readonly userGrowthDayPeakLabel = computed(() => {
    const peakDay = this.userGrowthDaySummary().peakDay;
    return peakDay ? `Day ${peakDay.day} (${peakDay.count})` : 'No signups yet';
  });
  readonly userGrowthDayYAxisTicks = computed(() => this.buildHistogramTicks(this.userGrowthDaySummary().maxCount));
  readonly isSelectedGrowthMonthCurrent = computed(() => {
    const today = new Date();
    return this.selectedGrowthYear() === today.getFullYear() && this.selectedGrowthMonth() === today.getMonth();
  });
  readonly selectedReceiptProcessingMonthLabel = computed(() =>
    `${MONTH_LABELS[this.selectedReceiptProcessingMonth()].long} ${this.selectedReceiptProcessingYear()}`
  );
  readonly receiptProcessingAllTimeTotal = computed(() =>
    this.receiptProcessingOverviewStats()?.allTimeTotal ??
    this.receiptProcessingStats()?.allTimeTotal ??
    this.users().reduce((sum, user) => sum + (user.receiptCount ?? 0), 0)
  );
  readonly receiptProcessingTodayTotal = computed(() => {
    const today = new Date();
    const stats = this.receiptProcessingOverviewStats();
    if (!stats || stats.year !== today.getFullYear() || stats.month !== today.getMonth() + 1) {
      return 0;
    }

    return stats.days.find((entry) => entry.day === today.getDate())?.count ?? 0;
  });
  readonly receiptProcessingOverviewLoading = computed(
    () => this.receiptProcessingLoading() && this.receiptProcessingOverviewStats() === null
  );
  readonly receiptProcessingSummary = computed<ReceiptProcessingSummary>(() => {
    const selectedYear = this.selectedReceiptProcessingYear();
    const selectedMonth = this.selectedReceiptProcessingMonth();
    const today = new Date();
    const isCurrentMonth = selectedYear === today.getFullYear() && selectedMonth === today.getMonth();
    const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
    const activeDayCount = isCurrentMonth ? today.getDate() : daysInMonth;
    const counts = Array.from({ length: daysInMonth }, () => 0);

    this.receiptProcessingStats()?.days.forEach((entry) => {
      if (entry.day >= 1 && entry.day <= daysInMonth) {
        counts[entry.day - 1] = entry.count;
      }
    });

    let cumulative = 0;
    const days = counts.map((count, index) => {
      const day = index + 1;
      cumulative += count;
      return {
        day,
        count,
        cumulative,
        isCurrentDay: isCurrentMonth && day === today.getDate(),
        isFuture: isCurrentMonth && day > today.getDate()
      };
    });
    const total = counts.reduce((sum, count) => sum + count, 0);
    const maxCount = Math.max(...counts, 0);
    const peakDay = maxCount > 0
      ? days.reduce((peak, day) => (day.count > peak.count ? day : peak), days[0])
      : null;

    return {
      days,
      total,
      maxCount,
      activeDayCount,
      averagePerDay: total / activeDayCount,
      peakDay
    };
  });
  readonly receiptProcessingPeakLabel = computed(() => {
    const peakDay = this.receiptProcessingSummary().peakDay;
    return peakDay ? `Day ${peakDay.day} (${peakDay.count})` : 'No receipts yet';
  });
  readonly receiptProcessingYAxisTicks = computed(() => this.buildHistogramTicks(this.receiptProcessingSummary().maxCount));
  readonly receiptProcessingDayOptions = computed(() => {
    const daysInMonth = new Date(
      this.selectedReceiptProcessingYear(),
      this.selectedReceiptProcessingMonth() + 1,
      0
    ).getDate();
    return Array.from({ length: daysInMonth }, (_, index) => index + 1);
  });
  readonly selectedReceiptProcessingDayLabel = computed(() => {
    const date = new Date(
      this.selectedReceiptProcessingYear(),
      this.selectedReceiptProcessingMonth(),
      this.selectedReceiptProcessingDay()
    );
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  });
  readonly receiptProcessingUserRangeLabel = computed(() =>
    this.receiptProcessingUserView() === 'day'
      ? this.selectedReceiptProcessingDayLabel()
      : this.selectedReceiptProcessingMonthLabel()
  );
  readonly receiptProcessingUserRows = computed<ReceiptProcessingUserRow[]>(() => {
    const stats = this.receiptProcessingStats();
    if (!stats?.users?.length) {
      return [];
    }

    const usersById = new Map(this.users().map((user) => [user.id, user]));
    const selectedDay = this.selectedReceiptProcessingDay();
    const view = this.receiptProcessingUserView();

    return stats.users
      .map((entry) => {
        const user = usersById.get(entry.userId) ?? null;
        const dayEntry = entry.days.find((item) => item.day === selectedDay);
        const count = view === 'day'
          ? dayEntry?.count ?? 0
          : entry.monthCount;

        return {
          user,
          userId: entry.userId,
          name: user ? this.displayName(user) : 'Deleted or unavailable user',
          email: user?.email || entry.userId,
          count,
          monthCount: entry.monthCount,
          latestProcessedAt: view === 'day' ? dayEntry?.latestProcessedAt : entry.latestProcessedAt
        };
      })
      .filter((row) => row.count > 0)
      .sort((a, b) =>
        b.count - a.count ||
        this.compareIsoDateTime(b.latestProcessedAt, a.latestProcessedAt) ||
        this.compareText(a.name, b.name)
      );
  });
  readonly receiptProcessingUserTotal = computed(() =>
    this.receiptProcessingUserRows().reduce((sum, row) => sum + row.count, 0)
  );
  readonly sortedUsers = computed(() => {
    const column = this.userSortColumn();
    const direction = this.userSortDirection();
    const multiplier = direction === 'asc' ? 1 : -1;

    return [...this.visibleDirectoryUsers()].sort((a, b) => this.compareUsers(a, b, column) * multiplier);
  });
  readonly summaryUsers = computed(() =>
    [...this.users()].sort((a, b) => this.compareText(this.displayName(a), this.displayName(b)))
  );
  readonly customEmailSystemRecipients = computed(() => {
    const search = this.customEmailSearch().trim().toLowerCase();
    const planFilter = this.customEmailPlanFilter();
    const roleFilter = this.customEmailRoleFilter();
    const proSourceFilter = this.customEmailProSourceFilter();
    const billingFilter = this.customEmailBillingFilter();
    const receiptFilter = this.customEmailReceiptFilter();

    return this.summaryUsers()
      .filter((user) => Boolean(user.email))
      .filter((user) => {
        const plan = this.effectivePlan(user);
        const role = user.role || 'user';
        const planSource = this.planSource(user);
        const billingMode = this.effectiveBillingMode(user);
        const receiptCount = user.receiptCount ?? 0;

        if (planFilter !== 'all' && plan !== planFilter) {
          return false;
        }

        if (roleFilter !== 'all' && role !== roleFilter) {
          return false;
        }

        if (proSourceFilter === 'paid' && planSource !== 'billing') {
          return false;
        }

        if (proSourceFilter === 'admin' && planSource !== 'admin') {
          return false;
        }

        if (proSourceFilter === 'none' && planSource !== 'free') {
          return false;
        }

        if (billingFilter !== 'all' && billingMode !== billingFilter) {
          return false;
        }

        if (receiptFilter === 'hasReceipts' && receiptCount < 1) {
          return false;
        }

        if (receiptFilter === 'noReceipts' && receiptCount > 0) {
          return false;
        }

        if (!search) {
          return true;
        }

        const haystack = [
          user.firstName,
          user.lastName,
          this.displayName(user),
          user.email,
          user.id
        ].join(' ').toLowerCase();
        return haystack.includes(search);
      })
      .map((user) => this.toCustomEmailRecipient(user));
  });
  readonly allCustomEmailRecipients = computed(() => {
    const seenEmails = new Set<string>();
    const recipients = [...this.customEmailSystemRecipients(), ...this.customEmailCsvRecipients()];

    return recipients.filter((recipient) => {
      const emailKey = recipient.email.toLowerCase();
      if (seenEmails.has(emailKey)) {
        return false;
      }

      seenEmails.add(emailKey);
      return true;
    });
  });
  readonly selectedCustomEmailRecipients = computed(() => {
    const selectedKeys = this.customEmailSelectedKeys();
    const systemRecipients = this.users()
      .filter((user) => selectedKeys.has(this.customEmailUserKey(user.id)) && Boolean(user.email))
      .map((user) => this.toCustomEmailRecipient(user));
    const csvRecipients = this.customEmailCsvRecipients().filter((recipient) => selectedKeys.has(recipient.key));
    const seenEmails = new Set<string>();

    return [...systemRecipients, ...csvRecipients].filter((recipient) => {
      const emailKey = recipient.email.toLowerCase();
      if (seenEmails.has(emailKey)) {
        return false;
      }

      seenEmails.add(emailKey);
      return true;
    });
  });
  readonly customEmailPreviewRecipient = computed(() => {
    const selectedPreviewKey = this.customEmailPreviewKey();
    const recipients = this.selectedCustomEmailRecipients();
    if (selectedPreviewKey) {
      const selected = recipients.find((recipient) => recipient.key === selectedPreviewKey);
      if (selected) {
        return selected;
      }
    }

    return recipients[0] ?? this.allCustomEmailRecipients()[0] ?? null;
  });
  readonly customEmailRenderedPreview = computed(() => {
    const recipient = this.customEmailPreviewRecipient();
    return this.renderCustomEmailTemplate(this.customEmailHtml(), recipient);
  });
  readonly customEmailPreviewSelection = computed(() => this.customEmailPreviewRecipient()?.key ?? '');
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
    this.loadCustomEmailTemplates();
    void this.loadSpendSummarySchedule();
    void this.loadBillingModeStatus();
    void this.loadReceiptProcessingStats();

    const usersRef = collection(this.db, 'users');
    const feedbackQuery = query(collection(this.db, 'feedback'), orderBy('createdAt', 'desc'));
    const billingConfigRef = doc(this.db, PUBLIC_BILLING_CONFIG_COLLECTION, PUBLIC_BILLING_CONFIG_DOC_ID);

    this.billingConfigUnsubscribe = onSnapshot(
      billingConfigRef,
      (snapshot) => {
        const data = snapshot.data();
        const limit = normalizeFreePlanReceiptLimit(data?.['freePlanReceiptLimit']);
        this.freePlanReceiptLimit.set(limit);
        this.freePlanReceiptLimitInput.set(limit);
      },
      (error) => {
        console.error('Failed to load billing config', error);
        this.freePlanReceiptLimitError.set('Unable to load the free-plan receipt limit right now.');
      }
    );

    this.usersUnsubscribe = onSnapshot(
      usersRef,
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

    this.feedbackUnsubscribe = onSnapshot(
      feedbackQuery,
      (snapshot) => {
        const feedback = snapshot.docs.map((doc) => {
          const data = doc.data() as Omit<FeedbackMessage, 'id'>;
          return { id: doc.id, ...data };
        });
        this.feedback.set(feedback);
        this.feedbackLoading.set(false);
      },
      (error) => {
        console.error('Failed to load feedback', error);
        this.feedbackError.set('Unable to load feedback right now.');
        this.feedbackLoading.set(false);
      }
    );
  }

  ngOnDestroy(): void {
    this.usersUnsubscribe?.();
    this.feedbackUnsubscribe?.();
    this.billingConfigUnsubscribe?.();
  }

  displayName(user: AdminUser): string {
    const fullName = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
    return fullName || user.email || user.id || 'Unknown user';
  }

  isLikelyBotUser(user: AdminUser): boolean {
    if (user.role === 'admin') {
      return false;
    }

    const firstName = (user.firstName || '').trim();
    const lastName = (user.lastName || '').trim();
    const email = (user.email || '').trim().toLowerCase();
    const emailLocalPart = email.split('@')[0] || '';
    const firstNameToken = this.normalizeIdentityToken(firstName.includes('@') ? firstName.split('@')[0] : firstName);
    const lastNameToken = this.normalizeIdentityToken(lastName);
    const emailLocalToken = this.normalizeIdentityToken(emailLocalPart);
    const displayName = this.displayName(user).trim().toLowerCase();

    const generatedEmailLocal = this.isGeneratedIdentityToken(emailLocalToken);
    if (!generatedEmailLocal) {
      return false;
    }

    const nameMirrorsEmail = Boolean(firstNameToken && firstNameToken === emailLocalToken);
    const nameIsEmail = Boolean(firstName && firstName.toLowerCase() === email);
    const displayIsEmail = displayName === email;
    const generatedFirstNameOnly = Boolean(firstNameToken && !lastNameToken && this.isGeneratedIdentityToken(firstNameToken));
    const anonymousPrivateRelay = !firstName && !lastName && email.endsWith('@privaterelay.appleid.com');

    return nameMirrorsEmail || nameIsEmail || displayIsEmail || generatedFirstNameOnly || anonymousPrivateRelay;
  }

  customEmailUserKey(userId: string): string {
    return `user:${userId}`;
  }

  isCustomEmailRecipientSelected(key: string): boolean {
    return this.customEmailSelectedKeys().has(key);
  }

  toggleCustomEmailRecipient(key: string, selected: boolean): void {
    const nextKeys = new Set(this.customEmailSelectedKeys());
    if (selected) {
      nextKeys.add(key);
    } else {
      nextKeys.delete(key);
    }
    this.customEmailSelectedKeys.set(nextKeys);
  }

  selectVisibleCustomEmailRecipients(): void {
    const nextKeys = new Set(this.customEmailSelectedKeys());
    this.allCustomEmailRecipients().forEach((recipient) => nextKeys.add(recipient.key));
    this.customEmailSelectedKeys.set(nextKeys);
    this.customEmailError.set(null);
    this.customEmailSuccess.set(`${this.allCustomEmailRecipients().length} visible recipient(s) selected.`);
  }

  clearCustomEmailRecipients(): void {
    this.customEmailSelectedKeys.set(new Set());
    this.customEmailSuccess.set(null);
    this.customEmailError.set(null);
  }

  removeCustomEmailCsvRecipient(key: string): void {
    this.customEmailCsvRecipients.set(this.customEmailCsvRecipients().filter((recipient) => recipient.key !== key));
    this.toggleCustomEmailRecipient(key, false);
  }

  async importCustomEmailCsv(event: Event): Promise<void> {
    this.customEmailCsvError.set(null);
    this.customEmailSuccess.set(null);

    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const importedRecipients = this.parseCustomEmailCsv(text);
      if (importedRecipients.length === 0) {
        this.customEmailCsvError.set('No valid email addresses were found in that CSV.');
        return;
      }

      const existingByEmail = new Map(
        this.customEmailCsvRecipients().map((recipient) => [recipient.email.toLowerCase(), recipient])
      );
      importedRecipients.forEach((recipient) => existingByEmail.set(recipient.email.toLowerCase(), recipient));
      this.customEmailCsvRecipients.set([...existingByEmail.values()].sort((a, b) => this.compareText(a.email, b.email)));

      const nextKeys = new Set(this.customEmailSelectedKeys());
      importedRecipients.forEach((recipient) => nextKeys.add(recipient.key));
      this.customEmailSelectedKeys.set(nextKeys);
      this.customEmailSuccess.set(`${importedRecipients.length} CSV recipient(s) imported and selected.`);
    } catch (error) {
      console.error('Failed to import custom email CSV', error);
      this.customEmailCsvError.set('Unable to read that CSV file.');
    } finally {
      if (input) {
        input.value = '';
      }
    }
  }

  async sendCustomEmail(): Promise<void> {
    this.customEmailError.set(null);
    this.customEmailSuccess.set(null);

    const subject = this.customEmailSubject().trim();
    const preheader = this.customEmailPreheader().trim();
    const html = this.customEmailHtml().trim();
    const text = this.customEmailText().trim();
    const recipients = this.selectedCustomEmailRecipients();

    if (!subject) {
      this.customEmailError.set('Enter an email subject.');
      return;
    }

    if (!html) {
      this.customEmailError.set('Add an HTML template before sending.');
      return;
    }

    if (recipients.length === 0) {
      this.customEmailError.set('Select at least one recipient or import a CSV.');
      return;
    }

    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Send "${subject}" to ${recipients.length} recipient(s)?`)
    ) {
      return;
    }

    this.customEmailSending.set(true);
    try {
      const callable = httpsCallable<
        {
          subject: string;
          preheader: string;
          html: string;
          text: string;
          recipients: CustomEmailRecipient[];
        },
        CustomEmailSendResponse
      >(this.functions, 'sendCustomAdminEmail');

      const response = await callable({
        subject,
        preheader,
        html,
        text,
        recipients
      });

      const failedCount = response.data.failedCount ?? 0;
      this.customEmailSuccess.set(
        failedCount > 0
          ? `Sent ${response.data.sentCount} email(s). ${failedCount} recipient(s) failed.`
          : `Sent ${response.data.sentCount} custom email(s).`
      );
      if (failedCount > 0) {
        this.customEmailError.set(
          (response.data.failedRecipients || [])
            .slice(0, 3)
            .map((failure) => `${failure.email}: ${failure.reason}`)
            .join(' | ') || 'Some recipients failed.'
        );
      }
    } catch (error: any) {
      console.error('Failed to send custom admin email', error);
      this.customEmailError.set(error?.message || 'Unable to send the custom email right now.');
    } finally {
      this.customEmailSending.set(false);
    }
  }

  openCustomEmailPreviewPage(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.customEmailError.set(null);
    const previewWindow = window.open('', '_blank');
    if (!previewWindow) {
      this.customEmailError.set('Pop-up blocked. Allow pop-ups to open the preview page.');
      return;
    }

    previewWindow.opener = null;
    previewWindow.document.open();
    previewWindow.document.write(this.customEmailRenderedPreview());
    previewWindow.document.close();
  }

  saveCustomEmailHtmlTemplate(): void {
    this.customEmailTemplateError.set(null);
    this.customEmailTemplateSuccess.set(null);

    const name = this.customEmailTemplateName().trim();
    const html = this.customEmailHtml().trim();

    if (!name) {
      this.customEmailTemplateError.set('Give this HTML template a name before saving.');
      return;
    }

    if (!html) {
      this.customEmailTemplateError.set('Add HTML before saving this template.');
      return;
    }

    const templates = this.customEmailTemplates();
    const existingTemplate = templates.find((template) => template.name.toLowerCase() === name.toLowerCase());
    const updatedTemplate: CustomEmailHtmlTemplate = {
      id: existingTemplate?.id || this.createCustomEmailTemplateId(),
      name,
      html,
      updatedAt: new Date().toISOString()
    };
    const nextTemplates = this.sortCustomEmailTemplates([
      updatedTemplate,
      ...templates.filter((template) => template.id !== updatedTemplate.id)
    ]);

    this.customEmailTemplates.set(nextTemplates);
    this.persistCustomEmailTemplates(nextTemplates);
    this.customEmailTemplateName.set(name);
    this.customEmailTemplateSuccess.set(
      existingTemplate ? `Updated "${name}".` : `Saved "${name}".`
    );
  }

  loadCustomEmailHtmlTemplate(templateId: string): void {
    const template = this.customEmailTemplates().find((item) => item.id === templateId);
    if (!template) {
      this.customEmailTemplateError.set('That saved template could not be found.');
      this.customEmailTemplateSuccess.set(null);
      return;
    }

    this.customEmailHtml.set(template.html);
    this.customEmailTemplateName.set(template.name);
    this.customEmailTemplateError.set(null);
    this.customEmailTemplateSuccess.set(`Loaded "${template.name}" into the editor.`);
  }

  downloadCustomEmailHtmlTemplate(template: CustomEmailHtmlTemplate): void {
    if (typeof document === 'undefined' || typeof URL === 'undefined') {
      return;
    }

    const blob = new Blob([template.html], { type: 'text/html;charset=utf-8' });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `${this.sanitizeTemplateFileName(template.name)}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
  }

  deleteCustomEmailHtmlTemplate(templateId: string): void {
    const template = this.customEmailTemplates().find((item) => item.id === templateId);
    if (!template) {
      return;
    }

    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Delete saved HTML template "${template.name}"?`)
    ) {
      return;
    }

    const nextTemplates = this.customEmailTemplates().filter((item) => item.id !== templateId);
    this.customEmailTemplates.set(nextTemplates);
    this.persistCustomEmailTemplates(nextTemplates);
    this.customEmailTemplateError.set(null);
    this.customEmailTemplateSuccess.set(`Deleted "${template.name}".`);
  }

  effectivePlan(user: AdminUser): 'free' | 'pro' {
    return getEffectiveSubscriptionPlan(user);
  }

  planSource(user: AdminUser): EffectiveSubscriptionSource {
    return getEffectiveSubscriptionSource(user);
  }

  hasManualProAccess(user: AdminUser): boolean {
    return hasManualProOverride(user);
  }

  planSourceLabel(user: AdminUser): string {
    switch (this.planSource(user)) {
      case 'admin':
        return 'Admin override';
      case 'billing':
        return 'Paid subscription';
      default:
        return 'No Pro access';
    }
  }

  isUserPlanActionPending(userId: string): boolean {
    return this.userPlanActionPendingUserId() === userId;
  }

  isFeedbackActionPending(feedbackId: string): boolean {
    return this.feedbackActionPendingId() === feedbackId;
  }

  async archiveFeedback(item: AdminFeedback): Promise<void> {
    if (this.feedbackActionPendingId() || item.status === 'archived') {
      return;
    }

    this.feedbackError.set(null);
    this.feedbackSuccess.set(null);
    this.feedbackActionPendingId.set(item.id);

    try {
      await updateDoc(doc(this.db, 'feedback', item.id), {
        status: 'archived',
        archivedAt: serverTimestamp(),
        archivedBy: this.auth.user()?.id ?? null,
        updatedAt: serverTimestamp()
      });
      this.feedbackSuccess.set('Feedback archived.');
    } catch (error) {
      console.error('Failed to archive feedback', error);
      this.feedbackError.set('Unable to archive feedback right now.');
    } finally {
      this.feedbackActionPendingId.set(null);
    }
  }

  async deleteFeedback(item: AdminFeedback): Promise<void> {
    if (this.feedbackActionPendingId()) {
      return;
    }

    const targetLabel = item.email || item.displayName || 'this user';
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`Delete this feedback from ${targetLabel}? This cannot be undone.`)
    ) {
      return;
    }

    this.feedbackError.set(null);
    this.feedbackSuccess.set(null);
    this.feedbackActionPendingId.set(item.id);

    try {
      await deleteDoc(doc(this.db, 'feedback', item.id));
      this.feedbackSuccess.set('Feedback deleted.');
    } catch (error) {
      console.error('Failed to delete feedback', error);
      this.feedbackError.set('Unable to delete feedback right now.');
    } finally {
      this.feedbackActionPendingId.set(null);
    }
  }

  async updateUserProAccess(user: AdminUser, mode: UserProAccessMode): Promise<void> {
    if (this.userPlanActionPendingUserId()) {
      return;
    }

    this.userPlanActionError.set(null);
    this.userPlanActionSuccess.set(null);

    const targetLabel = `${this.displayName(user)} (${user.email})`;
    const confirmationMessage = mode === 'grant'
      ? `Grant Pro access to ${targetLabel}? This keeps Stripe billing data intact and adds an admin override.`
      : `Remove the admin-granted Pro override for ${targetLabel}? Their account will return to its normal billing state.`;

    if (typeof window !== 'undefined' && !window.confirm(confirmationMessage)) {
      return;
    }

    this.userPlanActionPendingUserId.set(user.id);

    try {
      const callable = httpsCallable<{ userId: string; mode: UserProAccessMode }, UserProAccessResponse>(
        this.functions,
        'setUserProAccess'
      );
      await callable({ userId: user.id, mode });

      this.userPlanActionSuccess.set(
        mode === 'grant'
          ? `Pro access granted to ${targetLabel}.`
          : `Admin-granted Pro access removed for ${targetLabel}.`
      );
    } catch (error: any) {
      console.error(`Failed to ${mode} Pro access`, error);
      this.userPlanActionError.set(
        error?.message ||
          `Unable to ${mode === 'grant' ? 'grant' : 'remove'} Pro access right now.`
      );
    } finally {
      this.userPlanActionPendingUserId.set(null);
    }
  }

  setFreePlanReceiptLimitInput(value: string | number): void {
    const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
    this.freePlanReceiptLimitInput.set(Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0);
  }

  billingModeLabel(mode: BillingMode): string {
    return mode === 'test' ? 'Test' : 'Live';
  }

  effectiveBillingMode(user: AdminUser): BillingMode {
    return normalizeBillingMode(user.billingModeOverride);
  }

  billingModeSourceLabel(user: AdminUser): string {
    return this.effectiveBillingMode(user) === 'test'
      ? 'Per-user test override'
      : `Default ${this.billingModeLabel(this.defaultBillingMode()).toLowerCase()} billing`;
  }

  isUserBillingModeActionPending(userId: string): boolean {
    return this.userBillingModeActionPendingUserId() === userId;
  }

  async updateUserBillingMode(user: AdminUser, mode: BillingMode): Promise<void> {
    if (this.userBillingModeActionPendingUserId() || this.effectiveBillingMode(user) === mode) {
      return;
    }

    if ((mode === 'test' && !this.hasTestBillingConfig()) || (mode === 'live' && !this.hasLiveBillingConfig())) {
      this.billingModeError.set(`Stripe ${this.billingModeLabel(mode).toLowerCase()} configuration is incomplete.`);
      return;
    }

    this.billingModeError.set(null);
    this.userBillingModeActionError.set(null);
    this.userBillingModeActionSuccess.set(null);

    const targetLabel = `${this.displayName(user)} (${user.email})`;
    const confirmationMessage = mode === 'test'
      ? `Switch ${targetLabel} to Stripe test billing only? Their live billing state will be preserved and restored when you switch them back.`
      : `Return ${targetLabel} to live Stripe billing? Their stored test billing state will be kept for future QA.`;

    if (typeof window !== 'undefined' && !window.confirm(confirmationMessage)) {
      return;
    }

    this.userBillingModeActionPendingUserId.set(user.id);

    try {
      const callable = httpsCallable<{ userId: string; mode: BillingMode }, UserBillingModeResponse>(
        this.functions,
        'setUserBillingMode'
      );
      const response = await callable({ userId: user.id, mode });
      this.userBillingModeActionSuccess.set(
        `${targetLabel} now uses ${this.billingModeLabel(response.data.billingMode).toLowerCase()} billing.`
      );
      await this.loadBillingModeStatus();
    } catch (error: any) {
      console.error('Failed to update user billing mode', error);
      this.userBillingModeActionError.set(error?.message || 'Unable to switch billing for this user right now.');
    } finally {
      this.userBillingModeActionPendingUserId.set(null);
    }
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

  async saveSpendSummarySchedule(period: 'week' | 'month'): Promise<boolean> {
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
      return true;
    } catch (error) {
      console.error(`Failed to save ${period} summary automation schedule`, error);
      this.scheduleError.set('Unable to save the automation schedule right now.');
      return false;
    } finally {
      this.scheduleSaving.set(null);
    }
  }

  async toggleSpendSummarySchedule(period: 'week' | 'month'): Promise<void> {
    if (this.scheduleSaving()) {
      return;
    }

    const isWeekly = period === 'week';
    const targetSignal = isWeekly ? this.weeklyAutomationEnabled : this.monthlyAutomationEnabled;
    const previousValue = targetSignal();
    targetSignal.set(!previousValue);

    const saved = await this.saveSpendSummarySchedule(period);
    if (!saved) {
      targetSignal.set(previousValue);
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

  async loadReceiptProcessingStats(): Promise<void> {
    const requestId = ++this.receiptProcessingStatsRequestId;
    const year = this.selectedReceiptProcessingYear();
    const month = this.selectedReceiptProcessingMonth();
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 1);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    this.receiptProcessingLoading.set(true);
    this.receiptProcessingError.set(null);
    this.receiptProcessingStats.set(null);

    try {
      const callable = httpsCallable<
        {
          year: number;
          month: number;
          startAtMillis: number;
          endAtMillis: number;
          timeZone: string;
        },
        ReceiptProcessingStatsResponse
      >(this.functions, 'getReceiptProcessingStats');

      const response = await callable({
        year,
        month: month + 1,
        startAtMillis: start.getTime(),
        endAtMillis: end.getTime(),
        timeZone
      });

      if (requestId === this.receiptProcessingStatsRequestId) {
        this.receiptProcessingStats.set(response.data);
        const today = new Date();
        if (year === today.getFullYear() && month === today.getMonth()) {
          this.receiptProcessingOverviewStats.set(response.data);
        }
      }
    } catch (error) {
      console.error('Failed to load receipt processing stats', error);
      if (requestId === this.receiptProcessingStatsRequestId) {
        this.receiptProcessingError.set('Unable to load receipt processing stats right now.');
      }
    } finally {
      if (requestId === this.receiptProcessingStatsRequestId) {
        this.receiptProcessingLoading.set(false);
      }
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

  formatFeedbackDate(value?: FeedbackMessage['createdAt'] | null): string {
    if (!value || !(value instanceof Timestamp)) {
      return 'Pending timestamp';
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
      return 'Pending timestamp';
    }
  }

  formatReceiptProcessingDateTime(value?: string): string {
    if (!value) {
      return '—';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '—';
    }

    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  setSelectedGrowthYear(value: string | number): void {
    const parsedYear = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
    if (Number.isFinite(parsedYear)) {
      this.selectedGrowthYear.set(parsedYear);
    }
  }

  setSelectedGrowthView(view: UserGrowthView): void {
    this.selectedGrowthView.set(view);
  }

  setSelectedGrowthMonth(value: string | number): void {
    const parsedMonth = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
    if (Number.isFinite(parsedMonth) && parsedMonth >= 0 && parsedMonth <= 11) {
      this.selectedGrowthMonth.set(parsedMonth);
    }
  }

  setSelectedReceiptProcessingYear(value: string | number): void {
    const parsedYear = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
    if (Number.isFinite(parsedYear)) {
      this.selectedReceiptProcessingYear.set(parsedYear);
      this.clampSelectedReceiptProcessingDay();
      void this.loadReceiptProcessingStats();
    }
  }

  setSelectedReceiptProcessingMonth(value: string | number): void {
    const parsedMonth = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
    if (Number.isFinite(parsedMonth) && parsedMonth >= 0 && parsedMonth <= 11) {
      this.selectedReceiptProcessingMonth.set(parsedMonth);
      this.clampSelectedReceiptProcessingDay();
      void this.loadReceiptProcessingStats();
    }
  }

  setSelectedReceiptProcessingDay(value: string | number): void {
    const parsedDay = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
    const daysInMonth = new Date(
      this.selectedReceiptProcessingYear(),
      this.selectedReceiptProcessingMonth() + 1,
      0
    ).getDate();

    if (Number.isFinite(parsedDay) && parsedDay >= 1 && parsedDay <= daysInMonth) {
      this.selectedReceiptProcessingDay.set(parsedDay);
      this.receiptProcessingUserView.set('day');
    }
  }

  setReceiptProcessingUserView(view: ReceiptProcessingUserView): void {
    this.receiptProcessingUserView.set(view);
  }

  setUserDirectoryView(view: UserDirectoryView): void {
    this.userDirectoryView.set(view);
  }

  growthBarHeight(count: number): number {
    const axisMax = this.userGrowthYAxisTicks()[0] ?? 0;
    if (axisMax < 1 || count < 1) {
      return 2;
    }

    return Math.max(7, Math.round((count / axisMax) * 100));
  }

  dailyGrowthBarHeight(count: number): number {
    const axisMax = this.userGrowthDayYAxisTicks()[0] ?? 0;
    if (axisMax < 1 || count < 1) {
      return 2;
    }

    return Math.max(8, Math.round((count / axisMax) * 100));
  }

  dailyGrowthGridTemplate(): string {
    return `repeat(${this.userGrowthDaySummary().days.length}, minmax(28px, 1fr))`;
  }

  receiptProcessingBarHeight(count: number): number {
    const axisMax = this.receiptProcessingYAxisTicks()[0] ?? 0;
    if (axisMax < 1 || count < 1) {
      return 2;
    }

    return Math.max(8, Math.round((count / axisMax) * 100));
  }

  receiptProcessingGridTemplate(): string {
    return `repeat(${this.receiptProcessingSummary().days.length}, minmax(28px, 1fr))`;
  }

  receiptProcessingTickPosition(tick: number): number {
    return this.histogramTickPosition(tick, this.receiptProcessingYAxisTicks());
  }

  receiptProcessingDayLabel(day: number): string {
    return `${MONTH_LABELS[this.selectedReceiptProcessingMonth()].short} ${day}`;
  }

  userGrowthTickPosition(tick: number): number {
    return this.histogramTickPosition(tick, this.userGrowthYAxisTicks());
  }

  userGrowthDayTickPosition(tick: number): number {
    return this.histogramTickPosition(tick, this.userGrowthDayYAxisTicks());
  }

  private histogramTickPosition(tick: number, ticks: number[]): number {
    const maxTick = ticks[0] ?? 0;
    if (maxTick < 1) {
      return 0;
    }

    return (tick / maxTick) * 100;
  }

  private buildHistogramTicks(maxCount: number): number[] {
    if (maxCount < 1) {
      return [0];
    }

    const roughStep = Math.max(1, Math.ceil(maxCount / 4));
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const normalized = roughStep / magnitude;
    const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    const step = niceNormalized * magnitude;
    const axisMax = Math.ceil(maxCount / step) * step;
    const ticks: number[] = [];

    for (let value = axisMax; value >= 0; value -= step) {
      ticks.push(value);
    }

    return ticks;
  }

  toggleUserSort(column: UserSortColumn): void {
    if (this.userSortColumn() === column) {
      this.userSortDirection.set(this.userSortDirection() === 'asc' ? 'desc' : 'asc');
      return;
    }

    this.userSortColumn.set(column);
    this.userSortDirection.set(column === 'created' || column === 'lastLogin' || column === 'lastSeen' ? 'desc' : 'asc');
  }

  isUserSortActive(column: UserSortColumn): boolean {
    return this.userSortColumn() === column;
  }

  userSortIndicator(column: UserSortColumn): string {
    if (!this.isUserSortActive(column)) {
      return '↕';
    }

    return this.userSortDirection() === 'asc' ? '↑' : '↓';
  }

  private loadCustomEmailTemplates(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      const storedTemplates = localStorage.getItem(CUSTOM_EMAIL_TEMPLATE_STORAGE_KEY);
      if (!storedTemplates) {
        return;
      }

      const parsedTemplates = JSON.parse(storedTemplates);
      if (!Array.isArray(parsedTemplates)) {
        return;
      }

      const templates = parsedTemplates
        .map((template): CustomEmailHtmlTemplate | null => {
          if (
            typeof template?.id !== 'string' ||
            typeof template?.name !== 'string' ||
            typeof template?.html !== 'string' ||
            typeof template?.updatedAt !== 'string'
          ) {
            return null;
          }

          return {
            id: template.id,
            name: template.name,
            html: template.html,
            updatedAt: template.updatedAt
          };
        })
        .filter((template): template is CustomEmailHtmlTemplate => Boolean(template));

      this.customEmailTemplates.set(this.sortCustomEmailTemplates(templates));
    } catch (error) {
      console.error('Failed to load saved custom email templates', error);
      this.customEmailTemplateError.set('Saved email templates could not be loaded in this browser.');
    }
  }

  private persistCustomEmailTemplates(templates: CustomEmailHtmlTemplate[]): void {
    if (typeof localStorage === 'undefined') {
      this.customEmailTemplateError.set('Saved templates are not available in this browser.');
      return;
    }

    try {
      localStorage.setItem(CUSTOM_EMAIL_TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
    } catch (error) {
      console.error('Failed to save custom email templates', error);
      this.customEmailTemplateError.set('Unable to save templates in this browser.');
    }
  }

  private sortCustomEmailTemplates(templates: CustomEmailHtmlTemplate[]): CustomEmailHtmlTemplate[] {
    return [...templates].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  private createCustomEmailTemplateId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }

    return `template-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private sanitizeTemplateFileName(name: string): string {
    const fileName = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return fileName || 'receipt-nest-email-template';
  }

  private toCustomEmailRecipient(user: AdminUser): CustomEmailRecipient {
    return {
      key: this.customEmailUserKey(user.id),
      source: 'system',
      email: user.email,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      fullName: this.displayName(user),
      userId: user.id,
      role: user.role || 'user',
      plan: this.effectivePlan(user),
      planSource: this.planSource(user),
      billingMode: this.effectiveBillingMode(user),
      receiptCount: user.receiptCount ?? 0
    };
  }

  private parseCustomEmailCsv(text: string): CustomEmailRecipient[] {
    const rows = this.parseCsvRows(text).filter((row) => row.some((cell) => cell.trim().length > 0));
    if (rows.length === 0) {
      return [];
    }

    const firstRow = rows[0].map((cell) => this.normalizeCsvHeader(cell));
    const hasHeader = firstRow.some((cell) =>
      ['email', 'emailaddress', 'firstname', 'first', 'lastname', 'last', 'name', 'fullname'].includes(cell)
    );
    const headers = hasHeader ? firstRow : [];
    const dataRows = hasHeader ? rows.slice(1) : rows;
    const emailIndex = hasHeader
      ? headers.findIndex((header) => header === 'email' || header === 'emailaddress')
      : 0;
    const firstNameIndex = hasHeader
      ? headers.findIndex((header) => header === 'firstname' || header === 'first')
      : 1;
    const lastNameIndex = hasHeader
      ? headers.findIndex((header) => header === 'lastname' || header === 'last')
      : 2;
    const fullNameIndex = hasHeader
      ? headers.findIndex((header) => header === 'name' || header === 'fullname')
      : -1;
    const recipients = new Map<string, CustomEmailRecipient>();

    dataRows.forEach((row) => {
      const email = (row[emailIndex] || '').trim().toLowerCase();
      if (!this.isLikelyEmail(email)) {
        return;
      }

      let firstName = firstNameIndex >= 0 ? (row[firstNameIndex] || '').trim() : '';
      let lastName = lastNameIndex >= 0 ? (row[lastNameIndex] || '').trim() : '';
      const fullName = fullNameIndex >= 0 ? (row[fullNameIndex] || '').trim() : '';

      if ((!firstName || !lastName) && fullName) {
        const splitName = this.splitFullName(fullName);
        firstName = firstName || splitName.firstName;
        lastName = lastName || splitName.lastName;
      }

      const displayName = `${firstName} ${lastName}`.trim() || fullName || email;
      recipients.set(email, {
        key: `csv:${email}`,
        source: 'csv',
        email,
        firstName,
        lastName,
        fullName: displayName,
        plan: 'free',
        role: 'csv',
        receiptCount: 0
      });
    });

    return [...recipients.values()];
  }

  private parseCsvRows(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const nextChar = text[index + 1];

      if (char === '"' && inQuotes && nextChar === '"') {
        cell += '"';
        index += 1;
        continue;
      }

      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }

      if (char === ',' && !inQuotes) {
        row.push(cell);
        cell = '';
        continue;
      }

      if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') {
          index += 1;
        }
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        continue;
      }

      cell += char;
    }

    row.push(cell);
    rows.push(row);
    return rows;
  }

  private normalizeCsvHeader(value: string): string {
    return value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  }

  private isLikelyEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  private splitFullName(value: string): { firstName: string; lastName: string } {
    const parts = value.trim().split(/\s+/).filter(Boolean);
    return {
      firstName: parts[0] || '',
      lastName: parts.slice(1).join(' ')
    };
  }

  private renderCustomEmailTemplate(template: string, recipient: CustomEmailRecipient | null): string {
    if (!recipient) {
      return template;
    }

    const values = this.customEmailTemplateValues(recipient);
    return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, key: string) => {
      const normalizedKey = key.toLowerCase();
      return this.escapeHtml(values[normalizedKey] ?? '');
    });
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private customEmailTemplateValues(recipient: CustomEmailRecipient): Record<string, string> {
    const firstName = recipient.firstName || this.splitFullName(recipient.fullName).firstName || 'there';
    const lastName = recipient.lastName || '';
    const fullName = recipient.fullName || `${firstName} ${lastName}`.trim() || recipient.email;

    return {
      firstname: firstName,
      first_name: firstName,
      first: firstName,
      lastname: lastName,
      last_name: lastName,
      last: lastName,
      fullname: fullName,
      full_name: fullName,
      name: fullName,
      email: recipient.email,
      plan: recipient.plan || '',
      role: recipient.role || '',
      plansource: recipient.planSource || '',
      plan_source: recipient.planSource || '',
      billingmode: recipient.billingMode || '',
      billing_mode: recipient.billingMode || '',
      receiptcount: String(recipient.receiptCount ?? 0),
      receipt_count: String(recipient.receiptCount ?? 0),
      preheader: this.customEmailPreheader()
    };
  }

  private getDefaultCustomEmailHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Unlock Pro in ReceiptNest AI</title>
  </head>
  <body style="margin:0; padding:0; background:#f8fafc; font-family:Arial, sans-serif; color:#0f172a;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">{{preheader}}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;">
      <tr>
        <td align="center" style="padding:28px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px; background:#ffffff; border:1px solid #e2e8f0; border-radius:18px; overflow:hidden;">
            <tr>
              <td style="padding:30px 34px; background:#064e3b; color:#ffffff;">
                <p style="margin:0; font-size:12px; letter-spacing:0.22em; text-transform:uppercase; color:#a7f3d0;">ReceiptNest AI</p>
                <h1 style="margin:12px 0 0; font-size:28px; line-height:1.2;">Your Pro workspace is ready</h1>
                <p style="margin:10px 0 0; font-size:15px; line-height:1.6; color:#d1fae5;">Unlimited receipt capture, cleaner reports, and deeper spending insight.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 34px;">
                <p style="margin:0 0 16px; font-size:16px; line-height:1.65;">Dear {{firstName}},</p>
                <p style="margin:0 0 16px; font-size:16px; line-height:1.65;">You signed up for ReceiptNest AI, and your account is ready for Pro. Pro removes free-plan limits and gives you a stronger workspace for receipts, categories, summaries, and tax-time organization.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0;">
                  <tr>
                    <td style="padding:18px; border:1px solid #d1fae5; border-radius:14px; background:#ecfdf5;">
                      <p style="margin:0; font-size:14px; line-height:1.6; color:#065f46;"><strong>Current plan:</strong> {{plan}}<br /><strong>Receipts saved:</strong> {{receiptCount}}</p>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 22px; font-size:16px; line-height:1.65;">Open your account and choose Pro when you are ready.</p>
                <a href="https://receipt-nest.com/app/pricing" style="display:inline-block; padding:13px 20px; border-radius:12px; background:#059669; color:#ffffff; font-size:15px; font-weight:700; text-decoration:none;">Upgrade to Pro</a>
                <p style="margin:24px 0 0; font-size:14px; line-height:1.6; color:#64748b;">Questions? Reply to this email and we will help.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 34px; border-top:1px solid #e2e8f0; color:#64748b; font-size:12px; line-height:1.6;">
                ReceiptNest AI · info@receipt-nest.com
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
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

  private userCreatedDate(user: AdminUser): Date | null {
    return user.createdAt instanceof Timestamp ? user.createdAt.toDate() : null;
  }

  private compareUsers(a: AdminUser, b: AdminUser, column: UserSortColumn): number {
    switch (column) {
      case 'name':
        return this.compareText(this.displayName(a), this.displayName(b));
      case 'email':
        return this.compareText(a.email, b.email);
      case 'role':
        return this.compareText(a.role || 'user', b.role || 'user');
      case 'plan':
        return this.compareText(this.effectivePlan(a), this.effectivePlan(b));
      case 'receipts':
        return (a.receiptCount ?? -1) - (b.receiptCount ?? -1);
      case 'lastLogin':
        return this.compareTimestamp(a.lastLoginAt, b.lastLoginAt);
      case 'lastSeen':
        return this.compareTimestamp(a.lastSeenAt, b.lastSeenAt);
      case 'created':
        return this.compareTimestamp(a.createdAt, b.createdAt);
    }
  }

  private compareText(a: string | undefined, b: string | undefined): number {
    return (a || '').localeCompare(b || '', undefined, { sensitivity: 'base' });
  }

  private normalizeIdentityToken(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private isGeneratedIdentityToken(token: string): boolean {
    if (token.length < 8 || token.length > 24 || !/^[a-z0-9]+$/.test(token)) {
      return false;
    }

    const letters = token.replace(/[^a-z]/g, '');
    if (letters.length < 5) {
      return false;
    }

    const vowelCount = (letters.match(/[aeiou]/g) || []).length;
    const vowelRatio = vowelCount / letters.length;
    const consonantRuns = letters.match(/[^aeiou]+/g) || [];
    const maxConsonantRun = consonantRuns.reduce((max, run) => Math.max(max, run.length), 0);
    const hasDigit = /\d/.test(token);
    const uncommonNameShape = maxConsonantRun >= 5 || vowelRatio <= 0.15;

    return uncommonNameShape && (hasDigit || letters.length >= 9);
  }

  private compareIsoDateTime(a: string | undefined, b: string | undefined): number {
    const aMillis = a ? new Date(a).getTime() : -1;
    const bMillis = b ? new Date(b).getTime() : -1;
    return (Number.isNaN(aMillis) ? -1 : aMillis) - (Number.isNaN(bMillis) ? -1 : bMillis);
  }

  private compareTimestamp(
    a: UserProfile['createdAt'] | UserProfile['lastLoginAt'] | UserProfile['lastSeenAt'] | null | undefined,
    b: UserProfile['createdAt'] | UserProfile['lastLoginAt'] | UserProfile['lastSeenAt'] | null | undefined
  ): number {
    const aMillis = a instanceof Timestamp ? a.toMillis() : -1;
    const bMillis = b instanceof Timestamp ? b.toMillis() : -1;
    return aMillis - bMillis;
  }

  private clampSelectedReceiptProcessingDay(): void {
    const daysInMonth = new Date(
      this.selectedReceiptProcessingYear(),
      this.selectedReceiptProcessingMonth() + 1,
      0
    ).getDate();
    const selectedDay = this.selectedReceiptProcessingDay();

    if (selectedDay > daysInMonth) {
      this.selectedReceiptProcessingDay.set(daysInMonth);
    } else if (selectedDay < 1) {
      this.selectedReceiptProcessingDay.set(1);
    }
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

  private async loadBillingModeStatus(): Promise<void> {
    this.billingModeLoading.set(true);

    try {
      const callable = httpsCallable<void, BillingModeStatusResponse>(this.functions, 'getBillingModeStatus');
      const response = await callable();
      this.defaultBillingMode.set(response.data.defaultBillingMode);
      this.hasLiveBillingConfig.set(response.data.hasLiveConfig);
      this.hasTestBillingConfig.set(response.data.hasTestConfig);
    } catch (error) {
      console.error('Failed to load billing mode status', error);
      this.billingModeError.set('Unable to load Stripe environment readiness right now.');
    } finally {
      this.billingModeLoading.set(false);
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
