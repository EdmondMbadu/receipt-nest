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
      const insightData = this.prepareInsightData();

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
      const insightData = this.prepareInsightData();

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
  private prepareInsightData(): InsightData {
    const receipts = this.receiptService.selectedMonthReceipts();
    const totalSpend = this.receiptService.selectedMonthSpend();
    const monthLabel = this.receiptService.selectedMonthLabel();
    const dailyData = this.receiptService.dailySpendingData();
    const monthChange = this.receiptService.monthOverMonthChange();

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

    return {
      totalSpend,
      receiptCount: receipts.length,
      monthLabel,
      topCategories,
      dailyAverage,
      highestSpendDay,
      monthOverMonthChange: monthChange,
      receipts: receiptSummaries
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
