import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import sgMail from "@sendgrid/mail";
import { assertAdmin } from "./authz";

const sendgridApiKey = defineSecret("SENDGRID_API_KEY");
const appBaseUrl = defineSecret("APP_BASE_URL");
const fromEmail = "info@receipt-nest.com";
const MAIN_SITE_URL = "https://receipt-nest.com";
const FALLBACK_TIME_ZONE = "America/Los_Angeles";
const FALLBACK_CURRENCY = "USD";
const SCHEDULE_CONFIG_PATH = "systemConfig/spendSummaryEmailSchedule";
const SUMMARY_NOTIFICATION_START_HOUR = 8;
const SUMMARY_NOTIFICATION_END_HOUR = 10;
const WEEKDAY_VALUES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

type SummaryPeriodType = "week" | "month";
type WeekdayValue = (typeof WEEKDAY_VALUES)[number];

type NormalizedReceipt = {
  amount: number;
  currency: string;
  categoryName: string;
  merchantName: string;
  dateKey: string;
  dateLabel: string;
  createdAt: Date | null;
};

type BreakdownItem = {
  name: string;
  total: number;
  count: number;
  share: number;
};

type SummaryActivityItem = {
  label: string;
  sublabel: string;
  amount: number;
  receiptCount: number;
};

type SummaryMetrics = {
  totalSpend: number;
  receiptCount: number;
  activeDays: number;
  averageSpend: number;
  topCategory: BreakdownItem | null;
  topMerchant: BreakdownItem | null;
  largestReceipt: NormalizedReceipt | null;
};

type SummaryPeriod = {
  type: SummaryPeriodType;
  label: string;
  compactLabel: string;
  heroEyebrow: string;
  rangeLabel: string;
  startKey: string;
  endKey: string;
};

type SpendSummaryData = {
  period: SummaryPeriod;
  userName: string;
  userEmail: string;
  metrics: SummaryMetrics;
  categories: BreakdownItem[];
  merchants: BreakdownItem[];
  recentReceipts: NormalizedReceipt[];
  activity: SummaryActivityItem[];
  currency: string;
  mixedCurrencies: boolean;
  generatedAtLabel: string;
};

type SummaryLinks = {
  dashboardUrl?: string;
  supportUrl?: string;
  termsUrl?: string;
  unsubscribeUrl?: string;
};

type WeeklyScheduleConfig = {
  enabled: boolean;
  dayOfWeek: WeekdayValue;
  time: string;
};

type MonthlyScheduleConfig = {
  enabled: boolean;
  dayOfMonth: number;
  time: string;
};

type SpendSummaryScheduleConfig = {
  timeZone: string;
  weekly: WeeklyScheduleConfig;
  monthly: MonthlyScheduleConfig;
  lastWeeklyPeriodSent?: string | null;
  lastWeeklySentAt?: admin.firestore.Timestamp | null;
  lastMonthlyPeriodSent?: string | null;
  lastMonthlySentAt?: admin.firestore.Timestamp | null;
  updatedAt?: admin.firestore.Timestamp | admin.firestore.FieldValue | null;
  updatedBy?: string | null;
};

type SpendSummaryScheduleResponse = {
  timeZone: string;
  weekly: WeeklyScheduleConfig & {
    lastPeriodSent: string | null;
    lastSentAt: string | null;
  };
  monthly: MonthlyScheduleConfig & {
    lastPeriodSent: string | null;
    lastSentAt: string | null;
  };
};

type NotificationSendResult = {
  sentCount: number;
  failedCount: number;
  invalidTokens: string[];
};

const getScheduleConfigRef = () => admin.firestore().doc(SCHEDULE_CONFIG_PATH);

const getDefaultScheduleConfig = (): SpendSummaryScheduleConfig => ({
  timeZone: FALLBACK_TIME_ZONE,
  weekly: {
    enabled: false,
    dayOfWeek: "monday",
    time: "08:00",
  },
  monthly: {
    enabled: false,
    dayOfMonth: 1,
    time: "08:00",
  },
  lastWeeklyPeriodSent: null,
  lastWeeklySentAt: null,
  lastMonthlyPeriodSent: null,
  lastMonthlySentAt: null,
});

const normalizeTimeValue = (value: unknown, fallback: string) => {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(trimmed) ? trimmed : fallback;
};

const normalizeDayOfWeek = (value: unknown, fallback: WeekdayValue): WeekdayValue => {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase() as WeekdayValue;
  return (WEEKDAY_VALUES as readonly string[]).includes(normalized) ? normalized : fallback;
};

const normalizeDayOfMonth = (value: unknown, fallback: number) => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric)) {
    return fallback;
  }

  return Math.min(31, Math.max(1, numeric));
};

const normalizeTimeZone = (value: unknown, fallback: string) => {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  return value.trim();
};

const normalizeScheduleConfig = (data?: admin.firestore.DocumentData | null): SpendSummaryScheduleConfig => {
  const defaults = getDefaultScheduleConfig();
  const weeklyData = (data?.weekly ?? {}) as Record<string, unknown>;
  const monthlyData = (data?.monthly ?? {}) as Record<string, unknown>;

  return {
    timeZone: normalizeTimeZone(data?.timeZone, defaults.timeZone),
    weekly: {
      enabled: Boolean(weeklyData.enabled ?? defaults.weekly.enabled),
      dayOfWeek: normalizeDayOfWeek(weeklyData.dayOfWeek, defaults.weekly.dayOfWeek),
      time: normalizeTimeValue(weeklyData.time, defaults.weekly.time),
    },
    monthly: {
      enabled: Boolean(monthlyData.enabled ?? defaults.monthly.enabled),
      dayOfMonth: normalizeDayOfMonth(monthlyData.dayOfMonth, defaults.monthly.dayOfMonth),
      time: normalizeTimeValue(monthlyData.time, defaults.monthly.time),
    },
    lastWeeklyPeriodSent: typeof data?.lastWeeklyPeriodSent === "string" ? data.lastWeeklyPeriodSent : null,
    lastWeeklySentAt: data?.lastWeeklySentAt instanceof admin.firestore.Timestamp ? data.lastWeeklySentAt : null,
    lastMonthlyPeriodSent: typeof data?.lastMonthlyPeriodSent === "string" ? data.lastMonthlyPeriodSent : null,
    lastMonthlySentAt: data?.lastMonthlySentAt instanceof admin.firestore.Timestamp ? data.lastMonthlySentAt : null,
    updatedAt: data?.updatedAt instanceof admin.firestore.Timestamp ? data.updatedAt : null,
    updatedBy: typeof data?.updatedBy === "string" ? data.updatedBy : null,
  };
};

const toScheduleResponse = (config: SpendSummaryScheduleConfig): SpendSummaryScheduleResponse => ({
  timeZone: config.timeZone,
  weekly: {
    ...config.weekly,
    lastPeriodSent: config.lastWeeklyPeriodSent ?? null,
    lastSentAt: config.lastWeeklySentAt?.toDate().toISOString() ?? null,
  },
  monthly: {
    ...config.monthly,
    lastPeriodSent: config.lastMonthlyPeriodSent ?? null,
    lastSentAt: config.lastMonthlySentAt?.toDate().toISOString() ?? null,
  },
});

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatCurrency = (amount: number, currency: string) => {
  const normalizedCurrency = (currency || FALLBACK_CURRENCY).toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: FALLBACK_CURRENCY,
      maximumFractionDigits: 2,
    }).format(amount);
  }
};

const formatCountLabel = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const getFormatterParts = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const getPart = (type: "year" | "month" | "day") =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: getPart("year"),
    month: getPart("month"),
    day: getPart("day"),
  };
};

const getDateTimeParts = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "long",
  }).formatToParts(date);

  const getNumberPart = (type: "year" | "month" | "day" | "hour" | "minute") =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const weekday = String(parts.find((part) => part.type === "weekday")?.value ?? "")
    .trim()
    .toLowerCase() as WeekdayValue;

  return {
    year: getNumberPart("year"),
    month: getNumberPart("month"),
    day: getNumberPart("day"),
    hour: getNumberPart("hour"),
    minute: getNumberPart("minute"),
    weekday: (WEEKDAY_VALUES as readonly string[]).includes(weekday) ? weekday : "monday",
  };
};

const toDateKey = (date: Date, timeZone: string) => {
  const parts = getFormatterParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
};

const isSameCalendarDay = (a: Date, b: Date, timeZone: string) => toDateKey(a, timeZone) === toDateKey(b, timeZone);

const toUtcDateKey = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;

const dateFromKey = (dateKey: string) => {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new HttpsError("invalid-argument", `Invalid date key: ${dateKey}`);
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0));
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const formatDateKey = (
  dateKey: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
) => new Intl.DateTimeFormat("en-US", { timeZone, ...options }).format(dateFromKey(dateKey));

const formatDateRange = (startKey: string, endKey: string, timeZone: string) => {
  const startLabel = formatDateKey(startKey, timeZone, { month: "short", day: "numeric", year: "numeric" });
  const endLabel = formatDateKey(endKey, timeZone, { month: "long", day: "numeric", year: "numeric" });

  return `${startLabel} - ${endLabel}`;
};

