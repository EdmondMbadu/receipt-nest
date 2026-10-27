# Onboarding email flow

The welcome, Day 3/10/21 follow-up and spend-summary emails share the approved white, charcoal and muted green visual style, with the real ReceiptNest logo embedded in the message. Account verification, password reset, billing and account-deletion messages retain their existing behavior.

## Customer flow

1. After verified sign-in, send the existing welcome once, with its upload action, written workflow and linked 85-second walkthrough. A successfully accepted welcome enrolls the user in this version of onboarding. Existing accounts can also enter through the explicit, audited zero-receipt restart described below.
2. For users who still have no usable receipt, send a first-receipt reminder around Day 3, a practical photo/PDF/email-forwarding shortcut around Day 10, and a support/walkthrough email around Day 21. The final email closes the sequence. Check hourly, during 08:00–18:00 in the user's notification time zone (Los Angeles fallback), and stop all routine onboarding after the final step or Day 30. Days are measured from enrollment (the accepted welcome, or the explicit restart); daylight-saving changes and quiet hours can shift the actual send hour.
3. Cancel all remaining steps after a final receipt, or a receipt needing review that has a usable amount. Extraction failures also use `needs_review`; missing data does not count as successful activation. Defer while an upload is processing. Recheck receipts in the delivery transaction, and retain a permanent activation marker so deleting a receipt does not restart onboarding.
4. Send automated weekly/monthly summaries only when their period contains at least one normalized receipt. A real $0 receipt or a net-zero period still qualifies. Admin-requested previews can render empty states.
5. Within a new account's first 30 days, include at most one small relevant tip in a summary. Each tip is recorded once per account: downloading an original, email forwarding if not already configured, then CSV export in a monthly summary. These do not create extra messages.

The **Getting started emails** setting controls all three follow-ups and summary tips independently of weekly/monthly email and push preferences. Existing profiles without the optional field keep the default enabled. Global email suppressions and recipient-signed unsubscribe URLs apply to reminders and scheduled summaries. Welcome remains the existing one-time account email, with a public unsubscribe/preferences link. Transactional security and account emails do not use the lifecycle sending budget.

Normal signup enrollment follows the welcome email, rather than the signup calendar date. Someone who registered before rollout but receives their first welcome through this implementation will be enrolled. An old welcome alone does not enroll an account; the explicit zero-receipt restart is a separate enrollment path. Preview sends do not enroll anyone or move their clock.

A one-time sequence upgrade continues **already enrolled** accounts from the previous one-reminder version, limited to the preceding 30 days. It marks an already-sent Day 3 as handled and preserves activation and explicit cancellation reasons. It does not enroll users merely because they have zero receipts. A late job sends only the currently relevant step: Day 3 expires when Day 10 starts, Day 10 expires when Day 21 starts, and Day 21 expires at Day 30. Missed messages are not sent as a backlog.

Future one-off mailings remain separate from onboarding and can use the existing custom admin mailing tools and zero-receipt filter. Onboarding does not schedule an indefinite newsletter or change product-update preferences.

## Existing zero-receipt accounts: one-time fresh start

The authorized `zero-receipts-2026-10-26` cohort starts from a common enrollment timestamp on October 26, 2026 (Los Angeles). It does **not resend welcome emails** or change their flags. Future signup enrollment continues normally. Eligibility requires a current profile and verified, enabled Auth account with matching email, an enabled Getting started emails preference, no global unsubscribe, and an actually empty receipt collection. A cached `receiptCount` is never used; even a processing, failed, or real $0 receipt excludes an account from this restart.

Run `npm --prefix functions run build`, then `node functions/scripts/restart-zero-receipt-onboarding.cjs` for a read-only production preview. It writes a private, ignored cohort plan to `output/onboarding-restart/plan.json` and refuses to overwrite it. The reviewed plan freezes the common start time and eligible user IDs. Apply with `node functions/scripts/restart-zero-receipt-onboarding.cjs --apply --plan=output/onboarding-restart/plan.json`. The operator script uses Application Default Credentials, explicitly targets `receipt-nest`, and never calls an email provider. It is not exported as a client-callable function. Every account is checked again in a transaction during application, so an intervening receipt, opt-out, unsubscribe or deletion excludes it.

