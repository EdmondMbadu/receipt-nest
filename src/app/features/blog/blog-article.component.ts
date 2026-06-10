import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { SeoService } from '../../services/seo.service';
import { ThemeService } from '../../services/theme.service';
import { BlogBlock, BlogPost, blogPosts, getBlogPost, getRelatedPosts } from './blog-posts';

@Component({
  selector: 'app-blog-article',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './blog-article.component.html'
})
export class BlogArticleComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly seo = inject(SeoService);
  private readonly theme = inject(ThemeService);

  readonly isDarkMode = this.theme.isDarkMode;
  readonly currentYear = new Date().getFullYear();
  readonly article: BlogPost = getBlogPost(this.route.snapshot.paramMap.get('slug')) ?? blogPosts[0];
  readonly relatedPosts = getRelatedPosts(this.article);

  constructor() {
    this.seo.apply({
      title: `${this.article.seoTitle} | ReceiptNest AI`,
      description: this.article.description,
      canonicalPath: this.article.path,
      image: this.article.image,
      imageAlt: this.article.imageAlt,
      keywords: this.article.keywords.join(', '),
      type: 'article'
    });

    this.seo.setJsonLd(`blog-${this.article.slug}`, {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Article',
          '@id': this.seo.absoluteUrl(`${this.article.path}#article`),
          mainEntityOfPage: this.seo.absoluteUrl(this.article.path),
          headline: this.article.title,
          description: this.article.description,
          image: this.seo.absoluteUrl(this.article.image),
          datePublished: this.article.datePublished,
          dateModified: this.article.dateModified,
          author: {
            '@type': 'Organization',
            name: 'The ReceiptNest Team',
            url: 'https://receipt-nest.com/'
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
          '@type': 'FAQPage',
          '@id': this.seo.absoluteUrl(`${this.article.path}#faq`),
          mainEntity: this.article.faq.map(item => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: {
              '@type': 'Answer',
              text: item.answer
            }
          }))
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

  calloutClasses(block: BlogBlock): string {
    if (block.kind !== 'callout') {
      return '';
    }

    const base = 'rounded-2xl border p-5';
    const tones = {
      note: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200',
      tip: 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100',
      warning: 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/35 dark:text-amber-100'
    };

    return `${base} ${tones[block.tone ?? 'note']}`;
  }

  toggleTheme(): void {
    this.theme.toggleTheme();
  }
}
