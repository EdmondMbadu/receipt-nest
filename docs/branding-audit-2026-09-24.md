# ReceiptNest branding audit — September 24, 2026

The product name used by the website and its backend-generated communications is **ReceiptNest**. The official App Store and Google Play listings retain **ReceiptNest AI**. Instagram links use `https://www.instagram.com/receiptnest`, and TikTok links use `https://www.tiktok.com/@receiptnest`. The existing Facebook URL stays unchanged.

## Coverage and corrections

- Searched the website, public files, metadata/structured data, admin defaults, backend functions, operational documentation, tests, and generated bundles. Included case-insensitive searches and checks for a separate AI badge.
- Weekly and monthly summaries: sender and reply-to names, HTML header/footer, introductory copy, logo alt text, copyright, plain-text fallback, and unsubscribe wording.
- Other email flows: welcome, verification, password reset, subscription activation and renewal, account deletion, unsubscribe confirmation, test email, and custom admin email defaults.
- All email delivery paths use the app's SendGrid helper with explicit sender names; no provider-hosted dynamic templates were found in the delivery code.
- Telegram welcome, linking, account, help, and unlink replies.
- Forwarded-email receipt capture: PDF author/creator/producer metadata, PDF footers, summary image titles, and HTML headers.
- Eight product screenshots in light and dark themes. Local OCR found the old suffix in all eight; it now reads ReceiptNest. Updated image URLs include `?v=20260924` to refresh browser caches.
- Replaced the legacy social-preview image with the already-approved ReceiptNest version.
- Updated README, email-unsubscribe documentation, current SEO recommendations, and a storage-rules comment. No rule behavior changed.

## Intentional remaining references

- Official app-store names, store links, and download accessibility labels.
- Working YouTube, X, and Facebook account URLs/handles. Instagram and TikTok use the replacement URLs supplied by the owner.
- Historical September 13 SEO crawl snapshots and citations identifying app-store listings.
- Technical feature/disclosure text such as AI Insights, Document AI, and AI processing. Those describe functionality, not the product-name suffix.

Existing sent emails, saved user content, previous Telegram messages, and previously generated documents were not rewritten. This audit covers this website/backend repository and its deployed services; it does not certify third-party account profiles, native mobile binaries, or provider-owned billing templates outside this codebase.

## Validation

- Functions TypeScript build and all 8 existing backend tests passed.
- All 7 existing public-route/SEO browser tests passed.
- Captured 10 local email payloads: weekly and monthly summaries with populated, empty, and mixed-currency data, plus verification, password reset, welcome, and account deletion. Sender/reply-to, HTML and text branding passed; summary unsubscribe headers and app-store links were preserved. No test email was sent.
- Inspected a locally rendered weekly email. Recognized text in all website image assets with macOS Vision and visually inspected the eight updated screenshots.
- Deployed 12 affected Cloud Functions; all report ACTIVE with updated source hashes. The scheduler trigger is unchanged.
- Hosting build and deployment passed, including SEO checks for 24 public pages, 3 account pages, and 765 local links.
- Verified the live homepage's branding, Instagram URL, Facebook URL, app-store labels, and refreshed screenshot URLs. All eight live screenshots and the legacy social-preview image match the reviewed local files by SHA-256. The inbound-email handler's read-only health response uses ReceiptNest.

Affected deployed functions: `sendVerificationEmail`, `sendPasswordResetEmail`, `sendWelcomeEmail`, `sendTestEmail`, `sendCustomAdminEmail`, `sendSpendSummaryEmail`, `dispatchScheduledSpendSummaryEmails`, `stripeWebhook`, `deleteUserAccount`, `requestEmailUnsubscribeLink`, `inboundEmailWebhook`, and `telegramWebhook`.

## Screenshot edit record

Used the built-in imagegen tool. Saved the reviewed replacements to:

- `/Users/edmondmbadu/repo/receipt-nest/src/assets/auto-categorization.png`
- `/Users/edmondmbadu/repo/receipt-nest/src/assets/auto-light.png`
- `/Users/edmondmbadu/repo/receipt-nest/src/assets/capture-anything.png`
- `/Users/edmondmbadu/repo/receipt-nest/src/assets/capture-light.png`
- `/Users/edmondmbadu/repo/receipt-nest/src/assets/monthly-dashboard.png`
- `/Users/edmondmbadu/repo/receipt-nest/src/assets/monthly-light.png`
- `/Users/edmondmbadu/repo/receipt-nest/src/assets/spend-insight.png`
- `/Users/edmondmbadu/repo/receipt-nest/src/assets/spend-light.png`

Each image used the following prompt, with its filename substituted:

> Edit target: the supplied ReceiptNest app screenshot (FILENAME.png). Make exactly one tiny text removal: in the top navigation bar, remove only the two-letter suffix "AI" after "ReceiptNest", filling those two letters with the identical surrounding flat header background. The header must read exactly "ReceiptNest". Keep the existing ReceiptNest letters in their precise original position, size, font and color. Do not move or center the title. Preserve the complete screenshot including all other text, receipt amounts, merchant names, icons, chart shapes, colors, dimensions and framing. No other modifications. This is a minimal localized removal, not a redesign; the full screenshot must remain unchanged outside those two top-bar letters. Return one edited screenshot, with original aspect ratio and no cropping.
