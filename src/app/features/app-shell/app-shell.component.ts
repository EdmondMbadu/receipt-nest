import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';

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

  readonly user = this.auth.user;
  readonly isDarkMode = this.theme.isDarkMode;
  readonly sidebarOpen = signal(false);

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

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((open) => !open);
  }

  toggleTheme(): void {
    this.theme.toggleTheme();
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigate(['/login']);
  }
}
