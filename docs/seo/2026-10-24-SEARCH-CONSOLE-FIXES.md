# Search Console fixes — October 24, 2026

Published to Firebase Hosting site `receiptnest`, project `receipt-nest`, version `83b919b8980bae50`. The deployment rebuilt the production site and passed the SEO gate. No backend or rules deployment was needed.

## Findings and fixes

Search Console's October 22 video-enhancement report showed zero critical errors and two non-critical warnings on `/blog/why-do-receipts-fade`: invalid `uploadDate` and missing timezone. A crawl of the current live site found the same date-only defect on `/blog/can-bank-statements-replace-receipts`, even though it was not yet listed in Google's examples.

Both dates now use the exact publication timestamps in the corresponding YouTube page's public `uploadDate` metadata:

| Article | Video | Correct timestamp |
| --- | --- | --- |
| Why do receipts fade? | `ZMGqpBIWJo8` | `2026-10-18T14:04:43-07:00` |
| Can bank statements replace receipts? | `vH_EjIIeEJY` | `2026-10-17T15:48:04-07:00` |

The getting-started tutorial already had a valid timestamp. Its player and sitemap now share metadata in `src/app/content/getting-started-video.ts`. The existing sitemap includes its thumbnail, content URL, title, description, duration, and publication timestamp. Supplemental article clips keep their page-level markup. The article schema's embed URL now matches the actual privacy-enhanced YouTube player.

Other changes:

- Added crawlable “Watch the short video” links to the article tables of contents.
- Added a clearly labeled coming-soon Statement Decoder link to the shared public footer. Google had discovered that page but had not crawled it in the available report.
- Revised tracker and receipt-management titles and descriptions to explain scanning, organization, CSV export, and the 50-receipt free allowance. These are a search-snippet experiment, not a measured ranking or CTR improvement.
- Added image dimensions to the homepage, support/terms logos, and five older blog images. Corrected workflow screenshot dimensions against the actual files. This reserves layout space; no field Core Web Vitals improvement is claimed.
- Fixed article-to-article navigation in the zoneless Angular app: reused article components now notify change detection when route data changes. The regression test caught the visible article and metadata becoming out of sync.
- Strengthened the production SEO gate to reject date-only, timezone-free, or invalid video timestamps; missing video metadata/assets; mismatches with the visible player; missing image dimensions; and tutorial sitemap/schema drift.

## Search visibility baseline

Search Console's three-month Web report, July 23–October 22, 2026, showed 36 clicks, 11.9K impressions, 0.3% CTR, and average position 28. The tracker page had 5 clicks / 3,489 impressions; receipt-management had 3 clicks / 4,178 impressions. Position and query mix affect CTR, so changes must be evaluated after Google recrawls and enough comparable impressions accumulate.

The page-indexing report last updated October 15 showed 25 indexed pages and 16 exclusions:

- Three discovered but not indexed: `/games`, `/games/fade`, and `/statement-decoder`.
- One crawled but not indexed: `/blog/organize-receipts-taxes-freelancer-guide`, last crawled September 9. Inspection confirmed crawling/indexing allowed, a successful fetch, and the correct canonical. A manual indexing request failed twice because Google's reCAPTCHA service could not connect. It was not successfully queued. The page remains in the successfully submitted sitemap, and its inspection tab was left open for a manual retry.
- Eight redirecting URLs, two noindex URLs, one alternate canonical, and one previously validated redirect error. These counts alone do not establish defects and do not justify removing index protections.

Core Web Vitals had insufficient real-user data for both mobile and desktop. No passing field performance score can be asserted.

Breadcrumbs showed zero invalid items and eight valid items, with no issues in the last 90 days. HTTPS showed zero non-HTTPS URLs and no issues in the last 90 days. Both the Manual actions and Security issues reports showed no issues detected.

## Verification

- Production build and SEO gate: 36 public pages, three account pages, 1,288 local links, and all three videos passed.
- Browser test suite: all 40 tests passed, including video metadata/player consistency across article navigation and tutorial navigation.
- Temporarily reintroduced the original date-only value into built HTML; the SEO gate rejected it with the intended diagnostic. Restored the artifact immediately.
- Post-deployment crawl: all 36 sitemap pages returned HTTP 200 with one self-canonical, unique expected titles/descriptions, public indexing allowed, and valid video timestamps. The two deliberate missing URLs returned HTTP 404.
- The live sitemap exactly matched the generated artifact. The tutorial MP4 and poster both returned HTTP 200 with correct content types.
- Search Console accepted the refreshed sitemap and immediately reported **Success, 36 discovered pages, one discovered video** (previously 32 pages and zero videos).
- Google validation started successfully for both video warning types, confirmed both on their detail screens and in the refreshed overview table. Final validation and indexing outcomes require Google's recrawl; a request is not a guarantee of inclusion or improved rankings.

Evidence is saved under `output/seo-2026-10-24/`: before/after public crawls and Search Console confirmation screenshots. This directory is local and ignored by Git.

## Remaining opportunities

Five older externally hosted PNG blog images are approximately 1.5–2.4 MB each. Producing smaller WebP/AVIF derivatives with responsive sizes is a separate performance opportunity; their original artwork and URLs were retained in this change. Prioritize those assets, then measure mobile lab performance and real-user data when traffic is sufficient.

Recheck the video validations after Google completes them. Compare CTR and positions for the two changed workflow pages over a comparable period, accounting for query mix. The four currently unindexed public URLs need indexing review after the updated sitemap has been processed; their available reports are older than today's deployment. Retry the optional tax-guide manual indexing request when Google's reCAPTCHA connection is working.

## References

- [Google video structured data](https://developers.google.com/search/docs/appearance/structured-data/video)
- [Google video sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps)
- [Google video search best practices](https://developers.google.com/search/docs/appearance/video)
- [Paper Trail, Part 1 publication metadata](https://www.youtube.com/watch?v=vH_EjIIeEJY)
- [Paper Trail, Part 2 publication metadata](https://www.youtube.com/watch?v=ZMGqpBIWJo8)
