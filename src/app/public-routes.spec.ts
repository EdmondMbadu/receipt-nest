import { DOCUMENT } from '@angular/common';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, TitleStrategy } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { AppTitleStrategy } from './app-title.strategy';

describe('Public SEO navigation', () => {
  beforeEach(() => TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), provideRouter(routes),
      { provide: TitleStrategy, useClass: AppTitleStrategy }]
  }));

  it('updates content and canonical between workflow pages', async () => {
    const harness = await RouterTestingHarness.create('/receipt-tracker');
    await harness.navigateByUrl('/receipt-to-csv');
    const document = TestBed.inject(DOCUMENT);
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://receipt-nest.com/receipt-to-csv');
    expect(harness.routeNativeElement?.querySelector('a[download]')).not.toBeNull();
    expect(harness.routeNativeElement?.querySelector('app-public-header a')?.getAttribute('href')).toBe('/receipt-to-csv#main-content');
  });

  it('clears article schema on navigation to pricing and updates the billing controls', async () => {
    const harness = await RouterTestingHarness.create('/blog/receiptnest-vs-expensify');
    const document = TestBed.inject(DOCUMENT);
    expect(document.querySelector('#json-ld-blog-article')).not.toBeNull();
    await harness.navigateByUrl('/pricing');
    expect(document.querySelector('#json-ld-blog-article')).toBeNull();
    expect(document.querySelector('meta[property^="article:"]')).toBeNull();
    expect(document.title).toBe('ReceiptNest AI Pricing — Free & Pro Receipt Plans');
    const monthly = Array.from(harness.routeNativeElement?.querySelectorAll('button') ?? [])
      .find(button => button.textContent?.trim() === 'Monthly');
    monthly?.click();
    harness.detectChanges();
    expect(monthly?.getAttribute('aria-pressed')).toBe('true');
    expect(harness.routeNativeElement?.textContent).toContain('$9');
  });

  it('shows a noindex not-found view for an unknown blog slug', async () => {
    const harness = await RouterTestingHarness.create('/blog/no-such-article-for-seo-test');
    const document = TestBed.inject(DOCUMENT);
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toContain('page');
    expect(document.title).toBe('Page Not Found | ReceiptNest AI');
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, follow');
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.querySelector('#json-ld-blog-article')).toBeNull();
  });
});
