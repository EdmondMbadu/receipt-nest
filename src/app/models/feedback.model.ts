import { Timestamp, serverTimestamp } from 'firebase/firestore';

export type FeedbackStatus = 'open' | 'archived';

export interface FeedbackMessage {
  id: string;
  userId: string | null;
  email: string;
  displayName: string;
  message: string;
  status: FeedbackStatus;
  createdAt?: Timestamp | ReturnType<typeof serverTimestamp>;
  updatedAt?: Timestamp | ReturnType<typeof serverTimestamp>;
  archivedAt?: Timestamp | ReturnType<typeof serverTimestamp> | null;
  archivedBy?: string | null;
}
