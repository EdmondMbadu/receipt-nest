import { Component, ElementRef, HostListener, ViewChild, computed, inject, output, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../../../../environments/environments';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-account-menu',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './account-menu.component.html'
})
export class AccountMenuComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  @ViewChild('trigger') private trigger?: ElementRef<HTMLButtonElement>;
  readonly settingsRequested = output<void>();
  readonly user = this.auth.user;
  readonly open = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly name = computed(() => `${this.user()?.firstName ?? ''} ${this.user()?.lastName ?? ''}`.trim() || 'Account');
  readonly initials = computed(() => (`${this.user()?.firstName?.[0] ?? ''}${this.user()?.lastName?.[0] ?? ''}` || this.user()?.email?.[0] || '?').toUpperCase());

  @HostListener('document:click', ['$event'])
  outsideClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }
  @HostListener('keydown.escape', ['$event'])
  escape(event: Event): void {
    if (!this.open()) return;
    event.stopPropagation();
    this.open.set(false);
    this.trigger?.nativeElement.focus();
  }
  settings(): void {
    this.open.set(false);
    this.settingsRequested.emit();
  }
  async billing(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const response = await httpsCallable<unknown, { url: string }>(getFunctions(app), 'createPortalSession')({});
      window.location.assign(response.data.url);
    } catch {
      this.error.set('Unable to open billing right now. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }
  async logout(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.logout();
      this.open.set(false);
      await this.router.navigateByUrl('/login');
    } catch {
      this.error.set('Unable to sign out right now. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
