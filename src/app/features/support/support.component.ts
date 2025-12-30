import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
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
  readonly isDarkMode = this.theme.isDarkMode;
  readonly currentYear = new Date().getFullYear();

  toggleTheme() {
    this.theme.toggleTheme();
  }
}
