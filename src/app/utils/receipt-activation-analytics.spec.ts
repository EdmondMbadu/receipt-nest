import { armReceiptActivation, trackFirstReceiptProcessed } from './receipt-activation-analytics';

describe('new web signup receipt activation', () => {
  const account = 'activation-test-account';
  const key = 'rn_receipt_activation:' + account;
  const ready = [{ status: 'needs_review', extraction: { totalAmount: { value: 12 } } }];
  let event: jasmine.Spy;
  let original: unknown;
  const analyticsWindow = window as unknown as { gtag?: unknown };

  beforeEach(() => {
    localStorage.removeItem(key);
    original = analyticsWindow.gtag;
    event = jasmine.createSpy('gtag');
    analyticsWindow.gtag = event;
  });
  afterEach(() => {
    localStorage.removeItem(key);
    analyticsWindow.gtag = original;
  });

  it('ignores historical accounts and incomplete or failed extraction', () => {
    trackFirstReceiptProcessed(account, ready, 1000);
    armReceiptActivation(account, 1000);
    trackFirstReceiptProcessed(account, [{ status: 'uploaded' }, { status: 'processing' }, { status: 'needs_review' }], 1100);
    expect(event).not.toHaveBeenCalled();
  });

  it('counts one successful activation across snapshots and repeated callbacks without receipt data', () => {
    armReceiptActivation(account, 1000);
    trackFirstReceiptProcessed(account, ready, 1100);
    armReceiptActivation(account, 1200);
    trackFirstReceiptProcessed(account, ready, 1300);
    expect(event).toHaveBeenCalledOnceWith('event', 'first_receipt_processed', {
      activation_scope: 'new_web_signup_same_browser'
    });
  });

  it('does not attribute a different account or an expired signup', () => {
    armReceiptActivation(account, 1000);
    trackFirstReceiptProcessed('different-account', ready, 1100);
    trackFirstReceiptProcessed(account, ready, 1000 + 31 * 24 * 60 * 60 * 1000);
    expect(event).not.toHaveBeenCalled();
  });
});
