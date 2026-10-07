# Phone edition — 9:16

Final output: `exports/ReceiptNest_I-Have-My-Ways_9x16_CAPTIONED.mp4`.
Format: 1080 × 1920, H.264, 24 fps, 60 seconds, AAC audio, MP4 fast start.

The wide animated scenes have been recut as speaker/reaction close-ups. The
capture montage preserves the full phone using a live detail frame and softened
moving scenery at the outer edges. The monthly spending summary, stored receipt,
sent-email illustration, and end card have new native portrait layouts.

All character scenes use the original animated footage. The final soundtrack is
copied from the approved landscape master without re-encoding. Caption timing
is unchanged; the longest caption wraps into two lines and all captions sit
about 400 pixels above the lower edge to leave room for mobile app controls.

The source videos are 720p; reframing uses their existing image detail. No new
generations, purchases, or posting were needed. Originals remain in place.

Editable production sources:

- `render_portrait.py`: scene reframing, portrait graphics, source timing.
- `portrait-timeline.json`: frame-accurate edit manifest.
- `exports/ReceiptNest_I-Have-My-Ways_9x16_CAPTIONED.srt`: portrait subtitles.
- `caption-tools/burn_caps_clean.sh`: caption burn.

Checks: final decoding, 1,440 frames at 24 fps, exactly 60 seconds of video and
audio, 1080 × 1920 dimensions, and compressed-audio hash matching the landscape
master. Contact-sheet review covers the dialogue, capture montage, all product
cards, and end card. See `qa/portrait-delivery.json` and the portrait QA images.
This environment did not provide a listening audition.

User delivery: matching captioned MP4 and SRT in Downloads.
