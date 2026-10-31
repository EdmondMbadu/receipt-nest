import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PdfThumbnailService } from '../../services/pdf-thumbnail.service';
import { ReceiptPagePreviewComponent } from './receipt-page-preview.component';

describe('Recovered receipt page preview', () => {
  async function setup(render: jasmine.Spy) {
    await TestBed.configureTestingModule({ imports:[ReceiptPagePreviewComponent], providers:[provideZonelessChangeDetection(), {provide:PdfThumbnailService,useValue:{generateThumbnail:render}}] }).compileComponents();
    const fixture = TestBed.createComponent(ReceiptPagePreviewComponent);
    fixture.componentRef.setInput('src', 'https://example.test/first.pdf');
    fixture.detectChanges();
    return fixture;
  }
  it('renders the one-page PDF at readable resolution', async () => {
    const render = jasmine.createSpy().and.resolveTo('data:image/png;base64,preview');
    const fixture = await setup(render); await fixture.whenStable(); fixture.detectChanges();
    expect(render).toHaveBeenCalledWith('https://example.test/first.pdf', 1.8);
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,preview');
  });
  it('offers the individual PDF if rendering fails', async () => {
    const fixture = await setup(jasmine.createSpy().and.rejectWith(new Error('Unavailable')));
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a')?.getAttribute('href')).toBe('https://example.test/first.pdf');
    expect(fixture.nativeElement.textContent).toContain('Open receipt PDF');
  });
  it('never shows a previous receipt when a slow render completes after navigation', async () => {
    let finishFirst!: (image: string) => void;
    const first = new Promise<string>(resolve => finishFirst = resolve);
    const render = jasmine.createSpy().and.callFake((url: string) => url.includes('first') ? first : Promise.resolve('second-image'));
    const fixture = await setup(render);
    fixture.componentRef.setInput('src', 'https://example.test/second.pdf');
    fixture.detectChanges(); await fixture.whenStable();
    finishFirst('first-image'); await first; await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.image()).toBe('second-image');
  });
});
