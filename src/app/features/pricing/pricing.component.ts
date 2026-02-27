import { Component, EffectRef, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { doc, getFirestore, onSnapshot, Timestamp } from 'firebase/firestore';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { ThemeService } from '../../services/theme.service';
import { AuthService } from '../../services/auth.service';
import { app } from '../../../../environments/environments';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './pricing.component.html',
  styleUrl: './pricing.component.css'
})
export class PricingComponent implements OnDestroy {
  private readonly theme = inject(ThemeService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly auth = inject(AuthService);
  private readonly db = getFirestore(app);
  private readonly functions = getFunctions(app);
  private readonly route = inject(ActivatedRoute);
  readonly isDarkMode = this.theme.isDarkMode;
  readonly billingInterval = signal<'monthly' | 'annual'>('monthly');
  readonly isProcessing = signal(false);
  readonly isPortalProcessing = signal(false);
  readonly checkoutError = signal<string | null>(null);
  readonly portalError = signal<string | null>(null);
  readonly limitReachedNotice = signal(false);

  readonly subscriptionPlan = signal<'free' | 'pro'>('free');
  readonly subscriptionStatus = signal<string>('inactive');
  readonly subscriptionInterval = signal<'monthly' | 'annual'>('monthly');
  readonly subscriptionPeriodEnd = signal<Timestamp | null>(null);
  readonly cancelAtPeriodEnd = signal<boolean>(false);
  private userSubscriptionCleanup: (() => void) | null = null;
  private userEffectRef: EffectRef | null = null;
  private routeSubscription: Subscription | null = null;

  readonly isPro = computed(() => this.subscriptionPlan() === 'pro');
  readonly renewalLabel = computed(() => {
    const periodEnd = this.subscriptionPeriodEnd();
    if (!periodEnd) {
      return '';
    }
    const date = periodEnd.toDate();
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  });

  constructor() {
    this.title.setTitle('Pricing - ReceiptNest AI');
    this.meta.updateTag({ name: 'description', content: 'Review your ReceiptNest AI plan and upgrade when you are ready.' });

    this.routeSubscription = this.route.queryParamMap.subscribe((params) => {
      this.limitReachedNotice.set(params.get('limit') === 'free');
    });

    this.userEffectRef = effect(
      () => {
        const user = this.auth.user();
        if (!user) {
          this.resetSubscriptionState();
          this.detachUserSubscription();
          return;
        }

        this.detachUserSubscription();
        const userRef = doc(this.db, 'users', user.id);
        this.userSubscriptionCleanup = onSnapshot(userRef, (snapshot) => {
          if (!snapshot.exists()) {
            this.resetSubscriptionState();
            return;
          }

          const data = snapshot.data();
          this.subscriptionPlan.set((data['subscriptionPlan'] as 'free' | 'pro') || 'free');
          this.subscriptionStatus.set(String(data['subscriptionStatus'] || 'inactive'));
          this.subscriptionInterval.set((data['subscriptionInterval'] as 'monthly' | 'annual') || 'monthly');
          this.subscriptionPeriodEnd.set((data['subscriptionCurrentPeriodEnd'] as Timestamp) || null);
          this.cancelAtPeriodEnd.set(Boolean(data['subscriptionCancelAtPeriodEnd']));
        });
      },
      { allowSignalWrites: true }
    );
  }

  toggleTheme() {
    this.theme.toggleTheme();
  }

  ngOnDestroy() {
    this.detachUserSubscription();
    this.userEffectRef?.destroy();
    this.userEffectRef = null;
    this.routeSubscription?.unsubscribe();
    this.routeSubscription = null;
  }

  setBillingInterval(interval: 'monthly' | 'annual') {
    this.billingInterval.set(interval);
  }

  async switchToPro() {
    this.checkoutError.set(null);
    this.isProcessing.set(true);
    try {
      const checkout = httpsCallable(this.functions, 'createCheckoutSession');
      const response = await checkout({ interval: this.billingInterval() });
      const data = response.data as { url?: string };
      if (!data?.url) {
        throw new Error('Missing checkout URL from server.');
      }
      window.location.assign(data.url);
    } catch (error: any) {
      console.error('Failed to start checkout', error);
      this.checkoutError.set('Unable to start checkout. Please try again in a moment.');
    } finally {
      this.isProcessing.set(false);
    }
  }

  async openBillingPortal() {
    this.portalError.set(null);
    this.isPortalProcessing.set(true);
    try {
      const portal = httpsCallable(this.functions, 'createPortalSession');
      const response = await portal({});
      const data = response.data as { url?: string };
      if (!data?.url) {
        throw new Error('Missing portal URL from server.');
      }
      window.location.assign(data.url);
    } catch (error) {
      console.error('Failed to open billing portal', error);
      this.portalError.set('Unable to open the billing portal right now.');
    } finally {
      this.isPortalProcessing.set(false);
    }
  }

  private resetSubscriptionState() {
    this.subscriptionPlan.set('free');
    this.subscriptionStatus.set('inactive');
    this.subscriptionInterval.set('monthly');
    this.subscriptionPeriodEnd.set(null);
    this.cancelAtPeriodEnd.set(false);
  }

  private detachUserSubscription() {
    if (this.userSubscriptionCleanup) {
      this.userSubscriptionCleanup();
      this.userSubscriptionCleanup = null;
    }
  }
}
