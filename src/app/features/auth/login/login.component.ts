import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

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
  private readonly cdr = inject(ChangeDetectorRef);

  readonly form = this.formBuilder.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  isSubmitting = false;
  isSendingReset = false;
  errorMessage = '';
  resetMessage = '';
  resetErrorMessage = '';

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
      await this.router.navigateByUrl('/app');
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
        `We sent a reset link to ${email}. Check your inbox to finish resetting your password, then sign in with the new one.`;
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
      await this.router.navigateByUrl('/app');
    } catch (error: any) {
      this.errorMessage = error?.message ?? 'Unable to sign you in with Google right now.';
    } finally {
      this.isSubmitting = false;
    }
  }

  private detectChanges() {
    this.cdr.detectChanges();
  }
}

