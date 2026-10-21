import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { APP_STORE_URL, GOOGLE_PLAY_URL, SOCIAL_LINKS, SocialPlatform } from '../../content/brand-links';
import { workflowPages } from '../../content/public-pages';

@Component({
  selector: 'app-public-footer',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './public-footer.component.html'
})
export class PublicFooterComponent {
  readonly workflows = workflowPages;
  readonly year = new Date().getFullYear();
  readonly socialLinks = SOCIAL_LINKS;
  readonly appStoreUrl = APP_STORE_URL;
  readonly googlePlayUrl = GOOGLE_PLAY_URL;

  /** Brand colors, matching the social buttons in the landing page footer. */
  readonly socialBackgrounds: Readonly<Record<SocialPlatform, string>> = {
    youtube: '#dc2626',
    x: '#0f172a',
    tiktok: 'linear-gradient(135deg, #010101 60%, #69C9D0 100%)',
    instagram: 'linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045)',
    facebook: '#1877F2'
  };
}
