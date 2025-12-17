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
import { CreateGraphShareRequest, GraphShare } from '../models/share-link.model';

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

    const document = {
      userId: user.id,
      month: payload.month,
      year: payload.year,
      monthLabel: payload.monthLabel,
      totalSpend: payload.totalSpend,
      dailyData: payload.dailyData,
      includeName: payload.includeName,
      includeEmail: payload.includeEmail,
      ownerName: payload.includeName ? payload.ownerName ?? '' : '',
      ownerEmail: payload.includeEmail ? payload.ownerEmail ?? '' : '',
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
}

