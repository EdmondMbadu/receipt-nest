const assert = require('node:assert/strict');
const { test } = require('node:test');
const { summarizeCohort } = require('../scripts/report-receipt-activation.cjs');

test('cohort denominators require full follow-up and month two requires prior usage', () => {
  const day = 86400000;
  const ts = days => ({ toMillis: () => days * day });
  const receipt = (created, processed, other = {}) => ({
    status: 'needs_review', createdAt: ts(created), processedAt: ts(processed),
    extraction: { totalAmount: { value: 12.50 } }, ...other
  });
  const result = summarizeCohort([
    {
      profile: { createdAt: ts(0), liveSubscriptionPlan: 'pro', liveSubscriptionStatus: 'active', signupSource: 'google_search' },
      receipts: [
        ...Array.from({ length: 6 }, (_, i) => receipt(i + 1, i + 1, { source: 'email' })),
        receipt(30, 30, { file: { mimeType: 'application/pdf' } })
      ]
    },
    { profile: { createdAt: ts(0) }, receipts: [receipt(6, 7), receipt(60, 60), receipt(29, 29, { status: 'processing' })] },
    { profile: { createdAt: ts(0) }, receipts: [receipt(32, 33)] },
    { profile: { createdAt: ts(50) }, receipts: [receipt(51, 51)] },
    { profile: { createdAt: ts(68) }, receipts: [receipt(69, 69)] }
  ], 70 * day);

  assert.deepEqual(result.firstProcessedIn7Days, { reached: 2, eligible: 4 });
  assert.deepEqual(result.sixSavedIn30Days, { reached: 1, eligible: 3 });
  assert.deepEqual(result.savedAgainInMonthTwo, { reached: 1, eligible: 2 });
  assert.deepEqual(result.activeLivePro, {
    accounts: 1, signupSource: { google_search: 1 }, captureMethodsInFirst60Days: { forwarded_email: 1, pdf: 1 }
  });
});
