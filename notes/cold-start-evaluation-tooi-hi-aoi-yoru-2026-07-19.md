# Cold-start composition evaluation: 遠い灯、青い夜

Date: 2026-07-19  
Run ID: `tooi-hi-aoi-yoru-ia-20260719-a`  
Model: `gpt-5.6-sol`, `xhigh`, ephemeral `codex exec` session  
Implementation commit: `31f134e` (`feat: compose distant summer-night IA song`)

## Purpose and result

This was a genuine cold-start test. The composing session received the user's scene and outcome requirements, then learned the repository workflow from the checked-in plans, notes, live MCP contracts, tests, and existing artifact conventions. It did not receive a prior song's notes, chords, lyrics, or hidden composition decisions.

The session successfully delivered an original, technically valid IA_ROCKS song and a complete hash-bound creative record. It kept the local IA library outside the composition boundary: no track-level lookup, reference identity, melody retrieval, lyric retrieval, or copying was used. Only the existing aggregate/manual summer-night palette was consulted after the symbolic composition passed preflight.

The result demonstrates that a fresh agent can recover and execute the intended flow:

`intent -> theory/form -> Japanese note allocation -> IA delivery -> selective harmony -> arrangement -> listening artifacts -> delivery`

It does not yet demonstrate an efficient workflow. The session required a bespoke 1,711-line runner and approximately 495k model tokens. Human intent-fidelity listening remains pending.

## Verified handoff

- Final WAV: `artifacts/songs/tooi-hi-aoi-yoru-ia-20260719-a-r50-final.wav`
- Final VSQX: `artifacts/vsqxs/tooi-hi-aoi-yoru-ia-20260719-a-r50-final.vsqx`
- Creative record: `artifacts/creative-records/tooi-hi-aoi-yoru-ia-20260719-a/`
- Reproducible runner: `scripts/compose-distant-lights.mjs`
- Local run report and intermediate evidence: `build/cold-start-songs/tooi-hi-aoi-yoru-ia-20260719-a/`
- Regression result: 86 tests, 84 passed, 2 expected integration skips, 0 failed.
- WAV: 130.053 s, 44.1 kHz stereo PCM, -17.2 LUFS, -1.5 dBTP, 0 clipped samples.
- VSQX: 335 notes, 44 native controls; declared and materialized gesture sets match for both vocal parts.

## Issue register

Priorities describe follow-up value for the reusable framework, not whether this song can be auditioned now.

### CS-01 — Composition workflow still requires excessive bespoke orchestration

- Category: framework ergonomics
- Priority: P1
- Status: open; song-level workaround committed
- Symptom: the fresh agent had to author a 1,711-line runner containing MCP transport setup, dry-run/write envelopes, revision handling, render orchestration, previews, mastering, journal publication, and recovery logic.
- Impact: cold-start transfer works, but it is expensive, slow to audit, and likely to produce per-song variations in infrastructure behavior. The session used approximately 495k model tokens.
- Current workaround: keep the runner as a reproducible record for this song.
- Recommended improvement: provide a supported composition-session scaffold or library that owns connection setup, edit transactions, resumable stage checkpoints, artifact reuse, anchor audition, mastering, and publication. Song scripts should primarily declare intent, musical material, tuning, arrangement, and listening questions.
- Acceptance test: a fresh agent can deliver an equivalent full song while writing substantially less workflow boilerplate, with canonical recovery and publication supplied by the framework.

### CS-02 — Editor export filename, path length, and Save As recovery are not robust enough

- Category: host automation
- Priority: P1
- Status: open; recovered during the run
- Symptom: one Editor Save As attempt reached an empty filename state, and a long lead-stem output path failed until the runner shortened the stem directory/name and retried.
- Impact: a technically correct composition can stall at the most expensive host-dependent stage; failure messages do not always identify dialog state versus filesystem-path failure.
- Current workaround: shorten host-facing paths and retry the bounded export operation.
- Recommended improvement: before confirming Save As, validate the dialog filename, extension, Windows-resolved parent directory, and path length. Add bounded retry with a fresh dialog, structured failure reason, attempted Windows path, and diagnostic screenshot/state capture. Prefer a framework-owned short staging directory followed by a verified copy.
- Acceptance test: empty filename, nonexistent parent, overlong path, and stale Save As dialog fixtures each produce a deterministic recovery or a precise actionable error without hanging.

### CS-03 — Whole-song loudness can pass while lyric-free sections are effectively inaudible

- Category: audio QC
- Priority: P1
- Status: open; current delivery adjusted
- Symptom: the first master measured about -16.8 LUFS overall, but its intro was approximately -46 LUFS, interlude/release approximately -37 LUFS, and outro approximately -51 LUFS. LRA was 22.8 LU.
- Impact: the intended "empty/distant" space became near-silence on ordinary playback even though full-song loudness and peak checks passed.
- Current workaround: explicit section-bus automation raised intro/outro by 14 dB and interlude/release by 10 dB. The current master is -17.2 LUFS with 15.1 LU LRA and still preserves large contrast.
- Recommended improvement: add section-level integrated loudness, peak, RMS, and audible-floor analysis to mix/preflight output. Allow intentional silence to be declared; otherwise warn or gate on sustained sections that are implausibly far below adjacent semantic sections. Do not solve this with hidden global normalization.
- Acceptance test: a master with acceptable whole-song LUFS but a non-silent ten-second section near -45 LUFS is flagged with the section ID and contrast delta.

