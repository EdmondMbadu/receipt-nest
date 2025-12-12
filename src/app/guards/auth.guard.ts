import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';

import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = async (): Promise<boolean | UrlTree> => {
  const authService = inject(AuthService);
  const router = inject(Router);

  await authService.waitForAuthState();
  await authService.waitForInitialization();

  if (authService.isAuthenticated()) {
    return true;
  }

  return router.parseUrl('/login');
};
