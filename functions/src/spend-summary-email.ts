import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import sgMail from "@sendgrid/mail";

const sendgridApiKey = defineSecret("SENDGRID_API_KEY");
const fromEmail = "info@receipt-nest.com";
const FALLBACK_TIME_ZONE = "America/Los_Angeles";
const FALLBACK_CURRENCY = "USD";

type SummaryPeriodType = "week" | "month";

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
  heroEyebrow: string;
  rangeLabel: string;
  startKey: string;
  endKey: string;
};

type SpendSummaryData = {
  period: SummaryPeriod;
  userName: string;
  userEmail: string;
  previewRecipient: string;
  metrics: SummaryMetrics;
  categories: BreakdownItem[];
  merchants: BreakdownItem[];
  recentReceipts: NormalizedReceipt[];
  activity: SummaryActivityItem[];
  currency: string;
  mixedCurrencies: boolean;
  generatedAtLabel: string;
};

const assertAdmin = async (uid: string, token: Record<string, unknown>) => {
  if (token?.admin === true || token?.role === "admin") {
    return;
  }

  const userSnap = await admin.firestore().doc(`users/${uid}`).get();
  const role = userSnap.get("role");
  if (role === "admin") {
    return;
  }

  throw new HttpsError("permission-denied", "Admin access required.");
};

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
  const startDate = dateFromKey(startKey);
  const endDate = dateFromKey(endKey);
  const sameYear = startDate.getUTCFullYear() === endDate.getUTCFullYear();
  const sameMonth = sameYear && startDate.getUTCMonth() === endDate.getUTCMonth();

  const startLabel = formatDateKey(startKey, timeZone, { month: "short", day: "numeric", year: "numeric" });
  const endLabel = formatDateKey(
    endKey,
    timeZone,
    sameMonth ? { day: "numeric", year: "numeric" } : { month: "short", day: "numeric", year: "numeric" },
  );

  return `${startLabel} - ${endLabel}`;
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
  previewRecipient: string,
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
    previewRecipient,
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
    <td style="padding:0 6px 12px; width:33.333%;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-radius:16px; background:${palette.background};">
        <tr>
          <td style="padding:18px 18px 16px; font-family:Arial, sans-serif;">
            <p style="margin:0; font-size:12px; line-height:1.4; color:${palette.subtext}; text-transform:uppercase; letter-spacing:0.12em; font-weight:700;">${escapeHtml(label)}</p>
            <p style="margin:10px 0 0; font-size:24px; line-height:1.2; color:${palette.text}; font-weight:700;">${escapeHtml(value)}</p>
          </td>
        </tr>
      </table>
    </td>
  `;
};

const renderBreakdownTable = (title: string, items: BreakdownItem[], currency: string) => {
  const rows = items.length > 0
    ? items.map((item) => `
        <tr>
          <td style="padding:0 0 14px;">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="padding:0 12px 4px 0; font-family:Arial, sans-serif; font-size:14px; line-height:1.5; color:#0f172a; font-weight:600;">
                  ${escapeHtml(item.name)}
                </td>
                <td align="right" style="padding:0 0 4px; font-family:Arial, sans-serif; font-size:14px; line-height:1.5; color:#0f172a; font-weight:700;">
                  ${escapeHtml(formatCurrency(item.total, currency))}
                </td>
              </tr>
              <tr>
                <td style="padding:0 12px 8px 0; font-family:Arial, sans-serif; font-size:12px; line-height:1.4; color:#64748b;">
                  ${escapeHtml(formatCountLabel(item.count, "receipt"))}
                </td>
                <td align="right" style="padding:0 0 8px; font-family:Arial, sans-serif; font-size:12px; line-height:1.4; color:#64748b;">
                  ${escapeHtml(`${Math.round(item.share * 100)}% of spend`)}
                </td>
              </tr>
              <tr>
                <td colspan="2" style="padding:0;">
                  <div style="height:7px; border-radius:999px; background:#e2e8f0;">
                    <div style="height:7px; border-radius:999px; background:linear-gradient(90deg,#10b981 0%, #0f766e 100%); width:${Math.max(8, Math.round(item.share * 100))}%;"></div>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `).join("")
    : `
      <tr>
        <td style="padding:0; font-family:Arial, sans-serif; font-size:14px; line-height:1.6; color:#64748b;">
          No spending data landed in this period.
        </td>
      </tr>
    `;

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-radius:18px; border:1px solid #e2e8f0; background:#ffffff;">
      <tr>
        <td style="padding:20px 20px 18px; font-family:Arial, sans-serif;">
          <p style="margin:0 0 16px; font-size:14px; line-height:1.4; color:#0f172a; font-weight:700;">${escapeHtml(title)}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            ${rows}
          </table>
        </td>
      </tr>
    </table>
  `;
};