### CS-04 — Creative-decision freshness can be invalidated by unrelated mix changes

- Category: provenance model
- Priority: P1
- Status: open; superseding record added
- Symptom: the initial selective-harmony decision depended on the whole `mix_hash`. Raising only lyric-free section buses made the harmony decision stale even though its notes, tuning, and isolated Editor stem were byte-identical.
- Impact: reviews can falsely imply that upstream musical decisions need to be repeated after unrelated downstream changes.
- Current workaround: `distant-decision-harmony-vocals-v2` supersedes the first entry and depends on composition plus the current harmony artifact rather than the whole mix.
- Recommended improvement: define phase-aware dependency defaults and permit artifact-scoped dependencies. Intent decisions normally depend on intent; form/harmony/melody/note-allocation/IA-delivery decisions on composition and relevant object fingerprints; arrangement balance and delivery decisions on mix; rendered claims on explicit artifact digests.
- Acceptance test: changing an instrumental section bus invalidates arrangement/delivery evidence but leaves unchanged note-allocation, IA-delivery, and harmony-composition decisions current.

### CS-05 — Anchor duration is validated too late

- Category: audition workflow
- Priority: P1
- Status: open; intent binding corrected
- Symptom: the final-chorus core was 15.65 seconds, but the 20–30 second anchor requirement was not rejected until preview generation.
- Impact: the agent completed full mixes before learning that its registered anchor scope could not pass the audition gate.
- Current workaround: expand the same semantic anchor to include the four-measure pre-2 preparation plus the eight-measure final chorus, approximately 23.5 seconds. Notes and mix did not need to change.
- Recommended improvement: compute anchor duration from tempo/meter during intent binding or preflight and return bounded candidate scopes that preserve the listening question.
- Acceptance test: an undersized anchor fails before render and reports its exact duration plus adjacent section/phrase boundaries that yield 20–30 seconds.

### CS-06 — Published creative packages need a first-class integrity verifier

- Category: publication/provenance
- Priority: P1
- Status: open; final package repaired and verified
- Symptom: a post-publish one-byte Markdown newline cleanup made the creative report differ from the SHA-256 and byte count recorded by the package index. The mismatch was found only by an explicit manual checksum pass.
- Impact: package metadata can become stale after an apparently harmless formatting edit.
- Current workaround: update the recorded digest/byte count and independently verify every listed file before commit. The committed package is consistent.
- Recommended improvement: add a read-only `verify` action for creative-record packages; make publish output immutable or stage all final bytes before computing the index; run verification in preflight/CI and before delivery.
- Acceptance test: changing one byte in any listed package file makes verification fail with the exact filename, expected digest/size, and actual digest/size.

### CS-07 — Multi-section vocal analysis selection is unintuitive

- Category: analysis API
- Priority: P2
- Status: open; explicit event IDs used
- Symptom: selecting a section by `section_id` did not select events from a vocal part spanning multiple sections.
- Impact: a fresh agent can receive an empty or misleading analysis result despite valid events in the requested timeline range.
- Current workaround: pass explicit event IDs.
- Recommended improvement: define `section_id` as a timeline intersection across parts, or reject unsupported selection with guidance. Document selector precedence and return selected event counts.
- Acceptance test: a single vocal part spanning verse and chorus can be analyzed by either section ID and returns only events intersecting that section.

### CS-08 — Japanese G2P/mora authoring has avoidable warning and counting friction

- Category: lyrics/note allocation API
- Priority: P2
- Status: open
- Symptom: there is no small production tool for reading normalization and mora count before full alignment. Supplying an explicit `sokuon_strategy` for a line with no small `っ` can also emit a misleading warning.
- Impact: agents need repeated full align calls to size pitch/rhythm arrays, and warning output becomes noisy even when note allocation is deliberate.
- Current workaround: explicit kana readings, iterative align calls, and stable mora-index review.
- Recommended improvement: expose a non-mutating `inspect_reading`/`count_morae` action and suppress or downgrade sokuon-strategy warnings when the normalized reading contains no sokuon.
- Acceptance test: the helper returns normalized morae and phonemes without creating a phrase; `sokuon_strategy: not_needed` on a line without `っ` produces no corrective warning.

### CS-09 — Final VSQX publication is still runner-owned