const formatCompactDateRange = (startKey: string, endKey: string, timeZone: string) => {
  const startDate = dateFromKey(startKey);
  const endDate = dateFromKey(endKey);
  const startParts = getFormatterParts(startDate, timeZone);
  const endParts = getFormatterParts(endDate, timeZone);

  if (startParts.year === endParts.year && startParts.month === endParts.month) {
    const monthLabel = new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "long",
    }).format(startDate);
    return `${monthLabel} ${startParts.day}-${endParts.day}, ${startParts.year}`;
  }

  if (startParts.year === endParts.year) {
    const startLabel = formatDateKey(startKey, timeZone, { month: "short", day: "numeric" });
    const endLabel = formatDateKey(endKey, timeZone, { month: "short", day: "numeric", year: "numeric" });
    return `${startLabel} - ${endLabel}`;
  }

  return `${formatDateKey(startKey, timeZone, { month: "short", day: "numeric", year: "numeric" })} - ${formatDateKey(endKey, timeZone, { month: "short", day: "numeric", year: "numeric" })}`;
};

const getMonthPeriod = (monthValue: string, timeZone: string): SummaryPeriod => {
  const match = monthValue.trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw new HttpsError("invalid-argument", "Month must use YYYY-MM format.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new HttpsError("invalid-argument", "Month must be between 01 and 12.");
  }

  const startKey = `${year}-${String(month).padStart(2, "0")}-01`;
  const endKey = toUtcDateKey(new Date(Date.UTC(year, month, 0, 12)));
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, 15, 12)));

  return {
    type: "month",
    label,
    compactLabel: label,
    heroEyebrow: "Monthly spend summary",
    rangeLabel: formatDateRange(startKey, endKey, timeZone),
    startKey,
    endKey,
  };
};

const getWeekPeriod = (weekValue: string, timeZone: string): SummaryPeriod => {
  const match = weekValue.trim().match(/^(\d{4})-W(\d{2})$/);
  if (!match) {
    throw new HttpsError("invalid-argument", "Week must use YYYY-Www format.");
  }

  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) {
    throw new HttpsError("invalid-argument", "Week must be between W01 and W53.");
  }

  const januaryFourth = new Date(Date.UTC(year, 0, 4, 12));
  const januaryFourthWeekday = januaryFourth.getUTCDay() || 7;
  const weekStart = addDays(januaryFourth, 1 - januaryFourthWeekday + (week - 1) * 7);
  const validatedWeekValue = getIsoWeekValue(weekStart);

  if (validatedWeekValue !== weekValue.trim()) {
    throw new HttpsError("invalid-argument", "Week selection is not valid.");
  }

  const weekEnd = addDays(weekStart, 6);
  const startKey = toUtcDateKey(weekStart);
  const endKey = toUtcDateKey(weekEnd);

  return {
    type: "week",
    label: `Week of ${formatDateKey(startKey, timeZone, { month: "long", day: "numeric", year: "numeric" })}`,
    compactLabel: formatCompactDateRange(startKey, endKey, timeZone),
    heroEyebrow: "Weekly spend summary",
    rangeLabel: formatDateRange(startKey, endKey, timeZone),
    startKey,
    endKey,
  };
};

function getIsoWeekValue(date: Date) {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
  const weekday = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1, 12));
  const weekNumber = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

const getPreviousCompletedWeekValue = (date: Date, timeZone: string) => {
  const todayKey = toDateKey(date, timeZone);
  const previousWeekDate = addDays(dateFromKey(todayKey), -7);
  return getIsoWeekValue(previousWeekDate);
};

const getPreviousCompletedMonthValue = (date: Date, timeZone: string) => {
  const parts = getFormatterParts(date, timeZone);
  let year = parts.year;
  let month = parts.month - 1;

  if (month < 1) {
    year -= 1;
    month = 12;
  }

  return `${year}-${String(month).padStart(2, "0")}`;
};

const getEffectiveDayOfMonth = (year: number, month: number, dayOfMonth: number) => {
  const daysInMonth = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  return Math.min(dayOfMonth, daysInMonth);
};

const parseAmount = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const normalized = value.trim().replace(/[^0-9,.\-]/g, "");
    if (!normalized || normalized === "-") {
      return null;
    }

    const hasComma = normalized.includes(",");
    const hasDot = normalized.includes(".");
    let formatted = normalized;

    if (hasComma && hasDot) {
      formatted = normalized.lastIndexOf(",") > normalized.lastIndexOf(".")
        ? normalized.replace(/\./g, "").replace(/,/g, ".")
        : normalized.replace(/,/g, "");
    } else if (hasComma) {
      formatted = normalized.replace(/,/g, ".");
    }

    const parsed = Number.parseFloat(formatted);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    return parseAmount(candidate["value"] ?? candidate["amount"]);
  }

  return null;
};

const parseDateValue = (value: unknown): Date | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const buildDate = (year: number, month: number, day: number) => {
      const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
      if (
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month - 1 &&
        parsed.getUTCDate() === day
      ) {
        return parsed;
      }
      return null;
    };

    const isoDateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDateOnlyMatch) {
      return buildDate(Number(isoDateOnlyMatch[1]), Number(isoDateOnlyMatch[2]), Number(isoDateOnlyMatch[3]));
    }

    const slashOrDashDateMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (slashOrDashDateMatch) {
      const first = Number(slashOrDashDateMatch[1]);
      const second = Number(slashOrDashDateMatch[2]);
      const rawYear = Number(slashOrDashDateMatch[3]);
      const year = rawYear < 100 ? (2000 + rawYear) : rawYear;

      const monthFirst = buildDate(year, first, second);
      const dayFirst = buildDate(year, second, first);

      if (first > 12 && dayFirst) return dayFirst;
      if (second > 12 && monthFirst) return monthFirst;
      if (monthFirst) return monthFirst;
      if (dayFirst) return dayFirst;
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  if (typeof value === "object") {
    const candidate = value as Record<string, unknown>;

    if (typeof (candidate as { toDate?: () => Date }).toDate === "function") {
      const parsed = (candidate as { toDate: () => Date }).toDate();
      return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
    }

    if (typeof candidate.seconds === "number") {
      const nanos = typeof candidate.nanoseconds === "number" ? candidate.nanoseconds : 0;
      const parsed = new Date((candidate.seconds * 1000) + Math.floor(nanos / 1_000_000));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    return parseDateValue(candidate.value ?? candidate.date ?? candidate.rawText);
  }

  return null;
};

const getEffectiveAmount = (receipt: admin.firestore.DocumentData) =>
  parseAmount(receipt.totalAmount) ?? parseAmount(receipt.extraction?.totalAmount?.value);

const getEffectiveDate = (receipt: admin.firestore.DocumentData) =>
  parseDateValue(receipt.date) ?? parseDateValue(receipt.extraction?.date?.value) ?? parseDateValue(receipt.createdAt);

const getEffectiveDateTime = (receipt: admin.firestore.DocumentData, timeZone: string) => {
  const explicitDate = parseDateValue(receipt.date);
  const extractedDate = parseDateValue(receipt.extraction?.date?.value);
  const timestamp = parseDateValue(receipt.createdAt) ?? parseDateValue(receipt.file?.uploadedAt);
  const baseDate = explicitDate ?? extractedDate ?? timestamp;

  if (!baseDate) {
    return null;
  }

  if (!timestamp || (!explicitDate && !extractedDate)) {
    return baseDate;
  }

  if (!isSameCalendarDay(baseDate, timestamp, timeZone)) {
    return baseDate;
  }

  return timestamp;
};

const normalizeReceipt = (
  receipt: admin.firestore.DocumentData,
  timeZone: string,
  currency: string,
): NormalizedReceipt | null => {
  const amount = getEffectiveAmount(receipt);
  const effectiveDate = getEffectiveDate(receipt);

  if (amount === null || !effectiveDate) {
    return null;
  }

  const merchantName = String(
    receipt.merchant?.canonicalName ??
    receipt.merchant?.rawName ??
    receipt.extraction?.supplierName?.value ??
    "Unknown merchant",
  ).trim() || "Unknown merchant";

  const categoryName = String(receipt.category?.name ?? "Uncategorized").trim() || "Uncategorized";

  return {
    amount,
    currency: String(receipt.currency ?? receipt.extraction?.currency?.value ?? currency).trim().toUpperCase() || currency,
    categoryName,
    merchantName,
    dateKey: toDateKey(effectiveDate, timeZone),
    dateLabel: new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(effectiveDate),
    createdAt: getEffectiveDateTime(receipt, timeZone),
  };
};

const sortBreakdowns = (items: BreakdownItem[]) =>
  items.sort((a, b) => {
    if (b.total !== a.total) {
      return b.total - a.total;
    }

    if (b.count !== a.count) {
      return b.count - a.count;
    }

    return a.name.localeCompare(b.name);
  });

const buildBreakdowns = (receipts: NormalizedReceipt[]) => {
  const totalSpend = receipts.reduce((sum, receipt) => sum + receipt.amount, 0);
  const categoriesMap = new Map<string, { total: number; count: number }>();
  const merchantsMap = new Map<string, { total: number; count: number }>();

  for (const receipt of receipts) {
    const categoryEntry = categoriesMap.get(receipt.categoryName) ?? { total: 0, count: 0 };
    categoryEntry.total += receipt.amount;
    categoryEntry.count += 1;
    categoriesMap.set(receipt.categoryName, categoryEntry);

    const merchantEntry = merchantsMap.get(receipt.merchantName) ?? { total: 0, count: 0 };
    merchantEntry.total += receipt.amount;
    merchantEntry.count += 1;
    merchantsMap.set(receipt.merchantName, merchantEntry);
  }

  const toBreakdownItems = (map: Map<string, { total: number; count: number }>) =>
    sortBreakdowns(
      [...map.entries()].map(([name, value]) => ({
        name,
        total: value.total,
        count: value.count,
        share: totalSpend > 0 ? value.total / totalSpend : 0,
      })),
    );

  return {
    categories: toBreakdownItems(categoriesMap),
    merchants: toBreakdownItems(merchantsMap),
  };
};

const buildDailyTotals = (receipts: NormalizedReceipt[]) => {
  const totals = new Map<string, { amount: number; receiptCount: number }>();

  for (const receipt of receipts) {
    const entry = totals.get(receipt.dateKey) ?? { amount: 0, receiptCount: 0 };
    entry.amount += receipt.amount;
    entry.receiptCount += 1;
    totals.set(receipt.dateKey, entry);
  }

  return totals;
};

const buildActivity = (
  period: SummaryPeriod,
  dailyTotals: Map<string, { amount: number; receiptCount: number }>,
  timeZone: string,
) => {
  const items: SummaryActivityItem[] = [];

  if (period.type === "week") {
    let cursor = dateFromKey(period.startKey);
    const endDate = dateFromKey(period.endKey);

    while (cursor.getTime() <= endDate.getTime()) {
      const key = toUtcDateKey(cursor);
      const totals = dailyTotals.get(key) ?? { amount: 0, receiptCount: 0 };
      items.push({
        label: formatDateKey(key, timeZone, { weekday: "short" }),
        sublabel: formatDateKey(key, timeZone, { month: "short", day: "numeric" }),
        amount: totals.amount,
        receiptCount: totals.receiptCount,
      });
      cursor = addDays(cursor, 1);
    }

    return items;
  }

  let cursor = dateFromKey(period.startKey);
  const endDate = dateFromKey(period.endKey);
  let chunkIndex = 1;

  while (cursor.getTime() <= endDate.getTime()) {
    const chunkStart = cursor;
    const chunkEnd = addDays(chunkStart, 6);
    const boundedEnd = chunkEnd.getTime() > endDate.getTime() ? endDate : chunkEnd;

    let amount = 0;
    let receiptCount = 0;
    let dayCursor = chunkStart;

    while (dayCursor.getTime() <= boundedEnd.getTime()) {
      const totals = dailyTotals.get(toUtcDateKey(dayCursor));
      if (totals) {
        amount += totals.amount;
        receiptCount += totals.receiptCount;
      }
      dayCursor = addDays(dayCursor, 1);
    }

    items.push({
      label: `Week ${chunkIndex}`,
      sublabel: formatDateRange(toUtcDateKey(chunkStart), toUtcDateKey(boundedEnd), timeZone),
      amount,
      receiptCount,
    });

    chunkIndex += 1;
    cursor = addDays(boundedEnd, 1);
  }

  return items;
};

const buildSummaryData = (
  period: SummaryPeriod,
  userData: admin.firestore.DocumentData,
  receipts: NormalizedReceipt[],
  timeZone: string,
): SpendSummaryData => {
  const filteredReceipts = receipts
    .filter((receipt) => receipt.dateKey >= period.startKey && receipt.dateKey <= period.endKey)
    .sort((a, b) => {
      if (a.dateKey !== b.dateKey) {
        return b.dateKey.localeCompare(a.dateKey);
      }

      if (a.createdAt && b.createdAt) {
        return b.createdAt.getTime() - a.createdAt.getTime();
      }

      if (a.createdAt) return -1;
      if (b.createdAt) return 1;
      return b.amount - a.amount;
    });

  const totalSpend = filteredReceipts.reduce((sum, receipt) => sum + receipt.amount, 0);
  const receiptCount = filteredReceipts.length;
  const dailyTotals = buildDailyTotals(filteredReceipts);
  const { categories, merchants } = buildBreakdowns(filteredReceipts);

  const currencies = [...new Set(filteredReceipts.map((receipt) => receipt.currency).filter(Boolean))];
  const currency = currencies[0] ?? FALLBACK_CURRENCY;

  const metrics: SummaryMetrics = {
    totalSpend,
    receiptCount,
    activeDays: dailyTotals.size,
    averageSpend: receiptCount > 0 ? totalSpend / receiptCount : 0,
    topCategory: categories[0] ?? null,
    topMerchant: merchants[0] ?? null,
    largestReceipt: filteredReceipts.reduce<NormalizedReceipt | null>((largest, receipt) => {
      if (!largest || receipt.amount > largest.amount) {
        return receipt;
      }
      return largest;
    }, null),
  };

  const firstName = String(userData.firstName ?? "").trim();
  const lastName = String(userData.lastName ?? "").trim();
  const userName = `${firstName} ${lastName}`.trim() || String(userData.email ?? "ReceiptNest user");

  return {
    period,
    userName,
    userEmail: String(userData.email ?? ""),
    metrics,
    categories: categories.slice(0, 5),
    merchants: merchants.slice(0, 5),
    recentReceipts: filteredReceipts.slice(0, 6),
    activity: buildActivity(period, dailyTotals, timeZone),
    currency,
    mixedCurrencies: currencies.length > 1,
    generatedAtLabel: new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date()),
  };
};

