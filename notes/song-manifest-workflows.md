# Song manifest agent workflows

`.song.json` is the editable source of truth. A VSQX or WAV is a derived build
artifact and must not be used as the only memory of section, pattern, harmony,
or mix intent. Every mutation passes the revision returned by the most recent
inspect/mutation as `expected_revision`; a stale revision fails instead of
silently overwriting a newer song. IDs are lowercase, unique across the
manifest, and preserved across unrelated revisions.

All score, intent, arrangement, and mix writes go through one tool,
`vocaloid_edit_song`, with one `action` and a strict `payload`. Read
`vocaloid://edit-song-contract` (and the per-action contract it links) before
the first write. Positions are zero-based; a quarter note is 480 ticks.

## 1. Create a skeleton

Start with structure, timeline, and harmonic intent only.

```json
{
  "name": "vocaloid_create_song_manifest",
  "arguments": {
    "output_path": "build/songs/ame-no-ato/ame-no-ato.song.json",
    "song_id": "ame-no-ato",
    "slug": "ame-no-ato",
    "title": "雨のあとで",
    "format": "vsq3",
    "time_signatures": [{ "measure": 0, "numerator": 4, "denominator": 4 }],
    "tempos": [{ "position": { "measure": 0, "beat": 0 }, "bpm": 128 }],
    "sections": [
      { "id": "verse-a", "name": "Verse A", "kind": "verse",
        "start": { "measure": 0, "beat": 0 }, "end": { "measure": 8, "beat": 0 }, "energy": 0.5 },
      { "id": "chorus-a", "name": "Chorus A", "kind": "chorus",
        "start": { "measure": 8, "beat": 0 }, "end": { "measure": 16, "beat": 0 }, "energy": 0.86 }
    ],
    "key_changes": [
      { "id": "key-dminor", "position": { "measure": 0, "beat": 0 }, "tonic": "D", "mode": "minor" }
    ],
    "response_format": "json"
  }
}
```

The response returns revision `1` and a content hash.

## 2. Preview, then write, one bounded change

Every edit can run with `dry_run: true` first. The preview returns the
predicted revision, a music-aware diff, theory/intent deltas, and readiness
without touching the file. Send the same payload again without `dry_run` to
write it.

```json
{
  "name": "vocaloid_edit_song",
  "arguments": {
    "action": "upsert_vocal_part",
    "payload": {
      "input_path": "build/songs/ame-no-ato/ame-no-ato.song.json",
      "output_path": "build/songs/ame-no-ato/ame-no-ato.song.json",
      "expected_revision": 1,
      "overwrite": true,
      "dry_run": true,
      "voice": { "id": "voice-ia-rocks", "name": "IA_ROCKS", "component_id": "BDREB7P2KTWKYDC5" },
      "track": { "id": "lead", "name": "Lead", "voice_id": "voice-ia-rocks", "mixer": { "volume": -100, "pan": 64 } },
      "part": {
        "id": "verse-a-lead",
        "section_id": "verse-a",
        "name": "Verse A Lead",
        "start": { "measure": 0, "beat": 0 },
        "end": { "measure": 8, "beat": 0 },
        "phrases": [{
          "id": "verse-a-line-1",
          "start": { "measure": 0, "beat": 0 },
          "allocation": "explicit",
          "lyrics": [
            { "id": "lyric-a", "lyric": "あ", "phonemes": "a" },
            { "id": "lyric-me", "lyric": "め", "phonemes": "m e" }
          ],
          "cells": [
            { "id": "cell-a-1", "duration": { "denominator": 16 }, "note_number": 67, "lyric_index": 0 },
            { "id": "cell-a-2", "duration": { "denominator": 16 }, "note_number": 69, "lyric_index": 0 },
            { "id": "cell-me-1", "duration": { "denominator": 8, "tuplet": { "played": 3, "in_time_of": 2 } },
              "note_number": 71, "lyric_index": 1, "vibrato": { "type": 13, "length": 35 } }
          ]
        }]
      }
    },
    "response_format": "json"
  }
}
```

