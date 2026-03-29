import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import { Router } from '@angular/router';

import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './verify-email.component.html',
  styleUrl: './verify-email.component.css'
})
export class VerifyEmailComponent {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  readonly email: string = this.router.getCurrentNavigation()?.extras.state?.['email'] ?? '';
  isSending = false;
  message = '';
  error = '';

  constructor() {
    this.title.setTitle('Verify Email - ReceiptNest AI');
    this.meta.updateTag({ name: 'description', content: 'Verify your email to continue with ReceiptNest AI.' });
    this.meta.updateTag({ name: 'robots', content: 'noindex, follow' });
    this.meta.updateTag({ name: 'googlebot', content: 'noindex, follow' });
  }

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

  async backToSignIn() {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