const getBadgeLabel = (value: string, fallback: string) => {
  const words = value
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);

  if (words.length === 0) {
    return fallback;
  }

  const label = words.map((word) => word[0]).join("").toUpperCase();
  return label.slice(0, 3) || fallback;
};

const renderMetricCard = (label: string, value: string, tone: "dark" | "green" | "stone") => {
  const palette = {
    dark: {
      background: "#0f172a",
      text: "#ffffff",
      subtext: "#cbd5e1",
    },
    green: {
      background: "#ecfdf5",
      text: "#065f46",
      subtext: "#047857",
    },
    stone: {
      background: "#f8fafc",
      text: "#0f172a",
      subtext: "#475569",
    },
  }[tone];

  return `
    <td class="metric-cell" style="padding:0 6px 12px; width:33.333%;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-radius:16px; background:${palette.background};">
        <tr>
          <td style="padding:18px 18px 16px; font-family:Inter, Arial, sans-serif;">
            <p style="margin:0; font-size:12px; line-height:1.4; color:${palette.subtext}; text-transform:uppercase; letter-spacing:0.12em; font-weight:700;">${escapeHtml(label)}</p>
            <p class="metric-value" style="margin:10px 0 0; font-size:24px; line-height:1.2; color:${palette.text}; font-weight:700;">${escapeHtml(value)}</p>
          </td>
        </tr>
      </table>
    </td>
  `;
};

const renderHighlightCard = (
  title: string,
  name: string,
  amountText: string,
  caption: string,
  badgeSymbol: string,
  accentColor: string,
  badgeBackground: string,
) => `
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-radius:20px; background:#eef4ff; border:1px solid #d4e4fa;">
    <tr>
      <td style="padding:26px 26px 24px; font-family:Inter, Arial, sans-serif;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="width:48px; height:48px; border-radius:12px; background:${accentColor}; color:#ffffff; text-align:center; font-size:22px; font-weight:800;">
              ${badgeSymbol}
            </td>
          </tr>
        </table>
        <p style="margin:20px 0 0; font-size:11px; line-height:1.4; color:#5b6471; text-transform:uppercase; letter-spacing:0.18em; font-weight:800;">${escapeHtml(title)}</p>
        <p style="margin:6px 0 0; font-size:28px; line-height:1.2; color:#0d1c2d; font-weight:800;">${escapeHtml(name)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:26px;">
          <tr>
            <td style="font-size:30px; line-height:1.1; color:${accentColor}; font-weight:900; font-family:Inter, Arial, sans-serif;">
              ${escapeHtml(amountText)}
            </td>
            <td align="right">
              <span style="display:inline-block; padding:7px 12px; border-radius:999px; background:${badgeBackground}; color:${accentColor}; font-size:11px; line-height:1.2; font-weight:800; letter-spacing:0.06em;">
                ${escapeHtml(caption)}
              </span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
`;

