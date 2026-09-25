import { EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import { CanActivateFn, CanMatchFn, GuardResult, MaybeAsync, Routes } from '@angular/router';
import { getPublicPage, workflowPages, informationPages } from './content/public-pages';
import { firstValueFrom, isObservable } from 'rxjs';

function toGuardResultPromise(result: MaybeAsync<GuardResult>): Promise<GuardResult> {
  if (isObservable(result)) {
    return firstValueFrom(result);
  }
  return Promise.resolve(result);
}

const lazyAuthGuard: CanActivateFn = (route, state) => {
  const injector = inject(EnvironmentInjector);
  return import('./guards/auth.guard')
    .then(({ authGuard }) => runInInjectionContext(injector, () => authGuard(route, state)))
    .then(toGuardResultPromise);
};

const lazyAdminGuard: CanActivateFn = (route, state) => {
  const injector = inject(EnvironmentInjector);
  return import('./guards/admin.guard')
    .then(({ adminGuard }) => runInInjectionContext(injector, () => adminGuard(route, state)))
    .then(toGuardResultPromise);
};

const knownBlogPost: CanMatchFn = async (_route, segments) => {
  const { getBlogPost } = await import('./features/blog/blog-posts');
  return !!getBlogPost(segments[1]?.path);
};

export const routes: Routes = [
  {
    path: '',
    title: getPublicPage('/').title,
    loadComponent: () => import('./features/landing/landing.component').then((m) => m.LandingComponent)
  },
  ...workflowPages.map(page => ({
    path: page.path.slice(1),
    title: page.title,
    data: { page: page.path.slice(1) },
    loadComponent: () => import('./features/seo-page/seo-page.component').then(m => m.SeoPageComponent)
  })),
  ...informationPages.map(page => ({
    path: page.path.slice(1),
    title: page.title,
    data: { page: page.path.slice(1) },
    loadComponent: () => import('./features/public-info/public-info.component').then(m => m.PublicInfoComponent)
  })),
  {
    path: 'blog',
    title: getPublicPage('/blog').title,
    loadComponent: () => import('./features/blog/blog-index.component').then((m) => m.BlogIndexComponent)
  },
  {
    path: 'blog/:slug',
    canMatch: [knownBlogPost],
    loadComponent: () => import('./features/blog/blog-article.component').then((m) => m.BlogArticleComponent)
  },
  {
    path: 'app/pricing',
    title: 'Pricing',
    canActivate: [lazyAuthGuard],
    loadComponent: () => import('./features/pricing/pricing.component').then((m) => m.PricingComponent)
  },
  {
    path: 'app/receipt/:id',
    title: 'Receipt Details',
    canActivate: [lazyAuthGuard],
    loadComponent: () => import('./features/receipt-detail/receipt-detail.component').then((m) => m.ReceiptDetailComponent)
  },
  {
    path: 'app/admin',
    title: 'Admin',
    canActivate: [lazyAdminGuard],
    loadComponent: () => import('./features/admin/admin.component').then((m) => m.AdminComponent)
  },
  {
    path: 'app',
    canActivate: [lazyAuthGuard],
    loadComponent: () => import('./features/app-shell/app-shell.component').then((m) => m.AppShellComponent),
    children: [
      {
        path: '',
        title: 'Home',
        loadComponent: () => import('./features/home/home.component').then((m) => m.HomeComponent)
      },
      {
        path: 'insights',
        title: 'Insights',
        loadComponent: () => import('./features/ai-insights/ai-insights.component').then((m) => m.AiInsightsComponent)
      },
      {
        path: 'categories/:id',
        title: 'Category Details',
        loadComponent: () => import('./features/folders/category-detail.component').then((m) => m.CategoryDetailComponent)
      },
      {
        path: 'folders/:id',
        title: 'Folder Details',
        loadComponent: () => import('./features/folders/folder-detail.component').then((m) => m.FolderDetailComponent)
      },
      {
        path: 'folders',
        title: 'Folders',
        loadComponent: () => import('./features/folders/folders.component').then((m) => m.FoldersComponent)
      }
    ]
  },
  {
    path: 'home',
    title: 'Home',
    canActivate: [lazyAuthGuard],
    loadComponent: () => import('./features/home/home.component').then((m) => m.HomeComponent)
  },
  {
    path: 'login',
    title: 'Sign In',
    loadComponent: () => import('./features/auth/login/login.component').then((m) => m.LoginComponent)
  },
  {
    path: 'email-verified',
    title: 'Email Verified',
    data: { verificationReturn: true },
    loadComponent: () => import('./features/auth/login/login.component').then((m) => m.LoginComponent)
  },
  {
    path: 'register',
    title: 'Create Account',
    loadComponent: () => import('./features/auth/register/register.component').then((m) => m.RegisterComponent)
  },
  {
    path: 'verify',
    title: 'Verify Email',
    loadComponent: () => import('./features/auth/verify/verify-email.component').then((m) => m.VerifyEmailComponent)
  },
  {
    path: 'reset-password',
    title: 'Reset Password',
    loadComponent: () =>
      import('./features/auth/reset-password/reset-password.component').then((m) => m.ResetPasswordComponent)
  },
  {
    path: 'share/:id',
    title: 'Shared View',
    loadComponent: () => import('./features/share/share-view.component').then((m) => m.ShareViewComponent)
  },
  {
    path: 'mobile-return/:flow',
    title: 'Open ReceiptNest',
    loadComponent: () =>
      import('./features/mobile-return/mobile-return.component').then((m) => m.MobileReturnComponent)
  },
  {
    path: 'support',
    title: getPublicPage('/support').title,
    loadComponent: () => import('./features/support/support.component').then((m) => m.SupportComponent)
  },
  {
    path: 'feedback',
    title: 'Feedback',
    loadComponent: () => import('./features/feedback/feedback.component').then((m) => m.FeedbackComponent)
  },
  {
    path: 'terms',
    title: getPublicPage('/terms').title,
    loadComponent: () => import('./features/terms/terms.component').then((m) => m.TermsComponent)
  },
  {
    path: 'goodbye',
    title: 'Goodbye',
    loadComponent: () => import('./features/goodbye/goodbye.component').then((m) => m.GoodbyeComponent)
  },
  {
    path: 'unsubscribe',
    title: 'Unsubscribe',
    loadComponent: () =>
      import('./features/unsubscribe/unsubscribe.component').then((m) => m.UnsubscribeComponent)
  },
  {
    path: '**',
    title: 'Page Not Found | ReceiptNest',
    loadComponent: () => import('./features/not-found/not-found.component').then(m => m.NotFoundComponent)
  }
];
