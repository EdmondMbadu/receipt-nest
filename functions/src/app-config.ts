import * as admin from "firebase-admin";

export const DEFAULT_FREE_PLAN_RECEIPT_LIMIT = 50;
export const PUBLIC_BILLING_CONFIG_PATH = "publicConfig/billing";
export const DEFAULT_BILLING_MODE = "live" as const;

export type BillingMode = "live" | "test";

export function normalizeFreePlanReceiptLimit(value: unknown): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_FREE_PLAN_RECEIPT_LIMIT;
  }

  return Math.floor(parsed);
}

export function normalizeBillingMode(value: unknown): BillingMode {
  return value === "test" ? "test" : DEFAULT_BILLING_MODE;
}

export function getEffectiveBillingModeForUserData(
  value: Record<string, unknown> | undefined
): BillingMode {
  return normalizeBillingMode(value?.billingModeOverride);
}

export async function getFreePlanReceiptLimit(): Promise<number> {
  const snapshot = await admin.firestore().doc(PUBLIC_BILLING_CONFIG_PATH).get();
  return normalizeFreePlanReceiptLimit(snapshot.data()?.freePlanReceiptLimit);
}

export async function getBillingMode(): Promise<BillingMode> {
  const snapshot = await admin.firestore().doc(PUBLIC_BILLING_CONFIG_PATH).get();
  return normalizeBillingMode(snapshot.data()?.billingMode);
}