Each successful enrollment has a server-only `emailLifecycleRestarts/{uid}_{runId}` audit record containing its prior onboarding state. This makes resuming the same plan idempotent: it never moves the clock again or erases new progress. `onboardingRunId` namespaces the three delivery keys, preserving old delivery claims while permitting the new sequence. Existing cadence reservations, used tips, preferences, profile data and receipts are preserved. This explicit operation may clear an old activation marker for an account whose receipt collection is now empty; deleting a receipt alone still cannot restart onboarding. Fresh successful receipts cancel the new sequence. Delayed events for receipts deleted before the restart are ignored, and stale scheduler work or old provider acknowledgements cannot advance or defer the new run. A delayed first welcome cannot move its enrollment timestamp.

Production preview: 48 profiles scanned, 21 eligible. The remaining results were 18 accounts with receipts, 3 missing Auth accounts, 5 unverified/disabled/otherwise ineligible Auth accounts, and 1 globally unsubscribed account. Auth eligibility is checked first, so these are mutually exclusive preview outcomes rather than a complete receipt-count breakdown. No customer email is sent by enrollment; reminders become eligible after 3, 10 and 21 elapsed days and still obey daytime delivery and shared cadence.

Applied to production: **21 of 21** planned accounts enrolled at `2026-10-27T05:13:38.544Z` (October 26 at 10:13 PM Los Angeles). All four affected Functions deployed successfully first. Post-application reads verified every account's enrollment timestamp, Day 3 due timestamp, cleared progression, empty receipt collection and audit record. Complete user profiles (including welcome flags), existing cadence events and used tips were unchanged. The operation sent **zero emails**. Day 3 is first eligible at `2026-10-30T05:13:38.544Z`; Los Angeles recipients wait until the following 08:00–18:00 sending window, and shared cadence can defer further.

## Admin test emails

Under **Spend summary emails**, use the shared **To email** and **Email source user** controls, then choose **Send welcome test**, **Send reminder test** (Day 3), **Send Day 10 shortcut test**, or **Send Day 21 help test** in **Welcome & getting started**. All four use the exact production message builder and embedded logo; follow-ups use the selected source user's first name. Test subjects start with `[Test]`.

`sendOnboardingTestEmail` requires admin authorization, one valid test inbox, and an existing source user. Tests can be sent for already-active, already-welcomed or opted-out source accounts because the selected account is only preview data: the email goes exclusively to the entered test inbox. These sends do not write Firestore, update welcome/reminder flags, spend cadence limits, or alter any user's preferences. They use the public unsubscribe form instead of creating unsubscribe tokens tied to the source account. No automatic customer mail or retroactive enrollment is triggered.

## Spacing and duplicate prevention

`email-lifecycle-policy.ts` and `email-lifecycle.ts` coordinate automated mail per user. Welcome is immediate and counts toward subsequent spacing. Other lifecycle emails require at least 48 hours since the last reservation, with a maximum of two reservations in a rolling seven-day window. A legacy profile's welcome timestamp is included even without a new delivery ledger.

Claims are stored transactionally before contacting SendGrid, and stable delivery keys prevent duplicate sends across concurrent scheduler runs and sign-in calls. A definite provider rejection releases the cadence slot and allows retry after six hours. An uncertain network outcome or failed acknowledgement after acceptance retains its claim and is not automatically resent. This favors avoiding duplicate emails; it cannot provide atomic exactly-once delivery across Firestore and SendGrid. Investigate old `sending` claims with the structured “Lifecycle email delivery needs attention” log and SendGrid delivery records before any manual replay.

If a summary is too close to another email, persist a deferred job with its original period/time zone and retry every 30 minutes. Re-read receipt data, suppression and preferences when delivering. Weekly jobs expire after six days; monthly jobs after fourteen days. Disabled schedules, deleted accounts, expired jobs, opt-outs and now-empty periods are discarded. Monthly goes first when both schedules fall due together. Admin-requested summary sends bypass automated cadence.

