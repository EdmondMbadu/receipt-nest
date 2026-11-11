# ReceiptNest search plan: January–April 2027

Use organic signups that reach a first processed receipt as the outcome. Use Search Console to diagnose discovery, GA4 to connect page visits to web conversions, and account records to measure usage across devices and capture methods.

## Release and indexing

1. Run `npm run build` and `npm --prefix functions test`. Deploy Hosting and the two existing waitlist functions (`joinStatementWaitlist`, `getStatementWaitlist`) together when the release is approved. There are no Firestore rules, index, or migration changes.
2. In [Search Console](https://search.google.com/search-console?resource_id=sc-domain%3Areceipt-nest.com), inspect the deployed URL and its live test for the tracker, organizer, tax organizer, accountant guide, freelancer tax guide, and delivery-driver guide. Confirm HTTP 200, indexability, and the expected canonical. After checking the new content is live, request indexing for the priority URLs. Leave the existing healthy sitemap in place.
3. Compare 28 days with the preceding 28 days after Google recrawls. Use Web Search and consistent query, page, country, and device filters. Use the U.S. for the tax guides. Review position before interpreting CTR changes; also account for tax season and small counts.

## GA4: search to first receipt

In the existing `receipt-nest` web property, create these [event-scoped custom dimensions](https://support.google.com/analytics/answer/14239696) if they do not already exist. Register the parameters before measuring the rollout:

| Display name | Event parameter |
| --- | --- |
| ReceiptNest content page | `content_path` |
| ReceiptNest article | `article_slug` |
| Google organic entry page | `organic_landing_path` |
| ReceiptNest CTA placement | `cta_placement` |
| Decoder entry channel | `entry_channel` |

Mark `sign_up` and `first_receipt_processed` as key events if needed. Verify one fresh email or social signup and one successfully processed receipt in DebugView before relying on the report. Use the Landing page report with Session source / medium = `google / organic` for same-session results. Use `organic_landing_path` and `article_slug` on signup and activation for later visits in the same browser; distinguish this original search entry from session attribution.

The first-receipt links open registration with a receipt action. Social signup and the sign-in link continue directly to upload. Email signup resumes upload after verification in the same browser, within seven days. In a separate browser the normal dashboard still offers Add Receipt.

| Event | Meaning |
| --- | --- |
| `content_view` | A tracked landing page or guide opened, including Angular navigation. |
| `content_cta_click` | A tracked signup CTA clicked. `content_path` is the page with the button; `cta_placement` identifies its location. |
| `receipt_csv_sample_download` | The fictional sample download was requested. It can precede signup; it is not a conversion by itself. |
| `sign_up` | An account and profile were created. Email verification is a separate step. |
| `first_receipt_processed` | The new web account's first usable extraction observed in the signup browser. It carries the signup's attribution, with no account ID or receipt fields sent to GA4. |

Attribution expires after 30 days and may be absent if storage or referrer data is unavailable. A more recent signup CTA can identify a different article than the original search landing. GA4 browser events do not backfill historical cohorts or reliably cover mobile and cross-device receipt activity.

## Account cohort and decoder

With read access to the ReceiptNest project and Application Default Credentials:

```sh
npm --prefix functions run build
node functions/scripts/report-receipt-activation.cjs 2026-08-09 2026-11-09
```

The report uses UTC signup dates with an exclusive end. It prints aggregate counts only. It excludes admin profiles, test billing profiles, and profiles known to have no auth account. It counts a usable receipt as final or ready for review with a recorded amount; the first-week metric also requires a processing timestamp. The six-receipt milestone uses save dates. Month two is days 31–60 among accounts with at least one usable receipt in days 1–30. Each rate uses only accounts old enough to complete the relevant window. The active live Pro breakdown is a current subscription snapshot, not a payment ledger; signup source is self-reported, and the same account can use more than one capture method. Deleted receipts and missing timestamps limit historical coverage.

The decoder is still an early-access page. Compare the GA4 `statement_decoder_view` and unique `generate_lead` events by `entry_channel`, and check the first-party waitlist breakdown in Admin. A game-origin join is distinct from a Google organic join. Older decoder joins without referrer information stay unknown. Build a small merchant-descriptor lookup only if direct search interest warrants it.

The missing-business-receipt answer lives on `/blog/can-bank-statements-replace-receipts#missing-receipt`. Check relevant queries in Search Console before creating a standalone page for the same task. Add adjacent content when there is evidence of a distinct question or an unmet reader need.
