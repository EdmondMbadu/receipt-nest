import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ThemeService } from '../../services/theme.service';
import { getPublicPage } from '../../content/public-pages';
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
    const page = getPublicPage('/support');
    this.seo.apply({ title: page.title, description: page.description, canonicalPath: page.path });
  }

  toggleTheme() {
    this.theme.toggleTheme();
  }
}
