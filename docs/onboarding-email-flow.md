# Onboarding email flow

The welcome, reminder and spend-summary emails share the approved white, charcoal and muted green visual style, with the real ReceiptNest logo embedded in the message. Account verification, password reset, billing and account-deletion messages retain their existing behavior.

## Customer flow

1. After verified sign-in, send the existing welcome once, with its upload action, written workflow and linked 85-second walkthrough. A successfully accepted welcome enrolls the user in this version of onboarding. Older welcomed accounts are not backfilled into reminders.
2. Around 72 hours after that welcome, send one first-receipt reminder if the account still has no usable receipt. Check hourly, during 08:00–18:00 in the user's notification time zone (Los Angeles fallback). Stop after 14 days. There is no Day 8–10 second reminder in this release.
3. Cancel the reminder after a final receipt, or a receipt needing review that has a usable amount. Extraction failures also use `needs_review`; missing data does not count as successful activation. Defer while an upload is processing. Recheck receipts in the delivery transaction, and retain a permanent activation marker so deleting a receipt does not restart onboarding.
4. Send automated weekly/monthly summaries only when their period contains at least one normalized receipt. A real $0 receipt or a net-zero period still qualifies. Admin-requested previews can render empty states.
5. Within a new account's first 30 days, include at most one small relevant tip in a summary. Each tip is recorded once per account: downloading an original, email forwarding if not already configured, then CSV export in a monthly summary. These do not create extra messages.

The new **Getting started emails** setting controls the reminder and summary tips independently of weekly/monthly email and push preferences. Existing profiles without the optional field keep the default enabled. Global email suppressions and recipient-signed unsubscribe URLs apply to reminders and scheduled summaries. Welcome remains the existing one-time account email, with a public unsubscribe/preferences link. Transactional security and account emails do not use the lifecycle sending budget.

## Spacing and duplicate prevention

`email-lifecycle-policy.ts` and `email-lifecycle.ts` coordinate automated mail per user. Welcome is immediate and counts toward subsequent spacing. Other lifecycle emails require at least 48 hours since the last reservation, with a maximum of two reservations in a rolling seven-day window. A legacy profile's welcome timestamp is included even without a new delivery ledger.

Claims are stored transactionally before contacting SendGrid, and stable delivery keys prevent duplicate sends across concurrent scheduler runs and sign-in calls. A definite provider rejection releases the cadence slot and allows retry after six hours. An uncertain network outcome or failed acknowledgement after acceptance retains its claim and is not automatically resent. This favors avoiding duplicate emails; it cannot provide atomic exactly-once delivery across Firestore and SendGrid. Investigate old `sending` claims with the structured “Lifecycle email delivery needs attention” log and SendGrid delivery records before any manual replay.

If a summary is too close to another email, persist a deferred job with its original period/time zone and retry every 30 minutes. Re-read receipt data, suppression and preferences when delivering. Weekly jobs expire after six days; monthly jobs after fourteen days. Disabled schedules, deleted accounts, expired jobs, opt-outs and now-empty periods are discarded. Monthly goes first when both schedules fall due together. Admin-requested summary sends bypass automated cadence.

Use the actual attempt time for eligibility and cadence, even if a scheduler retry carries an old `scheduleTime`; the reporting period still follows the original scheduled date.

## Storage and deployment

The existing configured database is `receipt-nest/(default)`, Firestore Standard in `us-central1`. All new storage is server-only under the existing default-deny client rules:

- `emailLifecycleState/{uid}` — recent reservations, enrollment, activation, next reminder and used tips.
- `emailLifecycleDeliveries/{uid}_{key}` — stable send claims and outcomes.
- `spendSummaryEmailQueue/{uid}_{period}` — deferred summary requests without recipient addresses or receipt payloads.

Each document carries `userId` for account-deletion cleanup. Final cleanup after profile deletion removes work that finished during deletion; deferred writes also check that the owner still exists. Queries use existing automatic single-field indexes (`reminderDueAt`, `dueAt`, `status`, `userId`); no new composite indexes or client permissions are required.

The new exported Functions are `dispatchOnboardingEmails`, `recordReceiptEmailActivation` and `dispatchDeferredSpendSummaryEmails`. Existing `sendWelcomeEmail`, `dispatchScheduledSpendSummaryEmails`, `sendSpendSummaryEmail`, `deleteUserAccount` and the admin directory sync include updated shared code/defaults. Existing `SENDGRID_API_KEY`, `APP_BASE_URL` and `UNSUBSCRIBE_TOKEN_SECRET` configuration is reused. Deploy Functions and Hosting together to expose the new preference and activate the flow. This implementation has not been deployed and has sent no customer mail.

## Verification

- `npm --prefix functions test`: 82 tests passed, covering old email behavior plus welcome enrollment, duplicate/concurrent jobs, exact cadence boundaries, activation/deletion, upload failures, processing deferrals, verification status, opt-outs, signed links, provider failures, delayed jobs, original summary periods, zero/empty data, tip preferences and account cleanup.
- `CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm test -- --watch=false --browsers=ChromeHeadless`: all 40 existing browser unit tests passed.
- `node scripts/check-spend-summary-email.mjs`: 29 visual/layout checks passed for welcome, reminder and summary emails at desktop and 390/320px widths, light/dark mode, blocked images, stripped head styles, long names and a summary tip. No missing images, overflowing text or horizontal scrolling.
- Functions and production website builds passed. Existing style-budget/CommonJS warnings remain. SEO checks passed for 37 public pages, 3 account pages and 1,345 local links.
- All nine onboarding website/media destinations returned HTTP 200 in read-only checks. Previous app-store and social destinations remain unchanged.

Preview HTML, PNGs and verification JSON are saved under `output/spend-summary-email/` (ignored by Git). Checks use mocked Firestore/SendGrid and local Chromium, rather than an actual delivered Gmail/Outlook/Apple Mail inbox.
