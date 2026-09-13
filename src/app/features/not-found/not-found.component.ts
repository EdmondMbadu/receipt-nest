import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../services/seo.service';
import { PublicHeaderComponent } from '../../components/public-layout/public-header.component';
import { PublicFooterComponent } from '../../components/public-layout/public-footer.component';

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [RouterLink, PublicHeaderComponent, PublicFooterComponent],
  templateUrl: './not-found.component.html'
})
export class NotFoundComponent {
  constructor() {
    inject(SeoService).apply({
      title: 'Page Not Found | ReceiptNest AI',
      description: 'This page could not be found. Explore receipt tracking or visit support.',
      canonicalPath: null,
      robots: 'noindex, follow'
    });
  }
}
