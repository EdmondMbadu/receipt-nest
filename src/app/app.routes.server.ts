import { RenderMode, ServerRoute } from '@angular/ssr';

import { blogPosts } from './features/blog/blog-posts';

export const serverRoutes: ServerRoute[] = [
  {
    path: '',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'login',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'email-verified',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'register',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'receipt-tracker',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'receipt-organizer',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'receipt-scanner',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'receipt-management-software',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'expense-tracker',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'tax-receipt-organizer',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'blog',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'blog/:slug',
    renderMode: RenderMode.Prerender,
    async getPrerenderParams() {
      return blogPosts.map(post => ({ slug: post.slug }));
    }
  },
  {
    path: 'support',
    renderMode: RenderMode.Prerender
  },
  {
    path: 'terms',
    renderMode: RenderMode.Prerender
  },
  {
    path: '**',
    renderMode: RenderMode.Client
  }
];
