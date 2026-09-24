import {
  Component,
  afterNextRender,
  computed,
  ElementRef,
  inject,
  OnDestroy,
  PLATFORM_ID,
  signal,
  viewChild
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';

import { AppConfigService } from '../../services/app-config.service';
import { AuthService } from '../../services/auth.service';
import { getPublicPage, workflowPages, informationPages } from '../../content/public-pages';
import { SeoService } from '../../services/seo.service';
import { ThemeService } from '../../services/theme.service';
import { blogPosts } from '../blog/blog-posts';

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
  private readonly appConfig = inject(AppConfigService);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly seo = inject(SeoService);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  readonly user = this.auth.user;
  readonly isDarkMode = this.theme.isDarkMode;
  readonly currentYear = new Date().getFullYear();
  readonly publicLinks = [...workflowPages, ...informationPages];
  readonly latestArticles = [
    ...blogPosts.filter(article => article.slug === 'can-bank-statements-replace-receipts'),
    ...blogPosts.filter(article => article.slug !== 'can-bank-statements-replace-receipts' && article.slug !== 'the-last-mile').slice(0, 2)
  ];
  readonly faqItems = [
    {
      question: 'What is ReceiptNest?',
      answer: 'ReceiptNest is a receipt app for freelancers and self-employed people. Forward email receipts, snap photos, or upload PDFs, then review and find your receipts when you need them. Export your records when your accountant asks.'
    },
    {
      question: 'Does ReceiptNest do my taxes?',
      answer: 'No. ReceiptNest keeps your receipts organized and lets you export them for yourself or your accountant. It does not prepare or file tax returns or give tax advice.'
    },
    {
      question: 'How do receipts get into ReceiptNest?',
      answer: 'Forward receipt emails to the address in your account, snap a photo, or upload a PDF. Forwarding a receipt does not connect ReceiptNest to your inbox.'
    },
    {
      question: 'Can I export receipts for my accountant?',
      answer: 'Yes. Export receipt records to CSV, or use Pro for PDF exports. You can review and filter your records before handing them off.'
    },
    {
      question: 'Is my data private?',
      answer: 'ReceiptNest uses account-based access and cloud services for storage and extraction. Read the data-handling overview before uploading sensitive records. Export and deletion controls are available in your account.'
    },
    {
      question: 'What happens if I cancel?',
      answer: 'You keep access to your data. Pro features are disabled, but you can still view and export your existing receipts.'
    },
    {
      question: 'Is ReceiptNest accounting software?',
      answer: 'No. ReceiptNest focuses on capturing, finding, and exporting receipts. If you need invoicing, payroll, or double-entry accounting, a broader accounting tool is better suited.'
    },
    {
      question: 'How is ReceiptNest different from Wave or Expensify?',
      answer: 'Wave and Expensify support broader accounting and expense workflows. ReceiptNest focuses on the receipts you send it and keeps them ready to hand off. There is no bank connection or bookkeeping workflow.'
    },
    {
      question: 'Can I switch plans later?',
      answer: 'Yes. You can start on Free and upgrade to Pro when you need unlimited receipts and additional export tools.'
    },
    {
      question: 'Do you sell my data?',
      answer: 'Service providers process receipt data to operate the product, including cloud storage and AI extraction. Our data-handling overview explains this workflow and how to contact support about deletion or privacy requirements.'
    }
  ] as const;
  readonly isMobileMenuOpen = signal(false);
  readonly isDemoOpen = signal(false);
  readonly openFaqIndex = signal<number | null>(null);
  readonly billingInterval = signal<'monthly' | 'annual'>('annual');
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
    { name: 'Staples', initials: 'ST', category: 'Office supplies', amount: 86.41, toneClass: 'tone-emerald' },
    { name: 'Adobe', initials: 'AD', category: 'Software', amount: 29.99, toneClass: 'tone-green' },
    { name: 'USPS', initials: 'US', category: 'Shipping', amount: 34.20, toneClass: 'tone-orange' },
    { name: 'Zoom', initials: 'ZM', category: 'Software', amount: 15.99, toneClass: 'tone-amber' },
    { name: 'Office Depot', initials: 'OD', category: 'Office supplies', amount: 52.18, toneClass: 'tone-rose' },
    { name: 'FedEx', initials: 'FX', category: 'Shipping', amount: 48.90, toneClass: 'tone-yellow' },
    { name: 'Canva', initials: 'CA', category: 'Software', amount: 12.99, toneClass: 'tone-slate' },
    { name: 'Dropbox', initials: 'DB', category: 'Software', amount: 11.99, toneClass: 'tone-emerald' },
    { name: 'Parking', initials: 'PK', category: 'Travel', amount: 15.49, toneClass: 'tone-rose' },
    { name: 'Print Shop', initials: 'PS', category: 'Marketing', amount: 23.65, toneClass: 'tone-blue' },
    { name: 'Amazon Business', initials: 'AB', category: 'Office supplies', amount: 67.32, toneClass: 'tone-amber' },
    { name: 'Domain Renewal', initials: 'DR', category: 'Software', amount: 13.85, toneClass: 'tone-orange' }
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
    void this.redirectSignedInUserToApp();
    this.applySeoTags();

    afterNextRender(() => {
      this.mobileStorePlatform.set(this.detectMobileStorePlatform());
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
    const page = getPublicPage('/');
    this.seo.apply({ title: page.title, description: page.description, canonicalPath: page.path });
    this.seo.setSoftwareApplication();
  }

  private async redirectSignedInUserToApp(): Promise<void> {
    if (!this.isBrowser) {
      return;
    }

    await this.auth.waitForAuthState();
    await this.auth.waitForInitialization();

    if (this.auth.isAuthenticated()) {
      await this.router.navigateByUrl('/app', { replaceUrl: true });
    }
  }

}
