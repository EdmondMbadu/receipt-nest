import { Timestamp, serverTimestamp } from 'firebase/firestore';

export interface FolderMergeEntry {
  mergeId: string;
  sourceFolderId: string;
  sourceFolderName: string;
  sourceFolderReceiptIds: string[];
  sourceOnlyReceiptIds: string[];
  sourceIsAuto?: boolean;
  sourceAutoType?: 'merchant' | 'title' | 'category';
  sourceAutoKey?: string;
  mergedAt: Timestamp | ReturnType<typeof serverTimestamp>;
}

export interface Folder {
  id: string;
  userId: string;
  name: string;
  receiptIds: string[];
  isAuto?: boolean;
  autoType?: 'merchant' | 'title' | 'category';
  autoKey?: string;
  mergedSources?: FolderMergeEntry[];
  createdAt: Timestamp | ReturnType<typeof serverTimestamp>;
  updatedAt: Timestamp | ReturnType<typeof serverTimestamp>;
}
