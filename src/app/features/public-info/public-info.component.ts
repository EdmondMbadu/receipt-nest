import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PublicHeaderComponent } from '../../components/public-layout/public-header.component';
import { PublicFooterComponent } from '../../components/public-layout/public-footer.component';
import { DEFAULT_FREE_PLAN_RECEIPT_LIMIT } from '../../config/subscription.constants';
import { getPublicPage } from '../../content/public-pages';
import { SeoService } from '../../services/seo.service';

@Component({
  selector: 'app-public-info',
  standalone: true,
  imports: [RouterLink, PublicHeaderComponent, PublicFooterComponent],
  templateUrl: './public-info.component.html'
})
export class PublicInfoComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly seo = inject(SeoService);
  readonly key = this.route.snapshot.data['page'] as string;
  readonly meta = getPublicPage('/' + this.key);
  readonly annual = signal(true);
  readonly freeLimit = DEFAULT_FREE_PLAN_RECEIPT_LIMIT;

  constructor() {
    this.seo.apply({ title: this.meta.title, description: this.meta.description, canonicalPath: this.meta.path });
    if (this.key === 'pricing') this.seo.setSoftwareApplication();
    this.seo.setJsonLd('information', {
      '@context': 'https://schema.org',
      '@type': this.key === 'about' ? 'AboutPage' : 'WebPage',
      '@id': this.seo.absoluteUrl(this.meta.path + '#webpage'),
      url: this.seo.absoluteUrl(this.meta.path),
      name: this.meta.title,
      description: this.meta.description,
      isPartOf: { '@id': this.seo.absoluteUrl('/#website') }
    });
  }
}
