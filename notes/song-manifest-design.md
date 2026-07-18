# Song Manifest architecture

## Purpose

The manifest is the canonical, editable source of a song. VSQX and WAV files are
derived artifacts. A manifest must retain creative intent that neither file can
represent on its own: named sections, harmony, vocal phrase sources,
accompaniment patterns, mixer/effect decisions, dependencies, and revision
lineage.

The design deliberately avoids a single `generate_good_song` workflow. Agents
make creative decisions; the MCP supplies deterministic inspect, mutation,
transform, build, render, analysis, and comparison operations.

## Version and concurrency contract

Every manifest contains:

- `schema`: fixed schema identifier;
- `revision`: monotonically increasing integer;
- `content_hash`: SHA-256 of canonical JSON excluding `content_hash`;
- `composition_hash`: SHA-256 of performance/arrangement source state, excluding
  downstream mix, revision, timestamps, and artifacts, so raw stems remain
  reusable after EQ/automation revisions;
- `mix_hash`: SHA-256 of `composition_hash` plus ordered effect chains and
  section dynamics, so a rendered mix becomes stale when either source music or
  downstream mix intent changes;
- `intent_hash`: a derived SHA-256 of optional `composition_intent`, used to
  invalidate artistic listening decisions without forcing a byte-identical
  score or stem rebuild;
- `parent_hash`: hash of the immediately preceding revision, when any;
- stable IDs for the song, sections, voices, tracks, parts, phrases, notes,
  controls, patterns, placements, and artifacts;
- timestamps and artifact provenance.

Every mutation requires `expected_revision`. A stale write fails with the
current revision/hash and tells the agent to inspect again. Existing output
paths are never replaced without explicit overwrite and a backup.

## Core domains

1. Composition intent: song premise, section transitions, anchor-phrase
   direction, listening questions, and optional stable realization links.
2. Timeline: tempo and meter maps.
3. Sections: semantic form, musical positions, energy, and descriptions.
4. Harmony: key and chord events retained as compositional intent.
5. Vocals: installed voices, track mixer state, parts, notes, phrase-level lyric
   and rhythm sources, expression, vibrato, and control curves.
6. Arrangement: pitched and drum tracks, reusable patterns, placements, and
   renderer settings.
7. Mix: stems, reproducible effect chains, automation, and section dynamics.
8. Artifacts: source revision, dependencies, SHA-256, size, and role.
9. Review: qualitative notes plus optional intent/composition/artifact-bound
   listening evidence.

## Tool boundary

The first implementation uses bounded domain operations rather than one huge
nested call:

- create and inspect a manifest;
- upsert one section;
- upsert one vocal part plus its track/voice metadata;
- compile Japanese kana into manual-backed mora/phoneme units, align one
  phrase, and upsert only that phrase;
- compile persistent high-level tuning gestures onto voiced stable event IDs;
- upsert one accompaniment track;
- transform selected events by stable ID or semantic scope;
- remove selected objects with referential-integrity checks;
- build accompaniment and VSQX artifacts from one manifest revision.

The same manifest now drives Japanese mora/phoneme alignment, persistent
high-level tuning gestures, separate stems, score-vs-render vocal analysis,
and reproducible stem effects/section automation. High-quality VST/DAW
rendering is explicitly outside the current requested scope.

## Completion evidence

Phase 1 is complete only when tests prove all of the following:

1. content hashes detect manual corruption;
2. stale revisions cannot write;
3. stable IDs survive unrelated edits;
4. section/part/track upserts and event transforms affect only their scope;
5. removals reject dangling references;
6. a manifest builds a validated VSQX plus verified stereo accompaniment;
7. derived artifacts contain hashes and source revision provenance;
8. a real MCP client can perform the workflow without submitting the entire
   song in one call.
