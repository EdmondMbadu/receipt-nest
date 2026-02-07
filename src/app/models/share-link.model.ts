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

export interface ChatShareMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ChatShare {
  id: string;
  userId: string;
  chatId: string;
  title: string;
  messages: ChatShareMessage[];
  messageCount: number;
  createdAt: Timestamp | ReturnType<typeof serverTimestamp>;
}

export type PublicShare =
  | (GraphShare & { shareType: 'graph' })
  | (ChatShare & { shareType: 'chat' });

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
