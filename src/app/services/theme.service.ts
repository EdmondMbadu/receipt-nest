import { Injectable, OnDestroy, effect, signal } from '@angular/core';

type ThemePreference = 'dark' | 'light';

@Injectable({
  providedIn: 'root'
})
export class ThemeService implements OnDestroy {
  private readonly storageKey = 'theme';
  private readonly darkModeMediaQuery = '(prefers-color-scheme: dark)';
  private systemPreferenceQuery: MediaQueryList | null = null;
  private readonly systemPreferenceChangeHandler = (event: MediaQueryListEvent) => {
    if (this.getSavedTheme()) {
      return;
    }
    this.isDarkMode.set(event.matches);
  };

  readonly isDarkMode = signal<boolean>(this.getInitialDarkModePreference());

  constructor() {
    this.watchSystemPreference();
    this.applyTheme(this.isDarkMode());

    effect(() => {
      const isDark = this.isDarkMode();
      this.applyTheme(isDark);
    });
  }

  ngOnDestroy(): void {
    if (!this.systemPreferenceQuery) {
      return;
    }

    this.systemPreferenceQuery.removeEventListener('change', this.systemPreferenceChangeHandler);
  }

  toggleTheme() {
    const next = !this.isDarkMode();
    this.isDarkMode.set(next);
    this.saveTheme(next ? 'dark' : 'light');
  }

  private getInitialDarkModePreference(): boolean {
    const savedTheme = this.getSavedTheme();
    if (savedTheme) {
      return savedTheme === 'dark';
    }

    return this.systemPrefersDarkMode();
  }

  private getSavedTheme(): ThemePreference | null {
    if (typeof window === 'undefined') {
      return null;
    }

    try {
      const savedTheme = window.localStorage?.getItem(this.storageKey);
      return savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : null;
    } catch {
      return null;
    }
  }

  private saveTheme(theme: ThemePreference): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage?.setItem(this.storageKey, theme);
    } catch {
      // The in-memory signal still reflects the user's choice when storage is unavailable.
    }
  }

  private systemPrefersDarkMode(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }

    return window.matchMedia(this.darkModeMediaQuery).matches;
  }

  private watchSystemPreference(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    this.systemPreferenceQuery = window.matchMedia(this.darkModeMediaQuery);
    this.systemPreferenceQuery.addEventListener('change', this.systemPreferenceChangeHandler);
  }

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
}

