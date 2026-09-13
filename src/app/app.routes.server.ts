import { RenderMode, ServerRoute } from '@angular/ssr';
import { blogPosts } from './features/blog/blog-posts';
import { publicPages } from './content/public-pages';

export const serverRoutes: ServerRoute[] = [
  ...publicPages.map((page): ServerRoute => ({
    path: page.path.slice(1),
    renderMode: RenderMode.Prerender
  })),
  ...['login', 'email-verified', 'register'].map((path): ServerRoute => ({
    path,
    renderMode: RenderMode.Prerender
  })),
  {
    path: 'blog/:slug',
    renderMode: RenderMode.Prerender,
    async getPrerenderParams() {
      return blogPosts.map(post => ({ slug: post.slug }));
    }
  },
  { path: '**', renderMode: RenderMode.Client }
];
