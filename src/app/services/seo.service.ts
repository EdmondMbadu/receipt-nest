import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { DEFAULT_FREE_PLAN_RECEIPT_LIMIT } from '../config/subscription.constants';
import { SITE_NAME, SITE_URL } from '../content/public-pages';

export interface SeoPageMeta {
  title: string;
  description: string;
  canonicalPath: string | null;
  keywords?: string;
  image?: string;
  imageAlt?: string;
  imageWidth?: number;
  imageHeight?: number;
  authorName?: string;
  robots?: string;
  type?: 'website' | 'article';
  publishedTime?: string;
  modifiedTime?: string;
  section?: string;
  tags?: readonly string[];
}

const DEFAULT_IMAGE = `${SITE_URL}/assets/og-image.png`;
const DEFAULT_IMAGE_ALT = 'ReceiptNest AI receipt organizer and receipt tracking dashboard';

@Injectable({
  providedIn: 'root'
})
export class SeoService {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);

  apply(meta: SeoPageMeta): void {
    this.clearPageJsonLd();
    const canonicalUrl = meta.canonicalPath === null ? null : this.absoluteUrl(meta.canonicalPath);
    const image = this.absoluteUrl(meta.image ?? DEFAULT_IMAGE);
    const imageType = /\.jpe?g(?:$|\?)/i.test(image)
      ? 'image/jpeg'
      : /\.webp(?:$|\?)/i.test(image)
        ? 'image/webp'
        : 'image/png';
    const imageAlt = meta.imageAlt ?? DEFAULT_IMAGE_ALT;
    const robots = meta.robots ?? 'index, follow';

    this.title.setTitle(meta.title);
    this.meta.updateTag({ name: 'description', content: meta.description });
    this.meta.updateTag({ name: 'robots', content: robots });
    this.meta.updateTag({
      name: 'googlebot',
      content: `${robots}, max-image-preview:large, max-snippet:-1, max-video-preview:-1`
    });
    this.meta.updateTag({ name: 'author', content: meta.authorName ?? SITE_NAME });
    this.meta.updateTag({ name: 'application-name', content: SITE_NAME });

    if (meta.keywords) {
      this.meta.updateTag({ name: 'keywords', content: meta.keywords });
    } else {
      this.meta.removeTag("name='keywords'");
    }

    this.meta.updateTag({ property: 'og:type', content: meta.type ?? 'website' }, "property='og:type'");
    if (canonicalUrl) {
      this.meta.updateTag({ property: 'og:url', content: canonicalUrl }, "property='og:url'");
      this.meta.updateTag({ name: 'twitter:url', content: canonicalUrl });
    } else {
      this.meta.removeTag("property='og:url'");
      this.meta.removeTag("name='twitter:url'");
    }
    this.meta.updateTag({ property: 'og:title', content: meta.title }, "property='og:title'");
    this.meta.updateTag({ property: 'og:description', content: meta.description }, "property='og:description'");
    this.meta.updateTag({ property: 'og:image', content: image }, "property='og:image'");
    this.meta.updateTag({ property: 'og:image:alt', content: imageAlt }, "property='og:image:alt'");
    const width = meta.imageWidth ?? (image === DEFAULT_IMAGE ? 1200 : undefined);
    const height = meta.imageHeight ?? (image === DEFAULT_IMAGE ? 630 : undefined);
    for (const [key, value] of [['width', width], ['height', height]] as const) {
      if (value) {
        this.meta.updateTag({ property: 'og:image:' + key, content: String(value) });
      } else {
        this.meta.removeTag("property='og:image:" + key + "'");
      }
    }
    this.meta.updateTag({ property: 'og:image:type', content: imageType }, "property='og:image:type'");
    this.meta.updateTag({ property: 'og:site_name', content: SITE_NAME }, "property='og:site_name'");
    this.meta.updateTag({ property: 'og:locale', content: 'en_US' }, "property='og:locale'");

    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.meta.updateTag({ name: 'twitter:title', content: meta.title });
    this.meta.updateTag({ name: 'twitter:description', content: meta.description });
    this.meta.updateTag({ name: 'twitter:image', content: image });
    this.meta.updateTag({ name: 'twitter:image:alt', content: imageAlt });
    this.meta.updateTag({ name: 'twitter:site', content: '@ReceiptNestAI' });

    this.document.querySelectorAll('meta[property^="article:"]').forEach(tag => tag.remove());
    if (meta.type === 'article') {
      if (meta.publishedTime) {
        this.meta.updateTag(
          { property: 'article:published_time', content: meta.publishedTime },
          "property='article:published_time'"
        );
      }
      if (meta.modifiedTime) {
        this.meta.updateTag(
          { property: 'article:modified_time', content: meta.modifiedTime },
          "property='article:modified_time'"
        );
      }
      if (meta.section) {
        this.meta.updateTag(
          { property: 'article:section', content: meta.section },
          "property='article:section'"
        );
      }
      this.meta.removeTag("property='article:tag'");
      meta.tags?.forEach(tag => {
        this.meta.addTag({ property: 'article:tag', content: tag });
      });
    } else {
      this.meta.removeTag("property='article:published_time'");
      this.meta.removeTag("property='article:modified_time'");
      this.meta.removeTag("property='article:section'");
      this.meta.removeTag("property='article:tag'");
    }

    this.updateCanonical(canonicalUrl);
  }

  setJsonLd(id: string, data: unknown): void {
    const scriptId = `json-ld-${id}`;
    let script = this.document.getElementById(scriptId) as HTMLScriptElement | null;

    if (!script) {
      script = this.document.createElement('script');
      script.type = 'application/ld+json';
      script.id = scriptId;
      this.document.head.appendChild(script);
    }

    script.text = JSON.stringify(data).replace(/</g, '\\u003c');
    script.setAttribute('data-seo-scope', 'page');
  }

  private clearPageJsonLd(): void {
    this.document.querySelectorAll('script[data-seo-scope="page"], script[id^="json-ld-"]')
      .forEach(script => script.remove());
  }

  setSoftwareApplication(): void {
    this.setJsonLd('software-application', {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      '@id': SITE_URL + '/#app',
      name: SITE_NAME,
      url: SITE_URL,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, iOS, Android',
      description: 'Capture, organize, review, and export receipts from photos, PDFs, and forwarded emails.',
      publisher: { '@id': SITE_URL + '/#organization' },
      offers: {
        '@type': 'Offer',
        name: 'Starter',
        price: '0',
        priceCurrency: 'USD',
        url: SITE_URL + '/pricing',
        description: 'Up to ' + DEFAULT_FREE_PLAN_RECEIPT_LIMIT + ' receipts with CSV export.'
      },
      installUrl: [
        'https://apps.apple.com/us/app/receiptnest-ai/id6762539388',
        'https://play.google.com/store/apps/details?id=com.receiptnest.mobile'
      ]
    });
  }

  absoluteUrl(path: string): string {
    if (path.startsWith('http')) {
      return path;
    }

    return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private updateCanonical(url: string | null): void {
    if (url === null) {
      this.document.querySelectorAll('link[rel="canonical"]').forEach(link => link.remove());
      return;
    }
    let canonical = this.document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    this.document.querySelectorAll('link[rel="canonical"]').forEach(link => {
      if (link !== canonical) link.remove();
    });

    if (!canonical) {
      canonical = this.document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      this.document.head.appendChild(canonical);
    }

    canonical.setAttribute('href', url);
  }
}
