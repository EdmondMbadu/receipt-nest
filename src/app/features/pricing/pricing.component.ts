import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './pricing.component.html',
  styleUrl: './pricing.component.css'
})
export class PricingComponent {
  private readonly theme = inject(ThemeService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  readonly isDarkMode = this.theme.isDarkMode;

  constructor() {
    this.title.setTitle('Pricing - ReceiptNest');
    this.meta.updateTag({ name: 'description', content: 'Review your ReceiptNest plan and upgrade when you are ready.' });
  }

  toggleTheme() {
    this.theme.toggleTheme();
  }
}