const renderActivityTable = (data: SpendSummaryData) => {
  const rows = data.activity.length > 0
    ? data.activity.map((item) => `
        <tr>
          <td style="padding:12px 0; border-bottom:1px solid #e2e8f0; font-family:Arial, sans-serif;">
            <p style="margin:0; font-size:14px; line-height:1.4; color:#0f172a; font-weight:600;">${escapeHtml(item.label)}</p>
            <p style="margin:3px 0 0; font-size:12px; line-height:1.4; color:#64748b;">${escapeHtml(item.sublabel)}</p>
          </td>
          <td align="right" style="padding:12px 0; border-bottom:1px solid #e2e8f0; font-family:Arial, sans-serif;">
            <p style="margin:0; font-size:14px; line-height:1.4; color:#0f172a; font-weight:700;">${escapeHtml(formatCurrency(item.amount, data.currency))}</p>
            <p style="margin:3px 0 0; font-size:12px; line-height:1.4; color:#64748b;">${escapeHtml(formatCountLabel(item.receiptCount, "receipt"))}</p>
          </td>
        </tr>
      `).join("")
    : `
      <tr>
        <td colspan="2" style="padding:12px 0; font-family:Arial, sans-serif; font-size:14px; line-height:1.6; color:#64748b;">
          No receipt activity to show for this period.
        </td>
      </tr>
    `;

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-radius:18px; border:1px solid #e2e8f0; background:#ffffff;">
      <tr>
        <td style="padding:20px 20px 6px; font-family:Arial, sans-serif;">
          <p style="margin:0 0 4px; font-size:14px; line-height:1.4; color:#0f172a; font-weight:700;">
            ${data.period.type === "week" ? "Daily spend" : "Week-by-week snapshot"}
          </p>
          <p style="margin:0 0 12px; font-size:13px; line-height:1.5; color:#64748b;">
            ${data.period.type === "week" ? "A day-by-day view across the selected week." : "A quick breakdown of how spending moved through the month."}
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
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
          <td style="padding:12px 0; border-bottom:1px solid #e2e8f0; font-family:Arial, sans-serif;">
            <p style="margin:0; font-size:14px; line-height:1.4; color:#0f172a; font-weight:600;">${escapeHtml(receipt.merchantName)}</p>
            <p style="margin:3px 0 0; font-size:12px; line-height:1.4; color:#64748b;">${escapeHtml(`${receipt.categoryName} • ${receipt.dateLabel}`)}</p>
          </td>
          <td align="right" style="padding:12px 0; border-bottom:1px solid #e2e8f0; font-family:Arial, sans-serif; font-size:14px; line-height:1.4; color:#0f172a; font-weight:700;">
            ${escapeHtml(formatCurrency(receipt.amount, currency))}
          </td>
        </tr>
      `).join("")
    : `
      <tr>
        <td colspan="2" style="padding:12px 0; font-family:Arial, sans-serif; font-size:14px; line-height:1.6; color:#64748b;">
          No receipts were recorded for this period.
        </td>
      </tr>
    `;

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-radius:18px; border:1px solid #e2e8f0; background:#ffffff;">
      <tr>
        <td style="padding:20px 20px 6px; font-family:Arial, sans-serif;">
          <p style="margin:0 0 4px; font-size:14px; line-height:1.4; color:#0f172a; font-weight:700;">Recent receipts in this period</p>
          <p style="margin:0 0 12px; font-size:13px; line-height:1.5; color:#64748b;">The latest receipts that shaped this summary.</p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            ${rows}
          </table>
        </td>
      </tr>
    </table>
  `;
};

