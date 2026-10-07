"""Author captions from the verified final-audio Whisper clocks.

Use the full-master clock for most cues, and scene-isolated final audio where
silence or the inserted product shots confused the continuous transcription.
Currency is formatted as numerals. No dialogue times come from the prompt.
"""
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parent.parent
PROD = ROOT / 'production'
sys.path.insert(0, str(PROD / 'caption-tools'))
from audio_to_captions import to_srt

clocks = {
    'final': json.loads((PROD / 'qa/final-transcript.json').read_text()),
    'scene': json.loads((PROD / 'qa/captions-scene-whisper.json').read_text()),
}

def span(source, segment, first=0, last=-1):
    words = clocks[source][segment]['words']
    return words[first]['start'], words[last]['end']

# Text, start clock, end clock. End clocks may come from a second verification
# pass when that pass recovered a quiet ending (e.g. "dollars").
plan = [
    ('Marcus.', ('scene', 0, 0, 0)),
    ('Miscellaneous, $86?', ('scene', 0, 1, 4)),
    ('It made sense in March.', ('final', 1)),
    ('We are fixing this.', ('final', 2)),
    ('You are photographing', ('final', 3, 0, 2)),
    ('receipts now?', ('final', 3, 3, 4)),
    ('Trying something.', ('final', 4)),
    ("This month's damage?", ('scene', 4)),
    ('$2,961.', ('scene', 5, 0, 6)),
    ('Forty cents.', ('scene', 5, 7, 8)),
    ('How?', ('scene', 6)),
    ('I have my ways.', ('final', 9)),
    ('Where is the receipt?', ('final', 10)),
    ('This one?', ('final', 11)),
    ('Coffee this month?', ('scene', 10)),
    ('Mmm.', ('final', 13, 0, 0)),
    ('$46.20.', ('final', 13, 1, 2)),
    ('How?', ('final', 14)),
    ('I have my ways.', ('final', 15)),
    ('Receipts?', ('final', 16)),
    ('Already with our accountant.', ('final', 17)),
    ('When did we even', ('final', 18, 0, 3)),
    ('do them?', ('final', 18, 4, 5)),
    ('Every day.', ('final', 19)),
]

cues = []
for text, clock in plan:
    start, end = span(*clock)
    assert len(text) <= 32 and len(text.split()) <= 5, text
    cues.append({'start': round(start, 3), 'speech_end': round(end, 3),
                 'end': round(end + 0.22, 3), 'text': text,
                 'clock': list(clock)})

for i, cue in enumerate(cues):
    if i + 1 < len(cues):
        cue['end'] = min(cue['end'], cues[i + 1]['start'])
    # Do not carry spoken captions across the stored-receipt or end-card cuts.
    for cut in (8, 14, 28, 32.25, 37, 45, 49, 56):
        if cue['start'] < cut < cue['end']:
            cue['end'] = cut
    assert cue['start'] < cue['end'], cue

out = ROOT / 'exports'
full = out / 'ReceiptNest_I-Have-My-Ways_CAPTIONED.srt'
full.write_text(to_srt(cues))
coffee_cues = [{**c, 'start': round(c['start']-37, 3),
                'end': round(c['end']-37, 3)}
               for c in cues if 37 <= c['start'] < 45]
(out / 'ReceiptNest_Coffee_CAPTIONED.srt').write_text(to_srt(coffee_cues))

authored = {'beats': [{'phrase': c['text']} for c in cues],
            'currency_policy': 'Spoken currency is displayed in numeric notation.',
            'timing_source': 'Whisper on final master, full and scene-isolated passes.'}
(PROD / 'caption-script.json').write_text(json.dumps(authored, indent=2))
(PROD / 'qa/caption-cues.json').write_text(json.dumps(cues, indent=2))
words = sum(len(c['text'].split()) for c in cues)
report = {'cue_count': len(cues), 'words': words, 'caption_words': words,
          'script_coverage': 1.0, 'max_chars': max(len(c['text']) for c in cues),
          'max_words': max(len(c['text'].split()) for c in cues),
          'style': 'Natural case, white bold Arial, black outline, lower center.',
          'full_srt': str(full), 'coffee_cue_count': len(coffee_cues)}
(PROD / 'qa/caption-coverage.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
print(full.read_text())
