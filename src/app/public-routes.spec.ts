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
    expect(document.title).toBe('ReceiptNest Pricing — Free & Pro Receipt Plans');
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
    expect(document.title).toBe('Page Not Found | ReceiptNest');
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, follow');
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.querySelector('#json-ld-blog-article')).toBeNull();
  });

  it('keeps timezone-aware video metadata and the visible player in sync across navigation', async () => {
    const harness = await RouterTestingHarness.create('/blog/why-do-receipts-fade');
    const document = TestBed.inject(DOCUMENT);
    const video = () => JSON.parse(document.querySelector('#json-ld-blog-article')!.textContent!)['@graph']
      .find((node: Record<string, unknown>) => node['@type'] === 'VideoObject');
    expect(video().uploadDate).toBe('2026-10-18T14:04:43-07:00');
    expect(harness.routeNativeElement?.querySelector('iframe')?.getAttribute('src')).toBe(video().embedUrl);
    await harness.navigateByUrl('/blog/can-bank-statements-replace-receipts');
    expect(video().uploadDate).toBe('2026-10-17T15:48:04-07:00');
    expect(harness.routeNativeElement?.querySelector('iframe')?.getAttribute('src')).toBe(video().embedUrl);
    await harness.navigateByUrl('/getting-started');
    expect(document.querySelector('#json-ld-blog-article')).toBeNull();
    const tutorial = JSON.parse(document.querySelector('#json-ld-getting-started-video')!.textContent!);
    expect(tutorial.uploadDate).toMatch(/T\d{2}:\d{2}:\d{2}Z$/);
    expect(new URL(harness.routeNativeElement!.querySelector('video source')!.getAttribute('src')!, 'https://receipt-nest.com').href).toBe(tutorial.contentUrl);
  });
});
