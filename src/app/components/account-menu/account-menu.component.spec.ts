import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { AccountMenuComponent } from './account-menu.component';

describe('help account menu', () => {
  const user = signal({ firstName: 'Test', lastName: 'User', email: 'test@example.com', role: 'admin', stripeCustomerId: 'customer' });
  beforeEach(() => TestBed.configureTestingModule({
    imports: [AccountMenuComponent],
    providers: [provideZonelessChangeDetection(), provideRouter([]), { provide: AuthService, useValue: { user } }]
  }));
  it('offers the existing account actions and opens the shell settings', () => {
    const fixture = TestBed.createComponent(AccountMenuComponent);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[aria-label="Account menu"]').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Manage billing');
    expect(fixture.nativeElement.querySelector('a').getAttribute('href')).toBe('/app/admin');
    const requested = jasmine.createSpy();
    fixture.componentInstance.settingsRequested.subscribe(requested);
    const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    buttons.find(button => button.textContent?.trim() === 'Settings')!.click();
    expect(requested).toHaveBeenCalled();
    expect(fixture.componentInstance.open()).toBeFalse();
  });
  it('dismisses with Escape or an outside click and returns keyboard focus', () => {
    const fixture = TestBed.createComponent(AccountMenuComponent);
    fixture.detectChanges();
    const trigger: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    trigger.click(); fixture.detectChanges();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fixture.componentInstance.open()).toBeFalse();
    expect(document.activeElement).toBe(trigger);
    trigger.click(); fixture.detectChanges();
    document.body.click();
    expect(fixture.componentInstance.open()).toBeFalse();
  });
});
