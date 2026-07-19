# Cold-start composition evaluation: 風は名を呼ばない

Date: 2026-07-19

Run ID: `kaze-wa-na-o-yobanai-ia-20260719`

Model: `gpt-5.6-sol`, `xhigh`, fresh `codex exec` session

Voice: original IA, component `BLRGDDR4M3WM2LC6`

## Purpose and result

This run tested whether a genuinely fresh agent could learn the repository's
intent-first composition workflow and create a new song from only this brief:

> Two swordsmen meet again after decades apart. On a cliff path they pass
> without greeting or stopping, each tightening a hand around the sword at his
> waist, and return one another to the rivers and lakes.

The composing session was explicitly prohibited from reading the local IA song
library, prior song manifests/artifacts, previous cold-start outputs, previous
creative packages, or existing `scripts/compose-*.mjs` files. Phrase grammar
was used only as a vocabulary of roles and constraints; the agent authored the
actual pitches, rhythms, rests, lyrics, Japanese mora allocation, harmony, and
arrangement.

The session delivered an original 3:09.943 song titled `風は名を呼ばない`.
IA is framed as the unnamed ridge wind rather than either swordsman. The form
withholds duel and reconciliation, reserves the largest melodic departure for
`柄を握り`, and removes one expected half-bar after the crossing.

The run demonstrates that the current framework transfers to a new agent:

`intent -> theory/form -> note allocation -> IA delivery -> arrangement -> render -> review artifacts -> delivery`

It also exposed reusable workflow and analyzer problems. They are recorded
below even though the song itself is complete.

## Verified handoff

- Final WAV: `artifacts/songs/kaze-wa-na-o-yobanai-ia-final.wav`
- Final VSQX: `artifacts/vsqxs/kaze-wa-na-o-yobanai-ia-final.vsqx`
- Creative record: `artifacts/creative-records/kaze-wa-na-o-yobanai-ia-20260719/`
- Reproducible runner: `scripts/run-kaze-wa-na-o-yobanai.mjs`
- Canonical local manifest: `build/cold-start-songs/kaze-wa-na-o-yobanai-ia-20260719/kaze-wa-na-o-yobanai.song.json`
- Full delivery: 189.943 s, 44.1 kHz stereo PCM, -16.2 LUFS,
  -1.0 dBTP, 8.2 LU LRA, zero clipped samples.
- Premaster: -22.5 LUFS, -4.6 dBTP, 13.2 LU LRA, zero clipped
  samples, approximately 0.14 dB stereo RMS imbalance.
- Score: 11 sections, 12 tempo events, one 2/4 subtraction, 36 vocal
  phrases, 433 vocal events, and five arrangement tracks.
- Native VSQX evidence: 433 `noteStyle` blocks, locked phonemes for all
  433 vocal events, PIT/PBS/DYN/BRI/GEN/CLE controls, and one non-zero
  focus vibrato.
- Original-Editor evidence: both current lead and harmony stems are
  non-silent and bound to original IA, not IA_ROCKS.
- Creative record: 23 hash-chained decisions, 100% core coverage, human
  listening explicitly pending.
- Regression result: 91 tests, 89 passed, 2 expected integration skips,
  0 failed.

## Issue register

Priorities describe reusable framework value, not whether the current song is
listenable.

### KZ-01 — A fresh session still needs a bespoke MCP orchestration runner

- Category: framework ergonomics
- Priority: P1
- Status: open; song-level runner retained
- Symptom: the agent had to discover and build its own stdio MCP client flow,
  revision-aware call wrapper, idempotent stage commands, Editor render
  recovery, mixing, mastering, and publication logic. The final runner is about
  164 KiB.
- Impact: the musical framework transfers, but the operational cost is high and
  each new agent can implement recovery semantics differently.
- Current workaround: retain `scripts/run-kaze-wa-na-o-yobanai.mjs` as the exact
  reproducible workflow record.
- Recommended improvement: provide a supported cold-start/session scaffold
  owning transport setup, progress-aware timeouts, revision checkpoints,
  artifact reuse, anchor rendering, delivery, and publication. Song code should
  mostly declare musical objects and decisions.
- Acceptance test: a fresh agent completes the same workflow with canonical
  recovery and substantially less transport/revision boilerplate.

### KZ-02 — MCP client timeout was shorter than the Editor render contract

- Category: host orchestration
- Priority: P1
- Status: open; runner workaround used
- Symptom: `vocaloid_render_vocal_stems` allowed a 300-second Editor deadline,
  but the SDK client call expired after 60 seconds while the Editor was still
  working.
- Impact: a valid expensive render is reported as failed, the server process is
  lost, and recovery can leave host state behind.
- Current workaround: the runner uses a 900-second call ceiling and resets the
  deadline on progress.
- Recommended improvement: derive the transport timeout from the tool's own
  `timeout_seconds`, add bounded overhead, and keep progress notifications
  alive across long Editor operations.
- Acceptance test: a 2–5 minute Editor export completes through the default
  client without a custom timeout wrapper.

### KZ-03 — A dead Editor lease survives a timed-out server

