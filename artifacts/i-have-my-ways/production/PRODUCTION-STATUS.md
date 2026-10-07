# I HAVE MY WAYS — motion cut ready for review

Updated October 3, 2026.

## Primary deliverable

`../exports/ReceiptNest_I-Have-My-Ways_ANIMATED-CUT.mp4`

A complete 60-second cut using actual character animation and spoken dialogue in every story scene, a three-location moving receipt-capture montage, tracked phone-screen graphics, animated product inserts, the original Firefly score, scene Foley, and subtle UI effects. 1280 × 720, 24 fps, H.264, stereo AAC 48 kHz. The earlier still-image visual workprint is superseded as the primary viewing artifact and remains only as a planning reference.

## Sources and editability

- `../footage/`: all seven original generated MP4s, plus the screen-composited montage and the store capture close-up.
- `render_motion_film.py`: complete film assembly, product graphics, timing and mix. Requires every motion source; no still-image fallback.
- `composite_capture_screens.py`: phone-screen tracking and compositing, including finger occlusion masks.
- `remaining-motion-shots.json`: exact prompts, settings, seeds and Adobe asset IDs for the five scenes generated after the opening.
- `motion-timeline.json`: rendered shot and product-insert timing.
- `MOTION-PRODUCTION-NOTES.md`: provenance, creative fixes, costs, and review limits.
- `qa/`: source contact sheets, transcripts, phone tracks, final frames and technical logs.

## Verification

The 60-second export decoded completely: 1,440 frames. Measured integrated loudness −17.5 LUFS and true peak −1.5 dBFS. Contact sheets cover all scenes and product inserts. Automatic transcription found the intended story dialogue, both “I have my ways” lines, the monthly and coffee totals, and “Every day.” Product amounts remain exact; category values sum to $2,961.40. The native capture screens are illustrative editorial graphics, not verified recordings of the app UI.

**Listening-review limitation:** this text-only runtime could not hear the soundtrack. Transcription and level checks do not certify perceived voice consistency, musical fit, or fine lip synchronization. A listening review remains appropriate before publishing.

## Adobe credits and privacy

This continuation used 1,000 existing Adobe credits for six new Kling 3.0 clips. The account displayed 1,015 before these renders and 15 afterward, with an October 4 reset. Coffee was the existing Veo pilot supplied by the user. No upgrades, subscriptions, or credits were purchased. No files were published or submitted to a public gallery.

## Download recovery

The working export route is Firefly Files → Generation history → the clip card’s More actions → Download. Check the actual Downloads folder even if the automation download event times out. Filenames can contain `Firefly_kling_` or `Firefly__`; the seed and final suffix identify the correct clip.

Earlier failures and workprint-only status are preserved in `PRODUCTION-STATUS-before-motion-cut.md` as historical production notes.
