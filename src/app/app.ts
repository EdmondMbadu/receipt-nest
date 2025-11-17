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

  constructor() {
    // Load theme preference from localStorage immediately to prevent flash
    if (typeof window !== 'undefined' && window.localStorage) {
      const savedTheme = localStorage.getItem('theme');
      const prefersDark = savedTheme ? savedTheme === 'dark' : true; // default to dark
      this.isDarkMode.set(prefersDark);

      // Apply theme class immediately
      if (prefersDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }

    // Apply theme class to document when theme changes
    effect(() => {
      const isDark = this.isDarkMode();
      if (typeof document !== 'undefined') {
        if (isDark) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }
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
    const htmlElement = document.documentElement;
    if (newMode) {
      htmlElement.classList.add('dark');
      htmlElement.setAttribute('data-theme', 'dark');
    } else {
      htmlElement.classList.remove('dark');
      htmlElement.setAttribute('data-theme', 'light');
    }
  }
}
