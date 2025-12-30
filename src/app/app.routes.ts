import { Routes } from '@angular/router';

import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/landing/landing.component').then((m) => m.LandingComponent)
  },
  {
    path: 'app',
    canActivate: [authGuard],
    loadComponent: () => import('./features/home/home.component').then((m) => m.HomeComponent)
  },
  {
    path: 'app/receipt/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./features/receipt-detail/receipt-detail.component').then((m) => m.ReceiptDetailComponent)
  },
  {
    path: 'home',
    canActivate: [authGuard],
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
    path: '**',
    redirectTo: ''
  }
];
