import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { getPublicPage } from '../../content/public-pages';
import { PublicHeaderComponent } from '../../components/public-layout/public-header.component';
import { PublicFooterComponent } from '../../components/public-layout/public-footer.component';
import { SeoService } from '../../services/seo.service';
import { ThemeService } from '../../services/theme.service';
import { BlogCategory, blogCategories, blogPosts } from './blog-posts';

@Component({
  selector: 'app-blog-index',
  standalone: true,
  imports: [CommonModule, RouterLink, PublicHeaderComponent, PublicFooterComponent],
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
  readonly featuredPost = blogPosts[0];
  readonly remainingPosts = blogPosts.slice(1);
  readonly filteredPosts = computed(() => {
    const selected = this.selectedCategory();
    return selected === 'All' ? this.posts : this.posts.filter(post => post.category === selected);
  });

  constructor() {
    const page = getPublicPage('/blog');
    this.seo.apply({ title: page.title, description: page.description, canonicalPath: page.path });

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
        description: post.description,
        image: this.seo.absoluteUrl(post.image),
        datePublished: post.datePublished,
        dateModified: post.dateModified,
        articleSection: post.category,
        inLanguage: 'en-US'
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
