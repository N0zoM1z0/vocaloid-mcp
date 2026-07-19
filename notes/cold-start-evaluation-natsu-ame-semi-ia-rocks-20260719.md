# Cold-start evaluation — natsu-ame-semi-ia-rocks-20260719

Date: 2026-07-19 (Asia/Singapore)

## Scope and source boundary

- Creative authority: `intents/2026-07-19-summer-night-rain-cicadas-ia-rocks.intent.json` only.
- Runtime corpus, prior song artifacts, reference audio, and prior per-song compose scripts were not read or searched.
- Framework contracts/resources and the unordered phrase-grammar vocabulary are process authority only.
- The composition package was published before final human listening. The later
  listening result is recorded below; no song or package revision was requested.

## Readiness evidence

- Original VOCALOID3 Editor: known fingerprint, version 3.2.1.1.
- Requested component `BDREB7P2KTWKYDC5` (`IA_ROCKS`): active registration and non-expired verified probe.
- Probe evidence: cached locked-phoneme render, 4.017052 seconds, SHA-256 `cfd5cf73c3f58c5fff51da9756775480a992fa9239df2b6d2f313f4bffa1c444`.
- Production MCP wrapper uses progress-aware 900-second timeouts.

## Framework issue log

No framework defect observed at initialization.

### 2026-07-19 — partial runner retry (composition-session code, not framework defect)

- Symptom: after revision 2 committed `composition_intent`, the run-scoped script tried to print `preview.diff.totalChanges`; the production response used a different summary shape, so JavaScript raised `TypeError` before harmony or journal calls.
- Evidence: the canonical manifest inspected as song `ame-semi-no-aida`, title `雨と蝉のあいだ`, revision 2, with intent hash `0c931ca4b9ef327df0fb3b0083e11d9e685fa25ee671d48ff6a370a328f2a070`, no voices, no arrangement tracks, and no artifacts.
- Workaround: preserve revision 2, verify song identity and the exact listener question through MCP inspection, make diagnostic extraction tolerant of production summary variants, and resume without recreating or overwriting the manifest.
- Root-cause status: confirmed local runner logging assumption; no canonical-state or MCP mutation failure. The shared production client now normalizes and validates source/predicted/applied revisions and change counts, and retains raw envelopes only for diagnostics.
- Non-overfit acceptance test: resume succeeds from any matching revision whose identity and listener question match, and refuses a same-path manifest with a different identity.

### 2026-07-19 — second partial runner retry (composition-session code, not framework defect)

- Symptom: revision 3 successfully materialized the D-Dorian key and 48 chord events, then the harmony journal payload used an undefined `predicted_revision` taken from an assumed edit-response property.
- Evidence: MCP inspection reports revision 3 and composition hash `0d402975185a20fcd02fa66ea426fc28c09530d5580e677a0224ae0a9b0b35bb`; intent/form/tempo decisions were already recorded and no audio/VSQX artifact exists.
- Workaround: recognize that exact revision/hash as the only valid phase-1 post-harmony checkpoint, skip the already-applied timeline mutation, and omit optional dry-run metadata when resuming.
- Root-cause status: confirmed local response-shape assumption; the dry-run-before-write contract and canonical mutation both completed. The same shared-client normalization fix removes the need to guess `predicted_revision` or response nesting.
- Non-overfit acceptance test: phase 1 is idempotent at the verified post-harmony checkpoint and refuses all other unexpected revision/hash combinations.

### 2026-07-19 — score-run pre-mutation retry (composition-session code, not framework defect)

- Symptom: after read-only lyric alignment/blueprint validation, the run-scoped resume helper looked for `manifest.vocals.tracks`; the canonical schema uses top-level `vocal_tracks`.
- Evidence: revision remained 3 with no voice, vocal track, tuning, or artifact mutation.
- Workaround: use the canonical top-level `vocal_tracks` field for idempotent part/tuning checks.
- Root-cause status: confirmed local manifest-shape assumption. The reusable prompt now requires schema/resource discovery and explicitly identifies canonical top-level `vocal_tracks` for resume checks.
- Non-overfit acceptance test: an empty canonical `vocal_tracks` array is handled as a valid pre-score state, and later populated tracks are located by stable ID.

