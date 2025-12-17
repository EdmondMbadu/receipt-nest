import { Timestamp, serverTimestamp } from 'firebase/firestore';

export interface GraphSharePoint {
  day: number;
  amount: number;
  cumulative: number;
}

export interface GraphShare {
  id: string;
  userId: string;
  month: number;
  year: number;
  monthLabel: string;
  totalSpend: number;
  dailyData: GraphSharePoint[];
  includeName: boolean;
  includeEmail: boolean;
  ownerName?: string;
  ownerEmail?: string;
  createdAt: Timestamp | ReturnType<typeof serverTimestamp>;
}

export interface CreateGraphShareRequest {
  month: number;
  year: number;
  monthLabel: string;
  totalSpend: number;
  dailyData: GraphSharePoint[];
  includeName: boolean;
  includeEmail: boolean;
  ownerName?: string;
  ownerEmail?: string;
}

