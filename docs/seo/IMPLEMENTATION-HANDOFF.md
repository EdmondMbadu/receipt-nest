# ReceiptNest SEO implementation

Implemented locally on September 13, 2026. **Not deployed.** This delivers the on-site foundation from the audit; it does not complete the external acquisition, measurement, legal, or ongoing editorial work in the 90-day plan.

## What changed

- Preserved the owner's preferred homepage hero: **“Finally know where your money goes.”**, its original subheading, and original app-store/demo buttons. The document title describes receipt tracking without replacing that visible headline.
- Rebuilt six existing workflow pages with distinct jobs, practical examples, existing product screenshots, relevant questions, limitations, and next-step links.
- Added five public pages: /receipt-to-csv, /email-receipt-organizer, /pricing, /security, and /about.
- Added a fictional downloadable CSV matching the current monthly export: Merchant, Date, Amount, then Total. It is a sample, **not** an anonymous receipt converter. The page explains the account requirement, category-export differences, missing currency column, and lack of line-item/image exports.
- Added clear Starter/Pro information and official app-store links. The free default is 50 receipt records, not 50 additional scans each month. Runtime configuration and public pricing must remain aligned.
- Added guide affiliation disclosures, primary-source links, visible revision dates, contextual workflow links, and crawlable table-of-contents anchors. The Expensify comparison now includes its free individual scanning/forwarding/web-CSV option.
- Removed unsupported end-to-end-encryption, never-third-party-processing, tax-field extraction, and no-review-needed claims from edited homepage sections. Added a factual cloud-processing overview. Formal legal terms were not rewritten.

## Technical safeguards

- One public-page registry drives route titles, static rendering, metadata, and sitemap generation.
- The sitemap contains 22 canonical public URLs. The build produces those pages plus three noindex account pages, for 25 pre-rendered routes.
- Page-scoped structured data and article metadata are cleared between navigations. Application schema appears on product pages, not every article/account screen. No invented ratings or review claims were added.
- Unknown article slugs reach a not-found view instead of silently displaying the first article. Existing Firebase HTTP 404 behavior is preserved.
- Response-level X-Robots-Tag rules cover account, share, verification, recovery, feedback, and sample-download paths. Existing private-route robots.txt restrictions and authentication were preserved. A robots.txt block may prevent a crawler from seeing noindex; authentication, not robots directives, protects private data. Check any previously indexed private URL separately in Search Console.
- Public images have one-day caching; HTML and private route shells remain non-cacheable. Images are not given immutable caching because their filenames are not fingerprinted.
- Shared public navigation/footer, real fragment links, image dimensions, and reduced-motion support improve usability. The existing homepage design is retained.

## Verification and how to repeat it

Use Node **22.20 or newer**. The sitemap/check scripts read the pure TypeScript content registry with Node's type-stripping support. The HTML parser parse5 is explicitly listed at the version already in the lockfile.

1. Run npm run build to generate the sitemap, build/pre-render, and automatically run the SEO gate.
2. Run npm test -- --watch=false --browsers=ChromeHeadless for the full test suite.
3. For local HTTP checks, run firebase emulators:start --only hosting --project demo-receiptnest-seo. This is a local demo, not a deployment.
4. Run node scripts/check-seo-browser.mjs against that preview. Set SEO_PREVIEW_ORIGIN if the port differs; set CHROME_BIN if Chrome is installed elsewhere. It uses a fresh temporary profile and blocks analytics and account-service requests.

Verified during implementation:

- Production build and generated SEO checks: 22 public pages, three account pages, 667 local links.
- Full browser test suite: 13 tests passed, including metadata cleanup, workflow navigation, pricing controls, unknown article routing, and the restored homepage headline.
- Local Hosting emulator: public pages return 200 without noindex; placeholder private routes return response-level noindex; nonexistent public/article URLs return 404; public-image caching is applied.
- Visual smoke tests: mobile CSV, tracker, pricing, comparison; desktop homepage and CSV. Screenshots inspected; no horizontal page overflow at tested widths.
- Git whitespace/diff validation passed.

These are local tests, not proof of Google indexing, rankings, field Core Web Vitals, or production conversion attribution. Existing build warnings remain for landing/folder component CSS size and several CommonJS dependencies. Initial transfer estimate was about 103 KB before and 106 KB after this work; no page-speed improvement is claimed.

## Before production / still required

1. **Legal operator and privacy facts:** confirm the legal operator, privacy contact, retention/deletion timelines, subprocessors, and analytics/consent requirements. /security is a product overview, not a substitute for a reviewed privacy policy. Review the existing commercial-use restriction and privacy-policy references in Terms.
2. **Deployment approval:** review and deploy through the normal release process. No production deployment, DNS change, paid service, or account mutation was performed.
3. **Search Console:** verify access, submit /sitemap.xml after deployment, inspect the homepage plus CSV/email/tracker pages, and review indexing/canonical decisions. Use normal account invitations, not passwords in chat.
4. **Conversion measurement:** existing GA4/Ads configuration was left intact. Validate SPA page-view behavior and consent, then instrument real signup success, first successfully processed receipt, export, and paid conversion. Do not count CTA clicks as signups or upload starts as successful processing. Never send receipt content, merchants, emails, forwarding addresses, or share tokens to analytics.
5. **Performance:** gather production mobile field data and a stable lab baseline. Image compression/responsive variants and the large homepage demo can be optimized in a separate measured pass without redesigning the approved hero.
6. **Authority and learning:** interview users about export/forwarding friction; publish permissioned examples and original evaluations; seek genuine relevant mentions. Do not buy links, mass-post Reddit replies, or manufacture testimonials.
7. **Editorial maintenance:** keep plan limits and competitor facts current, refresh content for substantive changes only, and prioritize new pages using actual search queries and activated users. Top rankings cannot be guaranteed by metadata or page count.

## Sources for factual changes

- [IRS recordkeeping](https://www.irs.gov/businesses/small-businesses-self-employed/what-kind-of-records-should-i-keep)
- [IRS retention periods and exceptions](https://www.irs.gov/businesses/small-businesses-self-employed/how-long-should-i-keep-records)
- [IRS business vehicle records](https://www.irs.gov/taxtopics/tc510)
- [Expensify free individual features](https://help.expensify.com/articles/new-expensify/getting-started/Free-Features-in-Expensify)
- [Firebase Hosting response configuration](https://firebase.google.com/docs/hosting/full-config)
- [Google noindex guidance](https://developers.google.com/search/docs/crawling-indexing/block-indexing)

See the separate audit for the full research, prioritization, and 90-day plan.
