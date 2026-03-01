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
    loadComponent: () => import('./features/landing/landing.component').then((m) => m.LandingComponent)
  },
  {
    path: 'app/pricing',
    canActivate: [lazyAuthGuard],
    loadComponent: () => import('./features/pricing/pricing.component').then((m) => m.PricingComponent)
  },
  {
    path: 'app/receipt/:id',
    canActivate: [lazyAuthGuard],
    loadComponent: () => import('./features/receipt-detail/receipt-detail.component').then((m) => m.ReceiptDetailComponent)
  },
  {
    path: 'app/admin',
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
        loadComponent: () => import('./features/home/home.component').then((m) => m.HomeComponent)
      },
      {
        path: 'insights',
        loadComponent: () => import('./features/ai-insights/ai-insights.component').then((m) => m.AiInsightsComponent)
      },
      {
        path: 'folders/:id',
        loadComponent: () => import('./features/folders/folder-detail.component').then((m) => m.FolderDetailComponent)
      },
      {
        path: 'folders',
        loadComponent: () => import('./features/folders/folders.component').then((m) => m.FoldersComponent)
      }
    ]
  },
  {
    path: 'home',
    canActivate: [lazyAuthGuard],
    loadComponent: () => import('./features/home/home.component').then((m) => m.HomeComponent)
  },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login/login.component').then((m) => m.LoginComponent)
  },
  {
    path: 'register',
    loadComponent: () => import('./features/auth/register/register.component').then((m) => m.RegisterComponent)
  },
  {
    path: 'verify',
    loadComponent: () => import('./features/auth/verify/verify-email.component').then((m) => m.VerifyEmailComponent)
  },
  {
    path: 'share/:id',
    loadComponent: () => import('./features/share/share-view.component').then((m) => m.ShareViewComponent)
  },
  {
    path: 'support',
    loadComponent: () => import('./features/support/support.component').then((m) => m.SupportComponent)
  },
  {
    path: 'terms',
    loadComponent: () => import('./features/terms/terms.component').then((m) => m.TermsComponent)
  },
  {
    path: 'goodbye',
    loadComponent: () => import('./features/goodbye/goodbye.component').then((m) => m.GoodbyeComponent)
  },
  {
    path: '**',
    redirectTo: ''
  }
];
