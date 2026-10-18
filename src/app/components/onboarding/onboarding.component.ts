import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ReceiptTourService, TourStep } from '../../services/receipt-tour.service';
import { placeTourTip, TourPlacement, TourRect } from '../../utils/tour-placement';
import { trackGettingStarted } from '../../utils/getting-started';

const STEPS: Record<TourStep, {number: number; target: string; title: string; copy: string; action?: string}> = {
  add: {number:1,target:'add',title:'Start here: add a receipt.',copy:'Tap this button to scan paper or upload a photo or PDF. We’ll guide you through the real upload.',action:'Add Receipt'},
  choose: {number:2,target:'upload-options',title:'Choose how to add it.',copy:'Use Scan Receipt for paper, or Upload Existing File for a photo or PDF you already have.',action:'Choose a file'},
  process: {number:2,target:'process',title:'Ready? Process your receipt.',copy:'Check the preview above. This button uploads your receipt so we can read and organize the details.',action:'Process Receipt'},
  uploading: {number:2,target:'upload-progress',title:'Your receipt is uploading.',copy:'Keep this window open. The next tip appears when your receipt reaches the dashboard.'},
  processing: {number:3,target:'receipt',title:'We’re reading the details.',copy:'ReceiptNest is finding the merchant, amount, date and category. You can leave the guide and come back later.'},
  receipt: {number:3,target:'receipt',title:'Open your receipt.',copy:'Your receipt lives right here. Open it to see the organized details and original file.',action:'Open this receipt'},
  details: {number:4,target:'details',title:'The details are already here.',copy:'Merchant, amount, date and category are filled automatically. For most receipts, you’re done. Editing and notes are optional.',action:'Show the download button'},
  original: {number:5,target:'original-download',title:'Download the original here.',copy:'This Download button saves the original receipt to your device. It is available on Free and Pro.',action:'Download original'},
  search: {number:6,target:'search',title:'Find it again in seconds.',copy:'Search here by merchant, amount or date. You can try a search now, or continue to monthly exports.',action:'Show monthly exports'},
  monthly: {number:7,target:'download',title:'Download a whole month.',copy:'Each month has its own Download menu. Open this one to see the export options.',action:'Open Download menu'},
  exports: {number:7,target:'export-options',title:'Choose the format you need.',copy:'CSV gives you a spreadsheet. PDF combines the receipt documents and requires Pro. You can finish without downloading.',action:'Finish tour'}
};

