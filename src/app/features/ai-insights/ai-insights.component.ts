import { Component, OnInit, OnDestroy, inject, signal, computed, effect, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { doc, getFirestore, onSnapshot, Timestamp } from 'firebase/firestore';

import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';
import { ReceiptService } from '../../services/receipt.service';
import { AiInsightsService, ChatMessage } from '../../services/ai-insights.service';
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

  readonly user = this.auth.user;
  readonly isDarkMode = this.theme.isDarkMode;
  readonly messages = this.aiService.messages;
  readonly isLoading = this.aiService.isLoading;
  readonly insights = this.aiService.insights;
  readonly insightsLoading = this.aiService.insightsLoading;
  readonly error = this.aiService.error;

  // Subscription state
  readonly subscriptionPlan = signal<'free' | 'pro'>('free');
  readonly subscriptionStatus = signal<string>('inactive');
  private userSubscriptionCleanup: (() => void) | null = null;

  // Input state
  readonly messageText = signal('');
  readonly showSuggestions = signal(true);

  // Computed
  readonly isPro = computed(() => this.subscriptionPlan() === 'pro');
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
        }
      });
    }

    // Generate initial insights if user is pro
    if (this.isPro() && this.insights().length === 0) {
      this.aiService.generateInsights();
    }
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
    if (!text || this.isLoading()) return;

    this.messageText.set('');
    this.showSuggestions.set(false);
    await this.aiService.sendMessage(text);
  }

  selectSuggestion(question: string): void {
    this.messageText.set(question);
    this.sendMessage();
  }

  clearChat(): void {
    this.aiService.clearChat();
    this.showSuggestions.set(true);
  }

  refreshInsights(): void {
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

  goBack(): void {
    this.router.navigate(['/app']);
  }

  goToPricing(): void {
    this.router.navigate(['/app/pricing']);
  }
}
