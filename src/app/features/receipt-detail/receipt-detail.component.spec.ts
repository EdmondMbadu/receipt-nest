import { CUSTOM_ELEMENTS_SCHEMA, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { Timestamp } from 'firebase/firestore';
import { of } from 'rxjs';
import { ReceiptDetailComponent } from './receipt-detail.component';
import { OnboardingComponent } from '../../components/onboarding/onboarding.component';
import { Receipt } from '../../models/receipt.model';
import { ReceiptService } from '../../services/receipt.service';
import { ReceiptTourService } from '../../services/receipt-tour.service';
import { ThemeService } from '../../services/theme.service';
import { PdfThumbnailService } from '../../services/pdf-thumbnail.service';

describe('Recovered receipt details', () => {
  async function setup(failSource = false) {
    const at = Timestamp.fromMillis(1000);
    const receipt: Receipt = { id:'page-03', userId:'owner', status:'final', totalAmount:46.91, currency:'AUD', date:'2026-06-29', createdAt:at, updatedAt:at,
      file:{ storagePath:'users/owner/receipts/page-03.pdf', originalName:'Woolworths.pdf', mimeType:'application/pdf', sizeBytes:5000, uploadedAt:at },
      merchant:{ canonicalName:'Woolworths', rawName:'Woolworths', matchedBy:'manual', matchConfidence:1 },
      category:{ id:'groceries', name:'Groceries', assignedBy:'user', confidence:1 },
      sourceBundle:{ recoveryId:'recovery', sourceReceiptId:'source', storagePath:'users/owner/receipts/original.pdf', originalName:'Original.pdf', page:3, pageCount:17, sha256:'source-hash', receiptSha256:'page-hash' },
    };
    const getReceiptFileUrl = jasmine.createSpy('getReceiptFileUrl').and.callFake(async (path: string) => {
      if (path === receipt.sourceBundle!.storagePath) {
        if (failSource) throw new Error('Unavailable');
        return 'about:blank#original-bundle';
      }
      return 'about:blank#single-receipt';
    });
    await TestBed.configureTestingModule({ imports:[ReceiptDetailComponent], providers:[provideZonelessChangeDetection(), provideRouter([]),
      {provide:ActivatedRoute,useValue:{params:of({id:receipt.id})}},
      {provide:ReceiptService,useValue:{getReceipt:jasmine.createSpy().and.resolveTo(receipt),getReceiptFileUrl}},
      {provide:ThemeService,useValue:{isDarkMode:signal(false)}},
      {provide:PdfThumbnailService,useValue:{generateThumbnail:jasmine.createSpy().and.resolveTo('data:image/png;base64,receipt-preview')}},
      {provide:ReceiptTourService,useValue:{active:signal(false),preview:signal(false),receiptLoaded:jasmine.createSpy()}},
    ] }).overrideComponent(ReceiptDetailComponent, { remove:{imports:[OnboardingComponent]}, add:{schemas:[CUSTOM_ELEMENTS_SCHEMA]} }).compileComponents();
    const fixture = TestBed.createComponent(ReceiptDetailComponent);
    const load = spyOn(fixture.componentInstance, 'loadReceipt').and.callThrough();
    fixture.detectChanges(); await load.calls.mostRecent().returnValue;
    await fixture.whenStable(); fixture.detectChanges();
    return { fixture, component:fixture.componentInstance, getReceiptFileUrl };
  }
  it('opens the individual PDF by default and offers the full original as a separate link', async () => {
    const { fixture, component } = await setup();
    expect(component.imageUrl()).toBe('about:blank#single-receipt');
    expect(fixture.nativeElement.querySelector('app-receipt-page-preview img')?.getAttribute('src')).toBe('data:image/png;base64,receipt-preview');
    expect(fixture.nativeElement.querySelector('iframe')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('page 3 of 17');
    const link = [...fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>].find(a=>a.textContent?.includes('Open original 17-page PDF'));
    expect(link?.getAttribute('href')).toBe('about:blank#original-bundle');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });
  it('keeps the individual receipt available if loading the bundle link fails', async () => {
    const { fixture, component } = await setup(true);
    expect(component.isLoading()).toBeFalse(); expect(component.error()).toBeNull();
    expect(component.imageUrl()).toBe('about:blank#single-receipt');
    expect(fixture.nativeElement.textContent).toContain('Reload original upload link');
  });
});
