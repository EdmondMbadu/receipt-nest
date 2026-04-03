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
    title: 'ReceiptNest AI | Receipt Organizer & Expense Tracker',
    loadComponent: () => import('./features/landing/landing.component').then((m) => m.LandingComponent)
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
    title: 'Support',
    loadComponent: () => import('./features/support/support.component').then((m) => m.SupportComponent)
  },
  {
    path: 'terms',
    title: 'Terms and Conditions',
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
