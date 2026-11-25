# ReceiptNest SEO and AI search audit

Reviewed November 24, 2026, Pacific time. The immediate opportunity is to improve the pages already attracting relevant impressions, support them with useful receipt workflows, and earn independent coverage. Public crawling is working. Rankings, indexing, and inclusion in AI answers remain decisions made by the search providers.

## Search Console baseline

Property: `sc-domain:receipt-nest.com`. Web performance covers August 24 through November 23, 2026. Values below are the displayed Search Console values, including its rounding. The indexing report was last updated November 15, so its counts are not a current census of the live sitemap.

| Metric | Observed value |
| --- | --- |
| Web clicks | 62 |
| Web impressions | 13.9K |
| Web CTR | 0.4% |
| Average position | 22.8 |
| Google generative AI feature impressions | 800 |
| Indexed pages in indexing report | 43 |
| Excluded pages in indexing report | 13 |
| Public URLs in live sitemap | 46 |

The submitted sitemap reports Success, with 46 discovered pages and one video, last read November 18. The saved [Search Console baseline](2026-11-24-search-console-baseline.json) and [article inventory](2026-11-24-article-inventory.json) preserve the comparison data.

The AI report measures Google's generative search features. It does not measure ChatGPT or Claude citations, referrals, or recommendations.

| Landing page | Clicks | Impressions | CTR | Position | Action |
| --- | ---: | ---: | ---: | ---: | --- |
| `/receipt-management-software` | 2 | 4,650 | Displayed as 0% | 37.2 | Clarified product fit, capture methods, comparison, and handoff example |
| `/receipt-organizer` | 14 | 2,879 | 0.5% | 18.3 | Added a specific folder-system guide |
| `/receipt-tracker` | 6 | 2,429 | 0.2% | 22.7 | Retain distinct tracking intent; connect supporting guides |
| `/` | 11 | 678 | 1.6% | 13.4 | Preserve current positioning |
| `/blog/how-long-to-keep-receipts` | 3 | 721 | 0.4% | 7.5 | Preserve the useful answer and exceptions; investigate query and country mix before changing its snippet |
| `/blog/why-do-receipts-fade` | 4 | 389 | 1% | 7.3 | Preserve this distinct, source-backed topic |
| `/blog/organize-receipts-for-accountant` | 4 | 307 | 1.3% | 10.6 | Strengthened the contextual path to receipt management |
| `/receipt-to-csv` | 3 | 120 | 2.5% | 8.2 | Keep the real sample and precise export limitations |

Selected queries reinforce these priorities. “receipt tracker” has 1,409 impressions at position 22.7; “receipt organizer” has 758 at 19.2; “receipt management software” has 760 at 29.4. “receipt folder” has 65 impressions at 9.1, supporting a useful filing-system article. Query positions and page positions cover different sets of impressions and should not be compared as equivalent measurements.

Google's AI feature report already lists the homepage with 137 impressions, receipt organizer with 124, receipt retention with 89, fading receipts with 71, and the accountant handoff guide with 55. These are useful topics to develop further with concrete examples rather than duplicating their answers on new URLs.

## Crawl and indexing findings

The saved [live crawl](2026-11-24-live-crawl.json) checks every URL from the production sitemap. All 46 returned HTTP 200, a nonempty title and description, one H1, a matching canonical, and no detected public indexing block. HTTP, www, and trailing-slash variants resolved to the canonical host and path. Two invented public/article URLs returned real HTTP 404 responses. `/app` returned a response-level `noindex` header.

Requests using Googlebot, Bingbot, OAI-SearchBot, Claude-SearchBot, and Claude-User names successfully retrieved the homepage and one article. These are user-agent simulations, not authenticated visits from those providers. They do not prove that every provider IP is permitted or that a provider has indexed the site. The live wildcard robots group allows public content and excludes private application paths; no crawler-policy expansion was needed.

The 13 exclusions comprise eight redirects, two noindex URLs, one alternate canonical, and two crawled but unindexed articles. Redirects, account-page noindex directives, and alternate canonicals can be intentional; do not try to make every excluded URL indexable.

The two unindexed article inspections showed successful fetching, allowed indexing, and the expected declared canonical:

| Article | Google's last recorded crawl | Action completed |
| --- | --- | --- |
| `/blog/receipt-tracking-delivery-drivers` | September 18, 2026 | Request indexing accepted |
| `/blog/organize-receipts-taxes-freelancer-guide` | September 9, 2026 | Request indexing accepted |

Both crawls predate the live November revisions. Search Console confirmed that both URLs entered its priority crawl queue. They were still reported as unindexed at inspection; acceptance of the requests does not mean indexing is complete. Repeated submissions do not improve queue position.

Core Web Vitals has insufficient field data for both mobile and desktop. This is not a passing performance assessment. The production build's initial payload is approximately 531 KB raw and 107 KB estimated transfer, before route-specific assets. Measure actual mobile loading before selecting further performance work.

## Article and product changes prepared

Two new articles bring the registry from 18 to 20 articles:

| Local article path | Primary intent | Useful original material | Hero asset |
| --- | --- | --- | --- |
| `/blog/receipt-folder-system` | receipt folder system | Folder structure, searchable filename convention, $134 example demonstrating how duplicate project allocations become $194, and a retrieval check | Reuses `src/assets/images/blog/track-business-receipts-by-project.jpg` |
| `/blog/chatgpt-claude-receipt-scanning` | ChatGPT and Claude receipt scanning | Copyable extraction prompt, ambiguous-date handling, subtotal/tax checks, and a five-document evaluation routine | Reuses `src/assets/images/blog/how-to-scan-receipts-for-taxes.webp` |

