import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-terms',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './terms.component.html',
  styleUrl: './terms.component.css'
})
export class TermsComponent {
  private readonly theme = inject(ThemeService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  readonly isDarkMode = this.theme.isDarkMode;
  readonly currentYear = new Date().getFullYear();
  readonly lastUpdated = 'December 29, 2025';

  constructor() {
    this.title.setTitle('Terms and Conditions - ReceiptNest AI');
    this.meta.updateTag({ name: 'description', content: 'Read the Terms and Conditions for using ReceiptNest AI, the AI-powered receipt scanner and expense tracker.' });
  }

  toggleTheme() {
    this.theme.toggleTheme();
  }
}