### 2026-07-19 — post-arrangement journal retry (composition-session code, not framework defect)

- Symptom: arrangement, gain staging, section dynamics, and all three realization bindings completed; the next journal call rejected phrase-grammar blueprint IDs as unknown stable manifest objects.
- Evidence: the blueprint IDs remain valid analyzer evidence inside their parent phrases, but the journal's bindable-object registry resolves the parent phrase IDs, not nested blueprint IDs.
- Workaround: bind the decision to the four parent vocal phrase IDs and retain `GRAMMAR_LIMIT_MISMATCH` as diagnostic evidence; resume skips every already-present arrangement/mix/binding object by stable ID.
- Root-cause status: confirmed local journal-binding assumption; no framework defect or lost composition state. The reusable prompt now states that nested blueprint evidence binds through its owning vocal phrase rather than inventing a top-level object ID.
- Non-overfit acceptance test: a decision about nested phrase metadata binds to the owning phrase object and preserves the analyzer code in evidence without inventing a top-level object identity.

### 2026-07-19 — modal subtonic mislabeled as leading tone (framework defect, non-blocking)

- Symptom: preflight reports 17 `LEADING_TONE_UNRESOLVED` warnings for MIDI C-natural events in declared D Dorian, even though C is a whole tone below tonic D and functions as a modal subtonic.
- Evidence: `src/theory/harmony.ts` unconditionally selects `scale.pitchClasses[6]` as `leadingTone`; it does not verify that the pitch class is one semitone below the tonic. Example: `verse-leaves-cell-001`, note 60 (C), tonic pitch class 2 (D).
- Workaround: preserve the intentional Dorian C-natural notes, keep release policy advisory/off, and disclose the warnings; repair the unrelated out-of-scale G-sharp separately.
- Root-cause status: fixed in the shared analyzer. Degree 7 now receives leading-tone resolution duty only when it is exactly one semitone below tonic; regression coverage distinguishes D Dorian C-natural from C-major B-natural.
- Non-overfit acceptance test: `LEADING_TONE_UNRESOLVED` fires only when scale degree 7 is one semitone below tonic (or when a mode-specific policy explicitly opts in); Dorian/Mixolydian whole-tone subtonics do not trigger it.

### 2026-07-19 — whole-track mean can invert local harmony ordering (framework limitation, non-blocking)

- Symptom: 46 `VOICE_CROSSING` warnings described the lead as the lower voice because the lead track's verse lowered its whole-song mean below the chorus-only harmony mean, despite every simultaneous harmony event being locally below the lead.
- Evidence: `src/theory/voice-leading.ts` orders tracks once by unweighted whole-track mean pitch, then evaluates every overlap against that global order.
- Workaround: restore three phrases to their diatonic lower-third voicings and place only `harm-chorus-wet-air` one octave lower. This keeps the global and local register order unambiguous without the out-of-scale and parallel-perfect warnings introduced by a blanket chromatic shift; rhythm, lyrics, tuning, and selective absence remain unchanged.
- Root-cause status: fixed in the shared analyzer. Expected upper/lower ordering now comes from overlap-duration-weighted simultaneous material; regression coverage prevents unrelated verse register from inverting a chorus-only harmony relationship.
- Non-overfit acceptance test: determine expected lower/upper ordering from overlap-weighted local or section means, and only flag a crossing when the local event order reverses that overlap-context order.

### 2026-07-19 — isolated-stem F0 tracker locks to the second harmonic (framework limitation, non-blocking)

- Symptom: vocal/render analysis marks five MIDI-67 events as `pitch-center-deviation` at approximately +1,166 to +1,197 cents even though the Editor render is non-silent, the project note numbers are correct, and neighboring detected events center normally.
- Evidence: the lead cases `pre-shells-cell-013`, `pre-summer-pushes-cell-002`, `outro-call-cell-003`, and `outro-call-cell-008` report roughly 768–783 Hz against the 391.995 Hz target. `harm-chorus-overlap-cell-007` begins on the same second harmonic and then returns to 391.984/389.257 Hz inside the same event. This is an octave-selection signature, not a random pitch displacement. The final VSQX contains the intended note numbers and only four bounded PIT plus two PBS control points.
- Workaround: retain the rendered stems and score; treat these five event errors as octave-tracker exceptions in the run evidence rather than retuning correctly authored notes. The median detected pitch error across confident lead events is 27.33 cents and across harmony events is 6.97 cents.
- Root-cause status: diagnostic limitation strongly evidenced; the 8 kHz analysis F0 selector accepted a strong second harmonic when `maximum_pitch_hz` was 1200. No render or component failure is evidenced.
- Non-overfit acceptance test: when a candidate is within a narrow tolerance of an exact octave and conflicts with adjacent-note/within-event continuity, evaluate the subharmonic candidate before emitting an error; retain the error only when the lower candidate lacks adequate periodic confidence.