- Category: host lease recovery
- Priority: P1
- Status: open; exact dead lock archived during this run
- Symptom: after the client timeout killed the MCP server, the lease owner PID
  was dead but `build/runtime/vocaloid-editor-render.lock` remained. Automatic
  stale removal depended on a 20-minute age threshold.
- Impact: a fresh retry is blocked even though no live process owns the Editor.
- Current workaround: verify the recorded owner PID is dead, then move only the
  exact lock into the run's `interrupted-render-20260719` evidence directory.
- Recommended improvement: reclaim a lease immediately when the owner PID and
  process identity are provably dead; retain the age threshold only when
  liveness is ambiguous. Return structured owner/liveness diagnostics.
- Acceptance test: killing the owning MCP process permits an immediate safe
  retry without waiting 20 minutes or manually moving the lock.

### KZ-04 — Save As filename automation remains intermittent

- Category: Windows Editor automation
- Priority: P1
- Status: open; bounded retry succeeded
- Symptom: the Editor reached Save As with a valid existing destination parent,
  but `set_save_filename` observed a zero-length filename and failed to set the
  Edit/ComboBox value. An interrupted partial export was produced. A bounded
  retry of the same valid output succeeded.
- Impact: composition, voicebank, and path validity can all be correct while
  export still stalls at the final host dialog.
- Current workaround: use bounded retry, archive interrupted output, and verify
  final digest/non-silence rather than infer success from dialog completion.
- Recommended improvement: add framework-owned short Windows staging paths,
  validate the parent and filename immediately before confirmation, retry with
  a newly discovered dialog handle, and capture the exact dialog class/value
  state in structured diagnostics.
- Acceptance test: empty filename, stale control handle, and nonexistent parent
  each yield deterministic recovery or a precise failure without a hang.

### KZ-05 — Creative journal re-entry is not ergonomic enough

- Category: workflow idempotency
- Priority: P1
- Status: open; runner guards added
- Symptom: rerunning setup attempted to append an existing decision ID and was
  rejected, even though the surrounding stage needed resumable behavior.
- Impact: a host retry can replay already completed journal work and stop before
  reaching the failed operation.
- Current workaround: query the journal and guard every append with
  `hasDecision`.
- Recommended improvement: provide a resumable stage/checkpoint abstraction or
  a record-if-absent action that verifies exact content before treating an
  existing ID as success. It must never silently overwrite append-only history.
- Acceptance test: rerunning an interrupted stage skips byte-equivalent prior
  decisions, rejects conflicting reuse, and resumes at the first incomplete
  operation.

### KZ-06 — Intent realization binding is sensitive to mutation order

- Category: authoring API
- Priority: P2
- Status: open; runner ordering corrected
- Symptom: a phrase realization binding referenced a tuning gesture before that
  gesture had been created, causing a failed intermediate stage.
- Impact: agents must know a non-obvious ordering rule across otherwise related
  intent, phrase, and tuning operations.
- Current workaround: materialize tuning gestures before binding realization
  IDs, with separate idempotent phases.
- Recommended improvement: expose dependency order in the compact contract and
  return a structured missing-object list. Consider an atomic bounded operation
  for phrase + tuning + realization binding.
- Acceptance test: an invalid order fails before mutation with exact missing
  IDs; the documented canonical order succeeds atomically or resumably.

### KZ-07 — Phrase-entry analysis ignores authored leading rests

- Category: phrase-grammar analyzer
- Priority: P1
- Status: open; warning dispositioned, global rule unchanged
- Symptom: `PHRASE_ENTRY_HOMOGENEITY` reported 30/30 lead phrases and 6/6
  harmony phrases at the same entry. The analyzer derives the signature from
  `phrase.start.beat/tick` and does not add the duration of leading rest cells.
  The score actually uses downbeat, delayed, pickup, and offbeat entries.
- Impact: the principal non-template diagnostic produces a false positive and
  can encourage an agent to alter already varied music merely to satisfy a
  metric.
- Current workaround: inspect authored rest cells and retain the music; record
  the analyzer limitation rather than changing the score.
- Recommended improvement: compute audible/voiced entry from the first
  non-rest cell onset, including leading rests and part/phrase offsets. Preserve
  phrase-start metadata as a separate structural metric.
- Acceptance test: otherwise identical phrases with 0, 120, 240, and 480 ticks
  of leading rest produce four entry signatures and no homogeneity warning.

### KZ-08 — Endpoint-only intent trends cannot express a local crest

- Category: intent analyzer
- Priority: P2
- Status: open; declaration corrected without changing music
- Symptom: the intended delivery was “rise into `柄を握り`, then cool before
  passing,” but `delivery_dynamics: increase` compared only the first and last
  samples. Because the final value is below the local crest, analysis reported a
  contradiction. The original beat-strength threshold also contradicted the
  deliberately weak-beat hilt focus.
- Impact: an accurate local arch can be mislabeled as failure, encouraging an
  inappropriate louder ending or strong-beat relocation.
- Current workaround: declare the whole-passage endpoint trend as stable, keep
  the local crest in prose/materialized controls, and set the measurable focus
  threshold to the authored offbeat value. No notes or tuning were changed.
