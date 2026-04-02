import { inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

@Injectable()
export class AppTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly appName = 'ReceiptNest AI';

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const routeTitle = this.buildTitle(snapshot);
    if (!routeTitle) {
      return;
    }

    const fullTitle = routeTitle.includes(this.appName) ? routeTitle : `${routeTitle} - ${this.appName}`;
    this.title.setTitle(fullTitle);
  }
}
