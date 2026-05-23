import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../../services/theme.service';
import { SeoService } from '../../services/seo.service';

@Component({
  selector: 'app-terms',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './terms.component.html',
  styleUrl: './terms.component.css'
})
export class TermsComponent {
  private readonly theme = inject(ThemeService);
  private readonly seo = inject(SeoService);
  readonly isDarkMode = this.theme.isDarkMode;
  readonly currentYear = new Date().getFullYear();
  readonly lastUpdated = 'December 29, 2025';

  constructor() {
    this.seo.apply({
      title: 'Terms and Conditions | ReceiptNest AI',
      description:
        'Read the Terms and Conditions for ReceiptNest AI, an AI-powered receipt scanner, receipt organizer, receipt tracker, and expense tracker.',
      canonicalPath: '/terms',
      keywords: 'ReceiptNest AI terms, receipt scanner terms, receipt tracker terms'
    });
  }

  toggleTheme() {
    this.theme.toggleTheme();
  }
}
