import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PublicHeaderComponent } from '../../components/public-layout/public-header.component';
import { PublicFooterComponent } from '../../components/public-layout/public-footer.component';
import { getPublicPage, SITE_URL } from '../../content/public-pages';
import { gettingStartedVideo } from '../../content/getting-started-video';
import { SeoService } from '../../services/seo.service';
import { trackGettingStarted } from '../../utils/getting-started';

@Component({
  selector: 'app-getting-started', standalone: true,
  imports: [RouterLink, PublicHeaderComponent, PublicFooterComponent],
  templateUrl: './getting-started.component.html'
})
export class GettingStartedComponent {
  readonly inApp = !!inject(ActivatedRoute).snapshot.data['inApp'];
  readonly media = gettingStartedVideo.media;
  private readonly seo = inject(SeoService);
  private played = false;
  constructor() {
    const page = getPublicPage('/getting-started');
    this.seo.apply({ title: page.title, description: page.description, canonicalPath: this.inApp ? null : page.path,
      robots: this.inApp ? 'noindex, follow' : 'index, follow', image: this.media + '.jpg', imageWidth: 1920, imageHeight: 1080 });
    if (!this.inApp) this.seo.setJsonLd('getting-started-video', {
      '@context': 'https://schema.org', '@type': 'VideoObject',
      '@id': SITE_URL + page.path + '#video',
      name: gettingStartedVideo.name, description: gettingStartedVideo.description,
      thumbnailUrl: SITE_URL + this.media + '.jpg', contentUrl: SITE_URL + this.media + '.mp4',
      uploadDate: gettingStartedVideo.uploadDate, duration: gettingStartedVideo.duration, inLanguage: 'en',
      url: SITE_URL + '/getting-started', publisher: { '@id': SITE_URL + '/#organization' }
    });
  }
  onPlay(): void {
    if (!this.played) trackGettingStarted('tutorial_play', this.inApp ? 'app_help' : 'getting_started_page');
    this.played = true;
  }
}
