import { EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import { CanActivateFn, GuardResult, MaybeAsync, Routes } from '@angular/router';
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

export const routes: Routes = [
  {
    path: '',
    title: 'ReceiptNest AI | Receipt Organizer, Receipt Tracker & Expense Tracker',
    loadComponent: () => import('./features/landing/landing.component').then((m) => m.LandingComponent)
  },
  {
    path: 'receipt-tracker',
    title: 'Receipt Tracker App for Organized Expenses | ReceiptNest AI',
    data: { page: 'receipt-tracker' },
    loadComponent: () => import('./features/seo-page/seo-page.component').then((m) => m.SeoPageComponent)
  },
  {
    path: 'receipt-organizer',
    title: 'Receipt Organizer App for Email, Photos, and PDFs | ReceiptNest AI',
    data: { page: 'receipt-organizer' },
    loadComponent: () => import('./features/seo-page/seo-page.component').then((m) => m.SeoPageComponent)
  },
  {
    path: 'receipt-scanner',
    title: 'Receipt Scanner App with AI Organization | ReceiptNest AI',
    data: { page: 'receipt-scanner' },
    loadComponent: () => import('./features/seo-page/seo-page.component').then((m) => m.SeoPageComponent)
  },
  {
    path: 'receipt-management-software',
    title: 'Receipt Management Software for Simple Expense Records | ReceiptNest AI',
    data: { page: 'receipt-management-software' },
    loadComponent: () => import('./features/seo-page/seo-page.component').then((m) => m.SeoPageComponent)
  },
  {
    path: 'expense-tracker',
    title: 'Expense Tracker Built Around Receipts | ReceiptNest AI',
    data: { page: 'expense-tracker' },
    loadComponent: () => import('./features/seo-page/seo-page.component').then((m) => m.SeoPageComponent)
  },
  {
    path: 'tax-receipt-organizer',
    title: 'Tax Receipt Organizer for Export-Ready Records | ReceiptNest AI',
    data: { page: 'tax-receipt-organizer' },
    loadComponent: () => import('./features/seo-page/seo-page.component').then((m) => m.SeoPageComponent)
  },
  {
    path: 'blog',
    title: 'The ReceiptNest Blog | Receipts, Taxes, and Money Clarity',
    loadComponent: () => import('./features/blog/blog-index.component').then((m) => m.BlogIndexComponent)
  },
  {
    path: 'blog/:slug',
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
    title: 'Open ReceiptNest AI',
    loadComponent: () =>
      import('./features/mobile-return/mobile-return.component').then((m) => m.MobileReturnComponent)
  },
  {
    path: 'support',
    title: 'Support | ReceiptNest AI',
    loadComponent: () => import('./features/support/support.component').then((m) => m.SupportComponent)
  },
  {
    path: 'feedback',
    title: 'Feedback',
    loadComponent: () => import('./features/feedback/feedback.component').then((m) => m.FeedbackComponent)
  },
  {
    path: 'terms',
    title: 'Terms and Conditions | ReceiptNest AI',
    loadComponent: () => import('./features/terms/terms.component').then((m) => m.TermsComponent)
  },
  {
    path: 'goodbye',
    title: 'Goodbye',
    loadComponent: () => import('./features/goodbye/goodbye.component').then((m) => m.GoodbyeComponent)
  },
  {
    path: '**',
    redirectTo: ''
  }
];
