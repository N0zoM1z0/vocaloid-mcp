# Long-form composition workflows

These fragments show the high-level MCP payloads an agent can reuse. Positions
are zero-based and use 480 ticks per quarter note.

## Rapid syllabic phrase

`sequential` consumes one lyric unit for each non-rest cell. Durations may change
inside the line, so a fast lyric is not forced into a uniform grid.

```json
{
  "time_signatures": [{ "measure": 0, "numerator": 4, "denominator": 4 }],
  "phrase": {
    "start": { "measure": 8, "beat": 3, "tick": 240 },
    "allocation": "sequential",
    "lyrics": [
      { "lyric": "か", "phonemes": "k a", "phoneme_locked": true },
      { "lyric": "け", "phonemes": "k e", "phoneme_locked": true },
      { "lyric": "ぬ", "phonemes": "n M", "phoneme_locked": true },
      { "lyric": "け", "phonemes": "k e", "phoneme_locked": true }
    ],
    "cells": [
      { "duration": { "denominator": 16 }, "note_number": 69, "gate_percent": 82 },
      { "duration": { "denominator": 32 }, "note_number": 71, "gate_percent": 76 },
      { "duration": { "denominator": 32 }, "note_number": 72, "gate_percent": 76 },
      { "duration": { "denominator": 8, "tuplet": { "played": 3, "in_time_of": 2 } }, "note_number": 76 }
    ]
  },
  "response_format": "json"
}
```

## One lyric across several notes

In `explicit` mode, consecutive cells with the same `lyric_index` compile the
second and later notes as native `-` continuation events. A rest breaks the
continuation chain.

```json
{
  "phrase": {
    "start": { "measure": 31, "beat": 0, "tick": 0 },
    "allocation": "explicit",
    "lyrics": [{ "lyric": "あ", "phonemes": "a", "phoneme_locked": true }],
    "cells": [
      { "duration": { "denominator": 8 }, "note_number": 72, "lyric_index": 0 },
      { "duration": { "denominator": 16 }, "note_number": 74, "lyric_index": 0 },
      { "duration": { "denominator": 16 }, "note_number": 76, "lyric_index": 0 },
      { "duration": { "denominator": 4, "dots": 1 }, "note_number": 79, "lyric_index": 0,
        "vibrato": { "type": 3, "length": 45 } }
    ]
  }
}
```

## Japanese-instrument pattern placement

Each pattern belongs to one track. This example defines one shamisen bar once,
then gives the verse and chorus different transposition and velocity treatment.
Drum patterns use the same placement model.

```json
{
  "output_path": "artifacts/evals/tsukikage-shissou-backing-v1.wav",
  "time_signatures": [{ "measure": 0, "numerator": 4, "denominator": 4 }],
  "tempos": [
    { "position": { "measure": 0, "beat": 0, "tick": 0 }, "bpm": 120 },
    { "position": { "measure": 32, "beat": 0, "tick": 0 }, "bpm": 126 }
  ],
  "end": { "measure": 96, "beat": 0, "tick": 0 },
  "tracks": [{
    "name": "Shamisen",
    "bank_msb": 0,
    "bank_lsb": 0,
    "program": 106,
    "volume": 94,
    "pan": 54,
    "patterns": [{
      "id": "shamisen-ostinato",
      "measures": 1,
      "notes": [
        { "offset": { "measure": 0, "beat": 0, "tick": 0 }, "duration": 180, "note_number": 64 },
        { "offset": { "measure": 0, "beat": 1, "tick": 240 }, "duration": 180, "note_number": 67 }
      ]
    }],
    "placements": [
      { "pattern_id": "shamisen-ostinato", "start": { "measure": 8, "beat": 0, "tick": 0 }, "repeats": 16, "velocity_scale": 0.78 },
      { "pattern_id": "shamisen-ostinato", "start": { "measure": 32, "beat": 0, "tick": 0 }, "repeats": 16, "transpose": 12, "velocity_scale": 1.08 }
    ]
  }],
  "drums": [],
  "drum_patterns": [],
  "drum_placements": [],
  "gain": 0.1,
  "overwrite": false,
  "response_format": "json"
}
```

Analyze backing and Editor mix before mastering. If full-scale samples are
present, lower source/mixer levels and render a new `-mix-v2.wav`; do not use a
limiter as a substitute for repairing clipped source audio. A clean mix may be
mastered to a distinct title-bearing path such as
`tsukikage-shissou-master-v1.wav`.
