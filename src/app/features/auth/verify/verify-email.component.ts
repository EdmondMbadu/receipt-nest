import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './verify-email.component.html',
  styleUrl: './verify-email.component.css'
})
export class VerifyEmailComponent {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly email: string = this.router.getCurrentNavigation()?.extras.state?.['email'] ?? '';
  isSending = false;
  message = '';
  error = '';

  async resend() {
    this.error = '';
    this.message = '';
    this.isSending = true;
    try {
      await this.auth.sendVerificationEmail();
      this.message = 'Verification email sent. Check your inbox.';
    } catch (err: any) {
      this.error = err?.message ?? 'Could not send verification email right now.';
    } finally {
      this.isSending = false;
    }
  }
}

