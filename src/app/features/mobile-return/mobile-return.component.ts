import { Component, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';

@Component({
  selector: 'app-mobile-return',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './mobile-return.component.html',
  styleUrl: './mobile-return.component.css'
})
export class MobileReturnComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  readonly flow = signal((this.route.snapshot.paramMap.get('flow') ?? '').toLowerCase());
  readonly status = signal((this.route.snapshot.queryParamMap.get('status') ?? '').toLowerCase());

  readonly title = computed(() => {
    if (this.flow() === 'checkout' && this.status() === 'success') {
      return 'Opening ReceiptNest AI';
    }
    if (this.flow() === 'checkout' && this.status() === 'cancel') {
      return 'Checkout Canceled';
    }
    if (this.flow() === 'portal') {
      return 'Returning To ReceiptNest AI';
    }
    return 'Opening ReceiptNest AI';
  });

  readonly description = computed(() => {
    if (this.flow() === 'checkout' && this.status() === 'success') {
      return 'Your payment was accepted. If the app does not open automatically, use the button below.';
    }
    if (this.flow() === 'checkout' && this.status() === 'cancel') {
      return 'No charge was made. You can reopen the app or continue on the web.';
    }
    if (this.flow() === 'portal') {
      return 'Your billing session is complete. Reopen the app to continue.';
    }
    return 'If the app does not open automatically, use the button below.';
  });

  readonly appLinkUrl = computed(() => {
    const flow = this.flow() || 'checkout';
    const params = new URLSearchParams();
    const status = this.status();
    if (status) {
      params.set('status', status);
    }

    const query = params.toString();
    return `receiptnest:///mobile-return/${flow}${query ? `?${query}` : ''}`;
  });

  constructor() {
    if (!this.isBrowser) {
      return;
    }

    const userAgent = navigator.userAgent || '';
    const isMobileBrowser = /Android|iPhone|iPad|iPod/i.test(userAgent);
    if (!isMobileBrowser) {
      return;
    }

    setTimeout(() => {
      window.location.assign(this.appLinkUrl());
    }, 500);
  }
}
