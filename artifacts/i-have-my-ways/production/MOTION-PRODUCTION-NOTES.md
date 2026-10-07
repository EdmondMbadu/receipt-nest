# Motion production notes — October 3, 2026

## Sources and edit

The film uses six animated dialogue scenes plus a three-location animated capture montage. Coffee is the user-downloaded Veo 3.1 Fast take. All other scenes are Kling 3.0 generations made through the signed-in Adobe Firefly account. Every generation uses the established character/reference artwork. The original generated MP4s are preserved in `../footage`.

`render_motion_film.py` assembles the 60-second cut. It fails if a motion source is missing; there is no still-image fallback. The total is 48 seconds of generated motion, 8 seconds of animated product inserts, and a 4-second end card. Native dialogue and scene Foley are preserved; the Firefly score is normalized, ducked beneath speech, and lifted toward the end card. UI confirmation effects are synthesized, unpitched accents.

`composite_capture_screens.py` tracks the blank phone-screen regions in all 96 montage frames and adds illustrative ReceiptNest capture graphics, retaining the original fingers as occlusions. The footage cuts at 1.625 and 3.0 seconds. The first 1.25 seconds of the store scene use a moving close-up derived from the lumber capture with a Tool Depot/$129 interface, replacing the generated wide-shot action that raised the camera too high. The original store dialogue and remaining character performance are retained.

The product graphics are an editorial illustration, not verified recordings of the native mobile app. Amounts and category totals are exact. PDF export is identified as Pro; email-sent is shown as a separate mail illustration. The story uses Jan–Dec 2026 for the final receipts attachment.

## Verification and limits

Local Whisper base.en transcription found all intended lines in the six dialogue clips, including $2,961.40, $46.20, both “I have my ways” lines, and “Every day.” Contact sheets were inspected for continuity and movement. The montage's low-confidence “You” token (probability 0.006) is not treated as verified speech. The runtime cannot hear audio: automatic transcript/level checks do not constitute a listening review or an exact phoneme-level lip-sync review.

## Credits and access

The account displayed 1,015 available credits before this continuation and 15 after the completed generations. The six new Kling jobs used 1,000 existing credits in total (200 + 150 + 200 + 150 + 200 + 100). The account displays an October 4 reset. No plan, upgrade, or credit purchase was made. All files remain private; none were submitted to a public gallery.

## Download workflow

Use Firefly Files → Generation history → the file card's More actions → Download. Downloads arrive in the user's Downloads folder. Browser download-event waits can time out despite successful downloads, so verify the actual files. Some filenames omit the model string (e.g. `Firefly__...`); match the generation seed and suffix. Do not repeatedly regenerate or repeat downloads just because the event handler times out.
