import { Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';

import { AppConfigService } from '../../services/app-config.service';
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
  private readonly appConfig = inject(AppConfigService);

  readonly user = this.auth.user;
  readonly isDarkMode = this.theme.isDarkMode;
  readonly currentYear = new Date().getFullYear();
  readonly isMobileMenuOpen = signal(false);
  readonly isDemoOpen = signal(false);
  readonly openFaqIndex = signal<number | null>(null);
  readonly demoVideo = viewChild<ElementRef<HTMLVideoElement>>('demoVideo');
  readonly freePlanReceiptLimit = this.appConfig.freePlanReceiptLimit;

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
    this.title.setTitle('ReceiptNest AI - Finally know where your money goes');
    this.meta.updateTag({ name: 'description', content: 'ReceiptNest AI gives self-employed people a private, auto-organized view of spending with tax-ready exports and clear monthly insights.' });

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

  openDemo() {
    this.isDemoOpen.set(true);
    requestAnimationFrame(() => {
      this.demoVideo()?.nativeElement.play().catch(() => undefined);
    });
  }

  closeDemo() {
    const video = this.demoVideo()?.nativeElement;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    this.isDemoOpen.set(false);
  }

  toggleFaq(index: number) {
    this.openFaqIndex.update(current => current === index ? null : index);
  }
}
