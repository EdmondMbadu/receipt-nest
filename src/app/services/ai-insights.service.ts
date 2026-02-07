import { Injectable, inject, signal } from '@angular/core';
import { getFunctions, httpsCallable } from 'firebase/functions';
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

@Injectable({
  providedIn: 'root'
})
export class AiInsightsService {
  private readonly functions = getFunctions(app);
  private readonly auth = inject(AuthService);
  private readonly receiptService = inject(ReceiptService);

  // Chat state
  readonly messages = signal<ChatMessage[]>([]);
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);

  // Pre-built insights
  readonly insights = signal<string[]>([]);
  readonly insightsLoading = signal(false);

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

  /**
   * Send a chat message and get AI response
   */
  async sendMessage(content: string): Promise<void> {
    if (!content.trim()) return;

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
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Clear chat history
   */
  clearChat(): void {
    this.messages.set([]);
    this.error.set(null);
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
}
