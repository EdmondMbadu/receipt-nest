import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';

import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';
import { AiInsightsService } from '../../services/ai-insights.service';
import { ShareService } from '../../services/share.service';
import { NotificationSettings } from '../../models/user.model';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.css'
})
export class AppShellComponent {
  private readonly desktopSidebarStorageKey = 'appShellDesktopSidebarExpanded';
  private readonly deleteKeyword = 'DELETE';
  private readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly aiService = inject(AiInsightsService);
  private readonly shareService = inject(ShareService);

  readonly user = this.auth.user;
  readonly isDarkMode = this.theme.isDarkMode;
  readonly sidebarOpen = signal(false);
  readonly desktopSidebarExpanded = signal(true);
  readonly historyExpanded = signal(true);
  readonly activeChatId = this.aiService.activeChatId;
  readonly chatHistory = this.aiService.chatHistory;
  readonly historyLoading = this.aiService.historyLoading;
  readonly historyLoadingMore = this.aiService.historyLoadingMore;
  readonly historyHasMore = this.aiService.historyHasMore;
  readonly chatActionsModalOpen = signal(false);
  readonly chatActionsChatId = signal<string | null>(null);
  readonly chatActionsChatTitle = signal('');
  readonly deleteConfirmChatId = signal<string | null>(null);
  readonly deleteConfirmChatTitle = signal<string>('');
  readonly shareModalOpen = signal(false);
  readonly shareSourceChatId = signal<string | null>(null);
  readonly shareSourceChatTitle = signal<string>('');
  readonly shareLink = signal<string | null>(null);
  readonly shareError = signal<string | null>(null);
  readonly shareCopied = signal(false);
  readonly shareLoading = signal(false);
  readonly telegramLinked = this.aiService.telegramLinked;
  readonly settingsDropUpOpen = signal(false);
  readonly settingsModalOpen = signal(false);
  readonly settingsActiveTab = signal<'general' | 'account' | 'notifications'>('general');
  readonly settingsFirstName = signal('');
  readonly settingsLastName = signal('');
  readonly settingsEmail = signal('');
  readonly settingsSaving = signal(false);
  readonly settingsError = signal<string | null>(null);
  readonly settingsSuccess = signal<string | null>(null);
  readonly notificationsReceiptProcessing = signal(true);
  readonly notificationsProductUpdates = signal(false);
  readonly notificationsSecurityAlerts = signal(true);
  readonly notificationsSaving = signal(false);
  readonly notificationsError = signal<string | null>(null);
  readonly notificationsSuccess = signal<string | null>(null);
  readonly usesPasswordAuth = signal(false);
  readonly passwordCurrent = signal('');
  readonly passwordNext = signal('');
  readonly passwordConfirm = signal('');
  readonly passwordSaving = signal(false);
  readonly passwordError = signal<string | null>(null);
  readonly passwordSuccess = signal<string | null>(null);
  readonly showDeleteConfirmation = signal(false);
  readonly deleteConfirmText = signal('');
  readonly deleteAccountPassword = signal('');
  readonly deleteAccountPending = signal(false);
  readonly deleteAccountError = signal<string | null>(null);
  readonly canConfirmDelete = computed(() => {
    const matchesKeyword = this.deleteConfirmText().trim().toUpperCase() === this.deleteKeyword;
    const hasPassword = !this.usesPasswordAuth() || this.deleteAccountPassword().trim().length > 0;
    return matchesKeyword && hasPassword && !this.deleteAccountPending();
  });

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

  constructor() {
    if (typeof localStorage === 'undefined') {
      return;
    }

    const stored = localStorage.getItem(this.desktopSidebarStorageKey);
    if (stored === '0') {
      this.desktopSidebarExpanded.set(false);
    } else {
      this.desktopSidebarExpanded.set(true);
    }
  }

  private readonly loadInsightsSidebarHistory = effect(() => {
    if (!this.isInsightsRoute()) return;
    this.aiService.initializeChatState(5);
  });

  private readonly syncAuthProviderState = effect(() => {
    this.user();
    this.usesPasswordAuth.set(this.auth.isCurrentUserPasswordAuth());
  });

