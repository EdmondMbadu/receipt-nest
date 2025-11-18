import { Component, signal, effect, OnInit } from '@angular/core';

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  protected readonly title = signal('receipt-nest');
  currentYear = new Date().getFullYear();

  public isDarkMode = signal<boolean>(true);

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

  ngOnInit() {
    // Theme is already loaded in constructor, but keep this for consistency
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
}
