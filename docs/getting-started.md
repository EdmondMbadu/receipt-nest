# Getting started and onboarding

The public guide is `/getting-started`. The same guide is available at `/app/help`, with a replay link to `/app?tour=1`. `/app?addReceipt=1` opens the existing uploader after authentication. The auth guard preserves these query parameters through sign-in.

The approved video, poster and English captions live in `public/media/getting-started/`. Media filenames are versioned and cached for one year. Keep the public page URL stable when replacing the video, and change the media version in the page, onboarding card and welcome-email content together.

## Eligibility and state

`getGettingStartedState` counts the authenticated account’s complete receipts collection on the server. It does not use search results, a selected month, or a possibly missing legacy profile count. Verified users with 0–4 receipts and no `gettingStarted` state receive the introduction. Unknown counts do not count as zero.

`saveGettingStartedProgress` accepts only `seen`, `progress`, `complete`, or `dismiss`, with a step from 0–4. A transaction writes only the authenticated user’s `gettingStarted` field. It stores version, status, step, seenAt and updatedAt. Times are server-generated epoch milliseconds. Late progress writes cannot undo dismissal or completion.

The intro is recorded as seen after its anchored tip is visible. An unfinished guide returns as a compact Continue card; dismissal/completion stops automatic prompting. Replay remains available to everyone. A tour already in progress can finish when the receipt count reaches five. The guide follows the actual upload dialog, file selection, processing, receipt card, receipt details, original download, search, and monthly export menu. Cancellation returns to Add Receipt. Camera capture temporarily hides the tip so the scanner remains usable. The uploaded receipt’s actual status drives processing/review guidance.

The standard automatic path does not require manual review or confirmation. Users are instructed to confirm only if the receipt is marked Needs Review.

## Admin preview

Admin → Preview first-time experience opens `/app/admin/onboarding-preview`, protected by the existing admin guard, then redirects to the real `/app` dashboard. There is no sample dashboard or simulated receipt. The same shared guide runs across Home, Upload and Receipt Details using `ReceiptTourService`. An admin-only toolbar provides Guide on/off, Restart, and Exit preview. Guide progress is not persisted in preview mode. Receipt actions remain real: uploading adds a real receipt, and downloading saves a real file. The toolbar states this explicitly. Existing receipts can be used to inspect the flow without uploading another file.

## Welcome email

`functions/src/welcome-email-content.ts` supplies HTML/plain text, the first-receipt CTA and video card. The thumbnail and visible watch link both lead directly to `/getting-started#walkthrough`. The card is after the primary action and before the existing app-download/social footer. Email verification and existing `welcomeEmailSent` behavior remain in `functions/src/email.ts`. Deploying the template does not resend previous welcome emails.

## Validation and measurement

Focused Angular tests cover eligibility, persistence-related UI states, cancellation, processing/review guidance, preview isolation and public route navigation. Backend tests cover valid transitions, terminal-state races, authenticated ownership and the email links. Production builds also verify the sitemap, prerendered metadata, schema, links and assets.

Guide start/completion/dismissal, tutorial clicks/plays and first receipt download use the existing optional analytics hook. No receipt contents or account identifier are sent. First-download tracking is per browser and records a download request, not proof that the operating system saved the file. Existing first-receipt processing analytics remain unchanged.

Release order: deploy the new onboarding callables, publish Hosting and verify the public media, then deploy `sendWelcomeEmail`. No other functions or Firestore rules need to change.

## Released October 18, 2026 (UTC)

Published the two onboarding callables, Hosting, and `sendWelcomeEmail` to the `receipt-nest` Firebase project. The public video loads at 1920×1080 with a duration of 84.53 seconds. Live checks covered the public page, permanent in-app Help, an existing account above the eligibility threshold, the admin preview, the automatic-processing and Needs Review paths, Free/Pro export messaging, and the preview switch. The 390×844 mobile check verified that highlighted controls remain visible above the guide. Opening an export menu pauses the floating tip.

Validation passed: 34 backend tests, 11 focused Angular tests, production build, and SEO checks across 31 public pages, 3 account pages and 1,020 local links. Welcome-email content and links were tested without sending a manual email or resending previous welcome emails. A new production user account was not created solely for testing; eligibility, authenticated ownership and progress persistence were covered by automated tests.

The implementation remains uncommitted in the working tree. Review screenshot: `output/onboarding-implementation-qa/getting-started-live.png`.

## Refined walkthrough

The original sample preview was replaced by the actual app. Seven visible steps cover Add Receipt, choose/process a file, open the saved receipt, read the extracted details, download the original, search, and monthly exports. Uploading/processing are action-driven substates. The server still stores the three broad progress sections (add, organize, download); completion remains step 4.

Tips use actual `data-onboarding` targets, a spotlight and directional arrow. Placement responds to scrolling, resizing, dialog changes and route transitions. The tour never completes a failed upload or pending extraction as though it succeeded. The camera, cancellation, missing controls and optional download paths are handled explicitly.

Focused tests cover actual-control activation, moving anchors, Escape dismissal, cancellation, processing/review status, route continuity, Free/Pro export descriptions, admin-only preview without progress writes, logout cleanup, desktop/mobile placement and the redirect into the real dashboard.

Refinement verification: 18 focused Angular tests passed, including a regression test that keeps above-target popups attached during repeated layout passes. The production build and SEO checks passed. Live desktop and 390×844 checks followed the real dashboard, upload dialog and selected-file preview, cancellation, existing receipt card, extracted fields, original download, search, monthly CSV/PDF menu and completion. An actual download of the already-saved tutorial receipt returned the guide to search. No new receipt was uploaded during this refinement check. The preview toggle, menu cleanup and route continuity were also verified.

## Native mobile welcome and web help follow-up (2026-10-18)

The Flutter app in `../receiptnest_mobile` now calls the existing `sendWelcomeEmail` callable after verified authentication, including restored sessions and email, Google, and Apple sign-in. A per-user in-flight/success guard prevents repeated auth events from issuing duplicate requests in one app session; the backend remains responsible for its existing `welcomeEmailSent` flag. Failed requests can retry on a later sign-in or app resume. Resuming after email verification refreshes the user and token before navigating to the signed-in app. No welcome emails were manually sent during testing.

Mobile has a permanent **Help & getting started** drawer entry and a native help screen. The screen opens the same captioned 85-second walkthrough in a browser sheet without requiring website sign-in, gives instructions matching Camera / Gallery / Files / Upload receipt / Collections / Export, and opens the actual upload sheet from **Add a receipt**. Accounts with fewer than five receipts receive a dashboard prompt after a server count check. Dismissal/viewing is remembered per account on that device; it does not mark the web interactive tour completed. The drawer scrolls on smaller screens so Help remains reachable.

The mobile work requires a new iOS/Android release. It has not been submitted to either store. Validation: Flutter analysis clean, all 12 Flutter tests passed, Android debug APK built, and unsigned iOS release app built. The automatic popup tour remains a web feature; this mobile update adds the welcome email, video access, native instructions, and first-receipt prompt.

The web help route now retains a sticky avatar dropdown on desktop and phones, with Admin (admin only), Settings, billing/plans, and sign-out. Settings uses the existing app-shell modal. Five Angular tests, the production build, and SEO checks passed. Published to Firebase Hosting and verified on the live help page at desktop and 390-pixel widths, including opening Settings and dismissing the menu with Escape; no horizontal overflow or console errors observed.
