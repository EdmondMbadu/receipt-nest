import { Injectable, inject, signal, computed } from '@angular/core';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  DocumentData,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  QueryDocumentSnapshot,
  serverTimestamp,
  startAfter,
  Timestamp,
  updateDoc
} from 'firebase/firestore';
import { app } from '../../../environments/environments';
import { AuthService } from './auth.service';
import { ReceiptService } from './receipt.service';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface InsightData {
  // Selected month (current UI context)
  totalSpend: number;
  receiptCount: number;
  monthLabel: string;
  topCategories: { name: string; total: number; percentage: number }[];
  dailyAverage: number;
  highestSpendDay: { day: number; amount: number } | null;
  monthOverMonthChange: { percent: number; isIncrease: boolean } | null;
  receipts: {
    merchant: string;
    amount: number;
    date: string;
    category: string;
  }[];

  // All-time coverage
  allTime: {
    totalSpend: number;
    receiptCount: number;
    topCategories: { name: string; total: number; percentage: number }[];
    topMerchants: { name: string; total: number; percentage: number }[];
    firstMonth: string | null;
    lastMonth: string | null;
    monthsCount: number;
  };

  // Monthly summaries for all available months
  monthlySummaries: {
    monthId: string;
    totalSpend: number;
    receiptCount: number;
    topCategories: { name: string; total: number; percentage: number }[];
    topMerchants: { name: string; total: number; percentage: number }[];
  }[];

  // Recent receipts for detail (limited)
  recentReceipts: {
    merchant: string;
    amount: number;
    date: string;
    category: string;
  }[];
}

export interface ChatHistoryItem {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
}

interface StoredChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

@Injectable({
  providedIn: 'root'
})
export class AiInsightsService {
  private readonly functions = getFunctions(app);
  private readonly db = getFirestore(app);
  private readonly auth = inject(AuthService);
  private readonly receiptService = inject(ReceiptService);
  private readonly activeChatStorageKey = 'aiInsightsActiveChatId';
  private initializedHistoryForUser: string | null = null;
  private historyCursor: QueryDocumentSnapshot<DocumentData> | null = null;

