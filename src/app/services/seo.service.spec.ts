import { DOCUMENT } from '@angular/common';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SeoService } from './seo.service';

describe('SeoService route metadata', () => {
  let service: SeoService;
  let document: Document;
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    service = TestBed.inject(SeoService);
    document = TestBed.inject(DOCUMENT);
  });
  afterEach(() => service.apply({ title: 'Test', description: '', canonicalPath: null, robots: 'noindex' }));

  it('clears article metadata and page schema when navigating to a product page', () => {
    service.apply({ title: 'Guide', description: 'Guide description', canonicalPath: '/blog/guide',
      type: 'article', publishedTime: '2026-01-01', tags: ['one', 'two'], image: '/custom.jpg',
      imageWidth: 640, imageHeight: 480, keywords: 'old keyword' });
    service.setJsonLd('guide', { '@type': 'BlogPosting' });
    service.apply({ title: 'Receipts', description: 'Product description', canonicalPath: '/receipt-tracker' });
    service.setSoftwareApplication();
    expect(document.querySelector('meta[property^="article:"]')).toBeNull();
    expect(document.querySelector('meta[name="keywords"]')).toBeNull();
    expect(document.querySelector('#json-ld-guide')).toBeNull();
    expect(document.querySelectorAll('script[data-seo-scope="page"]').length).toBe(1);
    expect(document.querySelector('meta[property="og:image:width"]')?.getAttribute('content')).toBe('1200');
  });

  it('removes canonical and social URLs for private routes without exposing their parameters', () => {
    service.apply({ title: 'Public', description: 'Public', canonicalPath: '/' });
    service.setSoftwareApplication();
    service.apply({ title: 'Account', description: 'Account', canonicalPath: null, robots: 'noindex, follow' });
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.querySelector('meta[property="og:url"]')).toBeNull();
    expect(document.querySelector('meta[name="twitter:url"]')).toBeNull();
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, follow');
    expect(document.querySelector('script[data-seo-scope="page"]')).toBeNull();
  });

  it('does not reuse default image dimensions for an image with unknown dimensions', () => {
    service.apply({ title: 'Page', description: 'Page', canonicalPath: '/' });
    service.apply({ title: 'Guide', description: 'Guide', canonicalPath: '/blog/guide', image: '/custom.jpg' });
    expect(document.querySelector('meta[property="og:image:width"]')).toBeNull();
    expect(document.querySelector('meta[property="og:image:height"]')).toBeNull();
  });

  it('emits a single canonical and safely serializes structured content', () => {
    const duplicate = document.createElement('link');
    duplicate.rel = 'canonical';
    document.head.appendChild(duplicate);
    service.apply({ title: 'Page', description: 'Page', canonicalPath: '/receipt-to-csv' });
    service.setJsonLd('test', { text: '<script>example</script>' });
    expect(document.querySelectorAll('link[rel="canonical"]').length).toBe(1);
    const content = document.querySelector('#json-ld-test')?.textContent ?? '';
    expect(content).not.toContain('<script>');
    expect(JSON.parse(content).text).toBe('<script>example</script>');
  });
});
