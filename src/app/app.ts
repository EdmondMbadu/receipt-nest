import { Component, computed, effect, inject, signal } from '@angular/core';
import { NgIf } from '@angular/common';
import { Router, RouterLink, RouterOutlet } from '@angular/router';

import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, NgIf],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('receipt-nest');
  currentYear = new Date().getFullYear();

  public isDarkMode = signal<boolean>(true);
  protected readonly auth = inject(AuthService);
  protected readonly user = this.auth.user;
  private readonly router = inject(Router);
  protected readonly displayName = computed(() => {
    const profile = this.user();
    if (!profile) {
      return '';
    }

    const name = `${profile.firstName} ${profile.lastName}`.trim();
    return name || profile.email;
  });

  private applyTheme(isDark: boolean) {
    if (typeof document === 'undefined') {
      return;
    }

    const htmlElement = document.documentElement;
    if (isDark) {
      htmlElement.classList.add('dark');
      htmlElement.setAttribute('data-theme', 'dark');
    } else {
      htmlElement.classList.remove('dark');
      htmlElement.setAttribute('data-theme', 'light');
    }
  }

  constructor() {
    // Load theme preference from localStorage immediately to prevent flash
    if (typeof window !== 'undefined' && window.localStorage) {
      const savedTheme = localStorage.getItem('theme');
      const prefersDark = savedTheme ? savedTheme === 'dark' : true; // default to dark
      this.isDarkMode.set(prefersDark);

      // Apply theme class immediately for initial render
      this.applyTheme(prefersDark);
    }

    // Apply theme class to document when theme changes
    effect(() => {
      const isDark = this.isDarkMode();
      this.applyTheme(isDark);
    });
  }

  toggleTheme() {
    const currentMode = this.isDarkMode();
    const newMode = !currentMode;

    // Update signal - this will trigger the effect to update the DOM
    this.isDarkMode.set(newMode);

    // Save to localStorage
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem('theme', newMode ? 'dark' : 'light');
    }

    // Also manually update to ensure immediate effect (effect should handle this, but this ensures it works)
    this.applyTheme(newMode);
  }

  async logout() {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
