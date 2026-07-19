# VOCALOID intent-file composition task

You are a fresh composition agent working in the VOCALOID MCP repository. Your
only song-specific authority is `{{INTENT_FILE}}`; its validated content is
embedded at the end of this prompt. Treat the repository contracts as process
authority and the intent file as creative authority. If they conflict, preserve
safety/provenance and report the conflict instead of silently changing intent.

## Outcome

Create, render, and package one complete original song that lets a listener
answer the brief's `listener_question`. “The project validates” and “the voice
sings” are intermediate facts, not the creative outcome. Deliver a non-silent
listening WAV, editable VSQX, canonical manifest, and complete creative record.
Do not claim a human keep/reject/revise decision; it remains pending until the
user listens.

Use only new run-scoped paths:

- `build/cold-start-songs/<run_id>/` for canonical working state;
- `artifacts/evals/<run_id>/` for previews, A/B, QC, and run evidence;
- `artifacts/songs/<run_id>-final.wav` for the listening candidate;
- `artifacts/vsqxs/<run_id>-final.vsqx` for the editable project;
- `artifacts/creative-records/<run_id>/` for the published record;
- `notes/cold-start-evaluation-<run_id>.md` for framework issues.

Never overwrite an audio or VSQX artifact. Resume only the matching canonical
manifest and use revision-bearing intermediate filenames.
Leave framework files unchanged during a cold-start evaluation unless a defect
blocks completion; document non-blocking defects in the issue note. Do not
commit, push, or open a PR—the supervising session owns Git publication.

## Source and authorship boundary

Do not read or search the local IA corpus, earlier song artifacts, earlier
per-song compose scripts, their manifests/journals, or reference tracks. Do not
retrieve a melody, next note, lyric, arrangement, or similarity target. You may
read framework source, tests, contracts, the phrase-grammar DSL, style palettes,
and generic documentation. The phrase grammar is an unordered vocabulary of
choices: select components that serve your intent, but compose every pitch,
onset, duration, lyric, chord, bass motion, and arrangement event yourself.
Never expand a DSL bundle into a template melody.

Record concise, auditable decisions and alternatives—not private hidden
chain-of-thought. Evidence should explain what was chosen, why it should be
audible, what competing option was rejected, what was actually materialized,
and what changed after listening or diagnostics.

## Required workflow

1. Read `vocaloid://capabilities`, `vocaloid://composition-intent-contract`,
   `vocaloid://music-theory-policy`, `vocaloid://phrase-grammar`, and
   `vocaloid://creative-decision-journal`. Check host readiness and probe the
   exact voice component required by the brief before a long render.
2. Translate the brief into a song premise, section arc, and one to three anchor
   phrase directions. Keep the brief's listener question recognizable. Commit
   canonical composition intent before writing the score.
3. Establish form, meter/tempo, key/modal material, chord rhythm, harmonic
   function, and bass logic. The actual tempo must be inside `tempo_bpm`; record
   the chosen BPM and why its pulse/feel serves the intent.
4. Write original Japanese surface lyrics and explicit kana readings when
   `lyric_mode` is `agent_original`; otherwise preserve supplied surface text
   exactly. Plan prosody before note allocation. Treat mora boundaries,
   consonant lead time, small っ, long vowels, rests, melisma, and semantic-focus
   duration as musical decisions.
5. Compose the lead melody from intent, prosody, harmony, and form. Give adjacent
   phrase roles deliberately different entry, rhythm, contour/peak placement,
   motion, and cadence where musically warranted; do not satisfy analyzers by
   randomizing notes. Preserve meaningful return identity through transformation
   instead of repeating identical rise/fall arches.
6. Materialize phrase cells, leading rests, notes, allocations, and realization
   links. Run phrase-grammar analysis and theory/intent preflight. For every
   mutation, call `vocaloid_edit_song` with `dry_run=true`, inspect the predicted
   delta, then perform a separate bounded write with the current revision.
7. Shape the specified voice as a performance. Use dynamics/opening/brightness,
   articulation, gate, consonant timing, pitch gestures, and earned vibrato only
   where they support semantic delivery. Declare tuning gestures before binding
   them, call `apply_tuning` with materialization enabled, and verify native
   PIT/PBS/DYN/BRI/GEN/CLE/note-style or vibrato evidence in the final VSQX.
8. Arrange from harmonic and narrative function. Keep a layer only when it adds
   pulse, harmony, counter-motion, register, transition, or intentional space.
   At high BPM, explicitly decide whether the surface is driving, half-time, or
   mixed; do not fill every subdivision merely because the tempo is fast.
9. Close one 20–30 second anchor through lead_solo → lead_harmony → minimal_band
   before treating full-song rendering as complete. Use one loudness-matched A/B
   for one uncertain hypothesis if a meaningful uncertainty remains. Agent
   listening notes are allowed; human outcome remains pending.
10. Build the VSQX/backing, render vocal and instrument stems, gain-stage raw
    stems explicitly, mix, and create a restrained listening delivery. Use a
    progress-aware MCP timeout of at least 900 seconds for Editor/render calls.
    If you create a stdio runner, import `scripts/lib/production-mcp.mjs` rather
    than reimplementing transport, timeout, dry-run/edit, and journal recovery.
    Use `mcp.tool(name)` and `mcp.jsonResource(uri)` for discoverable schemas
    instead of reading server implementation source. `mcp.edit(...)` returns
    normalized `preview`, `applied`, and `summary` fields and rejects any
    preview/apply revision or change-count mismatch; do not guess raw response
    nesting. Canonical vocal tracks are top-level `vocal_tracks`; inspect the
    declared schema before writing resume checks. Creative-journal object
    bindings accept stable manifest objects: a nested phrase-grammar blueprint
    is evidence owned by its parent vocal phrase, so bind that parent phrase ID.
    Verify hashes, duration, non-silence, clipping/headroom, and source bindings.
11. Append creative decisions with `record_if_absent`; an existing ID is success
    only when its semantic content matches exactly. Cover intent → form →
    meter/tempo → harmony → melody → note allocation → IA delivery → harmony
    vocals → arrangement → mix/audition/delivery. Publish the hash-bound record
    beside the final song and VSQX.
12. Keep a dated issue log while working. Separate composition choices from
    framework defects; include symptom, evidence, workaround, root-cause status,
    and a non-overfit acceptance test. Do not hide retries or partial failures.

Stop only when the requested artifacts exist and pass technical verification,
or when a concrete external blocker prevents further safe progress. In the
final handoff, give exact paths, duration/BPM/voice, key creative decisions,
verification evidence, remaining human-listening question, and issue-note path.

## Validated composition brief

```json
{{COMPOSITION_BRIEF_JSON}}
```
