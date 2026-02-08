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
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

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
  readonly error = this.aiService.error;

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
  readonly topSuggestedQuestions = computed(() => this.suggestedQuestions.slice(0, 3));
  readonly monthLabel = this.receiptService.selectedMonthLabel;
  readonly totalSpend = this.receiptService.selectedMonthSpend;
  readonly receiptCount = computed(() => this.receiptService.selectedMonthReceipts().length);
  readonly isCurrentMonth = this.receiptService.isCurrentMonth;

  // Upload state
  readonly isUploading = this.aiService.isUploading;
  readonly uploadProgress = this.aiService.uploadProgress;

  // Telegram state
  readonly telegramLinked = this.aiService.telegramLinked;
  readonly telegramDialogOpen = this.aiService.telegramDialogOpen;
  readonly telegramQrDataUrl = this.aiService.telegramQrDataUrl;
  readonly telegramDeepLink = this.aiService.telegramDeepLink;
  readonly telegramLinkLoading = this.aiService.telegramLinkLoading;
  readonly telegramLinkError = this.aiService.telegramLinkError;
  readonly unavailableReceiptPreviews = signal<Record<string, boolean>>({});

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
    this.aiService.checkTelegramStatus();
  }

  ngOnDestroy(): void {
    if (this.userSubscriptionCleanup) {
      this.userSubscriptionCleanup();
    }
    this.aiService.destroyTelegramListener();
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

  goToPreviousMonth(): void {
    this.receiptService.goToPreviousMonth();
  }

  goToNextMonth(): void {
    this.receiptService.goToNextMonth();
  }

  goToCurrentMonth(): void {
    this.receiptService.goToCurrentMonth();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.hasAiAccess()) return;

    // Reset the input so the same file can be re-selected
    input.value = '';

    await this.aiService.uploadReceiptFromChat(file);
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

  /**
   * Get a receipt image URL for a message (in-memory map, populated from download URLs).
   */
  getThumbnail(messageId: string): string | null {
    return this.aiService.chatThumbnails.get(messageId) ?? null;
  }

  async openReceiptPreview(messageId: string, content: string): Promise<void> {
    const freshUrl = await this.aiService.getFreshReceiptPreviewUrl(messageId, content);
    if (!freshUrl) {
      this.markReceiptPreviewUnavailable(messageId);
      return;
    }

    this.unavailableReceiptPreviews.update((state) => {
      if (!state[messageId]) return state;
      const next = { ...state };
      delete next[messageId];
      return next;
    });

    window.open(freshUrl, '_blank', 'noopener,noreferrer');
  }

  onReceiptPreviewError(messageId: string): void {
    this.markReceiptPreviewUnavailable(messageId);
  }

  isReceiptPreviewUnavailable(messageId: string): boolean {
    return !!this.unavailableReceiptPreviews()[messageId];
  }

  private markReceiptPreviewUnavailable(messageId: string): void {
    this.aiService.chatThumbnails.delete(messageId);
    this.unavailableReceiptPreviews.update((state) => ({ ...state, [messageId]: true }));
  }

  /**
   * Strip receipt metadata tags from message content for display.
   */
  stripReceiptUrl(content: string): string {
    return content
      .replace(/\s*\[receipt_url:[^\]]+\]/g, '')
      .replace(/\s*\[receipt_path:[^\]]+\]/g, '')
      .trim();
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

  // ── Telegram Methods ───────────────────────────────────────────────────

  openTelegramDialog(): void {
    if (this.telegramLinked()) {
      // Already linked - open the Telegram chat directly
      this.aiService.openTelegramChat();
      return;
    }
    this.aiService.generateTelegramLink();
  }

  closeTelegramDialog(): void {
    this.aiService.closeTelegramDialog();
  }

  unlinkTelegram(): void {
    this.aiService.unlinkTelegram();
  }

  private initializeAiData(): void {
    if (!this.hasAiAccess()) return;

    this.aiService.initializeChatState();
  }
}
