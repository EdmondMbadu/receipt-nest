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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
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

  private async updateFolderReceipts(folderId: string, receiptIds: string[]): Promise<void> {
    const folderRef = doc(this.db, this.getFoldersPath(), folderId);
    await updateDoc(folderRef, {
      receiptIds: Array.from(new Set(receiptIds)),
      updatedAt: serverTimestamp()
    });
  }
}
