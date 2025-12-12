import { Timestamp, serverTimestamp } from 'firebase/firestore';

export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  createdAt?: Timestamp | ReturnType<typeof serverTimestamp>;
  updatedAt?: Timestamp | ReturnType<typeof serverTimestamp>;
}
