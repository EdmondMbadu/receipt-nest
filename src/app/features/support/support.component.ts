import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-support',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './support.component.html',
  styleUrl: './support.component.css'
})
export class SupportComponent {
  private readonly theme = inject(ThemeService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  readonly isDarkMode = this.theme.isDarkMode;
  readonly currentYear = new Date().getFullYear();

  constructor() {
    this.title.setTitle('Support - ReceiptNest');
    this.meta.updateTag({ name: 'description', content: 'Get help with ReceiptNest. Contact our support team for questions about receipt scanning, expense tracking, and account assistance.' });
  }

  toggleTheme() {
    this.theme.toggleTheme();
  }
}