const renderBreakdownTable = (title: string, items: BreakdownItem[], currency: string, accentColor: string) => {
  const rows = items.length > 0
    ? items.map((item) => `
        <tr>
          <td style="padding:0 0 14px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="padding:0 12px 4px 0; font-family:Inter, Arial, sans-serif; font-size:14px; line-height:1.5; color:#0d1c2d; font-weight:700;">
                  ${escapeHtml(item.name)}
                </td>
                <td align="right" style="padding:0 0 4px; font-family:Inter, Arial, sans-serif; font-size:14px; line-height:1.5; color:#0d1c2d; font-weight:800;">
                  ${escapeHtml(formatCurrency(item.total, currency))}
                </td>
              </tr>
              <tr>
                <td style="padding:0 12px 8px 0; font-family:Inter, Arial, sans-serif; font-size:12px; line-height:1.4; color:#5b6471;">
                  ${escapeHtml(formatCountLabel(item.count, "receipt"))}
                </td>
                <td align="right" style="padding:0 0 8px; font-family:Inter, Arial, sans-serif; font-size:12px; line-height:1.4; color:#5b6471;">
                  ${escapeHtml(`${Math.round(item.share * 100)}% of total`)}
                </td>
              </tr>
              <tr>
                <td colspan="2" style="padding:0;">
                  <div style="height:8px; border-radius:999px; background:#dbe9ff;">
                    <div style="height:8px; border-radius:999px; background:${accentColor}; width:${Math.max(8, Math.round(item.share * 100))}%;"></div>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `).join("")
    : `
      <tr>
        <td style="padding:0; font-family:Inter, Arial, sans-serif; font-size:14px; line-height:1.6; color:#5b6471;">
          No spending data landed in this period.
        </td>
      </tr>
    `;

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-radius:20px; border:1px solid #d4e4fa; background:#ffffff;">
      <tr>
        <td style="padding:22px 22px 18px; font-family:Inter, Arial, sans-serif;">
          <p style="margin:0 0 16px; font-size:14px; line-height:1.4; color:#0d1c2d; font-weight:800; letter-spacing:0.02em;">${escapeHtml(title)}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            ${rows}
          </table>
        </td>
      </tr>
    </table>
  `;
};

const renderSpendChart = (data: SpendSummaryData) => {
  const maxAmount = Math.max(...data.activity.map((item) => item.amount), 1);
  const title = data.period.type === "week" ? "Daily Spend Volume" : "Weekly Spend Movement";
  const subtitle = data.period.type === "week"
    ? `Activity breakdown for ${data.period.rangeLabel}`
    : `Grouped weekly movement across ${data.period.label}`;
  const rows = data.activity.map((item) => {
    const active = item.amount === maxAmount && maxAmount > 0;
    const barWidth = item.amount <= 0 ? 0 : Math.max(6, Math.round((item.amount / maxAmount) * 100));
    const barColor = active ? "#006c49" : "#7ebea7";
    const trackColor = "#dbe9ff";
    const valueColor = active ? "#006c49" : "#0d1c2d";

    return `
      <tr>
        <td class="activity-label" style="padding:12px 0; border-bottom:1px solid #e2e8f0; width:27%; vertical-align:middle; font-family:Inter, Arial, sans-serif;">
          <p style="margin:0; font-size:13px; line-height:1.3; color:#0d1c2d; font-weight:900; letter-spacing:0.08em; text-transform:uppercase;">
            ${escapeHtml(item.label)}
          </p>
          <p class="mobile-date" style="margin:4px 0 0; font-size:12px; line-height:1.5; color:#5b6471; font-weight:600;">
            ${escapeHtml(item.sublabel)}
          </p>
        </td>
        <td class="activity-bar" style="padding:12px 16px; border-bottom:1px solid #e2e8f0; width:45%; vertical-align:middle;">
          <div style="height:12px; border-radius:999px; background:${trackColor}; overflow:hidden;">
            <div style="height:12px; border-radius:999px; background:${barColor}; width:${barWidth}%;"></div>
          </div>
        </td>
        <td class="activity-value" align="right" style="padding:12px 0; border-bottom:1px solid #e2e8f0; width:28%; vertical-align:middle; font-family:Inter, Arial, sans-serif;">
          <p style="margin:0; font-size:14px; line-height:1.3; color:${valueColor}; font-weight:900;">
            ${escapeHtml(formatCurrency(item.amount, data.currency))}
          </p>
          <p style="margin:4px 0 0; font-size:11px; line-height:1.4; color:#5b6471; font-weight:700;">
            ${escapeHtml(formatCountLabel(item.receiptCount, "receipt"))}
          </p>
        </td>
      </tr>
    `;
  }).join("");

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-radius:20px; border:1px solid #d4e4fa; background:#ffffff;">
      <tr>
        <td style="padding:24px 24px 22px; font-family:Inter, Arial, sans-serif;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td>
                <p style="margin:0; font-size:26px; line-height:1.2; color:#0d1c2d; font-weight:900;">${escapeHtml(title)}</p>
                <p style="margin:6px 0 0; font-size:13px; line-height:1.6; color:#5b6471; font-weight:600;">
                  ${escapeHtml(subtitle)}
                </p>
              </td>
              <td align="right">
                <span style="display:inline-block; padding:8px 12px; border-radius:10px; background:#eef4ff; color:#0d1c2d; font-family:Inter, Arial, sans-serif; font-size:11px; line-height:1.2; font-weight:800; letter-spacing:0.08em;">
                  SPEND
                </span>
              </td>
            </tr>
          </table>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:20px;">
            ${rows}
          </table>
        </td>
      </tr>
    </table>
  `;
};

const renderReceiptsTable = (receipts: NormalizedReceipt[], currency: string) => {
  const rows = receipts.length > 0
    ? receipts.map((receipt) => `
        <tr>
          <td style="padding:16px 0; border-bottom:1px solid #e2e8f0;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="width:54px; vertical-align:middle;">
                  <div style="width:42px; height:42px; border-radius:999px; background:#dbe9ff; color:#064e3b; text-align:center; line-height:42px; font-family:Inter, Arial, sans-serif; font-size:11px; font-weight:900; letter-spacing:0.08em;">
                    ${escapeHtml(getBadgeLabel(receipt.categoryName, "RCT"))}
                  </div>
                </td>
                <td style="vertical-align:middle; font-family:Inter, Arial, sans-serif;">
                  <p style="margin:0; font-size:15px; line-height:1.4; color:#0d1c2d; font-weight:800;">${escapeHtml(receipt.merchantName)}</p>
                  <p style="margin:4px 0 0; font-size:12px; line-height:1.4; color:#5b6471; font-weight:600; letter-spacing:0.02em;">${escapeHtml(`${receipt.dateLabel} • ${receipt.categoryName}`)}</p>
                </td>
              </tr>
            </table>
          </td>
          <td align="right" style="padding:16px 0; border-bottom:1px solid #e2e8f0; font-family:Inter, Arial, sans-serif;">
            <p style="margin:0; font-size:15px; line-height:1.4; color:#0d1c2d; font-weight:900;">
              ${escapeHtml(formatCurrency(receipt.amount, currency))}
            </p>
            <p style="margin:4px 0 0; font-size:10px; line-height:1.2; color:#006c49; font-weight:900; letter-spacing:0.12em;">
              VERIFIED
            </p>
          </td>
        </tr>
      `).join("")
    : `
      <tr>
        <td colspan="2" style="padding:12px 0; font-family:Inter, Arial, sans-serif; font-size:14px; line-height:1.6; color:#5b6471;">
          No receipts were recorded for this period.
        </td>
      </tr>
    `;

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-radius:20px; border:1px solid #d4e4fa; background:#eef4ff;">
      <tr>
        <td style="padding:22px 22px 10px; font-family:Inter, Arial, sans-serif;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td>
                <p style="margin:0; font-size:22px; line-height:1.2; color:#0d1c2d; font-weight:900;">Recent Receipts</p>
                <p style="margin:6px 0 0; font-size:13px; line-height:1.6; color:#5b6471; font-weight:600;">The latest receipts that shaped this summary.</p>
              </td>
              <td align="right" style="font-family:Inter, Arial, sans-serif; font-size:12px; line-height:1.4; color:#006c49; font-weight:800; letter-spacing:0.08em;">
                ORGANIZED
              </td>
            </tr>
          </table>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:10px;">
            ${rows}
          </table>
        </td>
      </tr>
    </table>
  `;
};

const renderSecuritySection = (links: SummaryLinks) => {
  const settingsLink = links.dashboardUrl
    ? `
      <a href="${escapeHtml(links.dashboardUrl)}" style="display:inline-block; padding:12px 20px; border-radius:10px; background:#006c49; color:#ffffff; text-decoration:none; font-family:Inter, Arial, sans-serif; font-size:12px; line-height:1.2; font-weight:900; letter-spacing:0.12em;">
        REVIEW SECURITY SETTINGS
      </a>
    `
    : `
      <span style="display:inline-block; padding:12px 20px; border-radius:10px; background:#006c49; color:#ffffff; font-family:Inter, Arial, sans-serif; font-size:12px; line-height:1.2; font-weight:900; letter-spacing:0.12em;">
        REVIEW SECURITY SETTINGS
      </span>
    `;

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-radius:22px; background:#0d1c2d; overflow:hidden;">
      <tr>
        <td style="width:6px; background:#6ffbbe;"></td>
        <td style="padding:24px 24px 24px 22px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="vertical-align:middle;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:54px; height:54px; border-radius:999px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.14); color:#6ffbbe; text-align:center; line-height:54px; font-family:Inter, Arial, sans-serif; font-size:24px;">
                      &#128274;
                    </td>
                    <td style="padding-left:18px; font-family:Inter, Arial, sans-serif;">
                      <p style="margin:0; font-size:22px; line-height:1.2; color:#ffffff; font-weight:800;">Encrypted &amp; Secure</p>
                      <p style="margin:6px 0 0; font-size:13px; line-height:1.7; color:#a8b6c8; max-width:430px;">
                        Your receipt data is protected with strong encryption and stored inside your secure ReceiptNest AI workspace.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top:18px;">
                ${settingsLink}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
};

const renderFooter = (links: SummaryLinks) => {
  const dashboardCta = links.dashboardUrl
    ? `
      <div style="margin-top:18px;">
        <a
          href="${escapeHtml(links.dashboardUrl)}"
          style="display:inline-block; padding:13px 22px; border-radius:999px; background:#064e3b; color:#ffffff; text-decoration:none; font-family:Inter, Arial, sans-serif; font-size:12px; line-height:1.2; font-weight:900; letter-spacing:0.12em; text-transform:uppercase; box-shadow:0 10px 24px rgba(6, 78, 59, 0.18);"
        >
          Open Dashboard
        </a>
      </div>
    `
    : "";
  const secondaryLinks = [
    links.supportUrl ? `<a href="${escapeHtml(links.supportUrl)}" style="display:inline-block; margin:6px 5px 0; padding:10px 14px; border-radius:999px; background:#eef4ff; border:1px solid #d4e4fa; color:#243244; text-decoration:none; font-family:Inter, Arial, sans-serif; font-size:11px; line-height:1.2; font-weight:800; letter-spacing:0.08em; text-transform:uppercase;">Support</a>` : "",
    links.termsUrl ? `<a href="${escapeHtml(links.termsUrl)}" style="display:inline-block; margin:6px 5px 0; padding:10px 14px; border-radius:999px; background:#eef4ff; border:1px solid #d4e4fa; color:#243244; text-decoration:none; font-family:Inter, Arial, sans-serif; font-size:11px; line-height:1.2; font-weight:800; letter-spacing:0.08em; text-transform:uppercase;">Terms</a>` : "",
    links.unsubscribeUrl ? `<a href="${escapeHtml(links.unsubscribeUrl)}" style="display:inline-block; margin:6px 5px 0; padding:10px 14px; border-radius:999px; background:#fff4f3; border:1px solid #fecaca; color:#9f1239; text-decoration:none; font-family:Inter, Arial, sans-serif; font-size:11px; line-height:1.2; font-weight:800; letter-spacing:0.08em; text-transform:uppercase;">Unsubscribe</a>` : "",
  ].filter(Boolean).join("");

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:16px;">
      <tr>
        <td align="center" style="padding:24px 16px 8px; font-family:Inter, Arial, sans-serif;">
          <p style="margin:0; font-size:18px; line-height:1.2; color:#064e3b; font-weight:900;">ReceiptNest AI</p>
          ${dashboardCta}
          ${secondaryLinks ? `<div style="margin-top:14px; font-size:0; line-height:0;">${secondaryLinks}</div>` : ""}
          <p style="margin:16px 0 0; font-size:11px; line-height:1.6; color:#64748b;">
            © ${new Date().getFullYear()} ReceiptNest AI. All rights reserved.
          </p>
        </td>
      </tr>
    </table>
  `;
};

