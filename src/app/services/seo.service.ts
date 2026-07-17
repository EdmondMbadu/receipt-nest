import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

export interface SeoPageMeta {
  title: string;
  description: string;
  canonicalPath: string;
  keywords?: string;
  image?: string;
  imageAlt?: string;
  robots?: string;
  type?: 'website' | 'article';
}

const SITE_URL = 'https://receipt-nest.com';
const SITE_NAME = 'ReceiptNest AI';
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
    const canonicalUrl = this.absoluteUrl(meta.canonicalPath);
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
    this.meta.updateTag({ name: 'author', content: SITE_NAME });
    this.meta.updateTag({ name: 'application-name', content: SITE_NAME });

    if (meta.keywords) {
      this.meta.updateTag({ name: 'keywords', content: meta.keywords });
    }

    this.meta.updateTag({ property: 'og:type', content: meta.type ?? 'website' }, "property='og:type'");
    this.meta.updateTag({ property: 'og:url', content: canonicalUrl }, "property='og:url'");
    this.meta.updateTag({ property: 'og:title', content: meta.title }, "property='og:title'");
    this.meta.updateTag({ property: 'og:description', content: meta.description }, "property='og:description'");
    this.meta.updateTag({ property: 'og:image', content: image }, "property='og:image'");
    this.meta.updateTag({ property: 'og:image:alt', content: imageAlt }, "property='og:image:alt'");
    this.meta.updateTag({ property: 'og:image:width', content: '1200' }, "property='og:image:width'");
    this.meta.updateTag({ property: 'og:image:height', content: '630' }, "property='og:image:height'");
    this.meta.updateTag({ property: 'og:image:type', content: imageType }, "property='og:image:type'");
    this.meta.updateTag({ property: 'og:site_name', content: SITE_NAME }, "property='og:site_name'");
    this.meta.updateTag({ property: 'og:locale', content: 'en_US' }, "property='og:locale'");

    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.meta.updateTag({ name: 'twitter:url', content: canonicalUrl });
    this.meta.updateTag({ name: 'twitter:title', content: meta.title });
    this.meta.updateTag({ name: 'twitter:description', content: meta.description });
    this.meta.updateTag({ name: 'twitter:image', content: image });
    this.meta.updateTag({ name: 'twitter:image:alt', content: imageAlt });

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

    script.text = JSON.stringify(data);
  }

  absoluteUrl(path: string): string {
    if (path.startsWith('http')) {
      return path;
    }

    return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private updateCanonical(url: string): void {
    let canonical = this.document.querySelector<HTMLLinkElement>('link[rel="canonical"]');

    if (!canonical) {
      canonical = this.document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      this.document.head.appendChild(canonical);
    }

    canonical.setAttribute('href', url);
  }
}
