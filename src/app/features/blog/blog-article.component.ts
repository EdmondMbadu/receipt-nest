import { CommonModule, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Component, OnDestroy, PLATFORM_ID, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { getBlogEditorial } from './blog-editorial';
import { PublicHeaderComponent } from '../../components/public-layout/public-header.component';
import { PublicFooterComponent } from '../../components/public-layout/public-footer.component';
import { SeoService } from '../../services/seo.service';
import { ThemeService } from '../../services/theme.service';
import { BlogBlock, BlogPost, getBlogPost, getRelatedPosts } from './blog-posts';

@Component({
  selector: 'app-blog-article',
  standalone: true,
  imports: [CommonModule, RouterLink, PublicHeaderComponent, PublicFooterComponent],
  templateUrl: './blog-article.component.html',
  styleUrl: './blog-article.component.css'
})
export class BlogArticleComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly seo = inject(SeoService);
  private readonly theme = inject(ThemeService);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);

  readonly isDarkMode = this.theme.isDarkMode;
  readonly currentYear = new Date().getFullYear();
  article: BlogPost = this.requirePost(this.route.snapshot.paramMap.get('slug'));
  editorial = getBlogEditorial(this.article.slug);
  relatedPosts = getRelatedPosts(this.article);
  private readonly routeSubscription: Subscription;

  constructor() {
    this.routeSubscription = this.route.paramMap.subscribe(paramMap => {
      this.article = this.requirePost(paramMap.get('slug'));
      this.editorial = getBlogEditorial(this.article.slug);
      this.relatedPosts = getRelatedPosts(this.article);
      this.applySeo();
      this.scrollToTop();
    });
  }

  private requirePost(slug: string | null): BlogPost {
    const post = getBlogPost(slug);
    // The route's canMatch guard sends unknown slugs to the real not-found view.
    if (!post) throw new Error('Unknown blog article');
    return post;
  }

  ngOnDestroy(): void {
    this.routeSubscription.unsubscribe();
  }

  private applySeo(): void {
    this.seo.apply({
      title: `${this.article.seoTitle} | ReceiptNest AI`,
      description: this.article.description,
      canonicalPath: this.article.path,
      image: this.article.image,
      imageAlt: this.article.imageAlt,
      imageWidth: this.article.imageWidth,
      imageHeight: this.article.imageHeight,
      authorName: 'ReceiptNest AI',
      type: 'article',
      publishedTime: this.article.datePublished,
      modifiedTime: this.article.dateModified,
      section: this.article.category,
      tags: this.article.keywords
    });

    this.seo.setJsonLd('blog-article', {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'BlogPosting',
          '@id': this.seo.absoluteUrl(`${this.article.path}#article`),
          url: this.seo.absoluteUrl(this.article.path),
          mainEntityOfPage: {
            '@type': 'WebPage',
            '@id': this.seo.absoluteUrl(`${this.article.path}#webpage`)
          },
          headline: this.article.title,
          description: this.article.description,
          image: {
            '@type': 'ImageObject',
            url: this.seo.absoluteUrl(this.article.image),
            ...(this.article.imageWidth ? { width: this.article.imageWidth } : {}),
            ...(this.article.imageHeight ? { height: this.article.imageHeight } : {})
          },
          datePublished: this.article.datePublished,
          dateModified: this.article.dateModified,
          articleSection: this.article.category,
          keywords: this.article.keywords.join(', '),
          inLanguage: 'en-US',
          isPartOf: {
            '@id': this.seo.absoluteUrl('/blog#blog')
          },
          author: {
            '@type': 'Organization',
            name: 'ReceiptNest AI',
            url: 'https://receipt-nest.com/about'
          },
          publisher: {
            '@type': 'Organization',
            name: 'ReceiptNest AI',
            logo: {
              '@type': 'ImageObject',
              url: this.seo.absoluteUrl('/assets/receipt-nest.png')
            }
          }
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            {
              '@type': 'ListItem',
              position: 1,
              name: 'ReceiptNest AI',
              item: 'https://receipt-nest.com/'
            },
            {
              '@type': 'ListItem',
              position: 2,
              name: 'Blog',
              item: this.seo.absoluteUrl('/blog')
            },
            {
              '@type': 'ListItem',
              position: 3,
              name: this.article.title,
              item: this.seo.absoluteUrl(this.article.path)
            }
          ]
        }
      ]
    });
  }

  private scrollToTop(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'auto' }));
  }

  calloutClasses(block: BlogBlock): string {
    if (block.kind !== 'callout') {
      return '';
    }

    const base = 'article-callout rounded-r-xl border-l-4 px-5 py-4';
    const tones = {
      note: 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200',
      tip: 'border-emerald-600 bg-emerald-50 text-emerald-950 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-100',
      warning: 'border-amber-500 bg-amber-50 text-amber-950 dark:border-amber-400 dark:bg-amber-950/35 dark:text-amber-100'
    };

    return `${base} ${tones[block.tone ?? 'note']}`;
  }

  scrollToSection(sectionId: string): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const section = this.document.getElementById(sectionId);
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  toggleTheme(): void {
    this.theme.toggleTheme();
  }
}