const buildEmailHtml = (data: SpendSummaryData, links: SummaryLinks) => {
  const metrics = data.metrics;
  const topCategoryText = metrics.topCategory
    ? `${metrics.topCategory.name} • ${formatCurrency(metrics.topCategory.total, data.currency)}`
    : "No category spending recorded";
  const topMerchantText = metrics.topMerchant
    ? `${metrics.topMerchant.name} • ${formatCurrency(metrics.topMerchant.total, data.currency)}`
    : "No merchant spending recorded";
  const largestReceiptText = metrics.largestReceipt
    ? `${metrics.largestReceipt.merchantName} • ${formatCurrency(metrics.largestReceipt.amount, data.currency)}`
    : "No receipt captured";
  const currencyNote = data.mixedCurrencies
    ? `
      <div style="margin-top:16px; padding:12px 14px; border-radius:14px; background:#fff7ed; border:1px solid #fdba74; color:#9a3412; font-size:13px; line-height:1.6; font-family:Arial, sans-serif;">
        Multiple currencies were found in this period. Totals are displayed using the app's current combined spend view and are not converted.
      </div>
    `
    : "";
  const introLine = data.period.type === "week"
    ? "Here is your weekly ReceiptNest AI spend summary, organized and ready to scan."
    : "Here is your monthly ReceiptNest AI spend summary, organized and ready for review.";
  const greetingName = data.userName.split(" ")[0] || data.userName;
  const heroPeriodLabel = data.period.compactLabel;
  const dashboardCta = links.dashboardUrl
    ? `
      <a href="${escapeHtml(links.dashboardUrl)}" style="display:inline-block; padding:11px 16px; border-radius:10px; background:#006c49; color:#ffffff; text-decoration:none; font-family:Inter, Arial, sans-serif; font-size:12px; line-height:1.2; font-weight:900; letter-spacing:0.08em;">
        OPEN DASHBOARD
      </a>
    `
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(data.period.heroEyebrow)}</title>
    <style>
      @media screen and (max-width: 640px) {
        .container {
          width: 100% !important;
        }

        .topbar-brand {
          font-size: 22px !important;
          line-height: 1.15 !important;
        }

        .topbar-link {
          display: inline-flex !important;
          align-items: center !important;
          gap: 10px !important;
        }

        .topbar-logo {
          width: 28px !important;
          height: 28px !important;
        }

        .mobile-px {
          padding-left: 16px !important;
          padding-right: 16px !important;
        }

        .stack-cell,
        .stack-cell-right,
        .metric-cell,
        .activity-label,
        .activity-bar,
        .activity-value {
          display: block !important;
          width: 100% !important;
          box-sizing: border-box !important;
        }

        .stack-cell {
          padding-right: 0 !important;
          padding-left: 0 !important;
          padding-bottom: 12px !important;
        }

        .stack-cell-right {
          padding-right: 0 !important;
          padding-left: 0 !important;
          padding-top: 12px !important;
        }

        .metric-cell {
          padding: 0 0 12px !important;
        }

        .metric-value {
          font-size: 22px !important;
        }

        .hero-title {
          font-size: 34px !important;
          line-height: 1.06 !important;
        }

        .hero-copy {
          font-size: 16px !important;
          line-height: 1.6 !important;
          max-width: none !important;
        }

        .hero-card {
          width: 100% !important;
          min-width: 0 !important;
        }

        .activity-label,
        .activity-bar,
        .activity-value {
          padding: 8px 0 !important;
          border-bottom: 0 !important;
          text-align: left !important;
        }

        .activity-row {
          border-bottom: 1px solid #e2e8f0 !important;
        }

        .activity-value p {
          text-align: left !important;
        }

        .mobile-date {
          white-space: normal !important;
        }
      }
    </style>
  </head>
  <body style="margin:0; padding:0; background:#f8f9ff;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
      ${escapeHtml(`${data.period.heroEyebrow} for ${data.period.rangeLabel}`)}
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f8f9ff;">
      <tr>
        <td align="center" style="padding:0;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#064e3b;">
            <tr>
              <td align="center" style="padding:20px 20px;">
                <table class="container" role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:740px;">
                  <tr>
                    <td class="topbar-brand" style="font-family:Inter, Arial, sans-serif; font-size:26px; line-height:1.1; color:#ffffff; font-weight:900; letter-spacing:-0.03em;">
                      <a class="topbar-link" href="${MAIN_SITE_URL}" style="display:inline-flex; align-items:center; gap:12px; color:#ffffff; text-decoration:none;">
                        <img class="topbar-logo" src="${MAIN_SITE_URL}/receipt-nest.png" alt="ReceiptNest AI" width="32" height="32" style="display:block; width:32px; height:32px; border-radius:8px;" />
                        <span style="display:inline-block; vertical-align:middle;">ReceiptNest AI</span>
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
          <table class="container" role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:740px; background:#f8f9ff;">
            <tr>
              <td class="mobile-px" style="padding:24px 16px 16px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-radius:24px; overflow:hidden; box-shadow:0 28px 60px rgba(13, 28, 45, 0.10);">
                  <tr>
                    <td style="padding:34px 34px 30px; background:
                      radial-gradient(circle at top left, rgba(16, 185, 129, 0.28), transparent 34%),
                      radial-gradient(circle at top right, rgba(191, 219, 254, 0.18), transparent 26%),
                      linear-gradient(135deg,#08111f 0%, #0f3b2f 48%, #0f766e 100%);">
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td class="stack-cell">
                            <div class="mobile-date" style="display:inline-block; padding:7px 12px; border-radius:999px; background:rgba(255,255,255,0.10); color:#d1fae5; font-family:Inter, Arial, sans-serif; font-size:11px; line-height:1.4; font-weight:900; letter-spacing:0.16em; text-transform:uppercase;">
                              ${escapeHtml(heroPeriodLabel)}
                            </div>
                            <h1 class="hero-title" style="margin:20px 0 0; font-size:44px; line-height:1.02; color:#ffffff; font-weight:900; letter-spacing:-0.04em; font-family:Inter, Arial, sans-serif;">Hi, ${escapeHtml(greetingName)}.</h1>
                            <p class="hero-copy" style="margin:16px 0 0; font-size:18px; line-height:1.7; color:#d1fae5; max-width:420px; font-family:Inter, Arial, sans-serif; font-weight:600;">
                              ${escapeHtml(introLine)}
                            </p>
                          </td>
                          <td class="stack-cell-right" align="right" style="vertical-align:top;">
                            <table class="hero-card" role="presentation" cellpadding="0" cellspacing="0" style="border-radius:22px; background:rgba(255,255,255,0.10); border:1px solid rgba(255,255,255,0.12); min-width:230px;">
                              <tr>
                                <td style="padding:18px 20px; font-family:Inter, Arial, sans-serif;">
                                  <p style="margin:0; font-size:10px; line-height:1.2; color:#a7f3d0; text-transform:uppercase; letter-spacing:0.16em; font-weight:700;">Total spend</p>
                                  <p style="margin:8px 0 0; font-size:38px; line-height:1.05; color:#6ffbbe; font-weight:900; letter-spacing:-0.04em;">${escapeHtml(formatCurrency(metrics.totalSpend, data.currency))}</p>
                                  <p style="margin:10px 0 0; font-size:13px; line-height:1.5; color:#ffffff; font-weight:700;">
                                    ${escapeHtml(formatCountLabel(metrics.receiptCount, "receipt"))} synced
                                  </p>
                                  ${dashboardCta ? `<div style="margin-top:16px;">${dashboardCta}</div>` : ""}
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="mobile-px" style="padding:0 16px 24px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td style="padding:0 0 20px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          ${renderMetricCard("Total spend", formatCurrency(metrics.totalSpend, data.currency), "dark")}
                          ${renderMetricCard("Receipt count", String(metrics.receiptCount), "green")}
                          ${renderMetricCard("Average receipt", formatCurrency(metrics.averageSpend, data.currency), "stone")}
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 0 20px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td class="stack-cell" style="padding:0 10px 0 0; width:50%; vertical-align:top;">
                            ${renderHighlightCard(
                              "Top Category",
                              metrics.topCategory ? metrics.topCategory.name : "No category data",
                              metrics.topCategory ? formatCurrency(metrics.topCategory.total, data.currency) : formatCurrency(0, data.currency),
                              metrics.topCategory ? `${Math.round(metrics.topCategory.share * 100)}% of total` : "No spend data",
                              "&#128179;",
                              "#064e3b",
                              "#d6fae8",
                            )}
                          </td>
                          <td class="stack-cell-right" style="padding:0 0 0 10px; width:50%; vertical-align:top;">
                            ${renderHighlightCard(
                              "Top Merchant",
                              metrics.topMerchant ? metrics.topMerchant.name : "No merchant data",
                              metrics.topMerchant ? formatCurrency(metrics.topMerchant.total, data.currency) : formatCurrency(0, data.currency),
                              metrics.topMerchant ? formatCountLabel(metrics.topMerchant.count, "transaction") : "No activity",
                              "&#127980;",
                              "#0d1c2d",
                              "#dbe9ff",
                            )}
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 0 20px;">
                      ${renderSpendChart(data)}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 0 20px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-radius:20px; background:#ffffff; border:1px solid #d4e4fa;">
                        <tr>
                          <td style="padding:22px 22px 18px; font-family:Inter, Arial, sans-serif;">
                            <p style="margin:0; font-size:14px; line-height:1.4; color:#0d1c2d; font-weight:800;">Highlights</p>
                            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:14px;">
                              <tr>
                                <td style="padding:0 12px 12px 0; width:33.333%; vertical-align:top;">
                                  <p style="margin:0; font-size:11px; line-height:1.4; color:#5b6471; text-transform:uppercase; letter-spacing:0.12em; font-weight:800;">Top category</p>
                                  <p style="margin:8px 0 0; font-size:14px; line-height:1.6; color:#0d1c2d; font-weight:700;">${escapeHtml(topCategoryText)}</p>
                                </td>
                                <td style="padding:0 12px 12px 0; width:33.333%; vertical-align:top;">
                                  <p style="margin:0; font-size:11px; line-height:1.4; color:#5b6471; text-transform:uppercase; letter-spacing:0.12em; font-weight:800;">Top merchant</p>
                                  <p style="margin:8px 0 0; font-size:14px; line-height:1.6; color:#0d1c2d; font-weight:700;">${escapeHtml(topMerchantText)}</p>
                                </td>
                                <td style="padding:0 0 12px; width:33.333%; vertical-align:top;">
                                  <p style="margin:0; font-size:11px; line-height:1.4; color:#5b6471; text-transform:uppercase; letter-spacing:0.12em; font-weight:800;">Largest receipt</p>
                                  <p style="margin:8px 0 0; font-size:14px; line-height:1.6; color:#0d1c2d; font-weight:700;">${escapeHtml(largestReceiptText)}</p>
                                </td>
                              </tr>
                              <tr>
                                <td colspan="3" style="padding:8px 0 0; font-size:13px; line-height:1.7; color:#5b6471; font-family:Inter, Arial, sans-serif;">
                                  Active on ${escapeHtml(formatCountLabel(metrics.activeDays, "day"))}. Summary prepared on ${escapeHtml(data.generatedAtLabel)}.
                                </td>
                              </tr>
                            </table>
                            ${currencyNote}
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 0 20px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                          <td class="stack-cell" style="padding:0 10px 0 0; width:50%; vertical-align:top;">
                            ${renderBreakdownTable("Category Breakdown", data.categories, data.currency, "#006c49")}
                          </td>
                          <td class="stack-cell-right" style="padding:0 0 0 10px; width:50%; vertical-align:top;">
                            ${renderBreakdownTable("Merchant Breakdown", data.merchants, data.currency, "#0d1c2d")}
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 0 20px;">
                      ${renderReceiptsTable(data.recentReceipts, data.currency)}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 0 20px;">
                      ${renderSecuritySection(links)}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0;">
                      ${renderFooter(links)}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

const buildSummarySubject = (summary: SpendSummaryData) =>
  `${summary.period.type === "week" ? "Weekly" : "Monthly"} spend summary • ${summary.period.label}`;

const buildSummaryNotificationTitle = (summary: SpendSummaryData) => {
  if (summary.mixedCurrencies) {
    return summary.period.type === "week"
      ? "Your weekly spend summary is ready"
      : "Your monthly spend summary is ready";
  }

  const amount = formatCurrency(summary.metrics.totalSpend, summary.currency);
  return summary.period.type === "week"
    ? `You spent ${amount} last week`
    : `You spent ${amount} last month`;
};

const buildSummaryNotificationBody = (summary: SpendSummaryData) => {
  const parts = [
    summary.period.compactLabel,
    formatCountLabel(summary.metrics.receiptCount, "receipt"),
  ];

  if (summary.mixedCurrencies) {
    parts.push("Multiple currencies detected");
  } else if (summary.metrics.topCategory?.name) {
    parts.push(`Top category: ${summary.metrics.topCategory.name}`);
  }

  return parts.join(" • ");
};

const getSummaryLinks = (): SummaryLinks => {
  const normalizedBaseUrl = appBaseUrl.value()?.trim().replace(/\/+$/, "");
  if (!normalizedBaseUrl) {
    return {};
  }

  return {
    dashboardUrl: `${normalizedBaseUrl}/app`,
    supportUrl: `${normalizedBaseUrl}/support`,
    termsUrl: `${normalizedBaseUrl}/terms`,
    unsubscribeUrl: `${normalizedBaseUrl}/app?settings=notifications&summaryEmails=1`,
  };
};

const buildEmailText = (data: SpendSummaryData) => {
  const lines = [
    `${data.period.heroEyebrow} (${data.period.label})`,
    `Range: ${data.period.rangeLabel}`,
    `User: ${data.userName}${data.userEmail ? ` <${data.userEmail}>` : ""}`,
    `Total spend: ${formatCurrency(data.metrics.totalSpend, data.currency)}`,
    `Receipt count: ${data.metrics.receiptCount}`,
    `Average receipt: ${formatCurrency(data.metrics.averageSpend, data.currency)}`,
    `Active days: ${data.metrics.activeDays}`,
  ];

  if (data.metrics.topCategory) {
    lines.push(`Top category: ${data.metrics.topCategory.name} (${formatCurrency(data.metrics.topCategory.total, data.currency)})`);
  }

  if (data.metrics.topMerchant) {
    lines.push(`Top merchant: ${data.metrics.topMerchant.name} (${formatCurrency(data.metrics.topMerchant.total, data.currency)})`);
  }

  if (data.recentReceipts.length > 0) {
    lines.push("");
    lines.push("Recent receipts:");
    for (const receipt of data.recentReceipts) {
      lines.push(`- ${receipt.dateLabel}: ${receipt.merchantName} • ${receipt.categoryName} • ${formatCurrency(receipt.amount, data.currency)}`);
    }
  }

  if (data.mixedCurrencies) {
    lines.push("");
    lines.push("Note: Multiple currencies were detected. Totals are not converted.");
  }

  lines.push("");
  lines.push("Generated by ReceiptNest AI.");

  return lines.join("\n");
};

const sendSummaryEmailMessage = async (to: string, summary: SpendSummaryData, links: SummaryLinks) => {
  sgMail.setApiKey(sendgridApiKey.value());

  await sgMail.send({
    to,
    from: { email: fromEmail, name: "ReceiptNest AI" },
    replyTo: { email: fromEmail, name: "ReceiptNest AI" },
    subject: buildSummarySubject(summary),
    text: buildEmailText(summary),
    html: buildEmailHtml(summary, links),
  });
};

const chunkValues = <T,>(values: T[], size: number) => {
  if (values.length <= size) {
    return [values];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

const sendSummaryNotificationMessage = async (
  tokens: string[],
  summary: SpendSummaryData,
): Promise<NotificationSendResult> => {
  const uniqueTokens = Array.from(new Set(tokens.filter((token) => token.trim().length > 0)));
  if (uniqueTokens.length === 0) {
    return {
      sentCount: 0,
      failedCount: 0,
      invalidTokens: [],
    };
  }

  let sentCount = 0;
  let failedCount = 0;
  const invalidTokens: string[] = [];

  for (const tokenChunk of chunkValues(uniqueTokens, 500)) {
    const response = await admin.messaging().sendEachForMulticast({
      tokens: tokenChunk,
      notification: {
        title: buildSummaryNotificationTitle(summary),
        body: buildSummaryNotificationBody(summary),
      },
      data: {
        type: "spend_summary",
        periodType: summary.period.type,
        periodLabel: summary.period.label,
        periodRange: summary.period.rangeLabel,
        periodStartKey: summary.period.startKey,
        periodEndKey: summary.period.endKey,
        totalSpend: summary.metrics.totalSpend.toFixed(2),
        receiptCount: String(summary.metrics.receiptCount),
        currency: summary.currency,
        mixedCurrencies: String(summary.mixedCurrencies),
      },
      android: {
        priority: "high",
      },
      apns: {
        headers: {
          "apns-priority": "10",
        },
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
    });

    response.responses.forEach((result, index) => {
      if (result.success) {
        sentCount += 1;
        return;
      }

      failedCount += 1;
      const code = result.error?.code ?? "";
      if (code === "messaging/invalid-registration-token" || code === "messaging/registration-token-not-registered") {
        invalidTokens.push(tokenChunk[index]);
      }
    });
  }

  return {
    sentCount,
    failedCount,
    invalidTokens,
  };
};

const loadUserSpendSummary = async (
  userId: string,
  userData: admin.firestore.DocumentData,
  period: SummaryPeriod,
  timeZone: string,
) => {
  const receiptsSnap = await admin.firestore().collection(`users/${userId}/receipts`).get();
  const normalizedReceipts = receiptsSnap.docs
    .map((doc) => normalizeReceipt(doc.data(), timeZone, FALLBACK_CURRENCY))
    .filter((receipt): receipt is NormalizedReceipt => receipt !== null);

  return buildSummaryData(period, userData, normalizedReceipts, timeZone);
};

const getScheduleSummaryPeriodKey = (period: SummaryPeriod) =>
  period.type === "week" ? getIsoWeekValue(dateFromKey(period.startKey)) : period.startKey.slice(0, 7);

const isWeeklyScheduleDue = (config: SpendSummaryScheduleConfig, date: Date) => {
  if (!config.weekly.enabled) {
    return false;
  }

  const parts = getDateTimeParts(date, config.timeZone);
  const currentTime = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  return parts.weekday === config.weekly.dayOfWeek && currentTime === config.weekly.time;
};

const isMonthlyScheduleDue = (config: SpendSummaryScheduleConfig, date: Date) => {
  if (!config.monthly.enabled) {
    return false;
  }

  const parts = getDateTimeParts(date, config.timeZone);
  const currentTime = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  const effectiveDay = getEffectiveDayOfMonth(parts.year, parts.month, config.monthly.dayOfMonth);
  return parts.day === effectiveDay && currentTime === config.monthly.time;
};

const getUserNotificationTokens = (userData: admin.firestore.DocumentData) =>
  Array.from(
    new Set(
      (Array.isArray(userData.notificationTokens) ? userData.notificationTokens : [])
        .filter((token): token is string => typeof token === "string")
        .map((token) => token.trim())
        .filter(Boolean),
    ),
  );

const getUserNotificationTimeZone = (userData: admin.firestore.DocumentData) =>
  normalizeTimeZone(userData.notificationTimeZone, FALLBACK_TIME_ZONE);

const isWithinSummaryNotificationWindow = (date: Date, timeZone: string) => {
  const parts = getDateTimeParts(date, timeZone);
  return parts.hour >= SUMMARY_NOTIFICATION_START_HOUR && parts.hour < SUMMARY_NOTIFICATION_END_HOUR;
};

const wantsSummaryNotification = (
  userData: admin.firestore.DocumentData,
  periodType: SummaryPeriodType,
) => {
  const notificationSettings = (userData.notificationSettings ?? {}) as Record<string, unknown>;
  if (periodType === "week") {
    return (notificationSettings.weeklySummaryPush ?? notificationSettings.weeklySummaryEmails ?? true) !== false;
  }

  return (notificationSettings.monthlySummaryPush ?? notificationSettings.monthlySummaryEmails ?? true) !== false;
};

const isUserWeeklyNotificationDue = (
  config: SpendSummaryScheduleConfig,
  userData: admin.firestore.DocumentData,
  date: Date,
) => {
  if (!config.weekly.enabled || !wantsSummaryNotification(userData, "week")) {
    return false;
  }

  const timeZone = getUserNotificationTimeZone(userData);
  if (!isWithinSummaryNotificationWindow(date, timeZone)) {
    return false;
  }

  return getDateTimeParts(date, timeZone).weekday === config.weekly.dayOfWeek;
};

const isUserMonthlyNotificationDue = (
  config: SpendSummaryScheduleConfig,
  userData: admin.firestore.DocumentData,
  date: Date,
) => {
  if (!config.monthly.enabled || !wantsSummaryNotification(userData, "month")) {
    return false;
  }

  const timeZone = getUserNotificationTimeZone(userData);
  if (!isWithinSummaryNotificationWindow(date, timeZone)) {
    return false;
  }

  const parts = getDateTimeParts(date, timeZone);
  return parts.day === getEffectiveDayOfMonth(parts.year, parts.month, config.monthly.dayOfMonth);
};

const getUserNotificationPeriodStateKey = (
  userData: admin.firestore.DocumentData,
  periodType: SummaryPeriodType,
) => {
  const state = (userData.summaryNotificationState ?? {}) as Record<string, unknown>;
  const periodState = (
    periodType === "week" ? state.weekly : state.monthly
  ) as Record<string, unknown> | undefined;
  return typeof periodState?.lastPeriodSent === "string" ? periodState.lastPeriodSent : null;
};

const dispatchSummaryNotificationToUser = async (
  userId: string,
  userData: admin.firestore.DocumentData,
  period: SummaryPeriod,
  timeZone: string,
) => {
  const summary = await loadUserSpendSummary(userId, userData, period, timeZone);
  return sendSummaryNotificationMessage(getUserNotificationTokens(userData), summary);
};

const dispatchSummaryPeriodToAllUsers = async (
  period: SummaryPeriod,
  timeZone: string,
) => {
  const links = getSummaryLinks();
  const usersSnap = await admin.firestore().collection("users").get();

  let eligibleUsers = 0;
  let sentCount = 0;
  let failedCount = 0;

  for (const userDoc of usersSnap.docs) {
    const userData = userDoc.data();
    const email = String(userData.email ?? "").trim();
    if (!email) {
      continue;
    }

    const notificationSettings = (userData.notificationSettings ?? {}) as Record<string, unknown>;
    const wantsThisEmail = period.type === "week"
      ? (notificationSettings.weeklySummaryEmails ?? true) !== false
      : (notificationSettings.monthlySummaryEmails ?? true) !== false;

    if (!wantsThisEmail) {
      continue;
    }

    eligibleUsers += 1;

    try {
      const summary = await loadUserSpendSummary(userDoc.id, userData, period, timeZone);
      await sendSummaryEmailMessage(email, summary, links);
      sentCount += 1;
    } catch (error) {
      failedCount += 1;
      logger.error("Failed to send automated spend summary email", {
        userId: userDoc.id,
        email,
        periodType: period.type,
        periodKey: getScheduleSummaryPeriodKey(period),
        error,
      });
    }
  }

  return {
    eligibleUsers,
    sentCount,
    failedCount,
  };
};

export const getSpendSummaryEmailSchedule = onCall(
  { region: "us-central1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated.");
    }

    await assertAdmin(request.auth.uid, request.auth.token as Record<string, unknown>);

    const scheduleSnap = await getScheduleConfigRef().get();
    const config = normalizeScheduleConfig(scheduleSnap.data());
    return toScheduleResponse(config);
  },
);

export const updateSpendSummaryEmailSchedule = onCall(
  { region: "us-central1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated.");
    }

    await assertAdmin(request.auth.uid, request.auth.token as Record<string, unknown>);

    const currentSnap = await getScheduleConfigRef().get();
    const currentConfig = normalizeScheduleConfig(currentSnap.data());
    const incomingWeekly = (request.data?.weekly ?? {}) as Record<string, unknown>;
    const incomingMonthly = (request.data?.monthly ?? {}) as Record<string, unknown>;

    const nextConfig: SpendSummaryScheduleConfig = {
      ...currentConfig,
      timeZone: normalizeTimeZone(request.data?.timeZone, currentConfig.timeZone),
      weekly: {
        enabled: Boolean(incomingWeekly.enabled ?? currentConfig.weekly.enabled),
        dayOfWeek: normalizeDayOfWeek(incomingWeekly.dayOfWeek, currentConfig.weekly.dayOfWeek),
        time: normalizeTimeValue(incomingWeekly.time, currentConfig.weekly.time),
      },
      monthly: {
        enabled: Boolean(incomingMonthly.enabled ?? currentConfig.monthly.enabled),
        dayOfMonth: normalizeDayOfMonth(incomingMonthly.dayOfMonth, currentConfig.monthly.dayOfMonth),
        time: normalizeTimeValue(incomingMonthly.time, currentConfig.monthly.time),
      },
    };

    await getScheduleConfigRef().set(
      {
        timeZone: nextConfig.timeZone,
        weekly: nextConfig.weekly,
        monthly: nextConfig.monthly,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: request.auth.uid,
      },
      { merge: true },
    );

    const savedSnap = await getScheduleConfigRef().get();
    return toScheduleResponse(normalizeScheduleConfig(savedSnap.data()));
  },
);

