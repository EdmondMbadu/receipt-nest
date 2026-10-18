import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { GettingStartedService } from './getting-started.service';
import { ReceiptTourService } from './receipt-tour.service';

describe('ReceiptTourService', () => {
  let tour: ReceiptTourService;
  let save: jasmine.Spy;
  let navigate: jasmine.Spy;
  let profile = signal<any>({id:'owner',role:'admin'});
  beforeEach(() => {
    save=jasmine.createSpy('save'); navigate=jasmine.createSpy('navigate').and.resolveTo(true);
    profile=signal({id:'owner',role:'admin'});
    TestBed.configureTestingModule({providers:[provideZonelessChangeDetection(),{provide:AuthService,useValue:{user:profile}},{provide:GettingStartedService,useValue:{save,progress:()=>({step:2})}},{provide:Router,useValue:{navigate}}]});
    tour=TestBed.inject(ReceiptTourService);
  });
  it('follows upload, processing, actual receipt navigation and export actions', async () => {
    tour.start(); tour.uploadOpened(); expect(tour.step()).toBe('choose');
    tour.uploadChanged('process'); expect(tour.step()).toBe('process');
    tour.uploadChanged('uploading'); tour.uploaded('r1','uploaded'); expect(tour.step()).toBe('processing');
    tour.updateReceipt('processing'); expect(tour.step()).toBe('processing');
    tour.updateReceipt('final'); expect(tour.step()).toBe('receipt');
    tour.receiptOpened('r1'); expect(tour.step()).toBe('details');
    tour.receiptLoaded('r1','final'); tour.go('original'); tour.downloaded('original');
    expect(tour.step()).toBe('search'); expect(navigate).toHaveBeenCalledWith(['/app']);
    tour.enterHome(); expect(tour.step()).toBe('search');
    tour.go('monthly'); tour.menuChanged(true); expect(tour.step()).toBe('exports');
    tour.downloaded('export'); tour.menuChanged(false); expect(tour.mode()).toBe('done');
    expect(save).toHaveBeenCalledWith({action:'complete',step:4});
  });
  it('handles cancellation and review without pretending processing succeeded', () => {
    tour.start(); tour.uploadOpened(); tour.uploadChanged('camera'); expect(tour.cameraActive()).toBeTrue();
    tour.uploadClosed(); expect(tour.cameraActive()).toBeFalse(); expect(tour.step()).toBe('add');
    tour.uploaded('r1','processing'); tour.updateReceipt('needs_review');
    expect(tour.step()).toBe('receipt'); expect(tour.receiptStatus()).toBe('needs_review');
    expect(save).not.toHaveBeenCalledWith({action:'complete',step:4});
  });
  it('never writes onboarding progress while previewing the real account', () => {
    tour.start(true); tour.markVisible(); tour.uploadOpened(); tour.uploaded('real-receipt','final');
    tour.receiptOpened('real-receipt'); tour.go('original'); tour.complete(); tour.dismiss();
    expect(tour.receiptId()).toBe('real-receipt'); expect(save).not.toHaveBeenCalled();
    tour.togglePreview(); expect(tour.active()).toBeFalse(); tour.togglePreview(); expect(tour.step()).toBe('add');
    tour.exitPreview(); expect(tour.preview()).toBeFalse(); expect(save).not.toHaveBeenCalled();
  });
  it('limits preview to admins and clears an active guide after sign-out', () => {
    profile.set({id:'owner',role:'user'}); tour.start(true); expect(tour.preview()).toBeFalse();
    TestBed.tick(); tour.start(); profile.set(null); TestBed.tick(); expect(tour.active()).toBeFalse();
  });
});
