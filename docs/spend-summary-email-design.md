# Weekly and monthly email design

The weekly and monthly emails use `functions/src/spend-summary-template.ts` for the approved white, charcoal and muted green design. The same renderer serves admin sends and scheduled mailings. It includes one main spending figure, three secondary metrics, two highlights, a proportional activity chart, category/merchant tables, recent receipts and a compact footer. Monthly charts group the month into consecutive seven-day ranges, including the final partial week.

The official logo is copied byte-for-byte from `public/receipt-nest.png` into `functions/assets/email/receipt-nest.png` and embedded as a CID attachment. The small monochrome lock is also embedded; no remote images or web fonts are needed. App-store and social destinations come from the existing shared constants. The summary's compact social row uses the shared footer marker so SendGrid does not append its default social card. Other email designs are unchanged.

All visible links are real anchors. The dashboard and receipts links open `/app`; the receipt link deliberately says “View receipts” because the app does not support an email-period filter. Scheduled mail retains recipient-signed browser unsubscribe links, one-click POST headers, suppression checks, notification preferences and scheduling. Admin sends use the public unsubscribe form. Plain text includes the dashboard, support, terms, app, social and unsubscribe links too.

Inline styles and presentation tables provide the email-client fallback. The layout stacks highlight and breakdown columns on phones and supplies a restrained dark palette. Mixed-currency notices remain visible beside the total. Zero bars stay empty, small bars have no inflated minimum width, and refunds/mixed currencies suppress misleading chart insights.

Automated delivery now skips empty periods, coordinates spacing with welcome/onboarding emails, and can include one small introductory tip. Manual previews retain the complete empty layout. See [the onboarding email flow](onboarding-email-flow.md) for cadence, deferred delivery, settings and current verification results.

## Verification

Run:

```sh
npm --prefix functions test
node scripts/check-spend-summary-email.mjs
npm run build
```

The browser check needs local Chrome and Node 22. It renders only fixtures, never reads customer data or sends emails. It saves HTML, full-length PNG previews and layout results in `output/spend-summary-email/` (ignored by Git).

The implementation passed 42 backend tests, including real admin and scheduler paths with mocked Firestore and SendGrid transport, correct weekly/monthly periods and totals, HTML parsing, exact bar widths, official-logo bytes, CID resolution, all footer destinations, signing/serialization and duplicate-footer prevention. Thirteen Chromium checks covered desktop, 390px and 320px screens, light/dark themes, empty data, long names, mixed currencies and stripped head styles. No broken images, overflowing text or horizontal scrolling were detected. All twelve destination URLs returned HTTP 200 in read-only checks; unsubscribe actions were not submitted.

These are local renders and mocked delivery checks, not a real Gmail, Apple Mail or Outlook inbox certification. No customer emails were sent and no deployment was performed as part of this change.
