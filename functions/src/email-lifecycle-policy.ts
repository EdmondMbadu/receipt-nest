export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
export const EMAIL_GAP = 48 * HOUR;
export const EMAIL_WINDOW = 7 * DAY;
export const REMINDER_DELAY = 3 * DAY;
export const REMINDER_EXPIRY = 30 * DAY;
export const ONBOARDING_SEQUENCE_VERSION = 2;
export const ONBOARDING_STAGES = [
  { template: "first-receipt", key: "first-receipt-v1", day: 3, expiresDay: 10 },
  { template: "receipt-shortcut", key: "receipt-shortcut-v1", day: 10, expiresDay: 21 },
  { template: "receipt-help", key: "receipt-help-v1", day: 21, expiresDay: 30 },
] as const;
export type OnboardingReminderTemplate = (typeof ONBOARDING_STAGES)[number]["template"];
export const isOnboardingReminder = (kind: string): kind is OnboardingReminderTemplate =>
  ONBOARDING_STAGES.some(stage => stage.template === kind);

// Signup keeps its original stable keys; an explicit restart has a separate
// namespace so old delivery claims remain intact without blocking the new run.
export const onboardingDeliveryKey = (state: Record<string, any>, stageKey: string): string =>
  state.onboardingRunId ? `${state.onboardingRunId}-${stageKey}` : stageKey;

export const sameOnboardingEnrollment = (left: Record<string, any>, right: Record<string, any>): boolean =>
  (left.onboardingRunId ?? null) === (right.onboardingRunId ?? null) && millis(left.enrolledAt) === millis(right.enrolledAt);

// Missed steps expire when the next step becomes relevant. A delayed job sends
// one useful email, never a backlog of reminders in quick succession.
export const nextOnboardingReminder = (enrolledAt: number, handled: Record<string, unknown> | undefined, now: number) => {
  if (!enrolledAt || now >= enrolledAt + REMINDER_EXPIRY) return null;
  const stage = ONBOARDING_STAGES.find(item => !handled?.[item.template] && now < enrolledAt + item.expiresDay * DAY);
  return stage ? { ...stage, dueAt: enrolledAt + stage.day * DAY } : null;
};

// Scheduler retries retain their original scheduleTime. Cadence and eligibility
// must use the actual attempt time, even when the reporting period stays fixed.
export const deliveryTime = (scheduled: Date): Date => new Date(Math.max(scheduled.getTime(), Date.now()));

export type LifecycleKind = "welcome" | OnboardingReminderTemplate | "week" | "month";
export type SendEvent = { key: string; at: number };

export const millis = (value: unknown): number => {
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

export const recentSendEvents = (value: unknown, now: number, legacyWelcomeAt = 0): SendEvent[] => {
  const events = Array.isArray(value) ? value.filter((event): event is SendEvent =>
    event && typeof event.key === "string" && Number.isFinite(event.at) && event.at > now - EMAIL_WINDOW,
  ) : [];
  if (legacyWelcomeAt > now - EMAIL_WINDOW && !events.some(event => event.key === "welcome-v1")) {
    events.push({ key: "welcome-v1", at: legacyWelcomeAt });
  }
  return events.sort((a, b) => a.at - b.at);
};

export const nextEmailTime = (events: SendEvent[], now: number): number => {
  const recent = events.filter(event => event.at > now - EMAIL_WINDOW).sort((a, b) => a.at - b.at);
  const gapEnds = recent.length ? recent[recent.length - 1].at + EMAIL_GAP : now;
  const capacityReturns = recent.length >= 2 ? recent[recent.length - 2].at + EMAIL_WINDOW : now;
  return Math.max(now, gapEnds, capacityReturns);
};

export const hasUsableReceipt = (receipt: Record<string, any> | undefined): boolean => {
  if (!receipt) return false;
  if (receipt.status === "final") return true;
  // Processing failures also use needs_review. They must not count as activation.
  const amount = receipt.totalAmount ?? receipt.extraction?.totalAmount?.value;
  return receipt.status === "needs_review" && amount !== null && amount !== undefined &&
    String(amount).trim() !== "" && Number.isFinite(Number(amount));
};

export const wantsLifecycleEmail = (profile: Record<string, any>, kind: LifecycleKind): boolean => {
  const settings = profile.notificationSettings ?? {};
  if (isOnboardingReminder(kind)) return settings.onboardingEmails !== false;
  if (kind === "week") return settings.weeklySummaryEmails !== false;
  if (kind === "month") return settings.monthlySummaryEmails !== false;
  return true; // Keep the existing single account welcome behavior.
};

export const isReminderHour = (profile: Record<string, unknown>, now: Date): boolean => {
  let timeZone = typeof profile.notificationTimeZone === "string" ? profile.notificationTimeZone : "America/Los_Angeles";
  try { new Intl.DateTimeFormat("en-US", { timeZone }).format(now); } catch { timeZone = "America/Los_Angeles"; }
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now));
  return hour >= 8 && hour < 18;
};
