import { BillingMode } from "./app-config";

export interface BillingSnapshot {
  subscriptionPlan: "free" | "pro";
  subscriptionStatus: string | null;
  subscriptionInterval: "monthly" | "annual";
  subscriptionPriceId: string | null;
  subscriptionCurrentPeriodEnd: FirebaseFirestore.Timestamp | null;
  subscriptionCancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionUpdatedAt: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp | null;
}

const BILLING_FIELD_NAMES = [
  "subscriptionPlan",
  "subscriptionStatus",
  "subscriptionInterval",
  "subscriptionPriceId",
  "subscriptionCurrentPeriodEnd",
  "subscriptionCancelAtPeriodEnd",
  "stripeCustomerId",
  "stripeSubscriptionId",
  "subscriptionUpdatedAt",
] as const;

type BillingFieldName = (typeof BILLING_FIELD_NAMES)[number];

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export const getModeBillingFieldName = (mode: BillingMode, fieldName: BillingFieldName) =>
  `${mode}${capitalize(fieldName)}`;

export const emptyBillingSnapshot = (): BillingSnapshot => ({
  subscriptionPlan: "free",
  subscriptionStatus: null,
  subscriptionInterval: "monthly",
  subscriptionPriceId: null,
  subscriptionCurrentPeriodEnd: null,
  subscriptionCancelAtPeriodEnd: false,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  subscriptionUpdatedAt: null,
});

const normalizePlan = (value: unknown): "free" | "pro" => (value === "pro" ? "pro" : "free");
const normalizeInterval = (value: unknown): "monthly" | "annual" =>
  value === "annual" ? "annual" : "monthly";
const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const normalizeTimestamp = (value: unknown): FirebaseFirestore.Timestamp | null =>
  value && typeof value === "object" && "toDate" in (value as Record<string, unknown>)
    ? (value as FirebaseFirestore.Timestamp)
    : null;

export const getGenericBillingSnapshot = (data: Record<string, unknown>): BillingSnapshot => ({
  subscriptionPlan: normalizePlan(data.subscriptionPlan),
  subscriptionStatus: normalizeString(data.subscriptionStatus),
  subscriptionInterval: normalizeInterval(data.subscriptionInterval),
  subscriptionPriceId: normalizeString(data.subscriptionPriceId),
  subscriptionCurrentPeriodEnd: normalizeTimestamp(data.subscriptionCurrentPeriodEnd),
  subscriptionCancelAtPeriodEnd: data.subscriptionCancelAtPeriodEnd === true,
  stripeCustomerId: normalizeString(data.stripeCustomerId),
  stripeSubscriptionId: normalizeString(data.stripeSubscriptionId),
  subscriptionUpdatedAt:
    (data.subscriptionUpdatedAt as FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | null | undefined) ??
    null,
});

export const getModeBillingSnapshot = (
  data: Record<string, unknown>,
  mode: BillingMode,
  options?: { fallbackToGeneric?: boolean }
): BillingSnapshot => {
  const fallback = options?.fallbackToGeneric ? getGenericBillingSnapshot(data) : emptyBillingSnapshot();
  const snapshot: BillingSnapshot = { ...fallback };

  for (const fieldName of BILLING_FIELD_NAMES) {
    const storedValue = data[getModeBillingFieldName(mode, fieldName)];
    if (storedValue === undefined) {
      continue;
    }

    switch (fieldName) {
      case "subscriptionPlan":
        snapshot.subscriptionPlan = normalizePlan(storedValue);
        break;
      case "subscriptionStatus":
        snapshot.subscriptionStatus = normalizeString(storedValue);
        break;
      case "subscriptionInterval":
        snapshot.subscriptionInterval = normalizeInterval(storedValue);
        break;
      case "subscriptionPriceId":
        snapshot.subscriptionPriceId = normalizeString(storedValue);
        break;
      case "subscriptionCurrentPeriodEnd":
        snapshot.subscriptionCurrentPeriodEnd = normalizeTimestamp(storedValue);
        break;
      case "subscriptionCancelAtPeriodEnd":
        snapshot.subscriptionCancelAtPeriodEnd = storedValue === true;
        break;
      case "stripeCustomerId":
        snapshot.stripeCustomerId = normalizeString(storedValue);
        break;
      case "stripeSubscriptionId":
        snapshot.stripeSubscriptionId = normalizeString(storedValue);
        break;
      case "subscriptionUpdatedAt":
        snapshot.subscriptionUpdatedAt =
          (storedValue as FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue | null | undefined) ?? null;
        break;
    }
  }

  return snapshot;
};

export const buildGenericBillingOverlay = (snapshot: BillingSnapshot): Record<string, unknown> => ({
  subscriptionPlan: snapshot.subscriptionPlan,
  subscriptionStatus: snapshot.subscriptionStatus,
  subscriptionInterval: snapshot.subscriptionInterval,
  subscriptionPriceId: snapshot.subscriptionPriceId,
  subscriptionCurrentPeriodEnd: snapshot.subscriptionCurrentPeriodEnd,
  subscriptionCancelAtPeriodEnd: snapshot.subscriptionCancelAtPeriodEnd,
  stripeCustomerId: snapshot.stripeCustomerId,
  stripeSubscriptionId: snapshot.stripeSubscriptionId,
  subscriptionUpdatedAt: snapshot.subscriptionUpdatedAt,
});

export const buildModeBillingFields = (
  mode: BillingMode,
  snapshot: BillingSnapshot
): Record<string, unknown> => {
  const generic = buildGenericBillingOverlay(snapshot);
  return Object.fromEntries(
    Object.entries(generic).map(([fieldName, value]) => [getModeBillingFieldName(mode, fieldName as BillingFieldName), value])
  );
};

export const getStoredCustomerIdForMode = (data: Record<string, unknown>, mode: BillingMode): string | null => {
  const modeSpecificCustomerId = normalizeString(data[getModeBillingFieldName(mode, "stripeCustomerId")]);
  if (modeSpecificCustomerId) {
    return modeSpecificCustomerId;
  }

  if (mode === "live") {
    return normalizeString(data.stripeCustomerId);
  }

  return null;
};