export const dispatchScheduledSpendSummaryEmails = onSchedule(
  {
    region: "us-central1",
    schedule: "every 1 minutes",
    secrets: [sendgridApiKey, appBaseUrl],
  },
  async (event) => {
    if (!sendgridApiKey.value()) {
      logger.error("Spend summary automation skipped because SendGrid is not configured.");
      return;
    }

    const scheduleSnap = await getScheduleConfigRef().get();
    const config = normalizeScheduleConfig(scheduleSnap.data());
    const now = event.scheduleTime ? new Date(event.scheduleTime) : new Date();

    if (!isWeeklyScheduleDue(config, now) && !isMonthlyScheduleDue(config, now)) {
      return;
    }

    if (isWeeklyScheduleDue(config, now)) {
      const weekValue = getPreviousCompletedWeekValue(now, config.timeZone);
      const period = getWeekPeriod(weekValue, config.timeZone);
      const periodKey = getScheduleSummaryPeriodKey(period);

      if (config.lastWeeklyPeriodSent !== periodKey) {
        const result = await dispatchSummaryPeriodToAllUsers(period, config.timeZone);
        await getScheduleConfigRef().set(
          {
            lastWeeklyPeriodSent: periodKey,
            lastWeeklySentAt: admin.firestore.FieldValue.serverTimestamp(),
            lastWeeklySentCount: result.sentCount,
            lastWeeklyFailedCount: result.failedCount,
          },
          { merge: true },
        );
        logger.info("Weekly spend summaries dispatched", { periodKey, ...result });
      }
    }

    if (isMonthlyScheduleDue(config, now)) {
      const monthValue = getPreviousCompletedMonthValue(now, config.timeZone);
      const period = getMonthPeriod(monthValue, config.timeZone);
      const periodKey = getScheduleSummaryPeriodKey(period);

      if (config.lastMonthlyPeriodSent !== periodKey) {
        const result = await dispatchSummaryPeriodToAllUsers(period, config.timeZone);
        await getScheduleConfigRef().set(
          {
            lastMonthlyPeriodSent: periodKey,
            lastMonthlySentAt: admin.firestore.FieldValue.serverTimestamp(),
            lastMonthlySentCount: result.sentCount,
            lastMonthlyFailedCount: result.failedCount,
          },
          { merge: true },
        );
        logger.info("Monthly spend summaries dispatched", { periodKey, ...result });
      }
    }
  },
);

