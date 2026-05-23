import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../../services/theme.service';
import { SeoService } from '../../services/seo.service';

@Component({
  selector: 'app-support',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './support.component.html',
  styleUrl: './support.component.css'
})
export class SupportComponent {
  private readonly theme = inject(ThemeService);
  private readonly seo = inject(SeoService);
  readonly isDarkMode = this.theme.isDarkMode;
  readonly currentYear = new Date().getFullYear();

  constructor() {
    this.seo.apply({
      title: 'Support | ReceiptNest AI',
      description:
        'Get help with ReceiptNest AI. Contact support for questions about receipt scanning, receipt tracking, expense tracking, and account assistance.',
      canonicalPath: '/support',
      keywords: 'ReceiptNest AI support, receipt scanner support, receipt tracker help'
    });
  }

  toggleTheme() {
    this.theme.toggleTheme();
  }
}
