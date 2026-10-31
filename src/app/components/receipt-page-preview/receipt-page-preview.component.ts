import { Component, effect, inject, input, signal } from '@angular/core';
import { PdfThumbnailService } from '../../services/pdf-thumbnail.service';

/** For a recovered PDF already verified to contain exactly one receipt page. */
@Component({
  selector: 'app-receipt-page-preview',
  standalone: true,
  template: `
    @if (image()) {
      <img [src]="image()" alt="Individual receipt preview">
    } @else if (failed()) {
      <p>The preview could not be displayed.</p>
      <a [href]="src()" target="_blank" rel="noopener noreferrer">Open receipt PDF ↗</a>
    } @else {
      <p role="status">Rendering receipt…</p>
    }
  `,
  styles: [`:host{display:block;width:100%;text-align:center}img{display:block;max-width:100%;width:auto;max-height:78vh;object-fit:contain;margin:auto;background:white}p,a{font-size:13px;padding:12px}a{color:#047857;text-decoration:underline}`],
})
export class ReceiptPagePreviewComponent {
  readonly src = input.required<string>();
  readonly image = signal('');
  readonly failed = signal(false);
  private readonly thumbnails = inject(PdfThumbnailService);
  private readonly render = effect(onCleanup => {
    const url = this.src();
    this.image.set(''); this.failed.set(false);
    let cancelled = false;
    onCleanup(() => { cancelled = true; });
    void this.thumbnails.generateThumbnail(url, 1.8).then(image => {
      if (!cancelled) this.image.set(image);
    }).catch(() => {
      if (!cancelled) this.failed.set(true);
    });
  });
}