  // Chat state
  readonly messages = signal<ChatMessage[]>([]);
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);
  readonly activeChatId = signal<string | null>(null);
  readonly chatHistory = signal<ChatHistoryItem[]>([]);
  readonly historyLoading = signal(false);
  readonly historyLoadingMore = signal(false);
  readonly historyHasMore = signal(false);

  // Pre-built insights
  readonly insights = signal<string[]>([]);
  readonly insightsLoading = signal(false);

  // Telegram state
  readonly telegramLinked = signal(false);
  readonly telegramLinkLoading = signal(false);
  readonly telegramDeepLink = signal<string | null>(null);
  readonly telegramQrDataUrl = signal<string | null>(null);
  readonly telegramLinkError = signal<string | null>(null);
  readonly telegramDialogOpen = signal(false);
  private telegramLinkUnsubscribe: (() => void) | null = null;

  /**
   * Generate initial insights based on user's expense data
   */
  async generateInsights(): Promise<void> {
    this.insightsLoading.set(true);
    this.error.set(null);

    try {
      const insightData = await this.prepareInsightData();

      const generateInsightsFn = httpsCallable(this.functions, 'generateAiInsights');
      const response = await generateInsightsFn({
        type: 'initial_insights',
        data: insightData
      });

      const result = response.data as { insights: string[] };
      this.insights.set(result.insights || []);
    } catch (err: any) {
      console.error('Failed to generate insights:', err);
      const message = `${err?.message || ''}`;
      if (message.includes('AI Insights is a Pro feature')) {
        this.error.set('AI Insights is a Pro feature. Please upgrade your plan to access it.');
      } else {
        this.error.set('Unable to generate insights. Please try again.');
      }
    } finally {
      this.insightsLoading.set(false);
    }
  }

  async initializeChatState(initialBatchSize = 10): Promise<void> {
    const userId = this.auth.user()?.id;
    if (!userId) {
      this.resetChatState();
      return;
    }

    if (this.initializedHistoryForUser === userId) {
      return;
    }

    this.initializedHistoryForUser = userId;
    this.historyCursor = null;
    this.messages.set([]);
    this.activeChatId.set(null);
    this.chatHistory.set([]);

    await this.loadHistoryBatch(initialBatchSize, false);

    const preferredChatId = this.readStoredActiveChatId(userId);
    if (preferredChatId) {
      const found = await this.openChat(preferredChatId, false);
      if (found) return;
    }

    const latest = this.chatHistory()[0];
    if (latest) {
      await this.openChat(latest.id, true);
      return;
    }

    this.startNewChat();
  }

  /**
   * Send a chat message and get AI response
   */
  async sendMessage(content: string): Promise<void> {
    if (!content.trim()) return;
    await this.initializeChatState();

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date()
    };

    // Add user message to chat
    this.messages.update(msgs => [...msgs, userMessage]);
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const chatId = await this.ensureActiveChat();
      await this.persistChat(chatId);
      const insightData = await this.prepareInsightData();

      // Get conversation history for context
      const history = this.messages().map(m => ({
        role: m.role,
        content: m.content
      }));

      const chatFn = httpsCallable(this.functions, 'generateAiInsights');
      const response = await chatFn({
        type: 'chat',
        message: content.trim(),
        history: history.slice(-10), // Last 10 messages for context
        data: insightData
      });

      const result = response.data as { response: string };

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.response || 'I apologize, but I could not generate a response. Please try again.',
        timestamp: new Date()
      };

      this.messages.update(msgs => [...msgs, assistantMessage]);
      await this.persistChat(chatId);
    } catch (err: any) {
      console.error('Failed to send message:', err);
      const message = `${err?.message || ''}`;
      if (message.includes('AI Insights is a Pro feature')) {
        this.error.set('AI Insights is a Pro feature. Please upgrade your plan to access it.');
      } else {
        this.error.set('Unable to get a response. Please try again.');
      }

      // Add error message
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: message.includes('AI Insights is a Pro feature')
          ? 'AI Insights is a Pro feature. Please upgrade your plan to access it.'
          : 'I apologize, but I encountered an error processing your request. Please try again.',
        timestamp: new Date()
      };
      this.messages.update(msgs => [...msgs, errorMessage]);
      const chatId = this.activeChatId();
      if (chatId) {
        await this.persistChat(chatId);
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Clear chat history
   */
  clearChat(): void {
    this.startNewChat();
  }

  startNewChat(): void {
    this.messages.set([]);
    this.error.set(null);
    this.activeChatId.set(null);
    this.storeActiveChatId(null);
  }

  async openChat(chatId: string, persistSelection = true): Promise<boolean> {
    const userId = this.auth.user()?.id;
    if (!userId) return false;

    const chatRef = doc(this.db, this.getChatsPath(userId), chatId);
    const snapshot = await getDoc(chatRef);
    if (!snapshot.exists()) {
      return false;
    }

    const data = snapshot.data() as {
      messages?: StoredChatMessage[];
      title?: string;
      createdAt?: Timestamp;
      updatedAt?: Timestamp;
      messageCount?: number;
    };

    const messages = (data.messages || []).map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      timestamp: new Date(message.timestamp)
    }));

    this.messages.set(messages);
    this.activeChatId.set(chatId);
    this.error.set(null);

    if (persistSelection) {
      this.storeActiveChatId(chatId);
    }

    const now = new Date();
    const createdAt = this.toDate(data.createdAt, now);
    const updatedAt = this.toDate(data.updatedAt, now);
    const title = data.title || this.getFallbackTitle(messages);
    const messageCount = typeof data.messageCount === 'number' ? data.messageCount : messages.length;
    this.upsertHistoryItem({
      id: chatId,
      title,
      createdAt,
      updatedAt,
      messageCount
    });

    return true;
  }

  async deleteChat(chatId: string): Promise<void> {
    const userId = this.auth.user()?.id;
    if (!userId) return;

    await deleteDoc(doc(this.db, this.getChatsPath(userId), chatId));
    this.chatHistory.update(items => items.filter(item => item.id !== chatId));

    if (this.activeChatId() === chatId) {
      const next = this.chatHistory()[0];
      if (next) {
        await this.openChat(next.id, true);
      } else {
        this.startNewChat();
      }
    }
  }

  async loadMoreHistory(batchSize = 10): Promise<void> {
    if (this.historyLoadingMore() || this.historyLoading() || !this.historyHasMore()) {
      return;
    }
    await this.loadHistoryBatch(batchSize, true);
  }

  /**
   * Prepare expense data for AI analysis
   */
  private async prepareInsightData(): Promise<InsightData> {
    const receipts = this.receiptService.selectedMonthReceipts();
    const totalSpend = this.receiptService.selectedMonthSpend();
    const monthLabel = this.receiptService.selectedMonthLabel();
    const dailyData = this.receiptService.dailySpendingData();
    const monthChange = this.receiptService.monthOverMonthChange();
    const allReceipts = this.receiptService.receipts();
    const monthlySummaries = await this.receiptService.getMonthlySummaries();

    // Calculate category spending
    const categoryTotals: Record<string, number> = {};
    for (const receipt of receipts) {
      const categoryName = receipt.category?.name || 'Other';
      categoryTotals[categoryName] = (categoryTotals[categoryName] || 0) + (receipt.totalAmount || 0);
    }

    const topCategories = Object.entries(categoryTotals)
      .map(([name, total]) => ({
        name,
        total,
        percentage: totalSpend > 0 ? Math.round((total / totalSpend) * 100) : 0
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    // Calculate daily average
    const daysWithSpending = dailyData.filter(d => d.amount > 0).length;
    const dailyAverage = daysWithSpending > 0 ? totalSpend / daysWithSpending : 0;

    // Find highest spend day
    const highestSpendDay = dailyData.reduce((max, day) =>
      day.amount > (max?.amount || 0) ? day : max,
      null as { day: number; amount: number } | null
    );

    // Prepare receipt summaries
    const receiptSummaries = receipts.map(r => ({
      merchant: r.merchant?.canonicalName || r.merchant?.rawName || 'Unknown',
      amount: r.totalAmount || 0,
      date: r.date || '',
      category: r.category?.name || 'Other'
    }));

    // Build monthly summaries with top categories/merchants
    const monthlySummariesData = monthlySummaries.map(ms => {
      const categories = Object.values(ms.byCategory || {});
      const merchants = Object.values(ms.byMerchant || {});

      const total = ms.totalSpend || 0;
      const topCategories = categories
        .map(c => ({
          name: c.categoryName,
          total: c.total,
          percentage: total > 0 ? Math.round((c.total / total) * 100) : 0
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      const topMerchants = merchants
        .map(m => ({
          name: m.merchantName,
          total: m.total,
          percentage: total > 0 ? Math.round((m.total / total) * 100) : 0
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      return {
        monthId: ms.id,
        totalSpend: ms.totalSpend || 0,
        receiptCount: ms.receiptCount || 0,
        topCategories,
        topMerchants
      };
    });

    // All-time aggregation from monthly summaries (preferred)
    let allTimeTotal = 0;
    let allTimeCount = 0;
    const allCategoryTotals: Record<string, number> = {};
    const allMerchantTotals: Record<string, number> = {};

    for (const ms of monthlySummaries) {
      allTimeTotal += ms.totalSpend || 0;
      allTimeCount += ms.receiptCount || 0;

      for (const c of Object.values(ms.byCategory || {})) {
        allCategoryTotals[c.categoryName] = (allCategoryTotals[c.categoryName] || 0) + (c.total || 0);
      }

      for (const m of Object.values(ms.byMerchant || {})) {
        allMerchantTotals[m.merchantName] = (allMerchantTotals[m.merchantName] || 0) + (m.total || 0);
      }
    }

    // Fallback to receipts if monthly summaries are missing
    if (monthlySummaries.length === 0) {
      for (const r of allReceipts) {
        allTimeTotal += r.totalAmount || 0;
        allTimeCount += 1;
        const cat = r.category?.name || 'Other';
        allCategoryTotals[cat] = (allCategoryTotals[cat] || 0) + (r.totalAmount || 0);
        const merchant = r.merchant?.canonicalName || r.merchant?.rawName || 'Unknown';
        allMerchantTotals[merchant] = (allMerchantTotals[merchant] || 0) + (r.totalAmount || 0);
      }
    }

    const allTimeTopCategories = Object.entries(allCategoryTotals)
      .map(([name, total]) => ({
        name,
        total,
        percentage: allTimeTotal > 0 ? Math.round((total / allTimeTotal) * 100) : 0
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const allTimeTopMerchants = Object.entries(allMerchantTotals)
      .map(([name, total]) => ({
        name,
        total,
        percentage: allTimeTotal > 0 ? Math.round((total / allTimeTotal) * 100) : 0
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const monthsSorted = [...monthlySummariesData].sort((a, b) => a.monthId.localeCompare(b.monthId));
    const firstMonth = monthsSorted.length > 0 ? monthsSorted[0].monthId : null;
    const lastMonth = monthsSorted.length > 0 ? monthsSorted[monthsSorted.length - 1].monthId : null;

    const recentReceipts = [...allReceipts]
      .slice(0, 50)
      .map(r => ({
        merchant: r.merchant?.canonicalName || r.merchant?.rawName || 'Unknown',
        amount: r.totalAmount || 0,
        date: r.date || '',
        category: r.category?.name || 'Other'
      }));

    return {
      totalSpend,
      receiptCount: receipts.length,
      monthLabel,
      topCategories,
      dailyAverage,
      highestSpendDay,
      monthOverMonthChange: monthChange,
      receipts: receiptSummaries,
      allTime: {
        totalSpend: allTimeTotal,
        receiptCount: allTimeCount,
        topCategories: allTimeTopCategories,
        topMerchants: allTimeTopMerchants,
        firstMonth,
        lastMonth,
        monthsCount: monthlySummariesData.length
      },
      monthlySummaries: monthsSorted,
      recentReceipts
    };
  }

  /**
   * Get suggested questions based on data
   */
  getSuggestedQuestions(): string[] {
    return [
      'How can I reduce my spending this month?',
      'What are my biggest expense categories?',
      'Am I spending more than last month?',
      'Where should I cut back to save money?',
      'What patterns do you see in my spending?',
      'How much am I spending on dining out?'
    ];
  }

  private async loadHistoryBatch(batchSize: number, append: boolean): Promise<void> {
    const userId = this.auth.user()?.id;
    if (!userId) return;

    if (append) {
      this.historyLoadingMore.set(true);
    } else {
      this.historyLoading.set(true);
    }

    try {
      const chatsRef = collection(this.db, this.getChatsPath(userId));
      let chatQuery = query(chatsRef, orderBy('updatedAt', 'desc'), limit(batchSize));

      if (append && this.historyCursor) {
        chatQuery = query(chatsRef, orderBy('updatedAt', 'desc'), startAfter(this.historyCursor), limit(batchSize));
      }

      const snapshot = await getDocs(chatQuery);
      const items = snapshot.docs.map(docSnapshot => this.mapHistoryItem(docSnapshot));

      if (append) {
        this.chatHistory.update(existing => {
          const existingIds = new Set(existing.map(item => item.id));
          const additions = items.filter(item => !existingIds.has(item.id));
          return [...existing, ...additions];
        });
      } else {
        this.chatHistory.set(items);
      }

      this.historyCursor = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : this.historyCursor;
      this.historyHasMore.set(snapshot.docs.length === batchSize);
    } catch (err) {
      console.error('Failed to load chat history:', err);
    } finally {
      if (append) {
        this.historyLoadingMore.set(false);
      } else {
        this.historyLoading.set(false);
      }
    }
  }

  private mapHistoryItem(docSnapshot: QueryDocumentSnapshot<DocumentData>): ChatHistoryItem {
    const data = docSnapshot.data() as {
      title?: string;
      createdAt?: Timestamp;
      updatedAt?: Timestamp;
      messageCount?: number;
      messages?: StoredChatMessage[];
    };

    const now = new Date();
    const createdAt = this.toDate(data.createdAt, now);
    const updatedAt = this.toDate(data.updatedAt, createdAt);
    const messageCount = typeof data.messageCount === 'number' ? data.messageCount : (data.messages || []).length;
    const title = data.title || this.getFallbackTitle((data.messages || []).map(message => ({
      id: message.id,
      role: message.role,
      content: message.content,
      timestamp: new Date(message.timestamp)
    })));

    return {
      id: docSnapshot.id,
      title,
      createdAt,
      updatedAt,
      messageCount
    };
  }

  private upsertHistoryItem(item: ChatHistoryItem): void {
    this.chatHistory.update(items => {
      const filtered = items.filter(existing => existing.id !== item.id);
      filtered.unshift(item);
      return filtered.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    });
  }

  private async ensureActiveChat(): Promise<string> {
    const existing = this.activeChatId();
    if (existing) return existing;

    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('User not authenticated');

    const now = new Date();
    const docRef = await addDoc(collection(this.db, this.getChatsPath(userId)), {
      title: 'New chat',
      messages: [],
      messageCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessageAt: serverTimestamp()
    });

    this.activeChatId.set(docRef.id);
    this.storeActiveChatId(docRef.id);
    this.upsertHistoryItem({
      id: docRef.id,
      title: 'New chat',
      createdAt: now,
      updatedAt: now,
      messageCount: 0
    });

    return docRef.id;
  }

  private async persistChat(chatId: string): Promise<void> {
    const userId = this.auth.user()?.id;
    if (!userId) return;

    const messages = this.messages();
    const serializedMessages: StoredChatMessage[] = messages.map(message => ({
      id: message.id,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp.toISOString()
    }));

    const title = this.buildTitle(messages);
    const now = new Date();
    const chatRef = doc(this.db, this.getChatsPath(userId), chatId);

    await updateDoc(chatRef, {
      title,
      messages: serializedMessages,
      messageCount: messages.length,
      updatedAt: serverTimestamp(),
      lastMessageAt: serverTimestamp()
    });

    const existingItem = this.chatHistory().find(item => item.id === chatId);
    this.upsertHistoryItem({
      id: chatId,
      title,
      createdAt: existingItem?.createdAt || now,
      updatedAt: now,
      messageCount: messages.length
    });
  }

  private buildTitle(messages: ChatMessage[]): string {
    const firstUserMessage = messages.find(message => message.role === 'user');
    if (!firstUserMessage || !firstUserMessage.content.trim()) {
      return 'New chat';
    }

    const normalized = firstUserMessage.content.trim().replace(/\s+/g, ' ');
    if (normalized.length <= 56) {
      return normalized;
    }
    return `${normalized.slice(0, 56)}...`;
  }

  private getFallbackTitle(messages: ChatMessage[]): string {
    return this.buildTitle(messages);
  }

  private getChatsPath(userId: string): string {
    return `users/${userId}/aiChats`;
  }

  private toDate(value: unknown, fallback: Date): Date {
    if (value instanceof Timestamp) {
      return value.toDate();
    }
    if (value && typeof value === 'object' && 'toDate' in value && typeof (value as any).toDate === 'function') {
      return (value as any).toDate();
    }
    return fallback;
  }

  private readStoredActiveChatId(userId: string): string | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(this.activeChatStorageKey);
    if (!raw) return null;

    const [storedUserId, chatId] = raw.split(':');
    if (storedUserId !== userId || !chatId) {
      return null;
    }
    return chatId;
  }

  private storeActiveChatId(chatId: string | null): void {
    const userId = this.auth.user()?.id;
    if (typeof localStorage === 'undefined') return;
    if (!userId || !chatId) {
      localStorage.removeItem(this.activeChatStorageKey);
      return;
    }
    localStorage.setItem(this.activeChatStorageKey, `${userId}:${chatId}`);
  }

  private resetChatState(): void {
    this.messages.set([]);
    this.error.set(null);
    this.activeChatId.set(null);
    this.chatHistory.set([]);
    this.historyHasMore.set(false);
    this.historyLoading.set(false);
    this.historyLoadingMore.set(false);
    this.historyCursor = null;
    this.initializedHistoryForUser = null;
  }

  // ── Telegram Integration ────────────────────────────────────────────────

  /**
   * Check the current user's Telegram link status from their profile.
   */
  checkTelegramStatus(): void {
    const userId = this.auth.user()?.id;
    if (!userId) {
      this.telegramLinked.set(false);
      return;
    }

    // Listen for real-time updates on the user doc to detect when linking completes
    if (this.telegramLinkUnsubscribe) {
      this.telegramLinkUnsubscribe();
    }

    const userRef = doc(this.db, 'users', userId);
    this.telegramLinkUnsubscribe = onSnapshot(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        const linked = !!data['telegramChatId'];
        this.telegramLinked.set(linked);

        // If just linked while dialog is open, close after a short delay
        if (linked && this.telegramDialogOpen()) {
          setTimeout(() => {
            this.telegramDialogOpen.set(false);
            this.telegramDeepLink.set(null);
            this.telegramQrDataUrl.set(null);
          }, 2000);
        }
      }
    });
  }

  /**
   * Generate a Telegram deep-link token and QR code.
   */
  async generateTelegramLink(): Promise<void> {
    this.telegramLinkLoading.set(true);
    this.telegramLinkError.set(null);
    this.telegramDeepLink.set(null);
    this.telegramQrDataUrl.set(null);

    try {
      const fn = httpsCallable(this.functions, 'generateTelegramLinkToken');
      const response = await fn({});
      const result = response.data as {
        deepLink: string;
        token: string;
        botUsername: string;
      };

      this.telegramDeepLink.set(result.deepLink);

      // Generate QR code as data URL
      const QRCode = await import('qrcode');
      const qrDataUrl = await QRCode.toDataURL(result.deepLink, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      });
      this.telegramQrDataUrl.set(qrDataUrl);
      this.telegramDialogOpen.set(true);

      // Start listening for link completion
      this.checkTelegramStatus();
    } catch (err: any) {
      console.error('Failed to generate Telegram link:', err);
      this.telegramLinkError.set(
        err?.message || 'Failed to generate Telegram link. Please try again.'
      );
    } finally {
      this.telegramLinkLoading.set(false);
    }
  }

  /**
   * Open the Telegram chat in the web UI.
   * Uses the well-known document ID '_telegram'.
   */
  async openTelegramChat(): Promise<void> {
    const found = await this.openChat('_telegram', true);
    if (!found) {
      // Chat doesn't exist yet (user hasn't sent any messages on Telegram)
      this.error.set('No Telegram messages yet. Send a message to the bot on Telegram first!');
    }
  }

  /**
   * Unlink the user's Telegram account.
   */
  async unlinkTelegram(): Promise<void> {
    const userId = this.auth.user()?.id;
    if (!userId) return;

    try {
      const userRef = doc(this.db, 'users', userId);
      await updateDoc(userRef, {
        telegramChatId: null,
        telegramLinkedAt: null,
        updatedAt: serverTimestamp(),
      });
      this.telegramLinked.set(false);
    } catch (err: any) {
      console.error('Failed to unlink Telegram:', err);
    }
  }

  /**
   * Close the Telegram link dialog.
   */
  closeTelegramDialog(): void {
    this.telegramDialogOpen.set(false);
    this.telegramDeepLink.set(null);
    this.telegramQrDataUrl.set(null);
    this.telegramLinkError.set(null);
  }

  /**
   * Clean up Telegram listener.
   */
  destroyTelegramListener(): void {
    if (this.telegramLinkUnsubscribe) {
      this.telegramLinkUnsubscribe();
      this.telegramLinkUnsubscribe = null;
    }
  }
}
