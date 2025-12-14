import { Component, inject } from '@angular/core';
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

    if (!emailControl.value || emailControl.invalid) {
      emailControl.markAsTouched();
      this.resetErrorMessage = 'Enter your email above to reset your password.';
      return;
    }

    this.isSendingReset = true;

    try {
      await this.authService.sendPasswordReset(emailControl.value);
      this.resetMessage = 'Reset link sent! Check your inbox.';
    } catch (error: any) {
      this.resetErrorMessage = error?.message ?? 'Unable to send reset link right now.';
    } finally {
      this.isSendingReset = false;
    }
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
}

