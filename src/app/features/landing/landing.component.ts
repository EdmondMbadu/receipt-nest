import {
  Component,
  afterNextRender,
  computed,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  PLATFORM_ID,
  signal,
  viewChild
} from '@angular/core';
import { CommonModule, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';

import { AppConfigService } from '../../services/app-config.service';
import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';

type DemoMonth = string;
type MobileStorePlatform = 'ios' | 'android' | 'unknown';

interface DemoMerchantTemplate {
  name: string;
  initials: string;
  category: string;
  amount: number;
  toneClass: string;
}

interface DemoReceipt {
  id: number;
  name: string;
  initials: string;
  category: string;
  amount: number;
  toneClass: string;
  dayLabel: string;
}

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.css'
})
export class LandingComponent implements OnDestroy {
  readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);
  private readonly appConfig = inject(AppConfigService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  readonly user = this.auth.user;
  readonly isDarkMode = this.theme.isDarkMode;
  readonly currentYear = new Date().getFullYear();
  readonly isMobileMenuOpen = signal(false);
  readonly isDemoOpen = signal(false);
  readonly openFaqIndex = signal<number | null>(null);
  readonly billingInterval = signal<'monthly' | 'annual'>('monthly');
  readonly googlePlayUrl = 'https://play.google.com/store/apps/details?id=com.receiptnest.mobile';
  readonly appStoreUrl = 'https://apps.apple.com/us/app/receiptnest-ai/id6762539388';
  readonly mobileStorePlatform = signal<MobileStorePlatform>('unknown');
  readonly showAppStoreButton = computed(() => this.mobileStorePlatform() !== 'android');
  readonly showGooglePlayButton = computed(() => this.mobileStorePlatform() !== 'ios');
  readonly demoVideo = viewChild<ElementRef<HTMLVideoElement>>('demoVideo');
  readonly freePlanReceiptLimit = this.appConfig.freePlanReceiptLimit;

  // ---- Live simulation (in-hero interactive dashboard) ----
  readonly demoMonths: DemoMonth[] = this.computeRecentDemoMonths();
  readonly selectedDemoMonth = signal<DemoMonth>(this.demoMonths[this.demoMonths.length - 1]);
  readonly demoReceiptsByMonth = signal<Record<DemoMonth, DemoReceipt[]>>(
    this.demoMonths.reduce((acc, m) => ({ ...acc, [m]: [] }), {} as Record<DemoMonth, DemoReceipt[]>)
  );
  readonly displayedDemoTotal = signal(0);
  readonly justAddedDemoReceiptId = signal<number | null>(null);
  private demoReceiptIdCounter = 0;
  private demoTotalAnimationFrame: number | null = null;

  // ---- Auto-play simulation state machine ----
  // Stages: idle → capture (camera/shutter) → scan (AI extraction) → add (slide into list) → loop
  readonly simStage = signal<'idle' | 'capture' | 'scan' | 'add' | 'complete'>('idle');
  readonly simMerchant = signal<DemoMerchantTemplate | null>(null);
  readonly simExtractedFields = signal<{ merchant: boolean; category: boolean; amount: boolean }>({
    merchant: false,
    category: false,
    amount: false
  });
  readonly simAutoPlay = signal(true);
  private simTimers: ReturnType<typeof setTimeout>[] = [];
  private simSequenceIndex = 0;
  private readonly simReceiptsPerCycle = 6;

  private readonly demoMerchantCatalog: DemoMerchantTemplate[] = [
    { name: 'Whole Foods Market', initials: 'WF', category: 'Groceries', amount: 86.41, toneClass: 'tone-emerald' },
    { name: 'Spotify', initials: 'SP', category: 'Subscription', amount: 9.99, toneClass: 'tone-green' },
    { name: 'Uber Eats', initials: 'UE', category: 'Food', amount: 34.20, toneClass: 'tone-orange' },
    { name: 'Starbucks', initials: 'SB', category: 'Coffee', amount: 6.75, toneClass: 'tone-amber' },
    { name: 'Target', initials: 'TG', category: 'Household', amount: 52.18, toneClass: 'tone-rose' },
    { name: 'Shell', initials: 'SH', category: 'Fuel', amount: 48.90, toneClass: 'tone-yellow' },
    { name: 'Apple', initials: 'AP', category: 'Electronics', amount: 129.00, toneClass: 'tone-slate' },
    { name: 'Trader Joe\'s', initials: 'TJ', category: 'Groceries', amount: 41.27, toneClass: 'tone-emerald' },
    { name: 'Netflix', initials: 'NF', category: 'Subscription', amount: 15.49, toneClass: 'tone-rose' },
    { name: 'CVS Pharmacy', initials: 'CV', category: 'Health', amount: 23.65, toneClass: 'tone-blue' },
    { name: 'Amazon', initials: 'AZ', category: 'Shopping', amount: 67.32, toneClass: 'tone-amber' },
    { name: 'Chipotle', initials: 'CH', category: 'Food', amount: 13.85, toneClass: 'tone-orange' }
  ];

  readonly currentDemoReceipts = computed(() => this.demoReceiptsByMonth()[this.selectedDemoMonth()]);
  readonly demoTotalSpend = computed(() =>
    this.currentDemoReceipts().reduce((sum, r) => sum + r.amount, 0)
  );
  readonly demoReceiptCount = computed(() => this.currentDemoReceipts().length);

  readonly demoChartPath = computed(() => {
    const receipts = this.currentDemoReceipts();
    if (receipts.length === 0) {
      return { line: '', area: '', dotX: 0, dotY: 40 };
    }

    let running = 0;
    const points = receipts.map((r, i) => {
      running += r.amount;
      const x = receipts.length === 1 ? 100 : (i / (receipts.length - 1)) * 200;
      return { x, value: running };
    });

    const max = Math.max(...points.map(p => p.value), 1);
    const mapped = points.map(p => ({ x: p.x, y: 70 - (p.value / max) * 56 }));

    if (mapped.length === 1) {
      const p = mapped[0];
      return {
        line: `M 0,70 L ${p.x},${p.y}`,
        area: `M 0,70 L ${p.x},${p.y} L ${p.x},80 L 0,80 Z`,
        dotX: p.x,
        dotY: p.y
      };
    }

    const linePath = mapped.reduce((acc, p, i) => {
      if (i === 0) return `M ${p.x},${p.y}`;
      const prev = mapped[i - 1];
      const cx = (prev.x + p.x) / 2;
      return `${acc} C ${cx},${prev.y} ${cx},${p.y} ${p.x},${p.y}`;
    }, '');

    const last = mapped[mapped.length - 1];
    const areaPath = `${linePath} L ${last.x},80 L 0,80 Z`;

    return { line: linePath, area: areaPath, dotX: last.x, dotY: last.y };
  });

  readonly displayName = computed(() => {
    const profile = this.user();
    if (!profile) {
      return '';
    }

    const name = `${profile.firstName} ${profile.lastName}`.trim();
    return name || profile.email;
  });

  constructor() {
    this.applySeoTags();

    afterNextRender(() => {
      this.mobileStorePlatform.set(this.detectMobileStorePlatform());
    });

    // Redirect to home if user is already authenticated
    effect(() => {
      if (this.auth.isAuthenticated()) {
        this.router.navigate(['/app']);
      }
    });

    // Kick off the cinematic auto-loop after the page settles
    if (this.canAutoPlayDemo()) {
      this.scheduleSim(900, () => this.runSimCycle());
    }
  }

  ngOnDestroy() {
    this.clearSimTimers();
    if (this.demoTotalAnimationFrame !== null) {
      cancelAnimationFrame(this.demoTotalAnimationFrame);
    }
  }

  toggleTheme() {
    this.theme.toggleTheme();
  }

  toggleMobileMenu() {
    this.isMobileMenuOpen.update(isOpen => !isOpen);
  }

  openDemo() {
    this.isDemoOpen.set(true);
    requestAnimationFrame(() => {
      this.demoVideo()?.nativeElement.play().catch(() => undefined);
    });
  }

  closeDemo() {
    const video = this.demoVideo()?.nativeElement;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    this.isDemoOpen.set(false);
  }

  toggleFaq(index: number) {
    this.openFaqIndex.update(current => current === index ? null : index);
  }

  setBillingInterval(interval: 'monthly' | 'annual') {
    this.billingInterval.set(interval);
  }

  // ---- Live simulation actions ----
  selectDemoMonth(month: DemoMonth) {
    if (this.selectedDemoMonth() === month) return;
    this.selectedDemoMonth.set(month);
    this.animateDemoTotalTo(this.demoTotalSpend());
  }

  addDemoReceipt(template?: DemoMerchantTemplate) {
    const month = this.selectedDemoMonth();
    const existing = this.demoReceiptsByMonth()[month];
    let chosen = template;
    if (!chosen) {
      const lastTemplateName = existing[0]?.name;
      const pool = this.demoMerchantCatalog.filter(m => m.name !== lastTemplateName);
      chosen = pool[Math.floor(Math.random() * pool.length)];
    }

    const day = Math.max(1, this.demoMonthAnchorDay(month) - existing.length);
    const dayLabel = `${month} ${day}`;
    const id = ++this.demoReceiptIdCounter;
    const receipt: DemoReceipt = {
      id,
      name: chosen.name,
      initials: chosen.initials,
      category: chosen.category,
      amount: chosen.amount,
      toneClass: chosen.toneClass,
      dayLabel
    };

    this.demoReceiptsByMonth.update(state => ({
      ...state,
      [month]: [receipt, ...state[month]]
    }));

    this.justAddedDemoReceiptId.set(id);
    setTimeout(() => {
      if (this.justAddedDemoReceiptId() === id) {
        this.justAddedDemoReceiptId.set(null);
      }
    }, 800);

    this.animateDemoTotalTo(this.demoTotalSpend());
  }

  resetDemoReceipts() {
    const month = this.selectedDemoMonth();
    this.demoReceiptsByMonth.update(state => ({ ...state, [month]: [] }));
    this.animateDemoTotalTo(0);
    this.simStage.set('idle');
    this.simMerchant.set(null);
    this.simExtractedFields.set({ merchant: false, category: false, amount: false });
  }

  // ---- Auto-play cinematic loop ----
  private canAutoPlayDemo(): boolean {
    if (!this.isBrowser) return false;
    try {
      return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return true;
    }
  }

  private detectMobileStorePlatform(): MobileStorePlatform {
    if (!this.isBrowser || typeof navigator === 'undefined') {
      return 'unknown';
    }

    const userAgent = navigator.userAgent || '';
    const platform = navigator.platform || '';
    const maxTouchPoints = navigator.maxTouchPoints || 0;
    const isIpadOsDesktopMode =
      /Macintosh/i.test(userAgent) && /Mac/i.test(platform) && maxTouchPoints > 1;

    if (/iPhone|iPad|iPod/i.test(userAgent) || isIpadOsDesktopMode) {
      return 'ios';
    }

    if (/Android/i.test(userAgent)) {
      return 'android';
    }

    return 'unknown';
  }

  private scheduleSim(delayMs: number, fn: () => void) {
    const handle = setTimeout(() => {
      this.simTimers = this.simTimers.filter(t => t !== handle);
      fn();
    }, delayMs);
    this.simTimers.push(handle);
  }

  private clearSimTimers() {
    for (const t of this.simTimers) {
      clearTimeout(t);
    }
    this.simTimers = [];
  }

  private pickNextSimMerchant(): DemoMerchantTemplate {
    const month = this.selectedDemoMonth();
    const existing = this.demoReceiptsByMonth()[month];
    const recentNames = new Set(existing.slice(0, 3).map(r => r.name));
    const pool = this.demoMerchantCatalog.filter(m => !recentNames.has(m.name));
    const source = pool.length > 0 ? pool : this.demoMerchantCatalog;
    return source[(this.simSequenceIndex++) % source.length];
  }

  // One full cycle: capture → scan → add → next (or reset & loop)
  private runSimCycle() {
    if (!this.simAutoPlay()) return;

    const month = this.selectedDemoMonth();
    const count = this.demoReceiptsByMonth()[month].length;

    // After N receipts, briefly celebrate and reset
    if (count >= this.simReceiptsPerCycle) {
      this.simStage.set('complete');
      this.scheduleSim(1600, () => {
        this.resetDemoReceipts();
        this.scheduleSim(700, () => this.runSimCycle());
      });
      return;
    }

    const merchant = this.pickNextSimMerchant();
    this.simMerchant.set(merchant);
    this.simExtractedFields.set({ merchant: false, category: false, amount: false });

    // Stage 1: capture (camera frames the receipt, shutter flash)
    this.simStage.set('capture');
    this.scheduleSim(1100, () => {
      // Stage 2: scan + AI extraction
      this.simStage.set('scan');
      this.scheduleSim(420, () => {
        this.simExtractedFields.update(f => ({ ...f, merchant: true }));
      });
      this.scheduleSim(820, () => {
        this.simExtractedFields.update(f => ({ ...f, category: true }));
      });
      this.scheduleSim(1180, () => {
        this.simExtractedFields.update(f => ({ ...f, amount: true }));
      });
      this.scheduleSim(1700, () => {
        // Stage 3: commit the receipt to the list with full animation
        this.simStage.set('add');
        this.addDemoReceipt(merchant);
        this.scheduleSim(900, () => {
          this.simStage.set('idle');
          this.simMerchant.set(null);
          // Stage 4: brief breath, then loop
          this.scheduleSim(700, () => this.runSimCycle());
        });
      });
    });
  }

  // Pause auto-play if the user manually interacts
  pauseSimForManualInteraction() {
    this.simAutoPlay.set(false);
    this.clearSimTimers();
    this.simStage.set('idle');
    this.simMerchant.set(null);
  }

  trackDemoReceipt(_: number, r: DemoReceipt) {
    return r.id;
  }

  formatDemoCurrency(value: number): string {
    return value.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  private computeRecentDemoMonths(): DemoMonth[] {
    const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    const months: DemoMonth[] = [];
    for (let offset = 2; offset >= 0; offset--) {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      months.push(labels[d.getMonth()]);
    }
    return months;
  }

  private demoMonthAnchorDay(month: DemoMonth): number {
    const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    const monthIdx = labels.indexOf(month);
    if (monthIdx === -1) return 28;
    if (monthIdx === now.getMonth()) {
      return now.getDate();
    }
    return new Date(now.getFullYear(), monthIdx + 1, 0).getDate();
  }

  private animateDemoTotalTo(target: number) {
    if (this.demoTotalAnimationFrame !== null) {
      cancelAnimationFrame(this.demoTotalAnimationFrame);
    }
    const start = this.displayedDemoTotal();
    const delta = target - start;
    if (Math.abs(delta) < 0.005) {
      this.displayedDemoTotal.set(target);
      return;
    }
    const duration = 480;
    const startTime = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      this.displayedDemoTotal.set(start + delta * eased);
      if (t < 1) {
        this.demoTotalAnimationFrame = requestAnimationFrame(step);
      } else {
        this.demoTotalAnimationFrame = null;
      }
    };
    this.demoTotalAnimationFrame = requestAnimationFrame(step);
  }

  private applySeoTags() {
    const pageTitle = 'ReceiptNest AI | Receipt Organizer & Expense Tracker';
    const description =
      'ReceiptNest AI is a receipt organizer and expense tracker that turns scattered receipts into a clear picture of your spending: auto-organized, tax-ready, and private by default.';
    const keywords =
      'ReceiptNest AI, ReceiptNest, receipt organizer, AI receipt organizer, receipt scanner, receipt tracker, receipt management software, expense tracker, receipt inbox, tax-ready receipts';
    const canonicalUrl = 'https://receipt-nest.com/';
    const previewImage = 'https://receipt-nest.com/assets/og-image.png';
    const previewAlt = 'ReceiptNest AI receipt organizer dashboard';

    this.title.setTitle(pageTitle);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ name: 'keywords', content: keywords });
    this.meta.updateTag({ name: 'author', content: 'ReceiptNest AI' });
    this.meta.updateTag({ name: 'robots', content: 'index, follow' });
    this.meta.updateTag({
      name: 'googlebot',
      content: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
    });
    this.meta.updateTag({ name: 'application-name', content: 'ReceiptNest AI' });
    this.meta.updateTag({ property: 'og:type', content: 'website' }, "property='og:type'");
    this.meta.updateTag({ property: 'og:url', content: canonicalUrl }, "property='og:url'");
    this.meta.updateTag({ property: 'og:title', content: pageTitle }, "property='og:title'");
    this.meta.updateTag({ property: 'og:description', content: description }, "property='og:description'");
    this.meta.updateTag({ property: 'og:image', content: previewImage }, "property='og:image'");
    this.meta.updateTag({ property: 'og:image:alt', content: previewAlt }, "property='og:image:alt'");
    this.meta.updateTag({ property: 'og:site_name', content: 'ReceiptNest AI' }, "property='og:site_name'");
    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.meta.updateTag({ name: 'twitter:url', content: canonicalUrl });
    this.meta.updateTag({ name: 'twitter:title', content: pageTitle });
    this.meta.updateTag({ name: 'twitter:description', content: description });
    this.meta.updateTag({ name: 'twitter:image', content: previewImage });
    this.meta.updateTag({ name: 'twitter:image:alt', content: previewAlt });
    this.updateCanonical(canonicalUrl);
  }

  private updateCanonical(url: string) {
    let canonical = this.document.querySelector<HTMLLinkElement>('link[rel="canonical"]');

    if (!canonical) {
      canonical = this.document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      this.document.head.appendChild(canonical);
    }

    canonical.setAttribute('href', url);
  }
}
