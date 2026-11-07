import { ReceiptIssueRow, ReceiptIssuesService } from './receipt-issues.service';

class TestReceiptIssuesService extends ReceiptIssuesService {
  changed?: () => void;
  failed?: () => void;
  readonly unsubscribe = jasmine.createSpy('unsubscribe');
  protected override listenForChanges(changed: () => void, failed: () => void) {
    this.changed = changed; this.failed = failed;
    return this.unsubscribe;
  }
  readonly request = jasmine.createSpy('request').and.resolveTo({ rows: [], fetchedAt: '2026-10-30T12:00:00Z' });
  protected override fetchRows(): Promise<{ rows: ReceiptIssueRow[]; fetchedAt: string }> {
    return this.request();
  }
}

describe('Receipt issues queue freshness', () => {
  it('queues a fresh read when a receipt changes during an in-flight request', async () => {
    const service = new TestReceiptIssuesService();
    let finish!: (value: { rows: ReceiptIssueRow[]; fetchedAt: string }) => void;
    service.request.and.returnValue(new Promise(resolve => finish = resolve));
    const first = service.load();
    await service.load();
    service.request.and.resolveTo({ rows: [], fetchedAt: '2026-10-30T12:01:00Z' });
    finish({ rows: [], fetchedAt: '2026-10-30T12:00:00Z' });
    await first;
    expect(service.request).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(service.fetchedAt()).toBe('2026-10-30T12:01:00Z');
  });

  it('shares live updates between viewers, refreshes on changes and stops on navigation away', async () => {
    jasmine.clock().install();
    spyOnProperty(document, 'visibilityState', 'get').and.returnValue('visible');
    const service = new TestReceiptIssuesService();
    const stopCard = service.watch();
    const stopQueue = service.watch();
    try {
      await Promise.resolve();
      expect(service.request).toHaveBeenCalledTimes(1);
      service.changed!(); service.changed!();
      jasmine.clock().tick(250); await Promise.resolve();
      expect(service.live()).toBeTrue();
      expect(service.request).toHaveBeenCalledTimes(2);
      service.failed!(); expect(service.live()).toBeFalse();
      jasmine.clock().tick(60000); await Promise.resolve();
      expect(service.request).toHaveBeenCalledTimes(3);
      stopCard(); expect(service.unsubscribe).not.toHaveBeenCalled();
      stopQueue(); stopQueue(); expect(service.unsubscribe).toHaveBeenCalledTimes(1);
      jasmine.clock().tick(60000); await Promise.resolve();
      expect(service.request).toHaveBeenCalledTimes(3);
    } finally { stopCard(); stopQueue(); jasmine.clock().uninstall(); }
  });
  it('reuses recent results on navigation but always honors an explicit refresh', async () => {
    const service = new TestReceiptIssuesService();
    await service.load(false);
    await service.load(false);
    expect(service.request).toHaveBeenCalledTimes(1);
    await service.load();
    expect(service.request).toHaveBeenCalledTimes(2);
  });

  it('refreshes results once they are a minute old', async () => {
    const now = spyOn(Date, 'now').and.returnValue(100000);
    const service = new TestReceiptIssuesService();
    await service.load(false);
    now.and.returnValue(160000);
    await service.load(false);
    expect(service.request).toHaveBeenCalledTimes(2);
  });

  it('retries failed refreshes immediately and keeps the previous queue visible', async () => {
    const service = new TestReceiptIssuesService();
    await service.load(false);
    service.request.and.rejectWith(new Error('Unavailable'));
    await service.load();
    expect(service.loaded()).toBeTrue();
    expect(service.error()).toContain('Unavailable');
    service.request.and.resolveTo({ rows: [], fetchedAt: '2026-10-30T12:01:00Z' });
    await service.load(false);
    expect(service.request).toHaveBeenCalledTimes(3);
    expect(service.error()).toBe('');
  });
});
