# ReceiptNest — Ready for tax time

Finished 20-second vertical ad for freelancers and solopreneurs.

- **Video:** `exports/ReceiptNest-Ready-for-Tax-Time-20s.mp4`
- **Optional caption sidecar:** `exports/ReceiptNest-Ready-for-Tax-Time-20s.srt` (the main copy is also visible in the film)
- **Editable composition:** `production/render_ad.py`
- **Sequence and provenance:** `production/source-manifest.json`
- **Narration edit points:** `production/audio-edit-map.json`
- **Actual word alignment:** `production/final-word-timestamps.json`
- **Encoded review frames:** `production/final-*.jpg` and `production/encoded-contact.jpg`
- **Technical verification:** `production/qa-results.json` and `production/qa-decode.log`

## Creative treatment

A freelancer sorts loose receipts, photographs one, sees it organized, asks about food spending, exports her records, and closes her laptop with relief. Warm cinematic footage is paired with ReceiptNest's cream and forest-green palette and its actual logo and brand fonts. The ending reads: “Your business receipts. Ready for tax time.”

The food answer remains visible for approximately 2.4 seconds. The final brand/offer card lasts 2.25 seconds. Footage and narration play at their original speed. Speech phrases are placed with deliberate pauses; no time-stretching, repeated footage, or frozen footage is used to fill the runtime. The final card is an authored graphic.

## Spoken script

“Receipts everywhere? Snap them. ReceiptNest organizes them automatically. How much did I spend on food this month? Export a month. Or the whole year. Your business receipts. Ready for tax time.”

## Product accuracy

The UI shots use the real receipt detail, AI Insights and folder detail components from this repository, rendered in the isolated `demo/` app. All merchants, receipts, amounts and conversations are fictional fixtures. The AI answer is a scripted example, not a live AI call. The video labels these as sample data. Eight food receipts sum to $286.40.

The annual export is demonstrated through a folder named “2026 business receipts” containing records from multiple months. It uses the app's actual whole-folder export, not an invented annual-filter screen. The sample yearly CSV was downloaded successfully from the isolated demo. Monthly export uses the real month-group export control. AI Insights and PDF export are marked Pro, and the closing free offer is the first 50 receipts.

Reference code: `src/app/features/folders/folder-detail.component.ts` (whole-folder/month exports), `src/app/features/ai-insights/`, `src/app/features/pricing/pricing.component.html`, and `src/app/content/public-pages.ts` (plan/offer copy). No production backend or customer data was used. No ad was published or restarted.

## Rebuild

Requires Python 3, Pillow, NumPy and imageio-ffmpeg. For the installed task runtime, run from the repository root:

```sh
PYTHONPATH=/private/tmp/receiptnest-ad-runtime python3 artifacts/tax-time-ad-20s/production/render_ad.py
PYTHONPATH=/private/tmp/receiptnest-ad-runtime python3 artifacts/tax-time-ad-20s/production/verify_ad.py
```

`--stills` renders the editable storyboard without creating a new video. `demo/` holds the sample data and build configuration if app screenshots need to be recaptured. It imports the repository's actual components and mocks services locally. Do not deploy the demo as the product.

## Review

Full MP4 decode passed. Export: 1080×1920, 24 fps, 480 frames, 20.00 seconds, H.264/AAC. Audio measured about -16.2 LUFS integrated with -1.5 dBTP peak. Encoded frames and phone-sized playback were checked; the player reached 20/20 seconds without errors. Main text was checked for clipping and contrast. The PDF Pro label was added during final review.

The soundtrack could not be auditioned by ear in this environment; audio checks cover decoding, level measurements, source word alignment, and edit timing. Placement UI margins are provisional: no Meta Ads Manager placement preview was opened or campaign changed. Original generated assets and narration are preserved for future edits.
