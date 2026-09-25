# Email social footer

All application emails now include a shared **Follow ReceiptNest** section with YouTube, X, TikTok, Instagram, and Facebook. It uses the current website destinations, including `@receiptnest` for TikTok and Instagram.

The browser-safe renderer in `functions/src/email-social-links.ts` is used by both the shared SendGrid transport and the admin's custom-email preview. The delivery layer adds the section once to HTML and plain text, preserving the original subject, sender, attachments, and unsubscribe headers. For custom admin emails, the automatic unsubscribe footer stays last.

The HTML uses presentation tables, inline styles, two centered rows, visible platform names, and 32px PNG icons adapted from the existing website SVGs. The icons are served from `/email/social/`. The layout does not depend on flexbox, grid, or embedded SVG. Dark-mode rules are scoped to the social section. Classic Outlook receives conditional fixed-width wrapper tables. The platform names remain usable when images are blocked.

Narrow-screen checks also found existing overflow in download badges and summary footer links. App-store badges now stack below 480px; summary footer links use tighter horizontal spacing below 400px without reducing the font size.

## Verification

- 14 backend tests passed, including transport serialization, all five website destinations, duplicate prevention, HTML fragments, plaintext, and unsubscribe ordering.
- Built the website/admin preview successfully; SEO checks passed for 24 public pages, 3 account pages, and 765 links.
- Captured 15 local serialized email payloads covering weekly/monthly populated, empty, and mixed-currency summaries; verification; password reset; welcome; account deletion; subscription activation/renewal; admin test/custom emails; and unsubscribe confirmation.
- 128 Chromium preview checks passed: 15 samples × 4 viewport widths (320, 390, 768, and 1024px) × light/dark modes, plus 8 social-section fallback checks with blocked images or head styles removed. Checked horizontal overflow, icon loading, link placement, non-overlap, and minimum 44px social tap targets.
- Reviewed phone and desktop screenshots. Social-label contrast is at least 7.58:1 in both themes. Generated HTML ranged from 8,204 to 45,663 bytes before local preview images were embedded.
- Hosting deployment completed; all five live PNG icons were verified against the local files by SHA-256.
- All ten email-sending Cloud Functions were deployed and verified ACTIVE with changed source hashes. The weekly/monthly scheduler trigger is unchanged.
- No test messages were sent. These are local browser previews and transport checks, not an actual Gmail/Outlook/Apple Mail inbox test.

Local samples, screenshots, and detailed layout results are in `output/email-socials/` (ignored by Git). Run `npm --prefix functions test` for the committed automated checks.

Compatibility reference: [Can I email — embedded SVG support](https://www.caniemail.com/features/html-svg/) informed the choice to reuse the website's icons as PNGs instead of copying inline SVG into emails.
