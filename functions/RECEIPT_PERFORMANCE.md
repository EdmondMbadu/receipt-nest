# Receipt processing performance

The package entry point is `lib/bootstrap.js`. Firestore receipt workers load only the receipt-processing module; Firebase discovery and other function targets retain the complete original `index` exports. Conversion libraries are loaded for HEIC/HEIF inputs, and archived-email extraction is loaded for the corresponding administrative retry. The Vertex model client is reused, with a new request containing the original file bytes for every receipt. Extraction responses are not cached.

The deployed original-upload worker retains 1 CPU, 1 GiB memory, concurrency 80 and maximum 10 instances. Minimum instances remains **zero**. One warm instance at this size would add approximately USD 12.96 per 30-day idle month before credits and normal usage, above the user's USD 5 budget, so it was not enabled. Published pricing: https://cloud.google.com/run/pricing.

## Evidence and scope

A historical 30-day sample contained 111 invocation durations: median 4.891 seconds and p90 9.113 seconds. Of 71 matched model calls, median model time was 3.516 seconds and p90 4.702 seconds. Historical cold requests (47 samples) spent median 4.341 seconds before model start; warm requests (24 samples) spent median 0.466 seconds. These groups span revisions and are not a controlled before/after comparison.

Five-process local startup benchmarks measured median 231 ms for the full entry point versus 137 ms for the receipt worker, with 1192 versus 798 loaded modules and approximately 143 versus 93 MiB RSS. This measures module startup, not end-to-end receipt latency.

Direct Cloud Storage input was evaluated with synthetic JPEG, PNG, WebP and PDF receipts. Both paths produced matching expected merchant, date, amount, currency and category, but direct storage was slower on three of four pairs. The production worker therefore retains its existing inline original-byte transport. No compression, downsampling, model change, prompt change or thinking-budget change was shipped.

The existing parser, merchant/category rules, validation, retry ownership, concurrent-edit merging and receipt history are preserved. Regression verification: 207 backend tests passed with one opt-in browser integration test skipped, 15 additional comparisons against the previous compiled worker passed, and all 74 mobile tests passed.

## Ongoing timing checks

`Receipt processing timing` logs contain event delivery, claim, file preparation, extraction, merchant, category, commit and total worker timings. These timing events exclude receipt contents. A completed invocation can still produce a receipt requiring review; it is not a claim that all fields were validated.

From the functions directory:

```sh
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="processreceipt" AND jsonPayload.message="Receipt processing timing"' --project=receipt-nest --freshness=7d --limit=1000 --format=json | node scripts/report-receipt-speed.cjs
```

Compare production p50/p90/p95 on the same file types and comparable traffic before claiming an end-to-end improvement. Cold starts remain possible with minimum instances zero. Keeping a server warm requires separate approval of the recurring idle charge.
