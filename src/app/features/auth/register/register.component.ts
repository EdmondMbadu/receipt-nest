import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css'
})
export class RegisterComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  readonly form = this.formBuilder.group({
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  isSubmitting = false;
  errorMessage = '';

  async submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.errorMessage = '';
    this.isSubmitting = true;

    try {
      const { firstName, lastName, email, password } = this.form.getRawValue();
      await this.authService.registerUser({
        firstName: firstName ?? '',
        lastName: lastName ?? '',
        email: email ?? '',
        password: password ?? ''
      });
      await this.authService.waitForAuthState();
      await this.router.navigateByUrl('/verify', { state: { email: email ?? '' } });
    } catch (error: any) {
      this.errorMessage = error?.message ?? 'Could not create your account right now.';
    } finally {
      this.isSubmitting = false;
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
      this.errorMessage = error?.message ?? 'Unable to continue with Google right now.';
    } finally {
      this.isSubmitting = false;
    }
  }
}



