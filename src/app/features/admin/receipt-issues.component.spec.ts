import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ReceiptIssuesComponent } from './receipt-issues.component';
import { ReceiptIssueDetailComponent } from './receipt-issue-detail.component';
import { IssueDetail, ReceiptIssueRow, ReceiptIssuesService } from './receipt-issues.service';

const issue = (id: string, kind: ReceiptIssueRow['kind'], state: ReceiptIssueRow['state'] = 'open'): ReceiptIssueRow => ({
  userId: 'customer', receiptId: id, email: 'customer@example.com', fileName: 'receipt.jpg', merchant: 'Market',
  kind, state, reason: `${kind} reason`, recommendation: 'Inspect the original', cause: 'unknown', notes: '',
  openedAt: '2026-10-20T12:00:00Z', updatedAt: '2026-10-20T12:00:00Z', resolvedAt: null, active: false,
  model: 'Not recorded', pipelineVersion: 'Not recorded',
});

describe('Receipt issues workspace', () => {
  function mockService() {
    const rows = signal([issue('failed', 'failed'), issue('stuck', 'stuck'), issue('partial', 'incomplete', 'awaiting_user'), issue('fixed', 'failed', 'resolved')]);
    return {
      rows, loading: signal(false), loaded: signal(true), error: signal(''), fetchedAt: signal('2026-10-29T12:00:00Z'),
      unresolved: computed(() => rows().filter(row => row.state !== 'resolved')), affectedUsers: signal(1), oldest: signal('2026-10-20T12:00:00Z'),
      load: jasmine.createSpy('load').and.resolveTo(), act: jasmine.createSpy('act').and.resolveTo({}),
      detail: jasmine.createSpy('detail'), message: (_error: unknown, fallback: string) => fallback,
      preview: jasmine.createSpy('preview').and.resolveTo({imageUrl:'',pdfUrl:'',originalUrl:'',error:'File missing. You can still enter values.'}),
    };
  }
  async function queue() {
    const service = mockService();
    await TestBed.configureTestingModule({ imports: [ReceiptIssuesComponent], providers: [provideZonelessChangeDetection(), provideRouter([]), { provide: ReceiptIssuesService, useValue: service }] }).compileComponents();
    const fixture = TestBed.createComponent(ReceiptIssuesComponent); fixture.detectChanges(); await fixture.whenStable();
    return { fixture, component: fixture.componentInstance, service };
  }
  it('keeps awaiting-user receipts unresolved, separates resolved history, and filters search results', async () => {
    const { fixture, component } = await queue();
    expect(component.count('all')).toBe(3); expect(component.count('awaiting_user')).toBe(1);
    expect(component.visible().map(row => row.receiptId)).toEqual(['failed', 'stuck', 'partial']);
    component.selectPattern('unknown|failed reason'); expect(component.filter()).toBe('all_history');
    expect(component.visible().length).toBe(2); component.pattern.set('');
    component.setFilter('resolved'); expect(component.visible().map(row => row.receiptId)).toEqual(['fixed']);
    component.setFilter('all'); component.search.set('partial'); fixture.detectChanges();
    expect(component.visible().length).toBe(1); expect(fixture.nativeElement.textContent).toContain('Awaiting user');
  });
  it('keeps stale results visible on refresh failure and shows an actionable error', async () => {
    const { fixture, service } = await queue(); service.error.set('Service unavailable'); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('previous results are still shown');
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(3);
  });
  it('clamps pagination after a refresh removes rows and groups recurring problems across states', async () => {
    const { component, service } = await queue();
    service.rows.set(Array.from({length: 30}, (_,i) => issue(`receipt-${i}`, 'failed')));
    component.page.set(2); expect(component.visible().length).toBe(5);
    service.rows.set([issue('only-one', 'failed')]); expect(component.currentPage()).toBe(1); expect(component.visible().length).toBe(1);
    expect(component.patterns()[0].count).toBe(1);
  });
  it('reverses the date sort across issue types while keeping the priority order available', async () => {
    const {component,service,fixture}=await queue();
    service.rows.set([
      {...issue('old-failure','failed'),openedAt:'2026-05-01T12:00:00Z'},
      {...issue('new-incomplete','incomplete'),openedAt:'2026-10-28T12:00:00Z'},
      {...issue('middle-stuck','stuck'),openedAt:'2026-07-01T12:00:00Z'},
    ]);
    expect(component.visible().map(row=>row.receiptId)).toEqual(['old-failure','middle-stuck','new-incomplete']);
    component.page.set(2);component.toggleDateSort();fixture.detectChanges();
    expect(component.page()).toBe(1);expect(component.sort()).toBe('newest');
    expect(component.visible().map(row=>row.receiptId)).toEqual(['new-incomplete','middle-stuck','old-failure']);
    expect(fixture.nativeElement.querySelector('th[aria-sort]')?.getAttribute('aria-sort')).toBe('descending');
    component.toggleDateSort();expect(component.visible().map(row=>row.receiptId)).toEqual(['old-failure','middle-stuck','new-incomplete']);
    component.setSort('priority');expect(component.sortDescription()).toContain('Failures first');
  });
  it('sorts resolved history by its displayed resolution date and leaves unknown dates at the end', async () => {
    const {component,service,fixture}=await queue();
    service.rows.set([
      {...issue('recent','failed','resolved'),openedAt:'2025-01-01',resolvedAt:'2026-10-28'},
      {...issue('earlier','incomplete','resolved'),openedAt:'2026-10-27',resolvedAt:'2026-10-20'},
      {...issue('unknown','incomplete','resolved'),resolvedAt:'invalid-date'},
    ]);
    component.setFilter('resolved');component.setSort('newest');
    expect(component.visible().map(row=>row.receiptId)).toEqual(['recent','earlier','unknown']);
    component.setSort('oldest');fixture.detectChanges();
    expect(component.visible().map(row=>row.receiptId)).toEqual(['earlier','recent','unknown']);
    expect(fixture.nativeElement.textContent).toContain('Date unknown');
  });

  async function workspace(active = false) {
    const service = mockService();
    const detail: IssueDetail = { revision: 123, row: {...issue('stuck','stuck'), active},
      receipt: {id:'stuck',userId:'customer',status:active?'processing':'needs_review',totalAmount:25,currency:'USD',date:'2026-10-20',merchant:'Market',category:'Groceries',createdAt:'2026-10-20',updatedAt:'2026-10-20'},
      issue: {cause:'unknown'},events:[],historyLimited:false };
    service.detail.and.resolveTo(detail);
    await TestBed.configureTestingModule({ imports: [ReceiptIssueDetailComponent], providers: [provideZonelessChangeDetection(), provideRouter([]), {provide:ActivatedRoute,useValue:{paramMap:of(convertToParamMap({userId:'customer',receiptId:'stuck'}))}}, {provide:ReceiptIssuesService,useValue:service}] }).compileComponents();
    const fixture = TestBed.createComponent(ReceiptIssueDetailComponent); fixture.detectChanges(); await fixture.whenStable(); await service.preview.calls.mostRecent().returnValue; await fixture.whenStable(); fixture.detectChanges();
    return {fixture, component:fixture.componentInstance, service, detail};
  }
  it('locks actions while a retry of a stuck receipt is running', async () => {
    const {component,fixture,service} = await workspace(true);
    expect(component.active()).toBeTrue();
    const retry = [...fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>].find(button=>button.textContent?.includes('Running…'));
    expect(retry?.disabled).toBeTrue(); await component.act('retry'); expect(service.act).not.toHaveBeenCalled();
  });
  it('records verified corrections with a root cause and requires notes before awaiting-user or flag actions', async () => {
    const {component,service} = await workspace();
    await component.act('awaiting_user'); expect(service.act).not.toHaveBeenCalled(); expect(component.error()).toContain('Add a note');
    component.notes.set('Subtotal was mistaken for total'); component.cause.set('extraction_mistake'); component.amount.set(30);
    await component.act('correct');
    expect(service.act).toHaveBeenCalledWith(jasmine.objectContaining({action:'correct',revision:123,cause:'extraction_mistake',values:jasmine.objectContaining({totalAmount:30})}));
  });
  it('loads the original through the admin preview endpoint and keeps manual entry available without an image', async () => {
    const {component,fixture,service} = await workspace();
    expect(service.preview).toHaveBeenCalledWith('customer','stuck');
    expect(fixture.nativeElement.textContent).toContain('File missing. You can still enter values.');
    const save=[...fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>].find(button=>button.textContent?.includes('Save to user’s receipt'));
    expect(save?.disabled).toBeFalse();
    component.merchant.set('Manual value'); component.reloadPreview(); await fixture.whenStable();
    expect(component.merchant()).toBe('Manual value');
  });
  it('renders a real image response from the preview loader', async () => {
    const {component,fixture,service} = await workspace();
    const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
    service.preview.and.resolveTo({imageUrl:image,pdfUrl:'',originalUrl:image,error:''});
    component.reloadPreview(); await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.preview-surface img')?.getAttribute('src')).toBe(image);
  });
  it('run again fills detected values while preserving unsaved admin edits through polling', async () => {
    const {component,service,detail}=await workspace();
    component.merchant.set('Verified merchant');
    service.detail.and.resolveTo({...detail,revision:124,row:{...detail.row!,active:true},receipt:{...detail.receipt,status:'processing'}});
    await component.act('retry'); expect(component.merchant()).toBe('Verified merchant');expect(component.active()).toBeTrue();
    service.detail.and.resolveTo({...detail,revision:125,receipt:{...detail.receipt,totalAmount:40,currency:'CAD',merchant:'Detected merchant'}});
    await component.load(false);
    expect(component.merchant()).toBe('Verified merchant');expect(component.amount()).toBe(40);expect(component.currency()).toBe('CAD');
    await component.act('correct');
    expect(service.act).toHaveBeenCalledWith(jasmine.objectContaining({action:'correct',revision:125,values:jasmine.objectContaining({merchant:'Verified merchant',totalAmount:40})}));
  });
  it('a failed rerun keeps the form editable and reports the failure without losing the draft', async () => {
    const {component,service,detail}=await workspace();
    component.amount.set(55);
    service.detail.and.resolveTo({...detail,revision:124,row:{...detail.row!,active:true},receipt:{...detail.receipt,status:'processing'}});
    await component.act('retry');
    service.detail.and.resolveTo({...detail,revision:125,row:{...detail.row!,kind:'failed',active:false}});
    await component.load(false);
    expect(component.amount()).toBe(55);expect(component.active()).toBeFalse();expect(component.error()).toContain('Run again could not finish');
    expect(component.canCorrect()).toBeTrue();
  });
});
