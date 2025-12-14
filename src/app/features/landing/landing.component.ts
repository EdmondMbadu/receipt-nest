import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.css'
})
export class LandingComponent {
  readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);

  readonly user = this.auth.user;
  readonly isDarkMode = this.theme.isDarkMode;
  readonly currentYear = new Date().getFullYear();

  readonly displayName = computed(() => {
    const profile = this.user();
    if (!profile) {
      return '';
    }

    const name = `${profile.firstName} ${profile.lastName}`.trim();
    return name || profile.email;
  });

  toggleTheme() {
    this.theme.toggleTheme();
  }
}


