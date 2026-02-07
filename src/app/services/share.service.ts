import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  addDoc,
  collection,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp
} from 'firebase/firestore';

import { app } from '../../../environments/environments';
import { AuthService } from './auth.service';
import { ChatShare, ChatShareMessage, CreateGraphShareRequest, GraphShare, PublicShare } from '../models/share-link.model';

@Injectable({
  providedIn: 'root'
})
export class ShareService {
  private readonly db: Firestore = getFirestore(app);
  private readonly auth = inject(AuthService);

  async createGraphShare(payload: CreateGraphShareRequest): Promise<GraphShare> {
    const user = this.auth.user();
    if (!user) {
      throw new Error('You need to be signed in to share data.');
    }

    if (!payload.dailyData?.length) {
      throw new Error('No spending data available for the selected month.');
    }

    const ownerName = payload.includeName ? (payload.ownerName ?? '').trim() : '';
    const ownerEmail = payload.includeEmail ? (payload.ownerEmail ?? '').trim() : '';

    const document = {
      userId: user.id,
      month: payload.month,
      year: payload.year,
      monthLabel: payload.monthLabel,
      totalSpend: payload.totalSpend,
      dailyData: payload.dailyData,
      includeName: payload.includeName,
      includeEmail: payload.includeEmail,
      ownerName,
      ownerEmail,
      createdAt: serverTimestamp()
    };

    const collectionRef = collection(this.db, 'graphShares');
    const docRef = await addDoc(collectionRef, document);

    return {
      id: docRef.id,
      ...document
    } as GraphShare;
  }

  async getGraphShare(shareId: string): Promise<GraphShare | null> {
    if (!shareId) {
      return null;
    }

    const snapshot = await getDoc(doc(this.db, 'graphShares', shareId));
    if (!snapshot.exists()) {
      return null;
    }

    return { id: snapshot.id, ...snapshot.data() } as GraphShare;
  }

  async createChatShare(chatId: string): Promise<ChatShare> {
    const user = this.auth.user();
    if (!user) {
      throw new Error('You need to be signed in to share data.');
    }

    if (!chatId) {
      throw new Error('Missing chat identifier.');
    }

    const chatSnapshot = await getDoc(doc(this.db, `users/${user.id}/aiChats`, chatId));
    if (!chatSnapshot.exists()) {
      throw new Error('Chat not found.');
    }

    const data = chatSnapshot.data() as {
      title?: string;
      messages?: Array<{
        role?: string;
        content?: string;
        timestamp?: string;
      }>;
    };

    const messages: ChatShareMessage[] = (data.messages || [])
      .filter(message => message?.role === 'user' || message?.role === 'assistant')
      .map((message, index) => ({
        id: `${index + 1}`,
        role: message.role as 'user' | 'assistant',
        content: String(message.content || ''),
        timestamp: String(message.timestamp || new Date().toISOString())
      }));

    if (!messages.length) {
      throw new Error('Cannot share an empty chat.');
    }

    const document = {
      userId: user.id,
      chatId,
      title: String(data.title || 'Shared conversation'),
      messages,
      messageCount: messages.length,
      createdAt: serverTimestamp()
    };

    const collectionRef = collection(this.db, 'chatShares');
    const docRef = await addDoc(collectionRef, document);

    return {
      id: docRef.id,
      ...document
    } as ChatShare;
  }

  async getChatShare(shareId: string): Promise<ChatShare | null> {
    if (!shareId) {
      return null;
    }

    const snapshot = await getDoc(doc(this.db, 'chatShares', shareId));
    if (!snapshot.exists()) {
      return null;
    }

    return { id: snapshot.id, ...snapshot.data() } as ChatShare;
  }

  async getPublicShare(shareId: string): Promise<PublicShare | null> {
    if (!shareId) {
      return null;
    }

    const graphShare = await this.getGraphShare(shareId);
    if (graphShare) {
      return {
        ...graphShare,
        shareType: 'graph'
      };
    }

    const chatShare = await this.getChatShare(shareId);
    if (chatShare) {
      return {
        ...chatShare,
        shareType: 'chat'
      };
    }

    return null;
  }
}
