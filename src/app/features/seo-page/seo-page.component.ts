import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PublicHeaderComponent } from '../../components/public-layout/public-header.component';
import { PublicFooterComponent } from '../../components/public-layout/public-footer.component';
import { DEFAULT_FREE_PLAN_RECEIPT_LIMIT } from '../../config/subscription.constants';
import { getPublicPage } from '../../content/public-pages';
import { receiptWorkflows } from '../../content/receipt-workflows';
import { SeoService } from '../../services/seo.service';
import { FIRST_RECEIPT_SIGNUP } from '../../utils/first-receipt-entry';
import { CtaPlacement, emitContentEvent, recordContentVisit } from '../../utils/search-acquisition';

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
  readonly sampleCsvPath = '/samples/receiptnest-monthly-example.csv';
  readonly firstReceiptSignup = FIRST_RECEIPT_SIGNUP;

  constructor() {
    recordContentVisit(this.meta.path);
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
            { '@type': 'ListItem', position: 1, name: 'ReceiptNest', item: this.seo.absoluteUrl('/') },
            { '@type': 'ListItem', position: 2, name: this.meta.label, item: this.seo.absoluteUrl(this.meta.path) }
          ]
        }
      ]
    });
  }

  trackSignupClick(placement: CtaPlacement): void {
    emitContentEvent('content_cta_click', this.meta.path, placement);
  }

  trackSampleDownload(placement: 'hero' | 'example'): void {
    emitContentEvent('receipt_csv_sample_download', this.meta.path, placement);
  }
}
