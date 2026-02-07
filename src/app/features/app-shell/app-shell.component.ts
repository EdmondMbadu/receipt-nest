import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';

import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';
import { AiInsightsService } from '../../services/ai-insights.service';

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

  readonly user = this.auth.user;
  readonly isDarkMode = this.theme.isDarkMode;
  readonly sidebarOpen = signal(false);
  readonly historyExpanded = signal(true);
  readonly activeChatId = this.aiService.activeChatId;
  readonly chatHistory = this.aiService.chatHistory;
  readonly historyLoading = this.aiService.historyLoading;
  readonly historyLoadingMore = this.aiService.historyLoadingMore;
  readonly historyHasMore = this.aiService.historyHasMore;

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

  async deleteHistoryChat(event: MouseEvent, chatId: string): Promise<void> {
    event.stopPropagation();
    await this.aiService.deleteChat(chatId);
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
}
