import { ReceiptIssueRow, ReceiptIssuesService } from './receipt-issues.service';

class TestReceiptIssuesService extends ReceiptIssuesService {
  readonly request = jasmine.createSpy('request').and.resolveTo({ rows: [], fetchedAt: '2026-10-30T12:00:00Z' });
  protected override fetchRows(): Promise<{ rows: ReceiptIssueRow[]; fetchedAt: string }> {
    return this.request();
  }
}

describe('Receipt issues queue freshness', () => {
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
