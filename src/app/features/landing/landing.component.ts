import { Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
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
  private readonly document = inject(DOCUMENT);
  private readonly appConfig = inject(AppConfigService);

  readonly user = this.auth.user;
  readonly isDarkMode = this.theme.isDarkMode;
  readonly currentYear = new Date().getFullYear();
  readonly isMobileMenuOpen = signal(false);
  readonly isDemoOpen = signal(false);
  readonly openFaqIndex = signal<number | null>(null);
  readonly billingInterval = signal<'monthly' | 'annual'>('monthly');
  readonly googlePlayUrl = 'https://play.google.com/store/apps/details?id=com.receiptnest.mobile';
  readonly appStoreUrl = 'https://apps.apple.com/us/app/receiptnest-ai/id6762539388';
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
    this.applySeoTags();

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

  setBillingInterval(interval: 'monthly' | 'annual') {
    this.billingInterval.set(interval);
  }

  private applySeoTags() {
    const pageTitle = 'ReceiptNest AI | Receipt Organizer & Expense Tracker';
    const description =
      'ReceiptNest AI is a receipt organizer and expense tracker that turns scattered receipts into a clear picture of your spending: auto-organized, tax-ready, and private by default.';
    const keywords =
      'ReceiptNest AI, ReceiptNest, receipt organizer, AI receipt organizer, receipt scanner, receipt tracker, receipt management software, expense tracker, receipt inbox, tax-ready receipts';
    const canonicalUrl = 'https://receipt-nest.com/';
    const previewImage = 'https://receipt-nest.com/assets/og-image.png';
    const previewAlt = 'ReceiptNest AI receipt organizer dashboard';

    this.title.setTitle(pageTitle);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ name: 'keywords', content: keywords });
    this.meta.updateTag({ name: 'author', content: 'ReceiptNest AI' });
    this.meta.updateTag({ name: 'robots', content: 'index, follow' });
    this.meta.updateTag({
      name: 'googlebot',
      content: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
    });
    this.meta.updateTag({ name: 'application-name', content: 'ReceiptNest AI' });
    this.meta.updateTag({ property: 'og:type', content: 'website' }, "property='og:type'");
    this.meta.updateTag({ property: 'og:url', content: canonicalUrl }, "property='og:url'");
    this.meta.updateTag({ property: 'og:title', content: pageTitle }, "property='og:title'");
    this.meta.updateTag({ property: 'og:description', content: description }, "property='og:description'");
    this.meta.updateTag({ property: 'og:image', content: previewImage }, "property='og:image'");
    this.meta.updateTag({ property: 'og:image:alt', content: previewAlt }, "property='og:image:alt'");
    this.meta.updateTag({ property: 'og:site_name', content: 'ReceiptNest AI' }, "property='og:site_name'");
    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.meta.updateTag({ name: 'twitter:url', content: canonicalUrl });
    this.meta.updateTag({ name: 'twitter:title', content: pageTitle });
    this.meta.updateTag({ name: 'twitter:description', content: description });
    this.meta.updateTag({ name: 'twitter:image', content: previewImage });
    this.meta.updateTag({ name: 'twitter:image:alt', content: previewAlt });
    this.updateCanonical(canonicalUrl);
  }

  private updateCanonical(url: string) {
    let canonical = this.document.querySelector<HTMLLinkElement>('link[rel="canonical"]');

    if (!canonical) {
      canonical = this.document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      this.document.head.appendChild(canonical);
    }

    canonical.setAttribute('href', url);
  }
}
