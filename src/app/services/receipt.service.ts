import { Injectable, inject, signal, computed } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  getFirestore,
  Unsubscribe
} from 'firebase/firestore';
import {
  FirebaseStorage,
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
  UploadTaskSnapshot
} from 'firebase/storage';

import { app } from '../../../environments/environments';
import { AuthService } from './auth.service';
import {
  Receipt,
  ReceiptStatus,
  ReceiptFile,
  createReceiptDocument
} from '../models/receipt.model';
import { MonthlySummary, getMonthlySummaryId } from '../models/monthly-summary.model';

/**
 * Allowed file types for receipt upload
 */
export const ALLOWED_FILE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf'
];

/**
 * Maximum file size (10MB)
 */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Upload progress callback
 */
export interface UploadProgress {
  bytesTransferred: number;
  totalBytes: number;
  progress: number; // 0-100
  state: 'running' | 'paused' | 'success' | 'error';
}

@Injectable({
  providedIn: 'root'
})
export class ReceiptService {
  private readonly db: Firestore = getFirestore(app);
  private readonly storage: FirebaseStorage = getStorage(app);
  private readonly auth = inject(AuthService);

  // Receipts state
  readonly receipts = signal<Receipt[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  // Active subscription
  private receiptsUnsubscribe: Unsubscribe | null = null;

  // Computed values
  readonly receiptCount = computed(() => this.receipts().length);
  readonly needsReviewCount = computed(() =>
    this.receipts().filter(r => r.status === 'needs_review').length
  );

  /**
   * Get the receipts collection path for current user
   */
  private getReceiptsPath(): string {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('User not authenticated');
    return `users/${userId}/receipts`;
  }

  /**
   * Get storage path for a receipt file
   */
  private getStoragePath(fileName: string): string {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('User not authenticated');
    const timestamp = Date.now();
    const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `users/${userId}/receipts/${timestamp}_${safeName}`;
  }

  /**
   * Validate file before upload
   */
  validateFile(file: File): { valid: boolean; error?: string } {
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      return {
        valid: false,
        error: `Invalid file type. Allowed: JPEG, PNG, WebP, HEIC, PDF`
      };
    }

    if (file.size > MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB`
      };
    }

    return { valid: true };
  }

  /**
   * Upload a receipt file and create Firestore document
   */
  async uploadReceipt(
    file: File,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<Receipt> {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('User not authenticated');

    // Validate file
    const validation = this.validateFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Create storage reference
    const storagePath = this.getStoragePath(file.name);
    const storageRef = ref(this.storage, storagePath);

    // Upload file with progress tracking
    return new Promise((resolve, reject) => {
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        'state_changed',
        (snapshot: UploadTaskSnapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          onProgress?.({
            bytesTransferred: snapshot.bytesTransferred,
            totalBytes: snapshot.totalBytes,
            progress,
            state: snapshot.state as 'running' | 'paused'
          });
        },
        (error) => {
          onProgress?.({
            bytesTransferred: 0,
            totalBytes: file.size,
            progress: 0,
            state: 'error'
          });
          reject(new Error(`Upload failed: ${error.message}`));
        },
        async () => {
          try {
            // Upload complete, create Firestore document
            const receiptFile: ReceiptFile = {
              storagePath,
              originalName: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
              uploadedAt: serverTimestamp()
            };

            // Create receipt document
            const receiptsRef = collection(this.db, this.getReceiptsPath());
            const docRef = await addDoc(receiptsRef, {
              userId,
              status: 'uploaded' as ReceiptStatus,
              file: receiptFile,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });

            // Update with document ID
            await updateDoc(docRef, { id: docRef.id });

            const receipt = createReceiptDocument(userId, docRef.id, receiptFile);

            onProgress?.({
              bytesTransferred: file.size,
              totalBytes: file.size,
              progress: 100,
              state: 'success'
            });

            resolve(receipt);
          } catch (error: any) {
            reject(new Error(`Failed to save receipt: ${error.message}`));
          }
        }
      );
    });
  }

  /**
   * Subscribe to real-time receipt updates for current user
   */
  subscribeToReceipts(): void {
    const userId = this.auth.user()?.id;
    if (!userId) {
      this.receipts.set([]);
      return;
    }

    // Unsubscribe from previous subscription
    this.unsubscribeFromReceipts();

    this.isLoading.set(true);
    this.error.set(null);

    try {
      const receiptsRef = collection(this.db, `users/${userId}/receipts`);
      const q = query(receiptsRef, orderBy('createdAt', 'desc'), limit(100));

      this.receiptsUnsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const receipts = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as Receipt[];
          this.receipts.set(receipts);
          this.isLoading.set(false);
        },
        (error) => {
          console.error('Error subscribing to receipts:', error);
          this.error.set('Failed to load receipts');
          this.isLoading.set(false);
        }
      );
    } catch (error: any) {
      console.error('Error setting up receipts subscription:', error);
      this.error.set('Failed to load receipts');
      this.isLoading.set(false);
    }
  }

  /**
   * Unsubscribe from receipt updates
   */
  unsubscribeFromReceipts(): void {
    if (this.receiptsUnsubscribe) {
      this.receiptsUnsubscribe();
      this.receiptsUnsubscribe = null;
    }
  }

  /**
   * Get a single receipt by ID
   */
  async getReceipt(receiptId: string): Promise<Receipt | null> {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('User not authenticated');

    const docRef = doc(this.db, `users/${userId}/receipts`, receiptId);
    const snapshot = await getDoc(docRef);

    if (!snapshot.exists()) {
      return null;
    }

    return { id: snapshot.id, ...snapshot.data() } as Receipt;
  }

  /**
   * Update a receipt
   */
  async updateReceipt(receiptId: string, updates: Partial<Receipt>): Promise<void> {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('User not authenticated');

    const docRef = doc(this.db, `users/${userId}/receipts`, receiptId);
    await updateDoc(docRef, {
      ...updates,
      updatedAt: serverTimestamp()
    });
  }

  /**
   * Delete a receipt and its associated file
   */
  async deleteReceipt(receiptId: string): Promise<void> {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('User not authenticated');

    // Get receipt to find storage path
    const receipt = await this.getReceipt(receiptId);
    if (!receipt) throw new Error('Receipt not found');

    // Delete from Storage
    if (receipt.file?.storagePath) {
      try {
        const storageRef = ref(this.storage, receipt.file.storagePath);
        await deleteObject(storageRef);
      } catch (error) {
        console.warn('Failed to delete file from storage:', error);
        // Continue with Firestore deletion even if storage fails
      }
    }

    // Delete from Firestore
    const docRef = doc(this.db, `users/${userId}/receipts`, receiptId);
    await deleteDoc(docRef);
  }

  /**
   * Get download URL for a receipt file
   */
  async getReceiptFileUrl(storagePath: string): Promise<string> {
    const storageRef = ref(this.storage, storagePath);
    return getDownloadURL(storageRef);
  }

  /**
   * Get receipts for a specific month
   */
  async getReceiptsForMonth(year: number, month: number): Promise<Receipt[]> {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('User not authenticated');

    const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0];
    const endDate = new Date(year, month, 0).toISOString().split('T')[0];

    const receiptsRef = collection(this.db, `users/${userId}/receipts`);
    const q = query(
      receiptsRef,
      where('date', '>=', startDate),
      where('date', '<=', endDate),
      orderBy('date', 'desc')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Receipt[];
  }

  /**
   * Get monthly summary
   */
  async getMonthlySummary(year: number, month: number): Promise<MonthlySummary | null> {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('User not authenticated');

    const monthId = `${year}-${String(month).padStart(2, '0')}`;
    const docRef = doc(this.db, `users/${userId}/monthlySummaries`, monthId);
    const snapshot = await getDoc(docRef);

    if (!snapshot.exists()) {
      return null;
    }

    return { id: snapshot.id, ...snapshot.data() } as MonthlySummary;
  }

  // Selected month for filtering (default: current month)
  readonly selectedMonth = signal(new Date().getMonth());
  readonly selectedYear = signal(new Date().getFullYear());

  /**
   * Calculate spending for the selected month
   * Uses the extracted receipt date for filtering
   */
  readonly selectedMonthSpend = computed(() => {
    const targetMonth = this.selectedMonth();
    const targetYear = this.selectedYear();

    return this.receipts()
      .filter(r => {
        // Must have a total amount to count
        if (r.totalAmount === undefined || r.totalAmount === null) {
          return false;
        }

        // Use the extracted receipt date
        if (r.date) {
          const receiptDate = new Date(r.date);
          return receiptDate.getMonth() === targetMonth &&
            receiptDate.getFullYear() === targetYear;
        }

        // Fallback to createdAt if no extracted date
        if (r.createdAt) {
          const createdDate = (r.createdAt as any).toDate
            ? (r.createdAt as any).toDate()
            : new Date(r.createdAt as any);
          return createdDate.getMonth() === targetMonth &&
            createdDate.getFullYear() === targetYear;
        }

        return false;
      })
      .reduce((sum, r) => sum + (r.totalAmount || 0), 0);
  });

  /**
   * Get receipts for the selected month
   */
  readonly selectedMonthReceipts = computed(() => {
    const targetMonth = this.selectedMonth();
    const targetYear = this.selectedYear();

    return this.receipts().filter(r => {
      if (r.date) {
        const receiptDate = new Date(r.date);
        return receiptDate.getMonth() === targetMonth &&
          receiptDate.getFullYear() === targetYear;
      }

      if (r.createdAt) {
        const createdDate = (r.createdAt as any).toDate
          ? (r.createdAt as any).toDate()
          : new Date(r.createdAt as any);
        return createdDate.getMonth() === targetMonth &&
          createdDate.getFullYear() === targetYear;
      }

      return false;
    });
  });

  /**
   * Get the selected month label (e.g., "December 2024")
   */
  readonly selectedMonthLabel = computed(() => {
    const date = new Date(this.selectedYear(), this.selectedMonth(), 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  });

  /**
   * Check if viewing current month
   */
  readonly isCurrentMonth = computed(() => {
    const now = new Date();
    return this.selectedMonth() === now.getMonth() &&
      this.selectedYear() === now.getFullYear();
  });

  /**
   * Navigate to previous month
   */
  goToPreviousMonth(): void {
    let month = this.selectedMonth();
    let year = this.selectedYear();

    if (month === 0) {
      month = 11;
      year--;
    } else {
      month--;
    }

    this.selectedMonth.set(month);
    this.selectedYear.set(year);
  }

  /**
   * Navigate to next month
   */
  goToNextMonth(): void {
    let month = this.selectedMonth();
    let year = this.selectedYear();

    if (month === 11) {
      month = 0;
      year++;
    } else {
      month++;
    }

    this.selectedMonth.set(month);
    this.selectedYear.set(year);
  }

  /**
   * Reset to current month
   */
  goToCurrentMonth(): void {
    const now = new Date();
    this.selectedMonth.set(now.getMonth());
    this.selectedYear.set(now.getFullYear());
  }

  // Keep for backward compatibility
  readonly currentMonthSpend = this.selectedMonthSpend;

  /**
   * Calculate spending for the previous month (relative to selected month)
   */
  readonly previousMonthSpend = computed(() => {
    let prevMonth = this.selectedMonth() - 1;
    let prevYear = this.selectedYear();

    if (prevMonth < 0) {
      prevMonth = 11;
      prevYear--;
    }

    return this.receipts()
      .filter(r => {
        if (r.totalAmount === undefined || r.totalAmount === null) {
          return false;
        }

        if (r.date) {
          const receiptDate = new Date(r.date);
          return receiptDate.getMonth() === prevMonth &&
            receiptDate.getFullYear() === prevYear;
        }

        if (r.createdAt) {
          const createdDate = (r.createdAt as any).toDate
            ? (r.createdAt as any).toDate()
            : new Date(r.createdAt as any);
          return createdDate.getMonth() === prevMonth &&
            createdDate.getFullYear() === prevYear;
        }

        return false;
      })
      .reduce((sum, r) => sum + (r.totalAmount || 0), 0);
  });

  /**
   * Calculate the percentage change from previous month to selected month
   * Returns { percent: number, isIncrease: boolean } or null if no previous data
   */
  readonly monthOverMonthChange = computed(() => {
    const current = this.selectedMonthSpend();
    const previous = this.previousMonthSpend();

    // If no previous month data, return null
    if (previous === 0) {
      return null;
    }

    const change = ((current - previous) / previous) * 100;
    return {
      percent: Math.abs(Math.round(change)),
      isIncrease: change > 0
    };
  });

  /**
   * Get daily cumulative spending data for the selected month
   * Returns an array of { day, amount, cumulative } for chart rendering
   */
  readonly dailySpendingData = computed(() => {
    const targetMonth = this.selectedMonth();
    const targetYear = this.selectedYear();

    // Get number of days in the selected month
    const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();

    // Initialize daily totals
    const dailyTotals: number[] = new Array(daysInMonth).fill(0);

    // Sum up spending per day
    for (const receipt of this.selectedMonthReceipts()) {
      if (!receipt.totalAmount) continue;

      let day: number;
      if (receipt.date) {
        const receiptDate = new Date(receipt.date);
        day = receiptDate.getDate();
      } else if (receipt.createdAt) {
        const createdDate = (receipt.createdAt as any).toDate
          ? (receipt.createdAt as any).toDate()
          : new Date(receipt.createdAt as any);
        day = createdDate.getDate();
      } else {
        continue;
      }

      if (day >= 1 && day <= daysInMonth) {
        dailyTotals[day - 1] += receipt.totalAmount;
      }
    }

    // Build cumulative data
    let cumulative = 0;
    const data: { day: number; amount: number; cumulative: number }[] = [];

    for (let i = 0; i < daysInMonth; i++) {
      cumulative += dailyTotals[i];
      data.push({
        day: i + 1,
        amount: dailyTotals[i],
        cumulative
      });
    }

    return data;
  });

  /**
   * Generate SVG path for the spending chart (daily amounts, not cumulative)
   * Returns the path data for the line and area fill
   */
  readonly chartPathData = computed(() => {
    const data = this.dailySpendingData();
    const total = this.selectedMonthSpend();

    if (data.length === 0 || total === 0) {
      // Return flat line at bottom if no data
      return {
        linePath: 'M 0,95 L 200,95',
        areaPath: 'M 0,95 L 200,95 L 200,100 L 0,100 Z',
        hasData: false,
        maxDailySpend: 0
      };
    }

    // Use daily amount instead of cumulative for oscillating graph
    const maxValue = Math.max(...data.map(d => d.amount), 1);
    const width = 200;
    const height = 100;
    const padding = 5;
    const chartHeight = height - padding * 2;

    // Generate points based on daily spending
    const points: { x: number; y: number }[] = data.map((d, i) => ({
      x: (i / (data.length - 1)) * width,
      y: padding + chartHeight - (d.amount / maxValue) * chartHeight
    }));

    // Create smooth bezier curve path
    let linePath = `M ${points[0].x},${points[0].y}`;

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpx = (prev.x + curr.x) / 2;
      linePath += ` C ${cpx},${prev.y} ${cpx},${curr.y} ${curr.x},${curr.y}`;
    }

    // Area path (same as line, but closes to bottom)
    const areaPath = linePath + ` L ${width},${height} L 0,${height} Z`;

    return {
      linePath,
      areaPath,
      hasData: true,
      lastPoint: points[points.length - 1],
      maxDailySpend: maxValue
    };
  });

  /**
   * Get receipts grouped by status
   */
  readonly receiptsByStatus = computed(() => {
    const grouped: Record<ReceiptStatus, Receipt[]> = {
      uploaded: [],
      processing: [],
      extracted: [],
      needs_review: [],
      final: []
    };

    for (const receipt of this.receipts()) {
      grouped[receipt.status].push(receipt);
    }

    return grouped;
  });
}


