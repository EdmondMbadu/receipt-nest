import { inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { SeoService } from './services/seo.service';
import { publicPages } from './content/public-pages';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

@Injectable()
export class AppTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly seo = inject(SeoService);
  private readonly appName = 'ReceiptNest AI';

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const routeTitle = this.buildTitle(snapshot);
    // Article components own their dynamic title and structured data.
    if (!routeTitle) return;
    const path = snapshot.url.split(/[?#]/)[0].replace(/\/$/, '') || '/';
    const fullTitle = path === '/' || routeTitle.includes(this.appName) ? routeTitle : `${routeTitle} - ${this.appName}`;
    const isPublic = publicPages.some(page => page.path === path) || path.startsWith('/blog/');
    let leaf = snapshot.root;
    while (leaf.firstChild) leaf = leaf.firstChild;
    if (!isPublic && leaf.routeConfig?.path !== '**') {
      this.seo.apply({
        title: fullTitle,
        description: 'Your ReceiptNest AI account.',
        canonicalPath: null,
        robots: 'noindex, follow'
      });
    }
    this.title.setTitle(fullTitle);
  }
}
