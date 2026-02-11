import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Firestore,
  Unsubscribe,
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';

import { app } from '../../../environments/environments';
import { AuthService } from './auth.service';
import { Folder } from '../models/folder.model';
import { Receipt } from '../models/receipt.model';

@Injectable({
  providedIn: 'root'
})
export class FolderService {
  private readonly db: Firestore = getFirestore(app);
  private readonly auth = inject(AuthService);

  readonly folders = signal<Folder[]>([]);
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);

  readonly folderCount = computed(() => this.folders().length);

  private foldersUnsubscribe: Unsubscribe | null = null;
  private autoSyncInFlight = false;
  private autoSyncQueued = false;
  private pendingAutoSyncReceipts: Receipt[] = [];

  private getFoldersPath(): string {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('User not authenticated');
    return `users/${userId}/folders`;
  }

  subscribeToFolders(): void {
    const userId = this.auth.user()?.id;
    if (!userId) {
      this.folders.set([]);
      return;
    }

    this.unsubscribeFromFolders();

    this.isLoading.set(true);
    this.error.set(null);

    try {
      const foldersRef = collection(this.db, this.getFoldersPath());
      const foldersQuery = query(foldersRef, orderBy('createdAt', 'desc'));

      this.foldersUnsubscribe = onSnapshot(
        foldersQuery,
        (snapshot) => {
          const folders = snapshot.docs.map((folderDoc) => ({
            id: folderDoc.id,
            ...folderDoc.data()
          })) as Folder[];

          this.folders.set(folders);
          this.isLoading.set(false);
        },
        (error) => {
          console.error('Error subscribing to folders:', error);
          this.error.set('Failed to load folders');
          this.isLoading.set(false);
        }
      );
    } catch (error) {
      console.error('Error setting up folder subscription:', error);
      this.error.set('Failed to load folders');
      this.isLoading.set(false);
    }
  }

  unsubscribeFromFolders(): void {
    if (this.foldersUnsubscribe) {
      this.foldersUnsubscribe();
      this.foldersUnsubscribe = null;
    }
  }

  async createFolder(name: string, receiptIds: string[]): Promise<void> {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('User not authenticated');

    const cleanedName = name.trim();
    if (!cleanedName) {
      throw new Error('Folder name is required.');
    }

    const uniqueReceiptIds = Array.from(new Set(receiptIds));

    const foldersRef = collection(this.db, this.getFoldersPath());
    await addDoc(foldersRef, {
      userId,
      name: cleanedName,
      receiptIds: uniqueReceiptIds,
      isAuto: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  async syncAutoFolders(receipts: Receipt[]): Promise<void> {
    this.pendingAutoSyncReceipts = receipts;

    if (this.autoSyncInFlight) {
      this.autoSyncQueued = true;
      return;
    }

    this.autoSyncInFlight = true;
    try {
      await this.runAutoFolderSync(this.pendingAutoSyncReceipts);
    } finally {
      this.autoSyncInFlight = false;
      if (this.autoSyncQueued) {
        this.autoSyncQueued = false;
        void this.syncAutoFolders(this.pendingAutoSyncReceipts);
      }
    }
  }

  async addReceiptsToFolder(folder: Folder, receiptIds: string[]): Promise<void> {
    const uniqueIds = Array.from(new Set([...folder.receiptIds, ...receiptIds]));
    await this.updateFolderReceipts(folder.id, uniqueIds);
  }

  async removeReceiptsFromFolder(folder: Folder, receiptIds: string[]): Promise<void> {
    const removeSet = new Set(receiptIds);
    const nextIds = folder.receiptIds.filter((receiptId) => !removeSet.has(receiptId));
    await this.updateFolderReceipts(folder.id, nextIds);
  }

  async deleteFolder(folderId: string): Promise<void> {
    const folderRef = doc(this.db, this.getFoldersPath(), folderId);
    await deleteDoc(folderRef);
  }

  async renameFolder(folderId: string, name: string): Promise<void> {
    const cleanedName = name.trim();
    if (!cleanedName) {
      throw new Error('Folder name is required.');
    }

    const folderRef = doc(this.db, this.getFoldersPath(), folderId);
    await updateDoc(folderRef, {
      name: cleanedName,
      updatedAt: serverTimestamp()
    });
  }

  private async updateFolderReceipts(folderId: string, receiptIds: string[]): Promise<void> {
    const folderRef = doc(this.db, this.getFoldersPath(), folderId);
    await updateDoc(folderRef, {
      receiptIds: Array.from(new Set(receiptIds)),
      updatedAt: serverTimestamp()
    });
  }

  private async runAutoFolderSync(receipts: Receipt[]): Promise<void> {
    const userId = this.auth.user()?.id;
    if (!userId) {
      return;
    }

    const groups = this.buildAutoGroups(receipts);
    const desiredByCompositeKey = new Map(groups.map((group) => [this.getAutoCompositeKey(group.type, group.key), group]));

    const currentAutoFolders = this.folders().filter((folder) => folder.isAuto && folder.autoType && folder.autoKey);
    const currentByCompositeKey = new Map(
      currentAutoFolders.map((folder) => [this.getAutoCompositeKey(folder.autoType!, folder.autoKey!), folder])
    );

    const tasks: Promise<void>[] = [];

    for (const group of groups) {
      const compositeKey = this.getAutoCompositeKey(group.type, group.key);
      const existing = currentByCompositeKey.get(compositeKey);

      if (!existing) {
        const foldersRef = collection(this.db, this.getFoldersPath());
        tasks.push(
          addDoc(foldersRef, {
            userId,
            name: group.name,
            receiptIds: group.receiptIds,
            isAuto: true,
            autoType: group.type,
            autoKey: group.key,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          }).then(() => undefined)
        );
        continue;
      }

      const needsNameUpdate = existing.name !== group.name;
      const needsReceiptUpdate = !this.areIdsEqual(existing.receiptIds, group.receiptIds);
      if (!needsNameUpdate && !needsReceiptUpdate) {
        continue;
      }

      const folderRef = doc(this.db, this.getFoldersPath(), existing.id);
      tasks.push(
        updateDoc(folderRef, {
          name: group.name,
          receiptIds: group.receiptIds,
          updatedAt: serverTimestamp()
        }).then(() => undefined)
      );
    }

    for (const folder of currentAutoFolders) {
      const compositeKey = this.getAutoCompositeKey(folder.autoType!, folder.autoKey!);
      if (desiredByCompositeKey.has(compositeKey)) {
        continue;
      }

      const folderRef = doc(this.db, this.getFoldersPath(), folder.id);
      tasks.push(deleteDoc(folderRef));
    }

    if (tasks.length > 0) {
      await Promise.all(tasks);
    }
  }

  private buildAutoGroups(receipts: Receipt[]): Array<{
    type: 'merchant' | 'title' | 'category';
    key: string;
    name: string;
    receiptIds: string[];
  }> {
    const buckets = new Map<
      string,
      {
        type: 'merchant' | 'title' | 'category';
        key: string;
        label: string;
        receiptIds: Set<string>;
      }
    >();

    for (const receipt of receipts) {
      this.addBucket(buckets, 'merchant', this.getMerchantLabel(receipt), receipt.id);
      this.addBucket(buckets, 'title', this.getTitleLabel(receipt), receipt.id);
      this.addBucket(buckets, 'category', this.getCategoryLabel(receipt), receipt.id);
    }

    return Array.from(buckets.values())
      .filter((group) => group.receiptIds.size >= 2)
      .map((group) => ({
        type: group.type,
        key: group.key,
        name: this.buildAutoFolderName(group.type, group.label),
        receiptIds: Array.from(group.receiptIds).sort()
      }))
      .sort((a, b) => b.receiptIds.length - a.receiptIds.length || a.name.localeCompare(b.name));
  }

  private addBucket(
    buckets: Map<string, { type: 'merchant' | 'title' | 'category'; key: string; label: string; receiptIds: Set<string> }>,
    type: 'merchant' | 'title' | 'category',
    label: string | null,
    receiptId: string
  ): void {
    if (!label) {
      return;
    }

    const normalizedKey = this.normalizeGroupKey(label);
    if (!normalizedKey) {
      return;
    }

    const compositeKey = this.getAutoCompositeKey(type, normalizedKey);
    if (!buckets.has(compositeKey)) {
      buckets.set(compositeKey, {
        type,
        key: normalizedKey,
        label,
        receiptIds: new Set()
      });
    }

    buckets.get(compositeKey)?.receiptIds.add(receiptId);
  }

  private getMerchantLabel(receipt: Receipt): string | null {
    const label = receipt.merchant?.canonicalName || receipt.merchant?.rawName || receipt.extraction?.supplierName?.value;
    return this.cleanLabel(label);
  }

  private getCategoryLabel(receipt: Receipt): string | null {
    return this.cleanLabel(receipt.category?.name);
  }

  private getTitleLabel(receipt: Receipt): string | null {
    const originalName = receipt.file?.originalName;
    if (!originalName) {
      return null;
    }

    const withoutExtension = originalName.replace(/\.[^/.]+$/, '');
    const normalizedTitle = withoutExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalizedTitle) {
      return null;
    }

    const genericTitle = /^(img|image|scan|scanned|photo|receipt|document)[\s_-]*\d*$/i;
    if (genericTitle.test(normalizedTitle)) {
      return null;
    }

    return this.cleanLabel(normalizedTitle);
  }

  private cleanLabel(value?: string): string | null {
    if (!value) {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    return trimmed.length > 60 ? trimmed.slice(0, 60).trim() : trimmed;
  }

  private normalizeGroupKey(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildAutoFolderName(type: 'merchant' | 'title' | 'category', label: string): string {
    const prefix = type === 'merchant' ? 'Merchant' : type === 'category' ? 'Category' : 'Title';
    return `${prefix}: ${label}`;
  }

  private getAutoCompositeKey(type: 'merchant' | 'title' | 'category', key: string): string {
    return `${type}:${key}`;
  }

  private areIdsEqual(currentIds: string[], nextIds: string[]): boolean {
    if (currentIds.length !== nextIds.length) {
      return false;
    }

    const currentSorted = [...currentIds].sort();
    const nextSorted = [...nextIds].sort();
    return currentSorted.every((id, index) => id === nextSorted[index]);
  }
}
