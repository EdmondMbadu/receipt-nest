import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './reset-password.component.html',
  styleUrl: './reset-password.component.css'
})
export class ResetPasswordComponent implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  readonly form = this.formBuilder.group({
    password: ['', [Validators.required, Validators.minLength(6)]],
    confirmPassword: ['', [Validators.required]]
  });

  private oobCode = '';

  email = '';
  isLoading = true;
  isSubmitting = false;
  isLinkReady = false;
  isComplete = false;
  errorMessage = '';
  successMessage = '';

  constructor() {
    this.title.setTitle('Reset Password - ReceiptNest AI');
    this.meta.updateTag({ name: 'description', content: 'Reset your ReceiptNest AI password securely.' });
    this.meta.updateTag({ name: 'robots', content: 'noindex, follow' });
    this.meta.updateTag({ name: 'googlebot', content: 'noindex, follow' });
  }

  ngOnInit(): void {
    void this.initialize();
  }

  async submit(): Promise<void> {
    if (!this.isLinkReady) {
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.errorMessage = '';
    const { password, confirmPassword } = this.form.getRawValue();
    const trimmedPassword = (password ?? '').trim();
    const trimmedConfirmPassword = (confirmPassword ?? '').trim();

    if (trimmedPassword !== trimmedConfirmPassword) {
      this.errorMessage = 'Passwords do not match yet. Please enter the same password in both fields.';
      this.detectChanges();
      return;
    }

    this.isSubmitting = true;

    try {
      await this.authService.confirmPasswordReset(this.oobCode, trimmedPassword);
      this.isComplete = true;
      this.successMessage = 'Your password has been updated. Sign in with your new password when you are ready.';
      this.form.reset();
    } catch (error: any) {
      this.errorMessage = this.getResetErrorMessage(error);
    } finally {
      this.isSubmitting = false;
      this.detectChanges();
    }
  }

  async goToLogin(): Promise<void> {
    const queryParams: Record<string, string> = { reset: 'success' };
    if (this.email) {
      queryParams['email'] = this.email;
    }

    await this.router.navigate(['/login'], { queryParams });
  }

  private async initialize(): Promise<void> {
    this.oobCode = (this.route.snapshot.queryParamMap.get('oobCode') ?? '').trim();

    if (!this.oobCode) {
      this.errorMessage = 'This reset link is missing required details. Request a new password reset email and try again.';
      this.isLoading = false;
      this.detectChanges();
      return;
    }

    try {
      this.email = await this.authService.verifyPasswordResetCode(this.oobCode);
      this.isLinkReady = true;
    } catch (error: any) {
      this.errorMessage = this.getResetErrorMessage(error);
    } finally {
      this.isLoading = false;
      this.detectChanges();
    }
  }

  private detectChanges(): void {
    this.cdr.detectChanges();
  }

  private getResetErrorMessage(error: any): string {
    if (error?.code === 'auth/expired-action-code' || error?.code === 'auth/invalid-action-code') {
      return 'This password reset link has expired or is no longer valid. Request a fresh reset email and try again.';
    }

    if (error?.code === 'auth/weak-password') {
      return 'Choose a stronger password with at least 6 characters.';
    }

    return error?.message ?? 'We could not reset your password right now. Please request a new reset link.';
  }
}