  closeSidebar(): void {
    this.sidebarOpen.set(false);
    this.settingsDropUpOpen.set(false);
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((open) => !open);
  }

  toggleDesktopSidebar(): void {
    const next = !this.desktopSidebarExpanded();
    this.desktopSidebarExpanded.set(next);

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.desktopSidebarStorageKey, next ? '1' : '0');
    }
  }

  toggleHistoryExpanded(): void {
    this.historyExpanded.update((expanded) => !expanded);
  }

  toggleSettingsDropUp(): void {
    this.settingsDropUpOpen.update((open) => !open);
  }

  closeSettingsDropUp(): void {
    this.settingsDropUpOpen.set(false);
  }

  toggleTheme(): void {
    this.theme.toggleTheme();
  }

  openSettingsModal(tab: 'general' | 'account' | 'notifications' = 'general'): void {
    this.settingsDropUpOpen.set(false);
    const profile = this.user();
    const defaults = this.auth.getDefaultNotificationSettings(profile);

    this.settingsFirstName.set(profile?.firstName ?? '');
    this.settingsLastName.set(profile?.lastName ?? '');
    this.settingsEmail.set(profile?.email ?? '');
    this.notificationsReceiptProcessing.set(defaults.receiptProcessing);
    this.notificationsProductUpdates.set(defaults.productUpdates);
    this.notificationsSecurityAlerts.set(defaults.securityAlerts);

    this.settingsActiveTab.set(tab);
    this.settingsModalOpen.set(true);
    this.resetSettingsAlerts();
    this.resetPasswordState();
    this.resetDeleteState();
  }

  closeSettingsModal(): void {
    this.settingsModalOpen.set(false);
    this.showDeleteConfirmation.set(false);
  }

  setSettingsTab(tab: 'general' | 'account' | 'notifications'): void {
    this.settingsActiveTab.set(tab);
    this.settingsError.set(null);
    this.settingsSuccess.set(null);
    this.notificationsError.set(null);
    this.notificationsSuccess.set(null);
    this.passwordError.set(null);
    this.passwordSuccess.set(null);
  }

  async saveProfileSettings(): Promise<void> {
    this.settingsSaving.set(true);
    this.settingsError.set(null);
    this.settingsSuccess.set(null);

    try {
      await this.auth.updateProfileInfo({
        firstName: this.settingsFirstName(),
        lastName: this.settingsLastName()
      });
      this.settingsSuccess.set('Profile saved.');
    } catch (error) {
      this.settingsError.set(this.getErrorMessage(error, 'Unable to save profile details.'));
    } finally {
      this.settingsSaving.set(false);
    }
  }

  async saveNotificationSettings(): Promise<void> {
    this.notificationsSaving.set(true);
    this.notificationsError.set(null);
    this.notificationsSuccess.set(null);

    const settings: NotificationSettings = {
      receiptProcessing: this.notificationsReceiptProcessing(),
      productUpdates: this.notificationsProductUpdates(),
      securityAlerts: this.notificationsSecurityAlerts()
    };

    try {
      await this.auth.updateNotificationSettings(settings);
      this.notificationsSuccess.set('Notification settings updated.');
    } catch (error) {
      this.notificationsError.set(this.getErrorMessage(error, 'Unable to update notification settings.'));
    } finally {
      this.notificationsSaving.set(false);
    }
  }

  async updatePassword(): Promise<void> {
    this.passwordError.set(null);
    this.passwordSuccess.set(null);

    if (!this.usesPasswordAuth()) {
      this.passwordError.set('Password updates are only available for email/password accounts.');
      return;
    }

    const newPassword = this.passwordNext().trim();
    const confirmPassword = this.passwordConfirm().trim();
    if (newPassword.length < 6) {
      this.passwordError.set('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      this.passwordError.set('New password and confirmation do not match.');
      return;
    }

    this.passwordSaving.set(true);
    try {
      await this.auth.changePassword(this.passwordCurrent(), newPassword);
      this.passwordCurrent.set('');
      this.passwordNext.set('');
      this.passwordConfirm.set('');
      this.passwordSuccess.set('Password changed successfully.');
    } catch (error) {
      this.passwordError.set(this.getErrorMessage(error, 'Unable to change password.'));
    } finally {
      this.passwordSaving.set(false);
    }
  }

  openDeleteConfirmation(): void {
    this.showDeleteConfirmation.set(true);
    this.deleteConfirmText.set('');
    this.deleteAccountPassword.set('');
    this.deleteAccountError.set(null);
  }

  closeDeleteConfirmation(): void {
    this.showDeleteConfirmation.set(false);
    this.deleteConfirmText.set('');
    this.deleteAccountPassword.set('');
    this.deleteAccountError.set(null);
  }

  async deleteAccount(): Promise<void> {
    if (!this.canConfirmDelete()) {
      return;
    }

    this.deleteAccountPending.set(true);
    this.deleteAccountError.set(null);

    try {
      await this.auth.deleteAccount({
        currentPassword: this.deleteAccountPassword()
      });
      this.closeSettingsModal();
      await this.router.navigate(['/login']);
    } catch (error) {
      this.deleteAccountError.set(this.getErrorMessage(error, 'Unable to delete account right now.'));
    } finally {
      this.deleteAccountPending.set(false);
    }
  }

  async logout(): Promise<void> {
    this.settingsDropUpOpen.set(false);
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

  openChatActionsModal(event: MouseEvent, chatId: string, title: string): void {
    event.stopPropagation();
    this.chatActionsModalOpen.set(true);
    this.chatActionsChatId.set(chatId);
    this.chatActionsChatTitle.set(title);
  }

  closeChatActionsModal(): void {
    this.chatActionsModalOpen.set(false);
    this.chatActionsChatId.set(null);
    this.chatActionsChatTitle.set('');
  }

  openDeleteChatModal(chatId: string, title: string): void {
    this.closeChatActionsModal();
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

  async openShareChatModal(chatId: string, title: string): Promise<void> {
    this.closeChatActionsModal();
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

  async openTelegramConnect(): Promise<void> {
    if (!this.isInsightsRoute()) {
      await this.router.navigate(['/app/insights']);
    }
    // Small delay to ensure component is loaded
    setTimeout(() => {
      this.aiService.generateTelegramLink();
    }, 200);
    this.closeSidebar();
  }

  async openTelegramChat(): Promise<void> {
    if (!this.isInsightsRoute()) {
      await this.router.navigate(['/app/insights']);
    }
    // Small delay to ensure component is loaded
    setTimeout(() => {
      this.aiService.openTelegramChat();
    }, 200);
    this.closeSidebar();
  }

  async unlinkTelegram(): Promise<void> {
    await this.aiService.unlinkTelegram();
  }

  private buildShareUrl(shareId: string): string {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}/share/${shareId}`;
    }
    return `/share/${shareId}`;
  }

  private resetSettingsAlerts(): void {
    this.settingsError.set(null);
    this.settingsSuccess.set(null);
    this.notificationsError.set(null);
    this.notificationsSuccess.set(null);
  }

  private resetPasswordState(): void {
    this.passwordCurrent.set('');
    this.passwordNext.set('');
    this.passwordConfirm.set('');
    this.passwordError.set(null);
    this.passwordSuccess.set(null);
    this.passwordSaving.set(false);
  }

  private resetDeleteState(): void {
    this.showDeleteConfirmation.set(false);
    this.deleteConfirmText.set('');
    this.deleteAccountPassword.set('');
    this.deleteAccountPending.set(false);
    this.deleteAccountError.set(null);
  }

  private getErrorMessage(error: unknown, fallback: string): string {
    const code = String((error as { code?: unknown })?.code ?? '');
    if (code.includes('wrong-password') || code.includes('invalid-credential')) {
      return 'Current password is incorrect.';
    }
    if (code.includes('too-many-requests')) {
      return 'Too many attempts. Please wait a moment and try again.';
    }

    const message = (error as { message?: unknown })?.message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
    return fallback;
  }
}
