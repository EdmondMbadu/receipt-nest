import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  readonly form = this.formBuilder.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  isSubmitting = false;
  isSendingReset = false;
  errorMessage = '';
  pageNotice = '';
  resetMessage = '';
  resetErrorMessage = '';

  constructor() {
    this.title.setTitle('Sign In - ReceiptNest AI');
    this.meta.updateTag({ name: 'description', content: 'Sign in to your ReceiptNest AI account.' });
    this.meta.updateTag({ name: 'robots', content: 'noindex, follow' });
    this.meta.updateTag({ name: 'googlebot', content: 'noindex, follow' });

    const email = (this.route.snapshot.queryParamMap.get('email') ?? '').trim();
    if (email) {
      this.form.patchValue({ email });
    }

    if (this.route.snapshot.queryParamMap.get('reset') === 'success') {
      this.pageNotice = 'Your password was updated successfully. Sign in with your new password.';
    } else if (this.route.snapshot.queryParamMap.get('verified') === '1') {
      this.pageNotice = 'Your email is verified. Welcome to ReceiptNest AI.';
    }

    void this.redirectIfAuthenticated();
  }

  async submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.errorMessage = '';
    this.isSubmitting = true;

    try {
      const { email, password } = this.form.getRawValue();
      await this.authService.login(email ?? '', password ?? '');
      await this.authService.waitForAuthState();
      await this.router.navigateByUrl(this.getRedirectUrl());
    } catch (error: any) {
      if (error?.code === 'auth/email-not-verified') {
        this.errorMessage = 'Please verify your email to sign in.';
        await this.router.navigateByUrl('/verify', { state: { email: this.form.get('email')?.value ?? '' } });
      } else {
        this.errorMessage = error?.message ?? 'Unable to sign you in right now.';
      }
    } finally {
      this.isSubmitting = false;
    }
  }

  async sendPasswordReset() {
    const emailControl = this.form.get('email');
    if (!emailControl) {
      return;
    }

    this.resetMessage = '';
    this.resetErrorMessage = '';
    this.detectChanges();
    const email = (emailControl.value ?? '').trim();

    if (!email || emailControl.invalid) {
      emailControl.markAsTouched();
      this.resetErrorMessage = 'Enter your email above to reset your password.';
      this.detectChanges();
      return;
    }

    this.isSendingReset = true;
    this.detectChanges();

    try {
      await this.authService.sendPasswordReset(email);
      this.resetMessage =
        `If an account exists for ${email}, we sent a secure reset link. Check your inbox to finish updating your password.`;
      this.resetErrorMessage = '';
      this.detectChanges();
    } catch (error: any) {
      this.resetErrorMessage = error?.message ?? 'Unable to send reset link right now.';
      this.detectChanges();
    } finally {
      this.isSendingReset = false;
      this.detectChanges();
    }
  }

  clearResetMessages() {
    this.resetMessage = '';
    this.resetErrorMessage = '';
  }

  get resetButtonLabel(): string {
    if (this.isSendingReset) {
      return 'Sending reset link…';
    }

    if (this.resetMessage) {
      return 'Link sent! Check your email (tap to resend)';
    }

    return 'Forgot password?';
  }

  async signInWithGoogle() {
    this.errorMessage = '';
    this.isSubmitting = true;

    try {
      await this.authService.loginWithGoogle();
      await this.authService.waitForAuthState();
      await this.router.navigateByUrl(this.getRedirectUrl());
    } catch (error: any) {
      this.errorMessage = error?.message ?? 'Unable to sign you in with Google right now.';
    } finally {
      this.isSubmitting = false;
    }
  }

  async signInWithApple() {
    this.errorMessage = '';
    this.isSubmitting = true;

    try {
      await this.authService.loginWithApple();
    } catch (error: any) {
      this.errorMessage = error?.message ?? 'Unable to sign you in with Apple right now.';
      this.isSubmitting = false;
      return;
    }
  }

  private async redirectIfAuthenticated() {
    try {
      await this.authService.waitForRedirectResult();
      await this.authService.waitForAuthState();
      const redirectError = this.authService.redirectErrorMessage();
      if (redirectError) {
        this.errorMessage = redirectError;
        return;
      }
      if (this.authService.isAuthenticated()) {
        await this.router.navigateByUrl(this.getRedirectUrl());
      }
    } catch {
      // The explicit sign-in handlers surface actionable auth errors.
    }
  }

  private detectChanges() {
    this.cdr.detectChanges();
  }

  private getRedirectUrl(): string {
    const redirect = this.route.snapshot.queryParamMap.get('redirect');
    if (redirect && redirect.startsWith('/')) {
      return redirect;
    }

    return '/app';
  }
}