Use separate writes for lead, double, harmony, and counterline so a failed
harmony edit cannot replace a valid lead part.

### Phrase cells

Phrases keep the rhythm/lyric source; the build compiles them to native notes.

- `allocation: "sequential"` consumes one lyric unit per non-rest cell, so a
  rapid line can change durations inside the phrase instead of sitting on a
  uniform grid.
- `allocation: "explicit"` lets several consecutive cells share one
  `lyric_index`; the second and later notes compile to native `-` continuation
  events (melisma). A rest breaks the chain.
- A cell duration is either integer ticks or a note value (`denominator`,
  optional `dots`, optional `tuplet`). `gate_percent` shortens the sounding
  part of a cell.
- For Japanese text, prefer `vocaloid_align_japanese_phrase`: it turns a
  surface string plus explicit kana reading into a manifest-compatible phrase
  with mora allocation, small-`っ` timing, and phonemes, which you then send
  with `upsert_vocal_phrase`.

## 3. Revise stable events

Read only the section you are changing:

```json
{
  "name": "vocaloid_get_song_section",
  "arguments": { "path": "build/songs/ame-no-ato/ame-no-ato.song.json", "section_id": "chorus-a", "response_format": "json" }
}
```

Then transform exactly the returned event IDs. An empty `event_ids` array
selects every matching event in the supplied scope, so use it deliberately.

```json
{
  "name": "vocaloid_edit_song",
  "arguments": {
    "action": "transform_events",
    "payload": {
      "input_path": "build/songs/ame-no-ato/ame-no-ato.song.json",
      "output_path": "build/songs/ame-no-ato/ame-no-ato.song.json",
      "expected_revision": 12,
      "overwrite": true,
      "transform": {
        "section_id": "chorus-a",
        "vocal_track_id": "harmony-high",
        "event_ids": ["chorus-harmony-note-7", "chorus-harmony-note-8"],
        "targets": ["vocal_notes"],
        "transpose": 3,
        "velocity_scale": 1.08
      }
    },
    "response_format": "json"
  }
}
```

Other actions follow the same envelope: `upsert_section`, `replace_timeline`,
`upsert_vocal_phrase`, `apply_tuning`, `upsert_arrangement` (pitched or drum
tracks with reusable patterns and placements), `apply_groove`,
`upsert_effect_chain`, `upsert_section_dynamic`, `remove_objects`, and the
intent actions described in `notes/composition-intent-contract.md`.

## 4. Build, render, mix, deliver

Run `vocaloid_preflight_song` until the needed readiness gate passes, then
build. Output names should carry the slug and source revision; the build
advances the manifest once more to record artifact hashes and dependencies.

```json
{
  "name": "vocaloid_build_song_manifest",
  "arguments": {
    "manifest_path": "build/songs/ame-no-ato/ame-no-ato.song.json",
    "expected_revision": 13,
    "backing_output_path": "artifacts/evals/ame-no-ato/ame-no-ato-backing-r13.wav",
    "project_output_path": "artifacts/evals/ame-no-ato/ame-no-ato-r13.vsqx",
    "response_format": "json"
  }
}
```

After that:

1. `vocaloid_render_vocal_stems` renders each vocal track separately through
   the original Editor; `vocaloid_render_instrument_stems` renders the
   arrangement tracks. Both record hash-bound stem artifacts.
2. `vocaloid_render_stem_mix` applies the manifest's effect chains and section
   dynamics (see `notes/stem-mix-workflow.md`).
3. `vocaloid_master_manifest_delivery` loudness-masters the current mix into a
   listening delivery. `vocaloid_render_manifest_master` is the shortcut that
   renders the built VSQX in one Editor pass instead of per-track stems.

Analyze the result (`vocaloid_analyze_wav`, `vocaloid_analyze_vocal_stem`,
`vocaloid_review_audio`), then make the next change in the manifest. Never
patch a derived VSQX as the only record of a decision.
