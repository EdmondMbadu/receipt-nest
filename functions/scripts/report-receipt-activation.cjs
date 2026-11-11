// Read-only cohort report. Run with Application Default Credentials for receipt-nest.
const DAY = 24 * 60 * 60 * 1000;
const KNOWN_SIGNUP_SOURCES = new Set([
  'google_search', 'facebook', 'instagram', 'threads', 'tiktok', 'youtube',
  'bookkeeper_or_accountant', 'friend_or_colleague', 'paid_ad', 'app_store', 'ai_search', 'other'
]);

const millis = value => typeof value?.toMillis === 'function' ? value.toMillis() : NaN;
const usable = receipt => (receipt.status === 'final' || receipt.status === 'needs_review') &&
  (Number.isFinite(receipt.extraction?.totalAmount?.value) || Number.isFinite(receipt.totalAmount));

function receiptAge(receipt, signedUpAt, asOf) {
  const createdAt = millis(receipt.createdAt);
  if (!usable(receipt) || !Number.isFinite(createdAt) || createdAt >= asOf) return null;
  const processedAt = millis(receipt.processedAt ?? receipt.extraction?.processedAt);
  return { saved: createdAt - signedUpAt, processed: processedAt < asOf ? processedAt - signedUpAt : NaN };
}

function captureMethod(receipt) {
  if (receipt.source === 'email') return 'forwarded_email';
  if (receipt.source === 'telegram') return 'telegram';
  if (receipt.file?.mimeType === 'application/pdf') return 'pdf';
  if (receipt.file?.mimeType?.startsWith('image/')) return 'image';
  return 'other_or_unknown';
}

function isActiveLivePro(profile) {
  const hasLiveSnapshot = profile.liveSubscriptionStatus !== undefined;
  return hasLiveSnapshot
    ? profile.liveSubscriptionPlan === 'pro' && profile.liveSubscriptionStatus === 'active'
    : profile.billingModeOverride !== 'test' &&
      profile.subscriptionPlan === 'pro' && profile.subscriptionStatus === 'active' && !!profile.stripeSubscriptionId;
}

function summarizeCohort(accounts, asOf) {
  const firstProcessedIn7Days = { reached: 0, eligible: 0 };
  const sixSavedIn30Days = { reached: 0, eligible: 0 };
  const savedAgainInMonthTwo = { reached: 0, eligible: 0 };
  const activeLivePro = { accounts: 0, signupSource: {}, captureMethodsInFirst60Days: {} };
  let usableReceiptsMissingProcessedAt = 0;
  const increment = (counts, key) => { counts[key] = (counts[key] ?? 0) + 1; };

  for (const { profile, receipts } of accounts) {
    const signedUpAt = millis(profile.createdAt);
    const age = asOf - signedUpAt;
    const saved = receipts.flatMap(receipt => {
      const times = receiptAge(receipt, signedUpAt, asOf);
      return times && times.saved >= 0 && times.saved < 60 * DAY ? [{ receipt, ...times }] : [];
    });
    usableReceiptsMissingProcessedAt += saved.filter(row => !Number.isFinite(millis(
      row.receipt.processedAt ?? row.receipt.extraction?.processedAt
    ))).length;
    const firstMonth = saved.filter(row => row.saved < 30 * DAY);
    if (age >= 7 * DAY) {
      firstProcessedIn7Days.eligible++;
      if (saved.some(row => row.processed >= 0 && row.processed < 7 * DAY)) firstProcessedIn7Days.reached++;
    }
    if (age >= 30 * DAY) {
      sixSavedIn30Days.eligible++;
      if (firstMonth.length >= 6) sixSavedIn30Days.reached++;
    }
    if (age >= 60 * DAY && firstMonth.length > 0) {
      savedAgainInMonthTwo.eligible++;
      if (saved.some(row => row.saved >= 30 * DAY)) savedAgainInMonthTwo.reached++;
    }
    if (isActiveLivePro(profile)) {
      activeLivePro.accounts++;
      const source = KNOWN_SIGNUP_SOURCES.has(profile.signupSource) ? profile.signupSource : 'unknown';
      increment(activeLivePro.signupSource, source);
      const methods = new Set(saved.map(row => captureMethod(row.receipt)));
      for (const method of methods.size ? methods : ['no_usable_receipts']) {
        increment(activeLivePro.captureMethodsInFirst60Days, method);
      }
    }
  }
  return { accounts: accounts.length, firstProcessedIn7Days, sixSavedIn30Days, savedAgainInMonthTwo,
    usableReceiptsMissingProcessedAt, activeLivePro };
}

function parseDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return NaN;
  const parsed = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : NaN;
}

async function main() {
  const [start, end, ...extra] = process.argv.slice(2);
  const from = parseDay(start);
  const to = parseDay(end);
  const asOf = Date.now();
  if (extra.length || !(from < to && to <= asOf && to - from <= 366 * DAY)) {
    throw new Error('Usage: node functions/scripts/report-receipt-activation.cjs YYYY-MM-DD YYYY-MM-DD (UTC start and exclusive end, at most 366 days)');
  }
  const { initializeApp, deleteApp } = require('firebase-admin/app');
  const { getFirestore, Timestamp } = require('firebase-admin/firestore');
  const app = initializeApp({ projectId: 'receipt-nest' });
  try {
    const db = getFirestore(app);
    const snapshot = await db.collection('users')
      .where('createdAt', '>=', Timestamp.fromMillis(from)).where('createdAt', '<', Timestamp.fromMillis(to))
      .select('createdAt', 'role', 'authAccountMissing', 'signupSource', 'billingModeOverride',
        'liveSubscriptionPlan', 'liveSubscriptionStatus', 'subscriptionPlan', 'subscriptionStatus', 'stripeSubscriptionId')
      .get();
    const profiles = snapshot.docs.filter(doc =>
      doc.get('role') !== 'admin' && doc.get('authAccountMissing') !== true && doc.get('billingModeOverride') !== 'test'
    );
    const accounts = [];
    for (let i = 0; i < profiles.length; i += 8) {
      const batch = await Promise.all(profiles.slice(i, i + 8).map(async doc => {
        const profile = doc.data();
        const receiptSnapshot = await doc.ref.collection('receipts')
          .where('createdAt', '>=', profile.createdAt)
          .where('createdAt', '<', Timestamp.fromMillis(Math.min(asOf, millis(profile.createdAt) + 60 * DAY)))
          .select('createdAt', 'processedAt', 'status', 'totalAmount', 'extraction.processedAt',
            'extraction.totalAmount.value', 'source', 'file.mimeType')
          .get();
        return { profile, receipts: receiptSnapshot.docs.map(receipt => receipt.data()) };
      }));
      accounts.push(...batch);
    }
    const waitlist = await db.collection('statementWaitlist').select('source', 'entryChannel').get();
    const { waitlistEntryChannel } = require('../lib/statement-waitlist-core.js');
    const joinsByEntryChannel = { google_organic: 0, game: 0, other: 0, unknown: 0 };
    for (const join of waitlist.docs) {
      joinsByEntryChannel[waitlistEntryChannel(String(join.get('source') ?? ''), join.get('entryChannel'))]++;
    }
    console.log(JSON.stringify({
      signupDatesUtc: { start, endExclusive: end }, measuredAt: new Date(asOf).toISOString(),
      excludedAdminTestOrMissingAccounts: snapshot.size - profiles.length,
      ...summarizeCohort(accounts, asOf),
      decoderWaitlistAllTime: { uniqueJoins: waitlist.size, joinsByEntryChannel }
    }, null, 2));
  } finally {
    await deleteApp(app);
  }
}

module.exports = { summarizeCohort };
if (require.main === module) main().catch(error => {
  console.error(error.code ? 'Receipt activation report failed (code ' + error.code + '). Check Firestore access and Application Default Credentials.' : error.message);
  process.exitCode = 1;
});
