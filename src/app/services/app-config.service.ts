import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Firestore, doc, getFirestore, onSnapshot, Unsubscribe } from 'firebase/firestore';

import { app } from '../../../environments/environments';
import {
  DEFAULT_FREE_PLAN_RECEIPT_LIMIT,
  PUBLIC_BILLING_CONFIG_COLLECTION,
  PUBLIC_BILLING_CONFIG_DOC_ID,
  normalizeFreePlanReceiptLimit
} from '../config/subscription.constants';

@Injectable({
  providedIn: 'root'
})
export class AppConfigService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly db: Firestore | null = this.isBrowser ? getFirestore(app) : null;
  private configUnsubscribe: Unsubscribe | null = null;

  readonly freePlanReceiptLimit = signal(DEFAULT_FREE_PLAN_RECEIPT_LIMIT);

  constructor() {
    if (!this.db) {
      return;
    }

    const configRef = doc(this.db, PUBLIC_BILLING_CONFIG_COLLECTION, PUBLIC_BILLING_CONFIG_DOC_ID);
    this.configUnsubscribe = onSnapshot(
      configRef,
      (snapshot) => {
        this.freePlanReceiptLimit.set(
          normalizeFreePlanReceiptLimit(snapshot.data()?.['freePlanReceiptLimit'])
        );
      },
      (error) => {
        console.error('Failed to load public billing config', error);
        this.freePlanReceiptLimit.set(DEFAULT_FREE_PLAN_RECEIPT_LIMIT);
      }
    );
  }
}
