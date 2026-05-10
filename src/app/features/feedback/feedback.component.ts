import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { addDoc, collection, Firestore, getFirestore, serverTimestamp } from 'firebase/firestore';

import { app } from '../../../../environments/environments';
import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-feedback',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './feedback.component.html',
  styleUrl: './feedback.component.css'
})
export class FeedbackComponent {
  private readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly db: Firestore = getFirestore(app);

  readonly user = this.auth.user;
  readonly isDarkMode = this.theme.isDarkMode;
  readonly currentYear = new Date().getFullYear();
  readonly feedbackName = signal('');
  readonly feedbackEmail = signal('');
  readonly feedbackMessage = signal('');
  readonly feedbackSending = signal(false);
  readonly feedbackError = signal<string | null>(null);
  readonly feedbackSuccess = signal<string | null>(null);

  readonly displayName = computed(() => {
    const profile = this.user();
    if (!profile) {
      return '';
    }

    const name = `${profile.firstName} ${profile.lastName}`.trim();
    return name || profile.email;
  });

  constructor() {
    this.title.setTitle('Feedback - ReceiptNest AI');
    this.meta.updateTag({
      name: 'description',
      content: 'Share feedback, ideas, bug reports, and product suggestions with ReceiptNest AI.'
    });
  }

  toggleTheme() {
    this.theme.toggleTheme();
  }

  setFeedbackMessage(value: string) {
    this.feedbackMessage.set(value);
    this.clearFeedbackStatus();
  }

  setFeedbackName(value: string) {
    this.feedbackName.set(value);
    this.clearFeedbackStatus();
  }

  setFeedbackEmail(value: string) {
    this.feedbackEmail.set(value);
    this.clearFeedbackStatus();
  }

  async sendFeedback() {
    if (this.feedbackSending()) {
      return;
    }

    this.feedbackError.set(null);
    this.feedbackSuccess.set(null);

    const profile = this.user();
    const message = this.feedbackMessage().trim();
    const email = profile?.email || this.feedbackEmail().trim();
    const displayName = profile ? this.displayName() : this.feedbackName().trim();

    if (message.length < 3) {
      this.feedbackError.set('Please enter a little more detail before sending.');
      return;
    }

    if (message.length > 1200) {
      this.feedbackError.set('Please keep feedback under 1,200 characters.');
      return;
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.feedbackError.set('Enter a valid email address, or leave it blank.');
      return;
    }

    this.feedbackSending.set(true);

    try {
      await addDoc(collection(this.db, 'feedback'), {
        userId: profile?.id ?? null,
        email,
        displayName: displayName || 'Anonymous visitor',
        message,
        status: 'open',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      this.feedbackMessage.set('');
      if (!profile) {
        this.feedbackName.set('');
        this.feedbackEmail.set('');
      }
      this.feedbackSuccess.set('Thanks. Your feedback was sent.');
    } catch (error) {
      console.error('Failed to send feedback', error);
      this.feedbackError.set('Unable to send feedback right now. Please try again.');
    } finally {
      this.feedbackSending.set(false);
    }
  }

  private clearFeedbackStatus() {
    if (this.feedbackError()) {
      this.feedbackError.set(null);
    }
    if (this.feedbackSuccess()) {
      this.feedbackSuccess.set(null);
    }
  }
}