- Recommended improvement: add measurable `arch`, `valley`, or explicit
  peak-position/peak-delta targets to delivery dynamics, parallel to melody
  contour vocabulary.
- Acceptance test: a start=54, peak=94 at 72%, end=48 curve supports a declared
  local arch and rejects a monotonic-increase claim.

### KZ-09 — Analyzer warnings need concise families and precise dispositions

- Category: diagnostics
- Priority: P2
- Status: open; scoped musical repairs completed
- Symptom: initial preflight produced 87 theory warnings, including 57 register
  density collisions. The useful decision surface was a handful of repeated
  causes: string/piano overlap, aligned bass/footstep onsets, modal subtonics,
  and intentional suspensions.
- Impact: raw event-level volume obscures where a local musical repair is
  warranted and where a warning should remain visible.
- Current workaround: group by code and location, thin/lift/offset only the
  responsible arrangement objects, rerun analysis, and retain intentional
  harmony warnings without adding exceptions or weakening the rules. Density
  warnings fell to zero.
- Recommended improvement: return family counts, bounded representative
  locations, affected sections/tracks, and a paginated raw list.
- Acceptance test: repeated event warnings default to a concise causal summary
  while exact findings remain available for audit.

### KZ-10 — Publication/report actions are only partially rerunnable

- Category: creative-record publication
- Priority: P2
- Status: open; package republished successfully
- Symptom: the audit had already generated the default creative report, so the
  final publish stage failed until `report.overwrite=true` was used. Republishing
  then created a timestamped backup directory that required separate cleanup.
- Impact: a normal final audit can make the packaging stage fail even when the
  journal and deliverables are valid.
- Current workaround: make report generation explicitly overwrite its generated
  target and republish the package after the final journal disposition.
- Recommended improvement: separate read-only completeness inspection from
  report writing, and provide an idempotent package verification/replace flow
  with explicit backup retention policy.
- Acceptance test: inspect -> report -> publish -> add final disposition ->
  republish succeeds deterministically and leaves one canonical package unless
  backup retention is requested.

### KZ-11 — Raw SoundFont and Editor stems require explicit gain staging

- Category: mix workflow
- Priority: P2
- Status: handled for this song; framework guidance can improve
- Symptom: raw instrument stems measured roughly 16–21 dB below the original IA
  lead, while the dry IA stem itself was far below final delivery loudness.
- Impact: a technically non-silent render is not automatically a usable mix;
  naïve summing would make arrangement layers effectively absent.
- Current workaround: measure isolated stems, author per-track effect/gain
  chains and section dynamics, retain premaster headroom, then master from the
  verified seven-stem mix.
- Recommended improvement: surface stem-relative loudness and suggested
  headroom ranges as diagnostics, never automatic creative balance.
- Acceptance test: stem render output includes relative LUFS/peak summaries and
  flags extreme level mismatch without mutating gains.

## What was agent error or normal creative iteration, not a framework defect

- Three grammar-limit mismatches were caused by blueprint metadata not being
  updated after the agent authored the concrete notes. Correcting the local
  blueprint limits was appropriate; weakening validation was not.
- The first XML verification query searched for the wrong VSQX tag shape
  (`<v id=...>`/`nStyle`). The file correctly used `<attr id=...>` and
  `<noteStyle>`. A corrected check found PIT=2, PBS=1, DYN=36, BRI=18, GEN=15,
  CLE=3, 433 note-style blocks, and one non-zero vibrato.
- One bass note at MIDI 26 is two semitones below the conservative GM bass
  warning floor but is within an extended/five-string bass register and rendered
  non-silently. It remains explicitly dispositioned rather than hidden by a
  global exception.
- Choosing a D-minor/modal field, one missing 2/4 half-bar, the wind narrator,
  sparse selective harmony, and one local focus gesture are creative decisions,
  not analyzer repairs.
- Human intent fidelity and mastering transparency remain listening questions.
  Metrics did not self-sign a keep/reject/revise outcome.

## Recommended implementation order

1. Build the reusable resumable session scaffold and align transport timeouts
   with Editor operations (KZ-01, KZ-02, KZ-05).
2. Harden Editor lease and Save As recovery (KZ-03, KZ-04).
3. Fix audible phrase-entry computation and add local-crest intent targets
   (KZ-07, KZ-08).
4. Improve dependency-order diagnostics, warning aggregation, and publication
   idempotency (KZ-06, KZ-09, KZ-10).
5. Add non-mutating stem-relative level diagnostics (KZ-11).

## Cold-start verdict

The framework is transferable. A fresh high-reasoning agent learned the
intent-first process, composed a structurally distinct original song, used only
the original IA voicebank, materialized native expression, completed actual
Editor renders, and published a reviewable creative record without consulting
the local song library or prior compositions.

The main remaining bottleneck is operational reliability and diagnostic
precision, not the agent's ability to form a musical intention. The most
important musical safeguard worked: phrase grammar offered compositional
choices, while the agent—not the DSL or the corpus—generated the final melody.
