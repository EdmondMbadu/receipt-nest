import { getAuthErrorMessage } from './auth-error.utils';

describe('getAuthErrorMessage', () => {
  it('turns invalid credentials into a clear login message', () => {
    const error = Object.assign(new Error('Firebase: Error (auth/invalid-credential).'), {
      code: 'auth/invalid-credential'
    });

    expect(getAuthErrorMessage(error, 'login', 'Fallback')).toBe(
      'Wrong email or password. Please try again.'
    );
  });

  it('does not expose unknown Firebase authentication errors', () => {
    const error = Object.assign(new Error('Firebase: Error (auth/internal-error).'), {
      code: 'auth/internal-error'
    });

    expect(getAuthErrorMessage(error, 'login', 'Please try again.')).toBe('Please try again.');
  });

  it('provides a useful account creation message for duplicate emails', () => {
    const error = Object.assign(new Error('Firebase: Error (auth/email-already-in-use).'), {
      code: 'auth/email-already-in-use'
    });

    expect(getAuthErrorMessage(error, 'register', 'Fallback')).toBe(
      'An account already exists with this email. Try signing in instead.'
    );
  });

  it('preserves intentional non-technical application messages', () => {
    expect(getAuthErrorMessage(new Error('Apple sign-in is not enabled.'), 'provider', 'Fallback')).toBe(
      'Apple sign-in is not enabled.'
    );
  });
});
