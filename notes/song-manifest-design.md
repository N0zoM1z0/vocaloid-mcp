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
- `parent_hash`: hash of the immediately preceding revision, when any;
- stable IDs for the song, sections, voices, tracks, parts, phrases, notes,
  controls, patterns, placements, and artifacts;
- timestamps and artifact provenance.

Every mutation requires `expected_revision`. A stale write fails with the
current revision/hash and tells the agent to inspect again. Existing output
paths are never replaced without explicit overwrite and a backup.

## Core domains

1. Timeline: tempo and meter maps.
2. Sections: semantic form, musical positions, energy, and descriptions.
3. Harmony: key and chord events retained as compositional intent.
4. Vocals: installed voices, track mixer state, parts, notes, phrase-level lyric
   and rhythm sources, expression, vibrato, and control curves.
5. Arrangement: pitched and drum tracks, reusable patterns, placements, and
   renderer settings.
6. Mix: stems, reproducible effect chains, automation, and section dynamics.
7. Artifacts: source revision, dependencies, SHA-256, size, and role.

## Tool boundary

The first implementation uses bounded domain operations rather than one huge
nested call:

- create and inspect a manifest;
- upsert one section;
- upsert one vocal part plus its track/voice metadata;
- upsert one accompaniment track;
- transform selected events by stable ID or semantic scope;
- remove selected objects with referential-integrity checks;
- build accompaniment and VSQX artifacts from one manifest revision.

Later phases use the same manifest for separate stems, score-vs-render vocal
analysis, stem effect chains, Japanese mora/phoneme alignment, and high-level
tuning gestures. High-quality VST/DAW rendering is explicitly outside the
current requested scope.

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
