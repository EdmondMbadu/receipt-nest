import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';

import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';
import { AiInsightsService } from '../../services/ai-insights.service';
import { ShareService } from '../../services/share.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.css'
})
export class AppShellComponent {
  private readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly aiService = inject(AiInsightsService);
  private readonly shareService = inject(ShareService);

  readonly user = this.auth.user;
  readonly isDarkMode = this.theme.isDarkMode;
  readonly sidebarOpen = signal(false);
  readonly historyExpanded = signal(true);
  readonly activeChatId = this.aiService.activeChatId;
  readonly chatHistory = this.aiService.chatHistory;
  readonly historyLoading = this.aiService.historyLoading;
  readonly historyLoadingMore = this.aiService.historyLoadingMore;
  readonly historyHasMore = this.aiService.historyHasMore;
  readonly openHistoryMenuId = signal<string | null>(null);
  readonly deleteConfirmChatId = signal<string | null>(null);
  readonly deleteConfirmChatTitle = signal<string>('');
  readonly shareModalOpen = signal(false);
  readonly shareSourceChatId = signal<string | null>(null);
  readonly shareSourceChatTitle = signal<string>('');
  readonly shareLink = signal<string | null>(null);
  readonly shareError = signal<string | null>(null);
  readonly shareCopied = signal(false);
  readonly shareLoading = signal(false);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects)
    ),
    { initialValue: this.router.url }
  );
  readonly isInsightsRoute = computed(() => this.currentUrl().startsWith('/app/insights'));

  readonly displayName = computed(() => {
    const profile = this.user();
    if (!profile) return 'Account';
    const name = `${profile.firstName} ${profile.lastName}`.trim();
    return name || profile.email || 'Account';
  });

  readonly userInitials = computed(() => {
    const profile = this.user();
    if (!profile) return '?';
    const initials = `${profile.firstName?.[0] ?? ''}${profile.lastName?.[0] ?? ''}`.trim().toUpperCase();
    if (initials) return initials;
    return profile.email?.[0]?.toUpperCase() || '?';
  });

  private readonly loadInsightsSidebarHistory = effect(() => {
    if (!this.isInsightsRoute()) return;
    this.aiService.initializeChatState(5);
  });

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((open) => !open);
  }

  toggleHistoryExpanded(): void {
    this.historyExpanded.update((expanded) => !expanded);
  }

  toggleTheme(): void {
    this.theme.toggleTheme();
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }

  async openHistoryChat(chatId: string): Promise<void> {
    if (!this.isInsightsRoute()) {
      await this.router.navigate(['/app/insights']);
    }
    await this.aiService.openChat(chatId, true);
    this.closeSidebar();
  }

  toggleHistoryMenu(event: MouseEvent, chatId: string): void {
    event.stopPropagation();
    this.openHistoryMenuId.update((current) => current === chatId ? null : chatId);
  }

  closeHistoryMenu(): void {
    this.openHistoryMenuId.set(null);
  }

  openDeleteChatModal(event: MouseEvent, chatId: string, title: string): void {
    event.stopPropagation();
    this.openHistoryMenuId.set(null);
    this.deleteConfirmChatId.set(chatId);
    this.deleteConfirmChatTitle.set(title);
  }

  closeDeleteChatModal(): void {
    this.deleteConfirmChatId.set(null);
    this.deleteConfirmChatTitle.set('');
  }

  async confirmDeleteChat(): Promise<void> {
    const chatId = this.deleteConfirmChatId();
    if (!chatId) {
      return;
    }

    await this.aiService.deleteChat(chatId);
    this.closeDeleteChatModal();
  }

  async openShareChatModal(event: MouseEvent, chatId: string, title: string): Promise<void> {
    event.stopPropagation();
    this.openHistoryMenuId.set(null);
    this.shareModalOpen.set(true);
    this.shareSourceChatId.set(chatId);
    this.shareSourceChatTitle.set(title);
    this.shareError.set(null);
    this.shareCopied.set(false);
    this.shareLink.set(null);
    this.shareLoading.set(true);

    try {
      const share = await this.shareService.createChatShare(chatId);
      this.shareLink.set(this.buildShareUrl(share.id));
    } catch (error: any) {
      const message = error?.message || 'Unable to create share link right now.';
      this.shareError.set(message);
    } finally {
      this.shareLoading.set(false);
    }
  }

  closeShareChatModal(): void {
    this.shareModalOpen.set(false);
    this.shareSourceChatId.set(null);
    this.shareSourceChatTitle.set('');
    this.shareLink.set(null);
    this.shareError.set(null);
    this.shareCopied.set(false);
    this.shareLoading.set(false);
  }

  async copyShareLink(): Promise<void> {
    const link = this.shareLink();
    if (!link) {
      return;
    }

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = link;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      this.shareCopied.set(true);
      setTimeout(() => this.shareCopied.set(false), 2500);
    } catch (error) {
      this.shareError.set('Unable to copy link. Please copy it manually.');
    }
  }

  async loadMoreHistory(): Promise<void> {
    await this.aiService.loadMoreHistory(10);
  }

  onHistoryScroll(event: Event): void {
    const element = event.target as HTMLElement;
    const threshold = 80;
    const reachedBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - threshold;
    if (reachedBottom && this.historyHasMore() && !this.historyLoadingMore()) {
      this.loadMoreHistory();
    }
  }

  formatHistoryDate(date: Date): string {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric'
    }).format(date);
  }

  private buildShareUrl(shareId: string): string {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/share/${shareId}`;
    }
    return `/share/${shareId}`;
  }
}
