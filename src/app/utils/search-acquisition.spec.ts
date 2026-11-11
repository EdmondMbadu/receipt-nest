import { trackFirstReceiptProcessed } from './receipt-activation-analytics';
import { ACQUISITION_MAX_AGE_MS, consumeAcquisition, emitContentEvent, isGoogleOrganicEntry, recordContentVisit } from './search-acquisition';
import { trackSignup } from './signup-analytics';

describe('search acquisition', () => {
  const path = '/blog/can-bank-statements-replace-receipts';
  const slug = 'can-bank-statements-replace-receipts';
  const account = 'search-acquisition-test-account';
  const google = 'https://www.google.com/';
  const analyticsWindow = window as unknown as { gtag?: unknown };
  const keys = ['rn_search_acquisition', 'rn_game_ref', 'rn_receipt_activation:' + account];
  let original: unknown;
  let event: jasmine.Spy;

  beforeEach(() => {
    keys.forEach(key => localStorage.removeItem(key));
    original = analyticsWindow.gtag;
    analyticsWindow.gtag = event = jasmine.createSpy('gtag');
  });
  afterEach(() => {
    keys.forEach(key => localStorage.removeItem(key));
    analyticsWindow.gtag = original;
  });

  it('preserves the initial Google landing from article to signup and to the first usable receipt', () => {
    spyOn(window.performance, 'getEntriesByType').and.returnValue([{ name: 'https://receipt-nest.com' + path }] as PerformanceEntry[]);
    spyOnProperty(document, 'referrer').and.returnValue(google);
    recordContentVisit(path, slug);
    emitContentEvent('content_cta_click', path, 'end');
    trackSignup('email', account);
    trackFirstReceiptProcessed(account, [{ status: 'needs_review', extraction: { totalAmount: { value: 27.48 } } }]);

    const attribution = { organic_landing_path: path, article_slug: slug, content_path: path };
    expect(event.calls.allArgs()).toEqual([
      ['event', 'content_view', attribution],
      ['event', 'content_cta_click', { ...attribution, cta_placement: 'end' }],
      ['event', 'sign_up', { method: 'email', ...attribution }],
      ['event', 'first_receipt_processed', { activation_scope: 'new_web_signup_same_browser', ...attribution }]
    ]);
    expect(consumeAcquisition()).toEqual({});
  });

  it('credits the original article after the visitor downloads a sample and returns to register', () => {
    recordContentVisit(path, slug);
    emitContentEvent('receipt_csv_sample_download', '/receipt-to-csv', 'hero');
    trackSignup('google', account);
    expect(event).toHaveBeenCalledWith('event', 'sign_up', {
      method: 'google', article_slug: slug, content_path: '/receipt-to-csv'
    });
  });

  it('does not classify SPA navigation, paid campaigns, or lookalike hosts as a Google entry', () => {
    spyOn(window.performance, 'getEntriesByType').and.returnValue([{ name: 'https://receipt-nest.com/' }] as PerformanceEntry[]);
    spyOnProperty(document, 'referrer').and.returnValue(google);
    recordContentVisit(path, slug);
    expect(consumeAcquisition().organic_landing_path).toBeUndefined();
    expect(isGoogleOrganicEntry(new URL('https://receipt-nest.com/?gclid=123'), google)).toBeFalse();
    expect(isGoogleOrganicEntry(new URL('https://receipt-nest.com/?utm_medium=cpc'), google)).toBeFalse();
    expect(isGoogleOrganicEntry(new URL('https://receipt-nest.com/'), 'https://google.com.other.example')).toBeFalse();
  });

  it('expires attribution after 30 days even if a CTA is clicked during the window', () => {
    const now = spyOn(Date, 'now').and.returnValue(1_000);
    recordContentVisit(path, slug);
    now.and.returnValue(1_000 + ACQUISITION_MAX_AGE_MS - 1);
    emitContentEvent('content_cta_click', path, 'end');
    expect(consumeAcquisition(1_001 + ACQUISITION_MAX_AGE_MS)).toEqual({});
  });
});
