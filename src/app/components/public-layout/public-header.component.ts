import { Component, inject, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ThemeService } from '../../services/theme.service';
import { emitContentEvent } from '../../utils/search-acquisition';

@Component({
  selector: 'app-public-header',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './public-header.component.html'
})
export class PublicHeaderComponent {
  readonly theme = inject(ThemeService);
  readonly trackingPath = input<string>();

  trackSignupClick(): void {
    const path = this.trackingPath();
    if (path) emitContentEvent('content_cta_click', path, 'header');
  }
}
