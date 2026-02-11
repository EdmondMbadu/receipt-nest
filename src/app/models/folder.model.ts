import { Timestamp, serverTimestamp } from 'firebase/firestore';

export interface Folder {
  id: string;
  userId: string;
  name: string;
  receiptIds: string[];
  isAuto?: boolean;
  autoType?: 'merchant' | 'title' | 'category';
  autoKey?: string;
  createdAt: Timestamp | ReturnType<typeof serverTimestamp>;
  updatedAt: Timestamp | ReturnType<typeof serverTimestamp>;
}
