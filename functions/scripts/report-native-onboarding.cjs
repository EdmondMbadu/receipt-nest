/* Read-only: node scripts/report-native-onboarding.cjs --project=receipt-nest
 * Requires Application Default Credentials. Output contains aggregates only. */
const DAY = 86400000;
function summarizeNativeOnboarding(profiles, now = Date.now()) {
  const groups = {};
  for (const profile of profiles) {
    const state = profile.nativeOnboarding;
    if (state?.version !== 2 || !Number.isFinite(state.firstOpenedAt)) continue;
    const name = state.baselineReceiptCount === 0 ? (state.cohort ?? 'unknown_account') + '_zero_receipts'
      : state.baselineReceiptCount < 5 ? 'existing_one_to_four_receipts' : 'five_or_more_receipts';
    const group = groups[name] ??= { accounts: 0, firstReceiptSavedAndViewed24h: { reached: 0, eligible: 0 }, threeReceipts14d: { reached: 0, eligible: 0 } };
    group.accounts++;
    const age = now - state.firstOpenedAt;
    if (age >= DAY) {
      group.firstReceiptSavedAndViewed24h.eligible++;
      if (state.firstReceiptSavedAt >= state.firstOpenedAt && state.firstReceiptSavedAt <= state.firstOpenedAt + DAY &&
        state.firstUsableReceiptViewedAt >= state.firstOpenedAt && state.firstUsableReceiptViewedAt <= state.firstOpenedAt + DAY) {
        group.firstReceiptSavedAndViewed24h.reached++;
      }
    }
    if (age >= 14 * DAY) {
      group.threeReceipts14d.eligible++;
      if (state.thirdReceiptSavedAt >= state.firstOpenedAt && state.thirdReceiptSavedAt <= state.firstOpenedAt + 14 * DAY) group.threeReceipts14d.reached++;
    }
  }
  return groups;
}
module.exports = { summarizeNativeOnboarding };
if (require.main === module) {
  const project = process.argv.find(arg => arg.startsWith('--project='))?.split('=')[1];
  if (!project) { process.stderr.write('Pass an explicit --project=<id>.\n'); process.exitCode = 1; }
  else {
    const admin = require('firebase-admin');
    admin.initializeApp({ projectId: project, credential: admin.credential.applicationDefault() });
    admin.firestore().collection('users').select('nativeOnboarding').get().then(snapshot => {
      process.stdout.write(JSON.stringify(summarizeNativeOnboarding(snapshot.docs.map(doc => doc.data())), null, 2) + '\n');
    }).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
  }
}