The images closely match the workflows. Both articles have their own metadata, descriptive image text, publication dates, table-of-contents anchors, three related articles, visible affiliation disclosures, and contextual product links. The AI guide links directly to OpenAI and Anthropic documentation. Its purchase example is fictional, and it makes no claim to have benchmarked model accuracy or to offer a native integration. Its proposed tax column is explicitly distinguished from ReceiptNest's actual three-column CSV.

The receipt-management page now names ReceiptNest and its supported capture methods in the opening answer, compares owner receipt management with folders, employee expense workflows, and accounting software, and demonstrates a three-purchase monthly handoff. The title and description emphasize small-business receipt management. Additional contextual links connect the new articles with scanner, organizer, accountant handoff, and scanning guides. The blog's workflow links now include receipt management and scanning.

Six older reading times substantially overstated the current article lengths. Updated estimates use roughly 220 words per minute, rounded up, with a three-minute minimum. Cosmetic reading-time corrections alone do not refresh publication dates. Modified dates changed where contextual article resources or page content changed.

Existing articles already cover the main tax record questions, scanning, fading paper, accountant handoffs, delivery work, Etsy, and Expensify. Preserve those URLs and improve them as evidence accumulates. Keep the missing-receipt recovery answer on the existing bank-statements article. Avoid another near-duplicate article just to target a spelling variation. Preserve the owner's essays, but prioritize practical receipt questions for the next search-led additions.

Spot checks of the linked IRS recordkeeping and retention sources and Expensify's individual free-feature documentation support retaining the important qualifications: electronic records have requirements, retention has exceptions, and Expensify offers free individual scanning and web CSV export. A future competitor comparison should include an actual documented test before claiming superior accuracy or convenience.

## Independent coverage is the larger remaining gap

Search Console reports 393 external links: 211 to the homepage, 181 to terms, and one to the bank-statements article. Its leading source domains are Apple with 205 links and Google with 172. Together those account for approximately 96% of the displayed total. The other visible leading sources are Product Hunt with five, X with three, and Reddit with two.

These are link counts, not 393 independent endorsements or referring domains. Search Console's links report is not a complete backlink inventory. Still, its visible concentration suggests that earning relevant independent editorial references is a higher priority than generating many more generic articles.

Prepare a small public demonstration with fictional or consented receipts: show the original, extracted fields, corrections, retrieval, and actual export. Invite independent reviewers to use their own receipts and describe the limitations. Seek relevant coverage from freelance operations, bookkeeping education, and small-business publications. Offer a concrete example or sample they can reference. Do not buy ranking links, fabricate testimonials, or post automated promotional replies. No outreach or third-party messages were sent as part of this audit.

## Google ChatGPT and Claude discovery

The current implementation already provides public HTML, consistent product entities, official app links, sources, and retrievable examples. Maintain these foundations. Google states that its AI search features use the same SEO fundamentals and require no special AI schema or additional machine-readable text file. See [Google's AI feature guidance](https://developers.google.com/search/docs/appearance/ai-features) and [AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide).

OpenAI distinguishes search crawling from training crawling in its [crawler documentation](https://developers.openai.com/api/docs/bots). Anthropic likewise describes Claude-SearchBot and Claude-User in its [crawler policy](https://privacy.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler). Public accessibility makes retrieval possible; it does not compel a recommendation. Adding an article that mentions an assistant does not itself make that assistant recommend ReceiptNest.

Measure actual referrals in analytics for sources such as `chatgpt.com` and Claude, alongside organic search and activated accounts. Do not infer ChatGPT or Claude citations from Google's AI report. For a small manual visibility sample, use a fixed set of realistic questions, record tool, date, locale, cited URLs, and brand accuracy, and avoid treating a single answer as a stable ranking.

## Next steps and measurement

1. Review and deploy this prepared batch. The new articles and product changes are local until deployed. The publishing skill requires deployment to be requested separately.
2. After deployment, verify both new canonical URLs, production HTML, images, and the sitemap. Request indexing once for each new article and the materially revised receipt-management page.
3. Check the two existing recrawl requests for a later crawl or indexing change. If exclusions persist, assess content usefulness and discovered links instead of repeatedly resubmitting.
4. Prioritize independent coverage and a reproducible product demonstration. The new guides can support that work with specific examples to cite.
5. Review matched 28-day periods after deployment. Compare page/query impressions, positions, CTR, clicks, signup, and first-receipt activation. Segment device and country, account for tax-season demand, and separate branded from nonbranded discovery. Do not attribute changes to this batch alone.
6. Expand only where queries or user questions show a distinct unmet need. Candidate follow-ups include a tested receipt-to-spreadsheet walkthrough and a documented extraction comparison using the same receipts, with corrections and failure cases shown.

## Validation

Production build and generated SEO gate passed for 48 public pages, three account pages, 1,770 local links, and three videos. The gate verifies sitemap coverage, canonical URLs, indexing metadata, image dimensions and local assets, internal fragments, video metadata, private-route headers, and the sample CSV. Build warnings remain for existing component style budgets and CommonJS dependencies.

Browser checks at 390 px and 1440 px confirmed one H1, loaded hero images, and no page overflow for both new guides and the revised product page. The guides index, mobile table containment, table-of-contents links, and light/dark article appearance were also inspected. Final diff whitespace checks passed. No production deployment, purchase, outreach, or recurring automation is included.
