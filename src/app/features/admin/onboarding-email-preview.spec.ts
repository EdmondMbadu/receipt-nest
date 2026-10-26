import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AdminComponent } from './admin.component';
import { AuthService } from '../../services/auth.service';

type Request = {to: string; userId: string; template: 'welcome' | 'first-receipt'};
type Transport = {requestOnboardingTestEmail(request: Request): Promise<{to: string}>};

describe('Admin onboarding email tests', () => {
  async function setup() {
    await TestBed.configureTestingModule({
      imports: [AdminComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([]), {
        provide: AuthService, useValue: {user: signal({id:'admin',email:'admin@example.com',role:'admin'})}
      }]
    }).compileComponents();
    // Angular records lifecycle hooks from the prototype when creating a view.
    // Stub before creation so no real directory listeners or Functions run.
    spyOn(AdminComponent.prototype, 'ngOnInit').and.stub();
    const fixture = TestBed.createComponent(AdminComponent);
    const component = fixture.componentInstance;
    // Exercise the real template and click handlers without directory listeners,
    // remote Functions, or any outgoing email.
    component.users.set([{id:'source',firstName:'Edmond',lastName:'Mbadu',email:'source@example.com'}]);
    component.summaryUserId.set('source');
    component.summaryEmailTo.set('test-inbox@example.com');
    const send = spyOn(component as unknown as Transport, 'requestOnboardingTestEmail').and.resolveTo({to:'test-inbox@example.com'});
    fixture.detectChanges();
    await fixture.whenStable();
    return {fixture,component,send};
  }

  it('uses the shared recipient and selected account for both email test buttons', async () => {
    const {fixture,component,send} = await setup();
    const section: HTMLElement = fixture.nativeElement.querySelector('section[aria-labelledby="onboarding-email-tests-title"]');
    expect(section.textContent).toContain('Test copies do not change');
    const buttons = section.querySelectorAll('button');
    expect(buttons[0].textContent).toContain('Send welcome test');
    expect(buttons[1].textContent).toContain('Send reminder test');
    component.summaryEmailTo.set(' Test-Inbox@Example.COM ');
    buttons[0].click(); await fixture.whenStable();
    expect(send).toHaveBeenCalledWith({to:'test-inbox@example.com',userId:'source',template:'welcome'});
    expect(component.onboardingTestSuccess()).toContain('onboarding is unchanged');
    buttons[1].click(); await fixture.whenStable();
    expect(send).toHaveBeenCalledWith({to:'test-inbox@example.com',userId:'source',template:'first-receipt'});
  });

  it('rejects an invalid inbox or missing source before sending', async () => {
    const {component,send} = await setup();
    component.summaryEmailTo.set('one@example.com,two@example.com');
    await component.sendOnboardingTestEmail('welcome');
    expect(send).not.toHaveBeenCalled();expect(component.onboardingTestError()).toContain('one valid test inbox');
    component.summaryEmailTo.set('test-inbox@example.com');component.summaryUserId.set('');
    await component.sendOnboardingTestEmail('first-receipt');
    expect(send).not.toHaveBeenCalled();expect(component.onboardingTestError()).toContain('source user');
  });

  it('blocks repeated clicks and both buttons while the request is pending', async () => {
    const {fixture,component,send} = await setup();
    let finish!: (value: {to: string}) => void;
    send.and.returnValue(new Promise(resolve => {finish=resolve;}));
    const pending=component.sendOnboardingTestEmail('welcome');
    await component.sendOnboardingTestEmail('first-receipt');
    expect(send).toHaveBeenCalledTimes(1);
    fixture.detectChanges();
    const buttons: NodeListOf<HTMLButtonElement> = fixture.nativeElement.querySelectorAll('section[aria-labelledby="onboarding-email-tests-title"] button');
    expect([...buttons].every(button=>button.disabled)).toBeTrue();
    finish({to:'test-inbox@example.com'}); await pending;fixture.detectChanges();
    expect(component.onboardingTestSending()).toBeNull();
    expect([...buttons].some(button=>button.disabled)).toBeFalse();
  });

  it('shows an error and releases the controls after a failed send', async () => {
    const {component,send} = await setup();
    spyOn(console,'error');
    send.and.rejectWith({code:'functions/not-found'});
    await component.sendOnboardingTestEmail('first-receipt');
    expect(component.onboardingTestError()).toContain('source account is no longer available');
    expect(component.onboardingTestSending()).toBeNull();expect(component.onboardingTestSuccess()).toBeNull();
  });
});