const buildEmailHtml = (data: SpendSummaryData) => {
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

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(data.period.heroEyebrow)}</title>
  </head>
  <body style="margin:0; padding:0; background:#eef2f7;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
      ${escapeHtml(`${data.period.heroEyebrow} for ${data.period.rangeLabel}`)}
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#eef2f7;">
      <tr>
        <td align="center" style="padding:24px 14px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:700px; background:#ffffff; border-radius:28px; overflow:hidden; border:1px solid #dbe4ee; box-shadow:0 28px 60px rgba(15, 23, 42, 0.10);">
            <tr>
              <td style="padding:34px 34px 30px; background:radial-gradient(circle at top left, rgba(16, 185, 129, 0.28), transparent 36%), linear-gradient(135deg,#08111f 0%, #0f3b2f 48%, #0f766e 100%); color:#ffffff; font-family:Arial, sans-serif;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td>
                      <p style="margin:0; font-size:12px; line-height:1.4; text-transform:uppercase; letter-spacing:0.24em; color:#a7f3d0; font-weight:700;">ReceiptNest AI</p>
                      <p style="margin:16px 0 0; font-size:13px; line-height:1.5; color:#bbf7d0; font-weight:600;">${escapeHtml(data.period.heroEyebrow)}</p>
                      <h1 style="margin:10px 0 0; font-size:32px; line-height:1.18; color:#ffffff; font-weight:700;">${escapeHtml(data.period.label)}</h1>
                      <p style="margin:12px 0 0; font-size:15px; line-height:1.7; color:#d1fae5;">
                        ${escapeHtml(data.userName)} spent ${escapeHtml(formatCurrency(metrics.totalSpend, data.currency))} across ${escapeHtml(formatCountLabel(metrics.receiptCount, "receipt"))} during ${escapeHtml(data.period.rangeLabel)}.
                      </p>
                    </td>
                    <td align="right" style="vertical-align:top;">
                      <div style="display:inline-block; min-width:68px; padding:14px 16px; border-radius:20px; background:rgba(255,255,255,0.12); text-align:left;">
                        <p style="margin:0; font-size:11px; line-height:1.4; color:#bbf7d0; text-transform:uppercase; letter-spacing:0.12em; font-weight:700;">Preview</p>
                        <p style="margin:6px 0 0; font-size:13px; line-height:1.5; color:#ffffff; font-weight:600;">Admin test send</p>
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 28px 34px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    ${renderMetricCard("Total spend", formatCurrency(metrics.totalSpend, data.currency), "dark")}
                    ${renderMetricCard("Receipt count", String(metrics.receiptCount), "green")}
                    ${renderMetricCard("Average receipt", formatCurrency(metrics.averageSpend, data.currency), "stone")}
                  </tr>
                </table>

                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:10px; border-radius:20px; background:#f8fafc; border:1px solid #e2e8f0;">
                  <tr>
                    <td style="padding:20px 20px 16px; font-family:Arial, sans-serif;">
                      <p style="margin:0; font-size:14px; line-height:1.4; color:#0f172a; font-weight:700;">Highlights</p>
                      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:14px;">
                        <tr>
                          <td style="padding:0 12px 12px 0; width:33.333%; vertical-align:top;">
                            <p style="margin:0; font-size:12px; line-height:1.4; color:#64748b; text-transform:uppercase; letter-spacing:0.12em; font-weight:700;">Top category</p>
                            <p style="margin:8px 0 0; font-size:14px; line-height:1.6; color:#0f172a; font-weight:600;">${escapeHtml(topCategoryText)}</p>
                          </td>
                          <td style="padding:0 12px 12px 0; width:33.333%; vertical-align:top;">
                            <p style="margin:0; font-size:12px; line-height:1.4; color:#64748b; text-transform:uppercase; letter-spacing:0.12em; font-weight:700;">Top merchant</p>
                            <p style="margin:8px 0 0; font-size:14px; line-height:1.6; color:#0f172a; font-weight:600;">${escapeHtml(topMerchantText)}</p>
                          </td>
                          <td style="padding:0 0 12px; width:33.333%; vertical-align:top;">
                            <p style="margin:0; font-size:12px; line-height:1.4; color:#64748b; text-transform:uppercase; letter-spacing:0.12em; font-weight:700;">Largest receipt</p>
                            <p style="margin:8px 0 0; font-size:14px; line-height:1.6; color:#0f172a; font-weight:600;">${escapeHtml(largestReceiptText)}</p>
                          </td>
                        </tr>
                        <tr>
                          <td colspan="3" style="padding:6px 0 0; font-size:13px; line-height:1.7; color:#475569;">
                            Active on ${escapeHtml(formatCountLabel(metrics.activeDays, "day"))}. Preview delivered to ${escapeHtml(data.previewRecipient)} on ${escapeHtml(data.generatedAtLabel)}.
                          </td>
                        </tr>
                      </table>
                      ${currencyNote}
                    </td>
                  </tr>
                </table>

                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:20px;">
                  <tr>
                    <td style="padding:0 10px 0 0; width:50%; vertical-align:top;">
                      ${renderBreakdownTable("Top categories", data.categories, data.currency)}
                    </td>
                    <td style="padding:0 0 0 10px; width:50%; vertical-align:top;">
                      ${renderBreakdownTable("Top merchants", data.merchants, data.currency)}
                    </td>
                  </tr>
                </table>

                <div style="margin-top:20px;">
                  ${renderActivityTable(data)}
                </div>

                <div style="margin-top:20px;">
                  ${renderReceiptsTable(data.recentReceipts, data.currency)}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 28px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-radius:20px; background:#0f172a;">
                  <tr>
                    <td style="padding:18px 20px; font-family:Arial, sans-serif;">
                      <p style="margin:0; font-size:13px; line-height:1.6; color:#cbd5e1;">
                        This message was generated from the ReceiptNest AI admin preview tool for ${escapeHtml(data.userEmail || data.userName)}.
                      </p>
                      <p style="margin:8px 0 0; font-size:12px; line-height:1.6; color:#94a3b8;">
                        ReceiptNest AI • info@receipt-nest.com
                      </p>
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
  lines.push("Preview generated from the ReceiptNest AI admin console.");

  return lines.join("\n");
};

export const sendSpendSummaryEmail = onCall(
  { region: "us-central1", secrets: [sendgridApiKey] },
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

    const receiptsSnap = await db.collection(`users/${userId}/receipts`).get();
    const normalizedReceipts = receiptsSnap.docs
      .map((doc) => normalizeReceipt(doc.data(), timeZone, FALLBACK_CURRENCY))
      .filter((receipt): receipt is NormalizedReceipt => receipt !== null);

    const summary = buildSummaryData(period, userSnap.data() ?? {}, to, normalizedReceipts, timeZone);
    const subject = `${summary.period.type === "week" ? "Weekly" : "Monthly"} spend summary • ${summary.period.label}`;
    const text = buildEmailText(summary);
    const html = buildEmailHtml(summary);

    sgMail.setApiKey(sendgridApiKey.value());

    try {
      await sgMail.send({
        to,
        from: { email: fromEmail, name: "ReceiptNest AI" },
        replyTo: { email: fromEmail, name: "ReceiptNest AI" },
        subject,
        text,
        html,
      });
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
