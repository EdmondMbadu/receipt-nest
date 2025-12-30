import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';

import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.css'
})
export class LandingComponent {
  readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  readonly user = this.auth.user;
  readonly isDarkMode = this.theme.isDarkMode;
  readonly currentYear = new Date().getFullYear();
  readonly isMobileMenuOpen = signal(false);

  readonly displayName = computed(() => {
    const profile = this.user();
    if (!profile) {
      return '';
    }

    const name = `${profile.firstName} ${profile.lastName}`.trim();
    return name || profile.email;
  });

  constructor() {
    // Set SEO meta tags
    this.title.setTitle('ReceiptNest - AI-Powered Receipt Scanner & Expense Tracker');
    this.meta.updateTag({ name: 'description', content: 'ReceiptNest is a free AI-powered receipt scanner and expense tracker. Scan receipts, organize expenses by category, track spending trends, and export reports.' });

    // Redirect to home if user is already authenticated
    effect(() => {
      if (this.auth.isAuthenticated()) {
        this.router.navigate(['/app']);
      }
    });
  }

  toggleTheme() {
    this.theme.toggleTheme();
  }

  toggleMobileMenu() {
    this.isMobileMenuOpen.update(isOpen => !isOpen);
  }
}



