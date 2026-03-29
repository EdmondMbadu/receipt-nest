export type EffectiveSubscriptionPlan = "free" | "pro";

type SubscriptionLike = {
  subscriptionPlan?: unknown;
  adminSubscriptionPlanOverride?: unknown;
} | null | undefined;

export const hasManualProOverride = (profile: SubscriptionLike): boolean =>
  profile?.adminSubscriptionPlanOverride === "pro";

export const getEffectiveSubscriptionPlan = (profile: SubscriptionLike): EffectiveSubscriptionPlan => {
  if (hasManualProOverride(profile)) {
    return "pro";
  }

  return profile?.subscriptionPlan === "pro" ? "pro" : "free";
};
