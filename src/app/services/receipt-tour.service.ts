import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { GettingStartedService } from './getting-started.service';
import { AuthService } from './auth.service';
import { trackGettingStarted } from '../utils/getting-started';

export type TourStep = 'add' | 'choose' | 'process' | 'uploading' | 'processing' | 'receipt' | 'details' | 'original' | 'search' | 'monthly' | 'exports';
export type UploadGuideStage = 'choose' | 'process' | 'uploading' | 'camera';
export type GuideMode = 'hidden' | 'intro' | 'resume' | 'tour' | 'done';

@Injectable({ providedIn: 'root' })
export class ReceiptTourService {
  private readonly persistence = inject(GettingStartedService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly mode = signal<GuideMode>('hidden');
  readonly step = signal<TourStep>('add');
  readonly preview = signal(false);
  readonly previewEnabled = signal(true);
  readonly cameraActive = signal(false);
  readonly uploadOpen = signal(false);
  readonly receiptId = signal<string | null>(null);
  readonly receiptStatus = signal<string | null>(null);
  readonly availableReceiptId = signal<string | null>(null);
  readonly active = computed(() => ['intro', 'tour', 'done'].includes(this.mode()) && (!this.preview() || this.previewEnabled()));
  readonly section = computed(() => ['add','choose','process','uploading'].includes(this.step()) ? 1 : ['processing','receipt','details'].includes(this.step()) ? 2 : 3);
  private seenRecorded = false;
  private owner: string | null = null;
  private readonly accountChanged = effect(() => {
    const uid = this.auth.user()?.id ?? null;
    if (this.owner && this.owner !== uid) {
      this.mode.set('hidden'); this.preview.set(false); this.receiptId.set(null); this.availableReceiptId.set(null);
    }
    this.owner = uid;
  });

  introduce(): void { this.step.set('add'); this.mode.set('intro'); this.seenRecorded = false; }
  markVisible(): void {
    if (this.mode() === 'intro' && !this.seenRecorded && !this.preview()) {
      this.seenRecorded = true;
      this.persistence.save({ action: 'seen', step: 0 });
    }
  }
  start(preview = false): void {
    if (preview && this.auth.user()?.role !== 'admin') return;
    this.preview.set(preview); this.previewEnabled.set(true); this.cameraActive.set(false);
    this.receiptId.set(null); this.receiptStatus.set(null); this.mode.set('tour'); this.go('add');
    if (!preview) trackGettingStarted('onboarding_start', 'dashboard');
  }
  resume(): void {
    this.mode.set('tour');
    const saved = this.persistence.progress()?.step ?? 1;
    this.go(saved >= 3 && this.availableReceiptId() ? 'search' : saved >= 2 && this.availableReceiptId() ? 'receipt' : 'add');
  }
  go(step: TourStep): void {
    this.step.set(step);
    if (this.mode() === 'intro') this.mode.set('tour');
    if (!this.preview()) this.persistence.save({ action: 'progress', step: this.section() });
  }
  enterHome(): void {
    if (this.active() && ['details','original'].includes(this.step())) this.go('search');
  }
  uploadOpened(): void { this.uploadOpen.set(true); if (this.active()) this.go('choose'); }
  uploadChanged(stage: UploadGuideStage): void {
    if (!this.active() || !['choose','process','uploading'].includes(this.step())) return;
    this.cameraActive.set(stage === 'camera');
    if (stage !== 'camera' && stage !== this.step()) this.go(stage);
  }
  uploadClosed(): void {
    this.uploadOpen.set(false);
    this.cameraActive.set(false);
    if (this.active() && ['choose','process','uploading'].includes(this.step())) this.go('add');
  }
  uploaded(id: string, status: string): void {
    this.uploadOpen.set(false);
    if (!this.active()) return;
    this.cameraActive.set(false); this.receiptId.set(id); this.receiptStatus.set(status); this.go('processing');
    this.updateReceipt(status);
  }
  updateReceipt(status: string): void {
    this.receiptStatus.set(status);
    if (this.active() && this.step() === 'processing' && !['uploaded','processing'].includes(status)) this.go('receipt');
  }
  useExisting(): void {
    this.receiptId.set(this.availableReceiptId()); this.receiptStatus.set(null); this.go('receipt');
  }
  receiptOpened(id: string): void {
    if (!this.active()) return;
    this.receiptId.set(id); this.go('details');
  }
  receiptLoaded(id: string, status: string): void {
    if (!this.active()) return;
    this.receiptId.set(id); this.receiptStatus.set(status);
    if (!['details','original'].includes(this.step())) this.go('details');
  }
  menuChanged(open: boolean): void {
    if (!this.active()) return;
    if (open && ['monthly','search'].includes(this.step())) this.go('exports');
    else if (!open && this.step() === 'exports') this.go('monthly');
  }
  async returnToSearch(): Promise<void> { this.go('search'); await this.router.navigate(['/app']); }
  downloaded(kind: 'original' | 'export'): void {
    if (!this.active()) return;
    if (kind === 'original' && this.step() === 'original') void this.returnToSearch();
    if (kind === 'export' && ['exports','monthly'].includes(this.step())) this.complete();
  }
  complete(): void {
    this.mode.set('done');
    if (!this.preview()) this.persistence.save({ action: 'complete', step: 4 });
  }
  dismiss(): void {
    if (!this.preview() && this.mode() !== 'done') this.persistence.save({ action: 'dismiss', step: this.section() });
    this.mode.set('hidden'); this.cameraActive.set(false);
  }
  togglePreview(): void {
    this.previewEnabled.update(v => !v);
    if (this.previewEnabled()) { this.start(true); void this.router.navigate(['/app']); }
    else this.mode.set('hidden');
  }
  async restartPreview(): Promise<void> { this.start(true); await this.router.navigate(['/app']); }
  exitPreview(): void { this.mode.set('hidden'); this.preview.set(false); this.cameraActive.set(false); }
}