@Component({selector:'app-onboarding',standalone:true,imports:[RouterLink],templateUrl:'./onboarding.component.html',styleUrl:'./onboarding.component.css'})
export class OnboardingComponent implements AfterViewInit, OnDestroy {
  readonly tour = inject(ReceiptTourService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  @ViewChild('panel') panel?: ElementRef<HTMLElement>;
  @ViewChild('heading') heading?: ElementRef<HTMLElement>;
  @ViewChild('previewBar') previewBar?: ElementRef<HTMLElement>;
  readonly rect = signal<TourRect | null>(null);
  readonly placement = signal<TourPlacement | null>(null);
  readonly unavailable = signal(false);
  readonly tip = computed(() => STEPS[this.tour.step()]);
  readonly copy = computed(() => {
    const status = this.tour.receiptStatus();
    if (['receipt','details'].includes(this.tour.step()) && ['needs_review','extracted'].includes(status ?? '')) return 'This receipt is marked Needs Review. Open the details, check them against the original, then use Confirm & Save. Most receipts are organized without this extra step.';
    if (['receipt','details'].includes(this.tour.step()) && ['error','failed'].includes(status ?? '')) return 'This receipt could not be processed. Open it to check the problem or upload a clearer image. You can still find the original download below.';
    return this.tip().copy;
  });
  private target: HTMLElement | null = null;
  private frame = 0;
  private mounted = false;
  private destroyed = false;
  private observer?: MutationObserver;
  private resizeObserver?: ResizeObserver;
  private missingTimer?: ReturnType<typeof setTimeout>;
  private previousFocus: HTMLElement | null = null;
  private lastKey = '';
  private shouldScroll = false;
  private readonly refresh = () => this.schedule(false);
  private readonly escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && this.tour.active() && !this.tour.cameraActive()) this.close(); };
  private readonly watchState = effect(() => {
    const key = [this.tour.mode(),this.tour.step(),this.tour.receiptId(),this.tour.cameraActive(),this.tour.previewEnabled()].join(':');
    const changed = key !== this.lastKey; this.lastKey = key;
    if (changed) { this.unavailable.set(false); clearTimeout(this.missingTimer); this.missingTimer=undefined; }
    if (this.mounted) this.schedule(changed);
  });
  ngAfterViewInit(): void {
    this.mounted = true; this.previousFocus = document.activeElement as HTMLElement;
    window.addEventListener('resize', this.refresh);
    document.addEventListener('scroll', this.refresh, true);
    document.addEventListener('keydown', this.escape);
    this.observer = new MutationObserver(records => {
      if (records.some(r => !this.host.nativeElement.contains(r.target))) this.schedule(false);
    });
    this.observer.observe(document.body,{childList:true,subtree:true});
    this.resizeObserver = new ResizeObserver(this.refresh);
    this.schedule(true);
  }
  private findTarget(kind: string): HTMLElement | null {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(`[data-onboarding="${kind}"]`));
    const visible = elements.filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (kind === 'receipt' && this.tour.receiptId()) return visible.find(el=>el.dataset['receiptId'] === this.tour.receiptId()) ?? null;
    // Prefer the main Add Receipt button when it is visible; otherwise use the floating button.
    return visible.find(el => {const r=el.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight;}) ?? visible[0] ?? null;
  }
  private schedule(scroll: boolean): void {
    if (this.destroyed) return;
    this.shouldScroll ||= scroll;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.measure());
  }
  private measure(): void {
    if (this.destroyed || !this.tour.active() || this.tour.cameraActive()) { this.rect.set(null); return; }
    const target = this.findTarget(this.tour.mode() === 'done' ? 'help' : this.tip().target);
    if (!target) {
      this.rect.set(null); this.placement.set(null);
      if (!this.missingTimer) this.missingTimer = setTimeout(()=> {this.unavailable.set(true);this.missingTimer=undefined;},5000);
      return;
    }
    clearTimeout(this.missingTimer); this.missingTimer=undefined; this.unavailable.set(false);
    if (target !== this.target) { this.resizeObserver?.disconnect(); this.resizeObserver?.observe(target); this.target=target; this.shouldScroll=true; }
    if (this.panel) this.resizeObserver?.observe(this.panel.nativeElement);
    if (this.shouldScroll && getComputedStyle(target).position !== 'fixed') target.scrollIntoView({block:'start',behavior:'instant'});
    const focus = this.shouldScroll; this.shouldScroll=false;
    const r=target.getBoundingClientRect();
    const rect={left:r.left-5,top:r.top-5,width:r.width+10,height:r.height+10};
    this.rect.set(rect);
    const width=Math.min(336,innerWidth-24);
    // Measure content only: the external arrow must not inflate the next layout pass.
    const height=(this.panel?.nativeElement.querySelector<HTMLElement>('.panel-content')?.scrollHeight ?? 233) + 2;
    const inset=this.previewBar ? this.previewBar.nativeElement.getBoundingClientRect().bottom+10 : 12;
    this.placement.set(placeTourTip(rect,width,height,innerWidth,innerHeight,inset));
    this.tour.markVisible();
    if (focus) this.heading?.nativeElement.focus({preventScroll:true});
  }
  primary(): void {
    switch(this.tour.step()) {
      case 'add': this.activate('add'); break;
      case 'choose': this.activate('upload-file'); break;
      case 'process': this.activate('process'); break;
      case 'receipt': this.activate('receipt'); break;
      case 'details': this.tour.go('original'); break;
      case 'original': this.activate('original-download'); break;
      case 'search': if (this.tour.availableReceiptId()) this.tour.go('monthly'); else this.tour.complete(); break;
      case 'monthly': this.activate('download'); break;
      case 'exports': this.activate('download'); this.tour.complete(); break;
    }
  }
  private activate(kind: string): void { this.findTarget(kind)?.click(); }
  back(): void {
    switch(this.tour.step()) {
      case 'choose': case 'process': case 'uploading': this.activate('upload-close'); break;
      case 'receipt': this.tour.go('add'); break;
      case 'details': void this.tour.returnToSearch(); break;
      case 'original': this.tour.go('details'); break;
      case 'search': this.tour.go('add'); break;
      case 'monthly': this.tour.go('search'); break;
      case 'exports': this.activate('download'); break;
      default: this.close();
    }
  }
  restart(): void { this.activate('upload-close'); if(this.tour.step() === 'exports')this.activate('download'); void this.tour.restartPreview(); }
  close(): void { this.tour.dismiss(); if(this.previousFocus?.isConnected)this.previousFocus.focus({preventScroll:true}); }
  watch(): void { if(!this.tour.preview())trackGettingStarted('tutorial_click','onboarding'); }
  ngOnDestroy(): void {
    this.destroyed=true; cancelAnimationFrame(this.frame);clearTimeout(this.missingTimer);
    this.observer?.disconnect();this.resizeObserver?.disconnect();
    window.removeEventListener('resize',this.refresh);document.removeEventListener('scroll',this.refresh,true);document.removeEventListener('keydown',this.escape);
  }
}
