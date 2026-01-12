import { Timestamp, serverTimestamp } from 'firebase/firestore';

export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  subscriptionPlan?: 'free' | 'pro';
  subscriptionStatus?: string;
  subscriptionInterval?: 'monthly' | 'annual';
  subscriptionPriceId?: string | null;
  subscriptionCurrentPeriodEnd?: Timestamp | null;
  subscriptionCancelAtPeriodEnd?: boolean;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  createdAt?: Timestamp | ReturnType<typeof serverTimestamp>;
  updatedAt?: Timestamp | ReturnType<typeof serverTimestamp>;
}