- Category: delivery API
- Priority: P2
- Status: open
- Symptom: there is no formal final-VSQX publish operation. The runner must choose an immutable name, copy bytes, verify the digest, and rely on publication side effects to update the VSQX index.
- Impact: each song runner can implement naming, overwrite safety, and index updates differently.
- Current workaround: byte-verified copy to the revision-bearing `-r50-final.vsqx` path.
- Recommended improvement: provide a canonical publish tool that accepts a current VSQX artifact, creates an immutable revision-bearing path, verifies the copy, updates the index, and returns the published artifact.
- Acceptance test: publishing the same bytes is idempotent; publishing different bytes to the same name is rejected; package metadata and VSQX README/index agree.

### CS-10 — The planned sanitized IA corpus profile and novelty check are not yet available

- Category: style corpus / anti-copy
- Priority: P1 for the corpus milestone
- Status: planned, not exercised
- Symptom: the fresh agent could only use the existing aggregate/manual summer-night palette. It could not exercise the planned sanitized IA corpus statistics or compare the new song against a novelty threshold.
- Impact: this run proves that the theory-first framework can compose without leaning on the library, but it does not yet validate systematic IA-style accumulation or anti-copy metrics.
- Current workaround: no track-level corpus access at all; document that retrieval/copying was not used.
- Recommended improvement: finish the aggregate, identity-free corpus profile and novelty evaluation described by the project plan. Keep corpus observations post-composition and diagnostic; never expose source-song identity or next-note/chord retrieval.
- Acceptance test: a fresh agent can consume only sanitized aggregate distributions after symbolic preflight, and delivery reports novelty evidence without revealing or matching a source track.

### CS-11 — Advisory output is too voluminous for cold-start triage

- Category: diagnostics
- Priority: P2
- Status: open
- Symptom: final preflight reported 130 warnings, while the creative record reduced the relevant musical families to a small set of unique issue codes.
- Impact: repeated event-level advisories obscure the few decisions that require musical judgment.
- Current workaround: group by issue code and inspect bounded representative locations.
- Recommended improvement: return issue-family counts, representative examples, affected-section summaries, and a separate expandable event list. Preserve raw detail for audit without making it the default decision surface.
- Acceptance test: repeated warnings across hundreds of notes produce a concise family summary and a bounded set of examples while retaining pagination for the full list.

### CS-12 — Draft accompaniment timbres limit the listening test

- Category: renderer capability
- Priority: P2
- Status: known limitation
- Symptom: the six-role arrangement is rendered through GM/FluidSynth draft timbres.
- Impact: form, register, density, harmony, and vocal placement are auditionable, but acoustic articulation and production quality cannot be treated as final evidence.
- Current workaround: label the render as a draft arrangement and keep decisions role-based rather than claiming authentic instrument performance.
- Recommended improvement: add higher-quality, licensed render targets or an export path into a production DAW while preserving stem provenance.
- Acceptance test: the same canonical arrangement can render through a higher-fidelity target with stable role IDs and comparable stem hashes/provenance metadata.

### CS-13 — Model selection needed harness-specific discovery

- Category: evaluation harness, not VOCALOID MCP
- Priority: P3
- Status: resolved for this run
- Symptom: the generic `gpt-5.6` slug was unavailable to the local Codex account. The supported high-reasoning slug was `gpt-5.6-sol`, which supports `xhigh`.
- Impact: an evaluation request can fail before repository work begins if the harness assumes a marketing-family name is a callable model ID.
- Current workaround: resolve the supported local model catalog, then launch `gpt-5.6-sol` with `model_reasoning_effort="xhigh"`.
- Recommended improvement: make the cold-start harness record and validate the exact model slug and reasoning effort before starting the timed evaluation.
- Acceptance test: the harness fails fast with available compatible slugs or records the selected compatible model in the evaluation header.

## What was normal creative iteration, not a framework defect

- Choosing A major with add9/maj7/sus and internal F-sharp-minor shadow instead of mapping loneliness directly to a minor key.
- Reserving E5 for `やさしく照らした` and recovering stepwise after the final leap.
- Restricting harmony to four clauses that admit return or release.
- Deciding that the first section balance expressed distance as near-silence, then revising the mix without changing composition.
- Leaving the human keep/reject/revise decision pending. Technical analysis must not self-approve whether the intended scene is emotionally successful.

## Recommended implementation order

1. Build the reusable composition-session scaffold (CS-01) together with robust host export staging/retry (CS-02).
2. Add section-level audible-floor QC and early anchor-duration validation (CS-03, CS-05).
3. Correct decision dependency granularity and add package verification (CS-04, CS-06).
4. Improve analysis/G2P/publish ergonomics and warning aggregation (CS-07, CS-08, CS-09, CS-11).
5. Complete the sanitized IA aggregate profile and novelty pipeline without weakening the theory-first boundary (CS-10).
6. Treat higher-fidelity accompaniment rendering as a separate production-capability milestone (CS-12).

## Cold-start verdict

The framework is transferable: a new high-reasoning agent can understand the intent-first process, create a complete original IA song, materialize IA expression into native VSQX, render non-silent audio, preserve anti-copy boundaries, and publish a reviewable decision record.

The next bottleneck is not basic musical capability. It is making the successful path shorter, earlier-failing, more resumable, and more precise about which evidence becomes stale after each kind of change.
