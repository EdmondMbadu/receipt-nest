import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { GettingStartedService } from '../../services/getting-started.service';
import { ReceiptTourService } from '../../services/receipt-tour.service';
import { OnboardingComponent } from './onboarding.component';

describe('anchored onboarding',()=>{
  let fixture:ComponentFixture<OnboardingComponent>,tour:ReceiptTourService,target:HTMLButtonElement;
  const save=jasmine.createSpy('save');
  beforeEach(()=>{
    TestBed.configureTestingModule({imports:[OnboardingComponent],providers:[provideZonelessChangeDetection(),provideRouter([]),{provide:AuthService,useValue:{user:signal({id:'u',role:'admin'})}},{provide:GettingStartedService,useValue:{save,progress:()=>null}}]});
    target=document.createElement('button');target.dataset['onboarding']='add';target.textContent='Add Receipt';target.style.cssText='position:fixed;left:30px;top:80px;width:120px;height:44px';document.body.append(target);
    fixture=TestBed.createComponent(OnboardingComponent);tour=TestBed.inject(ReceiptTourService);
  });
  afterEach(()=>{fixture.destroy();target.remove();save.calls.reset();});
  async function render(){fixture.detectChanges();await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));fixture.detectChanges();}
  it('anchors to and activates the actual control rather than rendering a duplicate view',async()=>{
    target.addEventListener('click',()=>tour.uploadOpened());tour.introduce();await render();await render();
    expect(fixture.componentInstance.rect()?.left).toBe(25);
    expect(save).toHaveBeenCalledWith({action:'seen',step:0});
    fixture.componentInstance.primary();expect(tour.step()).toBe('choose');
    expect(fixture.nativeElement.querySelector('.sample')).toBeNull();
  });
  it('tracks repositioning and lets Escape dismiss the guide',async()=>{
    tour.start();await render();target.style.top='160px';window.dispatchEvent(new Event('resize'));await render();
    expect(fixture.componentInstance.rect()?.top).toBe(155);
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));await render();
    expect(fixture.nativeElement.querySelector('.tour-panel')).toBeNull();
  });
  it('keeps the real uploader visible while explaining the selected file',async()=>{
    target.dataset['onboarding']='process';tour.start();tour.uploadOpened();tour.uploadChanged('process');await render();await render();
    expect(fixture.nativeElement.textContent).toContain('Ready? Process your receipt.');
    expect(fixture.componentInstance.rect()).not.toBeNull();
    tour.uploadChanged('camera');await render();expect(fixture.nativeElement.querySelector('.tour-panel')).toBeNull();
  });
  it('keeps an above-target popup attached across repeated layout passes',async()=>{
    target.style.top=(innerHeight-70)+'px';target.style.width=(innerWidth-60)+'px';
    tour.start();await render();await render();await render();await render();
    const panel=fixture.nativeElement.querySelector('.tour-panel').getBoundingClientRect();
    const gap=target.getBoundingClientRect().top-panel.bottom;
    expect(gap).toBeGreaterThanOrEqual(10);expect(gap).toBeLessThanOrEqual(25);
  });
});