export const dispatchScheduledSpendSummaryNotifications = onSchedule(
  {
    region: "us-central1",
    schedule: "every 10 minutes",
  },
  async (event) => {
    const scheduleSnap = await getScheduleConfigRef().get();
    const config = normalizeScheduleConfig(scheduleSnap.data());
    if (!config.weekly.enabled && !config.monthly.enabled) {
      return;
    }

    const now = event.scheduleTime ? new Date(event.scheduleTime) : new Date();
    const usersSnap = await admin.firestore().collection("users").get();

    let weeklyEligibleUsers = 0;
    let weeklySentUsers = 0;
    let monthlyEligibleUsers = 0;
    let monthlySentUsers = 0;
    let invalidTokenCount = 0;

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const tokens = getUserNotificationTokens(userData);
      if (tokens.length === 0) {
        continue;
      }

      const timeZone = getUserNotificationTimeZone(userData);

      if (isUserWeeklyNotificationDue(config, userData, now)) {
        weeklyEligibleUsers += 1;
        const period = getWeekPeriod(getPreviousCompletedWeekValue(now, timeZone), timeZone);
        const periodKey = getScheduleSummaryPeriodKey(period);

        if (getUserNotificationPeriodStateKey(userData, "week") !== periodKey) {
          try {
            const result = await dispatchSummaryNotificationToUser(userDoc.id, userData, period, timeZone);
            invalidTokenCount += result.invalidTokens.length;

            if (result.invalidTokens.length > 0) {
              await userDoc.ref.set({
                notificationTokens: admin.firestore.FieldValue.arrayRemove(...result.invalidTokens),
                notificationTokenUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
              }, { merge: true });
            }

            if (result.sentCount > 0) {
              weeklySentUsers += 1;
              await userDoc.ref.set({
                notificationTimeZone: timeZone,
                summaryNotificationState: {
                  weekly: {
                    lastPeriodSent: periodKey,
                    lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
                    lastSentCount: result.sentCount,
                    lastFailedCount: result.failedCount,
                  },
                },
              }, { merge: true });
            }
          } catch (error) {
            logger.error("Failed to send automated weekly spend summary notification", {
              userId: userDoc.id,
              periodKey,
              timeZone,
              error,
            });
          }
        }
      }

      if (isUserMonthlyNotificationDue(config, userData, now)) {
        monthlyEligibleUsers += 1;
        const period = getMonthPeriod(getPreviousCompletedMonthValue(now, timeZone), timeZone);
        const periodKey = getScheduleSummaryPeriodKey(period);

        if (getUserNotificationPeriodStateKey(userData, "month") !== periodKey) {
          try {
            const result = await dispatchSummaryNotificationToUser(userDoc.id, userData, period, timeZone);
            invalidTokenCount += result.invalidTokens.length;

            if (result.invalidTokens.length > 0) {
              await userDoc.ref.set({
                notificationTokens: admin.firestore.FieldValue.arrayRemove(...result.invalidTokens),
                notificationTokenUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
              }, { merge: true });
            }

            if (result.sentCount > 0) {
              monthlySentUsers += 1;
              await userDoc.ref.set({
                notificationTimeZone: timeZone,
                summaryNotificationState: {
                  monthly: {
                    lastPeriodSent: periodKey,
                    lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
                    lastSentCount: result.sentCount,
                    lastFailedCount: result.failedCount,
                  },
                },
              }, { merge: true });
            }
          } catch (error) {
            logger.error("Failed to send automated monthly spend summary notification", {
              userId: userDoc.id,
              periodKey,
              timeZone,
              error,
            });
          }
        }
      }
    }

    logger.info("Scheduled spend summary notifications processed", {
      weeklyEligibleUsers,
      weeklySentUsers,
      monthlyEligibleUsers,
      monthlySentUsers,
      invalidTokenCount,
    });
  },
);

