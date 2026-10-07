# Captioned exports

Delivered October 3, 2026:

- `exports/ReceiptNest_I-Have-My-Ways_CAPTIONED.mp4` — 60 seconds.
- `exports/ReceiptNest_Coffee_CAPTIONED.mp4` — 8 seconds.
- Matching `.srt` subtitle files beside each export.
- Copies of all four files in `/Users/edmondmbadu/Downloads`.

Style: natural sentence case, white bold Arial with black outline and a small
shadow, centered near the bottom. Maximum five words and 28 characters per cue.
The full film has 24 cues; the coffee cut has five. Captions clear before the end
card and avoid the faces and receipt graphics.

Timing uses Whisper on the finished master and scene-isolated portions of its
audio, checked against the authored dialogue. Currency is displayed as numerals;
the separately spoken “Forty cents” remains a separate cue. Source clock
references are retained in `qa/caption-cues.json`.

The Higgsfield subtitles package was found in the installed remote bundle's
legacy `video-montage/scripts` directory. The bundled clean burner was copied
to `caption-tools` and run locally for the requested Downloads delivery. The
clean masters remain the sources for any later caption revisions.

Validation: both MP4s fully decode; audio and video each reach the intended
60/8-second durations. Compressed audio hashes match their respective clean
masters exactly. Twelve frames were inspected across the full film, including
captioned dialogue and the clear end card. This environment did not provide a
listening audition. See `qa/caption-delivery.json`, `qa/caption-contact-sheet.jpg`,
and `qa/caption-preview.png`.
