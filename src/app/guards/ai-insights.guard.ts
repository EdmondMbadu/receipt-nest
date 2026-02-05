import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';

import { AuthService } from '../services/auth.service';

export const aiInsightsGuard: CanActivateFn = async (): Promise<boolean | UrlTree> => {
  const authService = inject(AuthService);
  const router = inject(Router);

  await authService.waitForAuthState();
  await authService.waitForInitialization();

  const profile = authService.user();
  if (!profile) {
    return router.parseUrl('/login');
  }

  if (profile.role === 'admin' || profile.subscriptionPlan === 'pro') {
    return true;
  }

  return router.parseUrl('/app/pricing');
};
