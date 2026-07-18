# Song manifest agent workflows

`.song.json` is the editable source of truth. A VSQX or WAV is a derived build
artifact and must not be used as the only memory of section, pattern, harmony,
or mix intent. Every mutation below requires the revision returned by the most
recent inspect/mutation. All IDs are lowercase, globally unique, and preserved
across unrelated revisions.

## Example 1: create a long-song skeleton

Start with structure, timeline, and harmonic intent. Do not submit vocals and
every instrument in this call.

```json
{
  "name": "vocaloid_create_song_manifest",
  "arguments": {
    "output_path": "songs/ame-no-ato.song.json",
    "song_id": "ame-no-ato",
    "slug": "ame-no-ato",
    "title": "雨のあとで",
    "format": "vsq3",
    "time_signatures": [
      { "measure": 0, "numerator": 4, "denominator": 4 },
      { "measure": 24, "numerator": 6, "denominator": 8 },
      { "measure": 32, "numerator": 4, "denominator": 4 }
    ],
    "tempos": [
      { "position": { "measure": 0, "beat": 0 }, "bpm": 128 },
      { "position": { "measure": 24, "beat": 0 }, "bpm": 142 },
      { "position": { "measure": 32, "beat": 0 }, "bpm": 168 }
    ],
    "sections": [
      {
        "id": "intro",
        "name": "Intro",
        "kind": "intro",
        "start": { "measure": 0, "beat": 0 },
        "end": { "measure": 4, "beat": 0 },
        "energy": 0.25
      },
      {
        "id": "verse-a",
        "name": "Verse A",
        "kind": "verse",
        "start": { "measure": 4, "beat": 0 },
        "end": { "measure": 16, "beat": 0 },
        "energy": 0.5
      },
      {
        "id": "chorus-a",
        "name": "Chorus A",
        "kind": "chorus",
        "start": { "measure": 16, "beat": 0 },
        "end": { "measure": 24, "beat": 0 },
        "energy": 0.86
      }
    ],
    "key_changes": [
      {
        "id": "key-dminor",
        "position": { "measure": 0, "beat": 0 },
        "tonic": "D",
        "mode": "minor"
      }
    ],
    "response_format": "json"
  }
}
```

The response supplies revision `1` and a content hash. If another agent or tool
has advanced the file, a mutation with `expected_revision: 1` fails instead of
silently overwriting the newer song.

## Example 2: add rapid lyrics and melisma one part at a time

This call adds one voice, one track definition, and one part. Rhythm cells retain
the high-level lyric/rhythm source, while the build compiles them to native VSQX
notes. `explicit` allocation lets several cells point at one lyric; continuation
notes become native `lyric="-"` / `phonemes="-"` events.

```json
{
  "name": "vocaloid_upsert_manifest_vocal_part",
  "arguments": {
    "input_path": "songs/ame-no-ato.song.json",
    "output_path": "songs/ame-no-ato.song.json",
    "expected_revision": 1,
    "overwrite": true,
    "voice": {
      "id": "voice-ia-rocks",
      "name": "IA ROCKS",
      "component_id": "BDREB7P2KTWKYDC5"
    },
    "track": {
      "id": "lead",
      "name": "Lead",
      "voice_id": "voice-ia-rocks",
      "mixer": { "volume": -100, "pan": 64 }
    },
    "part": {
      "id": "verse-a-lead",
      "section_id": "verse-a",
      "name": "Verse A Lead",
      "start": { "measure": 4, "beat": 0 },
      "end": { "measure": 16, "beat": 0 },
      "phrases": [
        {
          "id": "verse-a-line-1",
          "start": { "measure": 4, "beat": 0 },
          "allocation": "explicit",
          "lyrics": [
            { "id": "lyric-ame", "lyric": "あ", "phonemes": "a" },
            { "id": "lyric-no", "lyric": "め", "phonemes": "m e" }
          ],
          "cells": [
            {
              "id": "cell-ame-1",
              "duration": { "denominator": 16 },
              "note_number": 67,
              "lyric_index": 0,
              "velocity": 58
            },
            {
              "id": "cell-ame-2",
              "duration": { "denominator": 16 },
              "note_number": 69,
              "lyric_index": 0,
              "velocity": 64
            },
            {
              "id": "cell-no-1",
              "duration": { "denominator": 8, "tuplet": { "played": 3, "in_time_of": 2 } },
              "note_number": 71,
              "lyric_index": 1,
              "velocity": 70,
              "vibrato": { "type": 13, "length": 35 }
            }
          ]
        }
      ]
    },
    "response_format": "json"
  }
}
```

Use separate calls for lead, double, harmony, and counterline. That keeps a
failed harmony edit from replacing a valid lead part.

## Example 3: inspect, revise stable events, then build

First read only the target chorus:

```json
{
  "name": "vocaloid_get_song_section",
  "arguments": {
    "path": "songs/ame-no-ato.song.json",
    "section_id": "chorus-a",
    "response_format": "json"
  }
}
```

After using the returned stable IDs and current revision, transpose only the
chosen notes and strengthen their velocity. An empty `event_ids` array would
select every matching event in the supplied scope, so use it intentionally.

```json
{
  "name": "vocaloid_transform_song_events",
  "arguments": {
    "input_path": "songs/ame-no-ato.song.json",
    "output_path": "songs/ame-no-ato.song.json",
    "expected_revision": 12,
    "overwrite": true,
    "transform": {
      "section_id": "chorus-a",
      "vocal_track_id": "harmony-high",
      "event_ids": ["chorus-harmony-note-7", "chorus-harmony-note-8"],
      "targets": ["vocal_notes"],
      "transpose": 3,
      "velocity_scale": 1.08
    },
    "response_format": "json"
  }
}
```

Build only after inspecting the resulting revision. Output names include the
song slug and source revision; the build advances the manifest once more to
record artifact hashes and dependencies.

```json
{
  "name": "vocaloid_build_song_manifest",
  "arguments": {
    "manifest_path": "songs/ame-no-ato.song.json",
    "expected_revision": 13,
    "backing_output_path": "artifacts/ame-no-ato-backing-r13.wav",
    "project_output_path": "artifacts/ame-no-ato-r13.vsqx",
    "response_format": "json"
  }
}
```

Then call `vocaloid_render_wav` on the built VSQX, analyze the rendered audio,
and make the next revision in the manifest rather than patching the derived
VSQX as the only source of truth.
