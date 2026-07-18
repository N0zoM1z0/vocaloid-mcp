# Score-vs-render vocal analysis

`vocaloid_analyze_vocal_stem` connects an editable manifest event to evidence
from an original-Editor vocal stem. It is an observation tool, not an automatic
pitch quantizer.

## Preconditions and alignment

- Input must be a `vocal_stem` artifact produced for the current
  `composition_hash`; its file SHA-256 and byte count are verified again.
- The stem provenance supplies the manifest vocal `track_id`.
- Direct-note IDs and phrase-cell IDs remain the score/event identity in the
  report.
- Project pre-measure duration and every tempo change are integrated before an
  optional explicit `timeline_offset_seconds` is added.
- The reported `estimatedGlobalEnergyOffsetMilliseconds` is observational.
  Consonants also move the energy onset, so the server never silently applies
  that estimate to later calls.

## Measurements

Audio is decoded to mono 8 kHz for bounded analysis. Each selected score event
uses 40 ms frames at 10 ms hops and a YIN-style difference estimator near the
expected pitch range. The JSON contains:

- expected score start/end, target MIDI/F0, lyric and phonemes;
- energy onset, confident target-pitch onset, consonant lead, and energy offset;
- median/mean/p95 pitch error, pitch spread, confidence, and voiced ratio;
- a bounded pitch contour carrying time, Hz, cents, confidence, and RMS;
- tail vibrato depth in cents, cycle rate, and interval regularity;
- phrase/part start-end deviations and aggregate pitch/voicing;
- issue codes with event IDs, evidence, and a conservative recommendation.

Adjacent legato notes can have continuous energy across a boundary. Those events
are marked `boundaryContinuous`, and the analyzer does not treat their first
energy frame as a reliable note onset. Notes shorter than 120 ms receive
`rapid-note-limited-resolution`; their phrase contour is more meaningful than a
standalone F0 verdict.

## Example

```json
{
  "name": "vocaloid_analyze_vocal_stem",
  "arguments": {
    "manifest_path": "songs/ame-no-ato.song.json",
    "expected_revision": 21,
    "stem_artifact_id": "vocal-stem-lead-r20",
    "output_path": "artifacts/ame-no-ato-lead-r21.vocal-analysis.json",
    "section_id": "chorus-a",
    "pitch_tolerance_cents": 80,
    "onset_tolerance_ms": 120,
    "offset_tolerance_ms": 160,
    "timeline_offset_seconds": 0,
    "response_format": "json"
  }
}
```

The agent should inspect the contour before responding to a pitch warning. A
short intentional scoop, portamento, or expressive release should not be
flattened merely because a transition frame differs from the equal-tempered
target. Revise note position, VEL/phonemes, PIT/PBS, duration, or vibrato only
when the evidence and musical intent agree.

This stage does not recognize phoneme identity or judge the backing mix: it
measures timing/voicing/pitch on an isolated stem. Masking and full-mix spectral
decisions belong to the later stem-mix analysis layer.