## Final QC and disposition

- Canonical manifest: revision 78, composition SHA-256 binding `4bd440c2d87dca26fb68552ec2b930ef3b8eb90f5b68c7f7ec832a5f33152e29`, mix binding `b37e223771c3e021f4cb5aa5765cbfdbb08b81aa181c7b2814c555c64600217f`.
- Score, build, render, mix, and delivery readiness: all ready with zero blockers. Phrase grammar: 19 phrases/19 blueprints, zero warnings and zero infos.
- Final WAV: 64.399683 seconds, stereo 44.1 kHz/16-bit PCM, non-silent, -16.3 LUFS, 6.4 LU loudness range, -1.2 dBTP, zero clipped sample values, 0.37 dB stereo imbalance; SHA-256 `294963d6c8f456901205a4c8576d687029730a7c8f58e36145461494dd63091c`.
- Final VSQX: schema-valid VSQ3, two IA_ROCKS tracks, 287 notes, component `BDREB7P2KTWKYDC5`; SHA-256 `bda3234c9ce25a8a8b7b48ab5d1d39fc55e72b1670ffb078aa083bdd3b031b3f`.
- Native performance evidence in the VSQX: 18 DYN, 15 BRI, 4 PIT, 2 PBS, and 3 CLE control points; 287 note-style records with varied opening values; three notes have nonzero native vibrato type/length. GEN was deliberately left neutral rather than used as a global intensity control.
- Anchor evidence: lead-solo, lead-harmony, and minimal-band previews are each exactly 25.0 seconds and non-silent. The one-variable A/B removes only the cicada-pulse stem; both A and B are exactly 25.0 seconds, -16.0 LUFS, -1.2 dBTP, and unclipped.
- Post-fix analyzer disposition: the 17 false modal-subtonic warnings are gone. Fifteen register-density warnings are symbolic simultaneous-register windows retained with two-note power chords, pan/EQ/high-pass separation, and bounded raw gain; one drum/rhythm-guitar onset collision is the intentional rock momentum layer; one motif-repetition info finding reflects return identity while phrase-grammar comparison still reports zero findings. These are disclosed, non-blocking, and do not carry a human acceptance claim.
- Creative record: 24 append-only decisions, 100% current core coverage, chain head `dfdf038538bbe9179f366f94e3359a25542dd535950a94fd6c16bd561fb10627`; human listening status `pending`.
- Mastering transparency review was not required: peak reshaping was 1.3 dB, loudness-range change was 0.0 LU, and true-peak correction was 0.0 dB.

### Post-delivery human listening disposition

- The accompaniment masks IA in the final mix.
- The arrangement remains comparatively flat and does not deliver a convincing
  rock feel despite the 190 BPM tempo, rock-oriented roles, and valid delivery.
- These are musical/production findings, not artifact-integrity failures. The
  readiness gates remain accurate about what they measure, but they do not imply
  vocal foreground ownership or genre success.
- Per the user's instruction, the song was not revised. The revision-78 creative
  package therefore retains the pre-listening `pending` value as historical
  publication state; this dated note is the authoritative later disposition.
- Future work should observe section-aware vocal-to-band foreground balance and
  articulation/groove interaction, then present bounded listening choices. It
  must not apply a song-specific automatic gain boost or alter unrelated theory,
  form, tuning, or delivery behavior.

Composition choices and rejected alternatives are in the creative journal. Every retry or partial failure observed in this run is recorded above. Framework corrections were applied only after the fresh session had finished, then validated against this unchanged revision-78 song and the full test suite.