Use the actual attempt time for eligibility and cadence, even if a scheduler retry carries an old `scheduleTime`; the reporting period still follows the original scheduled date.

## Storage and deployment

The existing configured database is `receipt-nest/(default)`, Firestore Standard in `us-central1`. All new storage is server-only under the existing default-deny client rules:

- `emailLifecycleState/{uid}` — recent reservations, enrollment, activation, handled onboarding stages, sequence version, next follow-up and used tips.
- `emailLifecycleDeliveries/{uid}_{key}` — stable send claims and outcomes.
- `spendSummaryEmailQueue/{uid}_{period}` — deferred summary requests without recipient addresses or receipt payloads.
- `emailLifecycleRollouts/onboarding-v2` — completion marker for the one-time upgrade of recently enrolled users.
- `emailLifecycleRestarts/{uid}_{runId}` — per-account restart audit and idempotency marker, removed during account deletion.
- `emailLifecycleRollouts/zero-receipts-2026-10-26` — fixed cohort plan hash, start time and application outcome.

Each per-account document carries `userId` for account-deletion cleanup; aggregate rollout markers contain no user IDs. Final cleanup after profile deletion removes work that finished during deletion; deferred writes also check that the owner still exists. Queries use existing automatic single-field indexes (`reminderDueAt`, `dueAt`, `status`, `userId`); no new composite indexes or client permissions are required.

The exported Functions are `dispatchOnboardingEmails`, `recordReceiptEmailActivation`, `dispatchDeferredSpendSummaryEmails` and the admin-only `sendOnboardingTestEmail`. Existing `sendWelcomeEmail`, `dispatchScheduledSpendSummaryEmails`, `sendSpendSummaryEmail`, `deleteUserAccount` and the admin directory sync include shared code/defaults. Existing `SENDGRID_API_KEY`, `APP_BASE_URL` and `UNSUBSCRIBE_TOKEN_SECRET` configuration is reused; the test endpoint only needs the first two secrets. The original sequence and all four admin previews were already live before the explicit restart. The restart safeguards require updating `dispatchOnboardingEmails`, `sendWelcomeEmail`, `recordReceiptEmailActivation` and `deleteUserAccount` before applying the plan. Email designs, frontend controls, summary schedules and client permissions do not change for this operation.

## Verification

- `npm --prefix functions test`: 127 tests passed, covering old email behavior plus welcome enrollment, duplicate/concurrent jobs, exact cadence boundaries, activation/deletion, upload failures, processing deferrals, verification status, opt-outs, signed links, provider failures, delayed jobs, original summary periods, zero/empty data, tip preferences, account cleanup, admin preview authorization/isolation, the complete three-step sequence, late-job expiry, daylight-saving daytime delivery, cancellation after either earlier step, and upgrading already-enrolled accounts without replaying Day 3. Restart coverage includes read-only previews, actual receipt checks despite stale counters, idempotent/concurrent application, preserving old history, all eligibility exclusions, all three fresh stages despite old delivery claims, cancellation after activation, stale scheduler/provider/receipt events, delayed welcome protection and restart-audit deletion cleanup.
- Previous extension verification: `CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm test -- --watch=false --browsers=ChromeHeadless`: all 44 browser unit tests passed, including all four preview button payloads, recipient/source validation, in-flight duplicate-click prevention and error recovery.
- Previous extension verification: `node scripts/check-spend-summary-email.mjs`: 45 visual/layout checks passed for welcome, all three follow-ups and summary emails at desktop and 390/320px widths, light/dark mode, blocked images, stripped head styles, long names and a summary tip. No missing images, overflowing text or horizontal scrolling.
- Functions and production website builds passed. Existing style-budget/CommonJS warnings remain. SEO checks passed for 37 public pages, 3 account pages and 1,345 local links.
- All nine onboarding website/media destinations returned HTTP 200 in read-only checks. Previous app-store and social destinations remain unchanged.

Preview HTML, PNGs and verification JSON are saved under `output/spend-summary-email/` (ignored by Git). Checks use mocked Firestore/SendGrid and local Chromium, rather than an actual delivered Gmail/Outlook/Apple Mail inbox.
