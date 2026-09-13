import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PublicHeaderComponent } from '../../components/public-layout/public-header.component';
import { PublicFooterComponent } from '../../components/public-layout/public-footer.component';
import { DEFAULT_FREE_PLAN_RECEIPT_LIMIT } from '../../config/subscription.constants';
import { getPublicPage } from '../../content/public-pages';
import { receiptWorkflows } from '../../content/receipt-workflows';
import { SeoService } from '../../services/seo.service';

@Component({
  selector: 'app-seo-page',
  standalone: true,
  imports: [RouterLink, PublicHeaderComponent, PublicFooterComponent],
  templateUrl: './seo-page.component.html',
  styleUrl: './seo-page.component.css'
})
export class SeoPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly seo = inject(SeoService);
  readonly key = this.route.snapshot.data['page'] as string;
  readonly meta = getPublicPage('/' + this.key);
  readonly page = receiptWorkflows[this.key];
  readonly freeLimit = DEFAULT_FREE_PLAN_RECEIPT_LIMIT;

  constructor() {
    this.seo.apply({
      title: this.meta.title,
      description: this.meta.description,
      canonicalPath: this.meta.path
    });
    this.seo.setSoftwareApplication();
    this.seo.setJsonLd('workflow', {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebPage',
          '@id': this.seo.absoluteUrl(this.meta.path + '#webpage'),
          url: this.seo.absoluteUrl(this.meta.path),
          name: this.meta.title,
          description: this.meta.description,
          inLanguage: 'en-US',
          isPartOf: { '@id': this.seo.absoluteUrl('/#website') },
          about: { '@id': this.seo.absoluteUrl('/#app') }
        },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'ReceiptNest AI', item: this.seo.absoluteUrl('/') },
            { '@type': 'ListItem', position: 2, name: this.meta.label, item: this.seo.absoluteUrl(this.meta.path) }
          ]
        }
      ]
    });
  }
}
