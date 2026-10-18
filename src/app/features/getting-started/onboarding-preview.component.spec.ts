import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ReceiptTourService } from '../../services/receipt-tour.service';
import { OnboardingPreviewComponent } from './onboarding-preview.component';
describe('admin preview entry',()=>{
  it('opens the real dashboard with the shared guide instead of a mock dashboard',()=>{
    const start=jasmine.createSpy('start'),navigate=jasmine.createSpy('navigate').and.resolveTo(true);
    TestBed.configureTestingModule({imports:[OnboardingPreviewComponent],providers:[provideZonelessChangeDetection(),{provide:ReceiptTourService,useValue:{start}},{provide:Router,useValue:{navigate}}]});
    const fixture=TestBed.createComponent(OnboardingPreviewComponent);fixture.detectChanges();
    expect(start).toHaveBeenCalledWith(true);expect(navigate).toHaveBeenCalledWith(['/app'],{replaceUrl:true});
    expect(fixture.nativeElement.querySelector('app-home')).toBeNull();expect(fixture.nativeElement.textContent).not.toContain('sample receipt');fixture.destroy();
  });
});
