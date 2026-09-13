import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../../services/theme.service';
import { getPublicPage } from '../../content/public-pages';
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
    const page = getPublicPage('/terms');
    this.seo.apply({ title: page.title, description: page.description, canonicalPath: page.path });
  }

  toggleTheme() {
    this.theme.toggleTheme();
  }
}
