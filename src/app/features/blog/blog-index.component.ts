import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SeoService } from '../../services/seo.service';
import { ThemeService } from '../../services/theme.service';
import { BlogCategory, blogCategories, blogPosts } from './blog-posts';

@Component({
  selector: 'app-blog-index',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './blog-index.component.html'
})
export class BlogIndexComponent {
  private readonly seo = inject(SeoService);
  private readonly theme = inject(ThemeService);

  readonly isDarkMode = this.theme.isDarkMode;
  readonly currentYear = new Date().getFullYear();
  readonly categories = blogCategories;
  readonly selectedCategory = signal<BlogCategory | 'All'>('All');
  readonly posts = blogPosts;
  readonly filteredPosts = computed(() => {
    const selected = this.selectedCategory();
    return selected === 'All' ? this.posts : this.posts.filter(post => post.category === selected);
  });

  constructor() {
    this.seo.apply({
      title: 'The ReceiptNest Blog | Receipts, Taxes, and Money Clarity',
      description:
        'Clarity on receipts, taxes, and money for freelancers and self-employed people. Read guides, comparisons, and receipt workflows from ReceiptNest AI.',
      canonicalPath: '/blog',
      keywords: 'receipt blog, freelancer receipts, self employed taxes, receipt tracker guides'
    });

    this.seo.setJsonLd('blog-index', {
      '@context': 'https://schema.org',
      '@type': 'Blog',
      '@id': this.seo.absoluteUrl('/blog#blog'),
      url: this.seo.absoluteUrl('/blog'),
      name: 'The ReceiptNest Blog',
      description: 'Clarity on receipts, taxes, and money for the self-employed.',
      publisher: {
        '@type': 'Organization',
        name: 'ReceiptNest AI',
        url: 'https://receipt-nest.com/'
      },
      blogPost: this.posts.map(post => ({
        '@type': 'BlogPosting',
        headline: post.title,
        url: this.seo.absoluteUrl(post.path),
        datePublished: post.datePublished,
        dateModified: post.dateModified
      }))
    });
  }

  selectCategory(category: BlogCategory | 'All'): void {
    this.selectedCategory.set(category);
  }

  toggleTheme(): void {
    this.theme.toggleTheme();
  }
}
