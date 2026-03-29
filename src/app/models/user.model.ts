import { Timestamp, serverTimestamp } from 'firebase/firestore';

export interface NotificationSettings {
  receiptProcessing: boolean;
  productUpdates: boolean;
  securityAlerts: boolean;
  weeklySummaryEmails: boolean;
  monthlySummaryEmails: boolean;
  weeklySummaryPush: boolean;
  monthlySummaryPush: boolean;
}

export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  receiptCount?: number;
  role?: 'admin' | 'user';
  subscriptionPlan?: 'free' | 'pro';
  subscriptionStatus?: string;
  subscriptionInterval?: 'monthly' | 'annual';
  subscriptionPriceId?: string | null;
  subscriptionCurrentPeriodEnd?: Timestamp | null;
  subscriptionCancelAtPeriodEnd?: boolean;
  adminSubscriptionPlanOverride?: 'pro' | null;
  adminSubscriptionOverrideUpdatedAt?: Timestamp | ReturnType<typeof serverTimestamp> | null;
  adminSubscriptionOverrideUpdatedBy?: string | null;
  adminSubscriptionOverrideUpdatedByEmail?: string | null;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  welcomeEmailSent?: boolean;
  welcomeEmailSentAt?: Timestamp | ReturnType<typeof serverTimestamp>;
  lastLoginAt?: Timestamp | ReturnType<typeof serverTimestamp>;
  lastSeenAt?: Timestamp | ReturnType<typeof serverTimestamp>;
  telegramChatId?: number;
  telegramLinkedAt?: Timestamp | ReturnType<typeof serverTimestamp>;
  receiptEmailToken?: string;
  receiptEmailAlias?: string;
  receiptForwardingAddress?: string;
  receiptForwardingFallbackAddresses?: string[];
  receiptForwardingEnabled?: boolean;
  notificationTokens?: string[];
  notificationTimeZone?: string;
  notificationSettings?: NotificationSettings;
  createdAt?: Timestamp | ReturnType<typeof serverTimestamp>;
  updatedAt?: Timestamp | ReturnType<typeof serverTimestamp>;
}
