import { UserProfile } from '../models/user.model';

export type EffectiveSubscriptionPlan = 'free' | 'pro';
export type EffectiveSubscriptionSource = 'free' | 'billing' | 'admin';

type SubscriptionProfile = Pick<UserProfile, 'subscriptionPlan' | 'subscriptionStatus' | 'adminSubscriptionPlanOverride'>;

export const hasManualProOverride = (profile: SubscriptionProfile | null | undefined): boolean =>
  profile?.adminSubscriptionPlanOverride === 'pro';

export const getEffectiveSubscriptionPlan = (
  profile: SubscriptionProfile | null | undefined
): EffectiveSubscriptionPlan => {
  if (hasManualProOverride(profile)) {
    return 'pro';
  }

  return profile?.subscriptionPlan === 'pro' ? 'pro' : 'free';
};

export const getEffectiveSubscriptionSource = (
  profile: SubscriptionProfile | null | undefined
): EffectiveSubscriptionSource => {
  if (hasManualProOverride(profile)) {
    return 'admin';
  }

  return profile?.subscriptionPlan === 'pro' ? 'billing' : 'free';
};

export const getEffectiveSubscriptionStatus = (profile: SubscriptionProfile | null | undefined): string =>
  hasManualProOverride(profile) ? 'admin-granted' : profile?.subscriptionStatus ?? 'inactive';
