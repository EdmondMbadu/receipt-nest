import { Component, OnInit, OnDestroy, inject, signal, computed, effect, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { doc, getFirestore, onSnapshot } from 'firebase/firestore';

import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';
import { ReceiptService } from '../../services/receipt.service';
import { AiInsightsService } from '../../services/ai-insights.service';
import { app } from '../../../../environments/environments';

@Component({
  selector: 'app-ai-insights',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ai-insights.component.html',
  styleUrl: './ai-insights.component.css'
})
export class AiInsightsComponent implements OnInit, OnDestroy {
  @ViewChild('chatContainer') chatContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('messageInput') messageInput!: ElementRef<HTMLInputElement>;

  private readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly receiptService = inject(ReceiptService);
  readonly aiService = inject(AiInsightsService);
  private readonly db = getFirestore(app);
  private readonly sanitizer = inject(DomSanitizer);

  readonly user = this.auth.user;
  readonly isDarkMode = this.theme.isDarkMode;
  readonly messages = this.aiService.messages;
  readonly isLoading = this.aiService.isLoading;
  readonly insights = this.aiService.insights;
  readonly insightsLoading = this.aiService.insightsLoading;
  readonly error = this.aiService.error;
  readonly activeChatId = this.aiService.activeChatId;
  readonly chatHistory = this.aiService.chatHistory;
  readonly historyLoading = this.aiService.historyLoading;
  readonly historyLoadingMore = this.aiService.historyLoadingMore;
  readonly historyHasMore = this.aiService.historyHasMore;

  // Subscription state
  readonly subscriptionPlan = signal<'free' | 'pro'>('free');
  readonly subscriptionStatus = signal<string>('inactive');
  private userSubscriptionCleanup: (() => void) | null = null;

  // Input state
  readonly messageText = signal('');

  // Computed
  readonly isPro = computed(() => this.subscriptionPlan() === 'pro');
  readonly isAdmin = computed(() => this.user()?.role === 'admin');
  readonly hasAiAccess = computed(() => this.isAdmin() || this.isPro());
  readonly showSuggestions = computed(() => this.messages().length === 0);
  readonly suggestedQuestions = this.aiService.getSuggestedQuestions();
  readonly monthLabel = this.receiptService.selectedMonthLabel;
  readonly totalSpend = this.receiptService.selectedMonthSpend;
  readonly receiptCount = computed(() => this.receiptService.selectedMonthReceipts().length);

  // Scroll effect
  private scrollEffect = effect(() => {
    const messages = this.messages();
    if (messages.length > 0) {
      setTimeout(() => this.scrollToBottom(), 100);
    }
  });

  ngOnInit(): void {
    // Subscribe to receipt updates
    this.receiptService.subscribeToReceipts();

    // Subscribe to user subscription status
    const user = this.user();
    if (user) {
      const userRef = doc(this.db, 'users', user.id);
      this.userSubscriptionCleanup = onSnapshot(userRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          this.subscriptionPlan.set((data['subscriptionPlan'] as 'free' | 'pro') || 'free');
          this.subscriptionStatus.set(String(data['subscriptionStatus'] || 'inactive'));
          this.initializeAiData();
        }
      });
    }

    this.initializeAiData();
  }

  ngOnDestroy(): void {
    if (this.userSubscriptionCleanup) {
      this.userSubscriptionCleanup();
    }
  }

  toggleTheme(): void {
    this.theme.toggleTheme();
  }

  async sendMessage(): Promise<void> {
    const text = this.messageText().trim();
    if (!text || this.isLoading() || !this.hasAiAccess()) return;

    this.messageText.set('');
    await this.aiService.sendMessage(text);
  }

  selectSuggestion(question: string): void {
    this.messageText.set(question);
    this.sendMessage();
  }

  clearChat(): void {
    this.aiService.startNewChat();
  }

  async openChat(chatId: string): Promise<void> {
    await this.aiService.openChat(chatId, true);
  }

  async deleteChat(event: MouseEvent, chatId: string): Promise<void> {
    event.stopPropagation();
    await this.aiService.deleteChat(chatId);
  }

  async loadMoreHistory(): Promise<void> {
    await this.aiService.loadMoreHistory();
  }

  refreshInsights(): void {
    if (!this.hasAiAccess()) {
      return;
    }
    this.aiService.generateInsights();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  private scrollToBottom(): void {
    if (this.chatContainer?.nativeElement) {
      const container = this.chatContainer.nativeElement;
      container.scrollTop = container.scrollHeight;
    }
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  }

  formatTime(date: Date): string {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date);
  }

  formatHistoryDate(date: Date): string {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(date);
  }

  goBack(): void {
    this.router.navigate(['/app']);
  }

  goToPricing(): void {
    this.router.navigate(['/app/pricing']);
  }

  formatMessage(content: string): SafeHtml {
    const escaped = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const lines = escaped.split(/\r?\n/);
    const parts: string[] = [];
    let inOl = false;
    let inUl = false;

    const closeLists = () => {
      if (inOl) {
        parts.push('</ol>');
        inOl = false;
      }
      if (inUl) {
        parts.push('</ul>');
        inUl = false;
      }
    };

    const formatInline = (text: string) => {
      let out = text;
      out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      out = out.replace(/__(.+?)__/g, '<strong>$1</strong>');
      out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
      return out;
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        closeLists();
        parts.push('<div class="ai-spacer"></div>');
        continue;
      }

      const olMatch = line.match(/^(\d+)\.\s+(.*)$/);
      if (olMatch) {
        if (!inOl) {
          closeLists();
          parts.push('<ol>');
          inOl = true;
        }
        parts.push(`<li>${formatInline(olMatch[2])}</li>`);
        continue;
      }

      const ulMatch = line.match(/^-+\s+(.*)$/);
      if (ulMatch) {
        if (!inUl) {
          closeLists();
          parts.push('<ul>');
          inUl = true;
        }
        parts.push(`<li>${formatInline(ulMatch[1])}</li>`);
        continue;
      }

      closeLists();
      parts.push(`<p>${formatInline(line)}</p>`);
    }

    closeLists();
    return this.sanitizer.bypassSecurityTrustHtml(parts.join(''));
  }

  private initializeAiData(): void {
    if (!this.hasAiAccess()) return;

    this.aiService.initializeChatState();
    if (this.insights().length === 0 && !this.insightsLoading()) {
      this.aiService.generateInsights();
    }
  }
}
