#!/usr/bin/env node
// Operator-only, one-time enrollment. This script never calls an email provider.
// Build first. Preview: node functions/scripts/restart-zero-receipt-onboarding.cjs
// Apply the reviewed snapshot: ... --apply --plan=output/onboarding-restart/plan.json
const admin = require('firebase-admin');
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {restartZeroReceiptOnboarding} = require('../lib/onboarding-restart');

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--apply' && !arg.startsWith('--plan='))) throw new Error('Unknown argument');
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Production enrollment cannot target an emulator');
  const apply = args.includes('--apply');
  const planFile = path.resolve(args.find(arg => arg.startsWith('--plan='))?.slice(7) || 'output/onboarding-restart/plan.json');
  const app = admin.initializeApp({projectId: 'receipt-nest'});
  try {
    const db = admin.firestore();
    let plan;
    if (!apply) {
      // Refuse to overwrite a prior preview; its timestamp and cohort must stay
      // fixed when a partially completed operation is resumed.
      const profiles = await db.collection('users').select().get();
      plan = {projectId: 'receipt-nest', runId: 'zero-receipts-2026-10-26', startedAt: new Date().toISOString(), profileCount: profiles.size, userIds: [], skipped: {}};
      for (const profile of profiles.docs) {
        const result = await restartZeroReceiptOnboarding({userId: profile.id, runId: plan.runId, startedAt: new Date(plan.startedAt)});
        if (result === 'eligible') plan.userIds.push(profile.id);
        else plan.skipped[result] = (plan.skipped[result] || 0) + 1;
      }
      await fs.mkdir(path.dirname(planFile), {recursive: true});
      await fs.writeFile(planFile, JSON.stringify(plan, null, 2) + '\n', {flag: 'wx', mode: 0o600});
      console.log(JSON.stringify({mode: 'preview', profiles: plan.profileCount, eligible: plan.userIds.length, skipped: plan.skipped, startedAt: plan.startedAt, planFile}));
      return;
    }
    plan = JSON.parse(await fs.readFile(planFile, 'utf8'));
    if (plan.projectId !== 'receipt-nest' || plan.runId !== 'zero-receipts-2026-10-26' || !Array.isArray(plan.userIds) || new Set(plan.userIds).size !== plan.userIds.length || !Number.isFinite(Date.parse(plan.startedAt))) throw new Error('Invalid enrollment plan');
    const planHash = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
    const marker = db.doc(`emailLifecycleRollouts/${plan.runId}`);
    await db.runTransaction(async transaction => {
      const saved = await transaction.get(marker);
      if (saved.exists && saved.data().planHash !== planHash) throw new Error('This rollout already has a different enrollment plan');
      if (!saved.exists) transaction.set(marker, {runId: plan.runId, planHash, startedAt: admin.firestore.Timestamp.fromDate(new Date(plan.startedAt)), cohortSize: plan.userIds.length});
    });
    const results = {};
    for (const userId of plan.userIds) {
      const result = await restartZeroReceiptOnboarding({userId, runId: plan.runId, startedAt: new Date(plan.startedAt), dryRun: false});
      results[result] = (results[result] || 0) + 1;
    }
    await marker.set({completedAt: admin.firestore.Timestamp.now(), lastResults: results}, {merge: true});
    console.log(JSON.stringify({mode: 'applied', cohort: plan.userIds.length, results, startedAt: plan.startedAt, firstDueAt: new Date(Date.parse(plan.startedAt) + 3 * 86400000).toISOString(), emailsSentByOperation: 0}));
  } finally { await app.delete(); }
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
