type AuthErrorContext = 'login' | 'register' | 'password-reset' | 'provider';

const CREDENTIAL_ERROR_CODES = new Set([
  'auth/invalid-credential',
  'auth/invalid-login-credentials',
  'auth/user-not-found',
  'auth/wrong-password'
]);

export function getAuthErrorMessage(
  error: unknown,
  context: AuthErrorContext,
  fallback: string
): string {
  const code = getErrorCode(error);

  if (CREDENTIAL_ERROR_CODES.has(code)) {
    return 'Wrong email or password. Please try again.';
  }

  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account already exists with this email. Try signing in instead.';
    case 'auth/invalid-email':
      return 'Enter a valid email address and try again.';
    case 'auth/weak-password':
      return 'Choose a stronger password with at least 6 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment, then try again or reset your password.';
    case 'auth/network-request-failed':
      return 'We could not reach the sign-in service. Check your connection and try again.';
    case 'auth/popup-closed-by-user':
      return context === 'provider' ? 'Sign-in was canceled. Please try again when you are ready.' : fallback;
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in window. Allow popups and try again.';
    case 'auth/expired-action-code':
    case 'auth/invalid-action-code':
      return 'This link has expired or is no longer valid. Request a new link and try again.';
  }

  if (code.startsWith('auth/') || code.startsWith('functions/')) {
    return fallback;
  }

  const message = getNonTechnicalMessage(error);
  return message || fallback;
}

function getErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return '';
  }

  return typeof error.code === 'string' ? error.code : '';
}

function getNonTechnicalMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return '';
  }

  const message = error.message.trim();
  if (!message || /firebase|auth\/|functions\//i.test(message)) {
    return '';
  }

  return message;
}