export const sendSpendSummaryEmail = onCall(
  { region: "us-central1", secrets: [sendgridApiKey, appBaseUrl] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated.");
    }

    if (!sendgridApiKey.value()) {
      throw new HttpsError("failed-precondition", "SendGrid configuration is missing.");
    }

    await assertAdmin(request.auth.uid, request.auth.token as Record<string, unknown>);

    const to = String(request.data?.to ?? "").trim();
    const userId = String(request.data?.userId ?? "").trim();
    const periodType = String(request.data?.periodType ?? "").trim() as SummaryPeriodType;
    const timeZone = String(request.data?.timeZone ?? FALLBACK_TIME_ZONE).trim() || FALLBACK_TIME_ZONE;

    if (!to) {
      throw new HttpsError("invalid-argument", "Recipient email is required.");
    }

    if (!userId) {
      throw new HttpsError("invalid-argument", "A source user is required.");
    }

    if (periodType !== "week" && periodType !== "month") {
      throw new HttpsError("invalid-argument", "Period type must be week or month.");
    }

    const period = periodType === "week"
      ? getWeekPeriod(String(request.data?.week ?? ""), timeZone)
      : getMonthPeriod(String(request.data?.month ?? ""), timeZone);

    const db = admin.firestore();
    const userSnap = await db.doc(`users/${userId}`).get();
    if (!userSnap.exists) {
      throw new HttpsError("not-found", "Source user was not found.");
    }

    const summary = await loadUserSpendSummary(userId, userSnap.data() ?? {}, period, timeZone);
    const links = getSummaryLinks();
    const subject = buildSummarySubject(summary);

    try {
      await sendSummaryEmailMessage(to, summary, links);
    } catch (error) {
      logger.error("Failed to send spend summary email", error);
      throw new HttpsError("internal", "Failed to send summary email.");
    }

    return {
      ok: true,
      subject,
      rangeLabel: summary.period.rangeLabel,
      receiptCount: summary.metrics.receiptCount,
      totalSpend: summary.metrics.totalSpend,
    };
  },
);

export const sendSpendSummaryNotification = onCall(
  { region: "us-central1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated.");
    }

    await assertAdmin(request.auth.uid, request.auth.token as Record<string, unknown>);

    const userId = String(request.data?.userId ?? "").trim();
    const periodType = String(request.data?.periodType ?? "").trim() as SummaryPeriodType;
    const timeZone = String(request.data?.timeZone ?? FALLBACK_TIME_ZONE).trim() || FALLBACK_TIME_ZONE;
    const dryRun = request.data?.dryRun === true;

    if (!userId) {
      throw new HttpsError("invalid-argument", "A source user is required.");
    }

    if (periodType !== "week" && periodType !== "month") {
      throw new HttpsError("invalid-argument", "Period type must be week or month.");
    }

    const period = periodType === "week"
      ? getWeekPeriod(String(request.data?.week ?? ""), timeZone)
      : getMonthPeriod(String(request.data?.month ?? ""), timeZone);

    const db = admin.firestore();
    const userRef = db.doc(`users/${userId}`);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      throw new HttpsError("not-found", "Source user was not found.");
    }

    const userData = userSnap.data() ?? {};
    const summary = await loadUserSpendSummary(userId, userData, period, timeZone);
    const title = buildSummaryNotificationTitle(summary);
    const body = buildSummaryNotificationBody(summary);
    const tokens = getUserNotificationTokens(userData);

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        title,
        body,
        rangeLabel: summary.period.rangeLabel,
        receiptCount: summary.metrics.receiptCount,
        totalSpend: summary.metrics.totalSpend,
        tokenCount: tokens.length,
      };
    }

    if (tokens.length === 0) {
      throw new HttpsError(
        "failed-precondition",
        "The selected user does not have any registered notification devices.",
      );
    }

    try {
      const result = await sendSummaryNotificationMessage(tokens, summary);

      if (result.invalidTokens.length > 0) {
        await userRef.set({
          notificationTokens: admin.firestore.FieldValue.arrayRemove(...result.invalidTokens),
          notificationTokenUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      if (result.sentCount === 0) {
        throw new HttpsError(
          "failed-precondition",
          "Notification could not be delivered to any registered device.",
        );
      }

      return {
        ok: true,
        dryRun: false,
        title,
        body,
        rangeLabel: summary.period.rangeLabel,
        receiptCount: summary.metrics.receiptCount,
        totalSpend: summary.metrics.totalSpend,
        tokenCount: tokens.length,
        sentCount: result.sentCount,
        failedCount: result.failedCount,
      };
    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }

      logger.error("Failed to send spend summary notification", error);
      throw new HttpsError("internal", "Failed to send spend summary notification.");
    }
  },
);
