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

    // Update signal first
    this.isDarkMode.set(newMode);

    // Save to localStorage
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem('theme', newMode ? 'dark' : 'light');
    }

    // Force apply the class to html element
    const htmlElement = document.documentElement;

    // Remove any existing theme classes first
    htmlElement.classList.remove('dark', 'light');

    // Add the new class
    if (newMode) {
      htmlElement.classList.add('dark');
      // Force a style recalculation
      htmlElement.style.colorScheme = 'dark';
    } else {
      htmlElement.classList.remove('dark');
      htmlElement.style.colorScheme = 'light';
    }

    // Log for debugging
    console.log('Theme toggled to:', newMode ? 'dark' : 'light');
    console.log('HTML classes:', htmlElement.classList.toString());
    console.log('HTML element:', htmlElement);
  }
}
