import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
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
  readonly isDarkMode = this.theme.isDarkMode;
  readonly currentYear = new Date().getFullYear();
  readonly lastUpdated = 'December 29, 2025';

  toggleTheme() {
    this.theme.toggleTheme();
  }
}
