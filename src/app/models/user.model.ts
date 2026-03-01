import { Timestamp, serverTimestamp } from 'firebase/firestore';

export interface NotificationSettings {
  receiptProcessing: boolean;
  productUpdates: boolean;
  securityAlerts: boolean;
}

export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role?: 'admin' | 'user';
  subscriptionPlan?: 'free' | 'pro';
  subscriptionStatus?: string;
  subscriptionInterval?: 'monthly' | 'annual';
  subscriptionPriceId?: string | null;
  subscriptionCurrentPeriodEnd?: Timestamp | null;
  subscriptionCancelAtPeriodEnd?: boolean;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  welcomeEmailSent?: boolean;
  welcomeEmailSentAt?: Timestamp | ReturnType<typeof serverTimestamp>;
  telegramChatId?: number;
  telegramLinkedAt?: Timestamp | ReturnType<typeof serverTimestamp>;
  receiptEmailToken?: string;
  receiptEmailAlias?: string;
  receiptForwardingAddress?: string;
  receiptForwardingFallbackAddresses?: string[];
  receiptForwardingEnabled?: boolean;
  notificationSettings?: NotificationSettings;
  createdAt?: Timestamp | ReturnType<typeof serverTimestamp>;
  updatedAt?: Timestamp | ReturnType<typeof serverTimestamp>;
}
