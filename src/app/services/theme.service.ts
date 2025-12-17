import { Injectable, effect, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  readonly isDarkMode = signal<boolean>(true);

  constructor() {
    if (typeof window !== 'undefined' && window.localStorage) {
      const savedTheme = localStorage.getItem('theme');
      const prefersDark = savedTheme ? savedTheme === 'dark' : true;
      this.isDarkMode.set(prefersDark);
      this.applyTheme(prefersDark);
    }

    effect(() => {
      const isDark = this.isDarkMode();
      this.applyTheme(isDark);
    });
  }

  toggleTheme() {
    const next = !this.isDarkMode();
    this.isDarkMode.set(next);
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    }
    this.applyTheme(next);
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



