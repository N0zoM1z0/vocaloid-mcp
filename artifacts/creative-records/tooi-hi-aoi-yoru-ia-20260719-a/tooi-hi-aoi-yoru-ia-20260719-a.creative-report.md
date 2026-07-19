# 遠い灯、青い夜 — Creative Decision Record

> This report stores concise, auditable creative rationale and evidence. It is not a raw model chain-of-thought transcript.

## Current binding

- Song ID: `tooi-hi-aoi-yoru-ia-20260719-a`
- Manifest: `/home/pentester/coding/codex_ida/vocaloid/build/cold-start-songs/tooi-hi-aoi-yoru-ia-20260719-a/tooi-hi-aoi-yoru-ia-20260719-a.song.json`
- Revision: 52
- Intent SHA-256: `157f9a1b6593fdc555bf982e19a8605c20265e0c0272aaca0587693fd7899242`
- Composition SHA-256: `83fd91723bb94fa19f366865fa0614075910ced9f10660fa9c6634809db2d385`
- Mix SHA-256: `110f3fda76684b16ab637e551d042724802b11dc42a193cd1452cea0f132d7ae`
- Journal coverage: 100% (core complete)
- Human listening: pending

## intent → theory → note allocation → IA delivery → arrangement

| Dimension | Required phases | Current decisions | Status |
| --- | --- | --- | --- |
| Intent | intent | distant-decision-intent-v1 | complete |
| Theory / form / harmony / melody | form, meter_tempo, harmony, melody | distant-decision-form-v1, distant-decision-meter-tempo-v1, distant-decision-harmony-v1, distant-decision-melody-v1 | complete |
| Japanese note allocation | note_allocation | distant-decision-note-allocation-v1 | complete |
| IA delivery | ia_delivery | distant-decision-ia-delivery-v1 | complete |
| Arrangement | arrangement | distant-decision-section-balance-v2 | complete |

## Bound deliverables

- song: `/home/pentester/coding/codex_ida/vocaloid/artifacts/songs/tooi-hi-aoi-yoru-ia-20260719-a-r50-final.wav` — artifact `delivery-r51`, SHA-256 `314314fbfd80256702c0889c152fb7366dcdaca650204c1a7f1c239e6b371f67`, 22941494 bytes
- vsqx: `/home/pentester/coding/codex_ida/vocaloid/artifacts/vsqxs/tooi-hi-aoi-yoru-ia-20260719-a-r50-final.vsqx` — artifact `vsqx-r28`, SHA-256 `ae80710813a0c0cdc2f1e172c027d79375e1f0057edb27c082073712dc18270f`, 154916 bytes

## Decision timeline

### 1. Hold loneliness and connection in the same distant view

- ID: `distant-decision-intent-v1`
- Phase / kind: `intent` / `selection`
- Author: codex-cold-start-distant-lights (agent)
- Recorded: 2026-07-19T04:24:39.761Z
- Outcome: `implemented`
- Currentness: `current`
- Bound revision: 44

**Objective**

Translate the user's summer-night ridge image into a falsifiable creative direction before choosing notes.

**Decision**

IA turns away from festival fireworks and addresses the town's ordinary lights; distance remains lonely, but it also reveals a possible route back.

**Rationale**

The town can offer connection without answering or curing the narrator, preserving the requested emptiness, distance, transparency, and non-pure-sadness.

**Expected audible effect**

Cool open space, a visible ache, and a final sense of motion rather than collapse.

**Alternatives considered**

- **rejected:** Make the fireworks the emotional climax — It would pull the song back toward the festival rather than the distant town and private ridge.

**Evidence / observations**

- Ten section intents and two anchor phrase directions are current.
- Constraint: Intent was authored before score and before reading the optional summer palette.

**Actual result**

The canonical song/section/anchor intent preserves two questions: loneliness becoming space, and return becoming possible without erasure.

Affected objects: `chorus-1`, `final-chorus`, `direction-loneliness-into-space`, `direction-return-with-solitude`

### 2. Use a 56-bar view-turn-return form

- ID: `distant-decision-form-v1`
- Phase / kind: `form` / `selection`
- Author: codex-cold-start-distant-lights (agent)
- Recorded: 2026-07-19T04:24:39.813Z
- Outcome: `implemented`
- Currentness: `current`
- Bound revision: 44

**Objective**

Give the scene a complete narrative movement without overstating resolution.

**Decision**

Intro → verse/pre → chorus → field interlude → altered verse/pre → final chorus → eight lyric-free release bars.

**Rationale**

The middle interlude restores literal distance; the long post-vocal release lets the final road image become motion instead of a repeated slogan.

**Expected audible effect**

A complete two-minute song with clear expansion and a dissolving afterimage.

**Alternatives considered**

- **rejected:** Repeat the final chorus once more — Another lyric cycle would turn the quiet decision to descend into an anthem.

**Evidence / observations**

- Vocal writing ends at bar 48; the song continues to bar 56.
- Constraint: No section is filler; each changes viewpoint, density, or action.

**Actual result**

Current manifest has 10 contiguous semantic sections and full form coverage.

Affected objects: `intro`, `verse-1`, `pre-1`, `chorus-1`, `interlude`, `verse-2`, `pre-2`, `final-chorus`, `instrumental-release`, `outro`

### 3. Keep compound 6/8 while breathing between 68 and 92 BPM

- ID: `distant-decision-meter-tempo-v1`
- Phase / kind: `meter_tempo` / `selection`
- Author: codex-cold-start-distant-lights (agent)
- Recorded: 2026-07-19T04:24:39.876Z
- Outcome: `implemented`
- Currentness: `current`
- Bound revision: 44

**Objective**

Create floating distance without losing a walkable pulse back toward town.

**Decision**

Use 6/8 throughout; verses sit near 82, choruses reach 90/92, and interlude/outro fall to 72/68 at exact section boundaries.

**Rationale**

Compound grouping supports wind-like flow and two-bar Japanese sentences; bounded tempo changes create perspective without a meter gimmick.

**Expected audible effect**

The song floats but still has two large steps per bar and a readable return arc.

**Alternatives considered**

- **rejected:** Switch choruses to 4/4 — A meter switch made the chorus feel like a separate pop declaration rather than the same night opening wider.

**Evidence / observations**

- Every lead line spans exactly two 6/8 measures including an internal and terminal breath.
- Constraint: All phrase and arrangement patterns remain compatible with compound meter.
- Theory issues: `RHYTHMIC_LAYER_COLLISION`

**Actual result**

One 6/8 meter and ten section-boundary tempo events are encoded in the manifest and VSQX.

Affected objects: `intro`, `verse-1`, `pre-1`, `chorus-1`, `interlude`, `verse-2`, `pre-2`, `final-chorus`, `instrumental-release`, `outro`

Artifacts: `vsqx-r28`

### 4. Balance A-major light with unresolved add9/maj7 distance

- ID: `distant-decision-harmony-v1`
- Phase / kind: `harmony` / `selection`
- Author: codex-cold-start-distant-lights (agent)
- Recorded: 2026-07-19T04:24:39.928Z
- Outcome: `implemented`
- Currentness: `current`
- Bound revision: 44

**Objective**

Avoid the one-to-one equation of loneliness with minor while retaining harmonic ache and transparency.

**Decision**

Use A major with add9/maj7, slash-bass descents, suspended E, an F#-minor interior, and one B/A→G#m7→C#sus4 color turn before the second verse resolves back through F#m.

**Rationale**

Major provides town light; sevenths, ninths, inversions, and withheld suspensions prevent cheerfulness or hard closure.

**Expected audible effect**

Luminous stability with a gentle downward bass horizon and no triumphant cadence.

**Alternatives considered**

- **rejected:** Write the whole song in F# natural minor — It made sadness the default meaning instead of letting loneliness coexist with warmth.

**Evidence / observations**

- The final harmony is Aadd9, not a plain root-position triad.
- Constraint: No corpus-derived chord continuation and no single four-chord loop is the whole form.
- Theory issues: `LEADING_TONE_UNRESOLVED`

**Actual result**

All 56 measures have exact chord coverage; pad, electric piano, guitar, and bass derive from explicit voicing/bass decisions.

Affected objects: `distant-key-a-major`, `distant-chord-m00`, `distant-chord-m01`, `distant-chord-m02`, `distant-chord-m03`, `distant-chord-m04`, `distant-chord-m05`, `distant-chord-m06`, `distant-chord-m07`, `distant-chord-m08`, `distant-chord-m09`, `distant-chord-m10`, `distant-chord-m11`, `distant-chord-m12`, `distant-chord-m13`, `distant-chord-m14`, `distant-chord-m15`, `distant-chord-m16`, `distant-chord-m17`, `distant-chord-m18`, `distant-chord-m19`, `distant-chord-m20`, `distant-chord-m21`, `distant-chord-m22`, `distant-chord-m23`, `distant-chord-m24`, `distant-chord-m25`, `distant-chord-m26`, `distant-chord-m27`, `distant-chord-m28`, `distant-chord-m29`, `distant-chord-m30`, `distant-chord-m31`, `distant-chord-m32`, `distant-chord-m33`, `distant-chord-m34`, `distant-chord-m35`, `distant-chord-m36`, `distant-chord-m37`, `distant-chord-m38`, `distant-chord-m39`, `distant-chord-m40`, `distant-chord-m41`, `distant-chord-m42`, `distant-chord-m43`, `distant-chord-m44`, `distant-chord-m45`, `distant-chord-m46`, `distant-chord-m47`, `distant-chord-m48`, `distant-chord-m49`, `distant-chord-m50`, `distant-chord-m51`, `distant-chord-m52`, `distant-chord-m53`, `distant-chord-m54`, `distant-chord-m55`

### 5. Reserve the E5 ceiling and one recovered leap for the decision to return

- ID: `distant-decision-melody-v1`
- Phase / kind: `melody` / `selection`
- Author: codex-cold-start-distant-lights (agent)
- Recorded: 2026-07-19T04:24:39.978Z
- Outcome: `implemented`
- Currentness: `current`
- Bound revision: 44

**Objective**

Give the 20 lyric lines independent contour while keeping IA_ROCKS clear and unforced.

**Decision**

Keep verses near A3–G#4, open chorus 1 to C#5, touch E5 once on やさしく照らした, and use one fifth into 青 followed by immediate stepwise descent.

**Rationale**

Register hierarchy and recovery make the final chorus structurally meaningful; most motion remains stepwise for diction and transparency.

**Expected audible effect**

A restrained verse voice, a wider first realization, then one earned final opening that relaxes rather than wins.

**Alternatives considered**

- **rejected:** Peak on the word さみしさ — It would center pain rather than the later ability to set it down.

**Evidence / observations**

- The final leap is bound to the final anchor and followed by contrary stepwise recovery.
- Constraint: No retrieved or copied melody/motif was used.

**Actual result**

The lead contains 306 original voiced mora events across 20 phrases in A3–E5.

Affected objects: `distant-v1-line-1`, `distant-v1-line-2`, `distant-v1-line-3`, `distant-v1-line-4`, `distant-pre1-line-1`, `distant-pre1-line-2`, `distant-chorus1-line-1`, `distant-chorus1-line-2`, `distant-chorus1-line-3`, `distant-chorus1-line-4`, `distant-v2-line-1`, `distant-v2-line-2`, `distant-v2-line-3`, `distant-v2-line-4`, `distant-pre2-line-1`, `distant-pre2-line-2`, `distant-final-line-1`, `distant-final-line-2`, `distant-final-line-3`, `distant-final-line-4`

Artifacts: `vsqx-r28`

### 6. Make every Japanese mora explicit and spend time on semantic actions

- ID: `distant-decision-note-allocation-v1`
- Phase / kind: `note_allocation` / `selection`
- Author: codex-cold-start-distant-lights (agent)
- Recorded: 2026-07-19T04:24:40.023Z
- Outcome: `implemented`
- Currentness: `current`
- Bound revision: 44

**Objective**

Preserve original surface lyrics, explicit readings, V3 phonemes, breath windows, and focus duration as separate evidence.

**Decision**

Align one voiced cell per mora, use 120-tick minimum values, insert an internal 120-tick breath at the written image boundary, and keep 240 ticks after every two-bar line; allocate remaining duration to each line's semantic focus.

**Rationale**

The allocation favors intelligibility and meaning without forcing decorative melisma or inventing phonemes.

**Expected audible effect**

Japanese phrasing remains articulated while focus words occupy visibly and audibly more time.

**Alternatives considered**

- **rejected:** Use uniform eighth-note syllables — Uniform allocation flattened the difference between images and actions such as 置いてゆける and 青くほどける.

**Evidence / observations**

- Every phrase ends with a rest and every displayed lyric remains separate from normalized kana/phonemes.
- Constraint: All kanji readings were supplied explicitly; no standalone sokuon token was invented.

**Actual result**

306 lead and 29 harmony mora events retain explicit linguistic provenance; no small-っ fallback or hidden kanji reading is present.

Affected objects: `distant-v1-line-1`, `distant-v1-line-2`, `distant-v1-line-3`, `distant-v1-line-4`, `distant-pre1-line-1`, `distant-pre1-line-2`, `distant-chorus1-line-1`, `distant-chorus1-line-2`, `distant-chorus1-line-3`, `distant-chorus1-line-4`, `distant-v2-line-1`, `distant-v2-line-2`, `distant-v2-line-3`, `distant-v2-line-4`, `distant-pre2-line-1`, `distant-pre2-line-2`, `distant-final-line-1`, `distant-final-line-2`, `distant-final-line-3`, `distant-final-line-4`, `distant-harmony-chorus-return`, `distant-harmony-chorus-release`, `distant-harmony-final-outline`, `distant-harmony-final-road`

Artifacts: `vsqx-r28`

### 7. Materialize sectional opening with selective pitch and vibrato gestures

- ID: `distant-decision-ia-delivery-v1`
- Phase / kind: `ia_delivery` / `selection`
- Author: codex-cold-start-distant-lights (agent)
- Recorded: 2026-07-19T04:24:40.080Z
- Outcome: `implemented`
- Currentness: `current`
- Bound revision: 44

**Objective**

Make IA delivery serve the lyric while proving native VSQX materialization and actual Editor synthesis separately.

**Decision**

Use six sectional DYN arcs, chorus-only opening/BRI arcs, verse BRE color, two slight vibratos, and three shallow pitch gestures; the final blue-road focus receives articulation and then decreases.

**Rationale**

Sparse gestures preserve diction and make the two semantic releases distinct; continuous vibrato or scoops would make the entire performance equally marked.

**Expected audible effect**

IA opens at chorus destinations, retains cool air in verses, and loosens the final mora without theatrical pitch bending.

**Alternatives considered**

- **rejected:** Apply a single full-song expressive preset — It would hide phrase intent and repeat the declaration-without-materialization failure the framework now guards against.

**Evidence / observations**

- Compiler provenance, native XML controls, and original-Editor stem digests are all current; human listening is not self-signed.
- Constraint: Declared, materialized, rendered, and heard are four separate evidence levels.
- Theory issues: `VIBRATO_NOTE_TOO_SHORT`

**Actual result**

Manifest materialization matches every declared gesture; native VSQX has 44 mCtrl, 21 DYN, 3 BRE, 9 BRI, 8 PIT, 3 PBS, and 2 nonzero vibrato notes. Original Editor produced current non-silent lead/harmony stems.

Affected objects: `distant-lights-lead-part`, `distant-lights-harmony-part`, `distant-final-dyn`, `distant-final-opening`, `distant-final-brightness`, `distant-blue-up-into`, `distant-final-fall-away`

Artifacts: `vsqx-r28`, `vocal-stem-distant-lights-lead-r30`, `vocal-stem-distant-lights-harmony-r31`

### 8. Answer only the four clauses that admit return or release

- ID: `distant-decision-harmony-vocals-v1`
- Phase / kind: `harmony_vocals` / `selection`
- Author: codex-cold-start-distant-lights (agent)
- Recorded: 2026-07-19T04:24:40.140Z
- Outcome: `implemented`
- Currentness: `superseded` — MIX_HASH_CHANGED
- Bound revision: 44

**Objective**

Use harmony as a second perspective without making private observation sound collective or certain.

**Decision**

Place lower diatonic harmony only on 帰れる気がした, 置いてゆける, やさしく照らした, and 青くほどける; keep it right of center and substantially below the lead.

**Rationale**

Selective entry makes possibility audible while the rest of the song remains one solitary voice.

**Expected audible effect**

A distant second presence appears only when the narrator can imagine an action, then disappears before the afterimage.

**Alternatives considered**

- **rejected:** Double both choruses throughout — It removed space and made the chorus sound more certain than the lyric.

**Evidence / observations**

- No harmony phrase exists in verses, pre-choruses, intro, or outro.
- Constraint: Harmony may strengthen only explicit semantic actions.
- Theory issues: `VOCAL_HARMONY_MINOR_SECOND`, `VOICE_CROSSING`

**Actual result**

4 selective harmony phrases and 29 notes are present, materialized, unmuted, and rendered as an isolated current stem.

Affected objects: `distant-lights-harmony`, `distant-lights-harmony-part`, `distant-harmony-chorus-return`, `distant-harmony-chorus-release`, `distant-harmony-final-outline`, `distant-harmony-final-road`

Artifacts: `vocal-stem-distant-lights-harmony-r31`

### 9. Build a transparent six-role night field around the vocal

- ID: `distant-decision-arrangement-v1`
- Phase / kind: `arrangement` / `selection`
- Author: codex-cold-start-distant-lights (agent)
- Recorded: 2026-07-19T04:24:40.213Z
- Outcome: `implemented`
- Currentness: `superseded` — MIX_HASH_CHANGED
- Bound revision: 44

**Objective**

Create distance, town light, pulse, and a return path while protecting IA's center and consonants.

**Decision**

Use warm pad (field), electric piano (harmonic landmarks), clean guitar (delayed reflections), fretless bass (route), celesta (remote afterimage), and a soft 6/8 kit (footsteps/air).

**Rationale**

Each layer has a distinct role, register, pan, and entry pattern; no continuous countermelody competes with the lyric.

**Expected audible effect**

Wide but centered space: slow harmonic air, small points of light, and enough low pulse to make descent possible.

**Alternatives considered**

- **rejected:** Add strings and a high counter-melody in the final chorus — The added density obscured the road image and exceeded what the draft GM renderer could represent credibly.

**Evidence / observations**

- Minimal and full layers share the same composition/question and have loudness-matched 25-second A/B artifacts.
- Constraint: FluidSynth/GM names are draft arrangement roles, not claims of authentic acoustic performance.
- Theory issues: `REGISTER_DENSITY_COLLISION`, `RHYTHMIC_LAYER_COLLISION`

**Actual result**

Six current dry stereo instrument stems were rendered, and separate minimal/full arrangement anchor previews plus a loudness-matched A/B were saved for listening.

Affected objects: `distant-warm-pad`, `distant-electric-piano`, `distant-clean-guitar`, `distant-fretless-bass`, `distant-celesta`, `distant-soft-kit`

Artifacts: `instrument-stem-distant-warm-pad-r29`, `instrument-stem-distant-electric-piano-r29`, `instrument-stem-distant-clean-guitar-r29`, `instrument-stem-distant-fretless-bass-r29`, `instrument-stem-distant-celesta-r29`, `instrument-stem-distant-soft-kit-r29`, `stem-mix-r35`, `stem-mix-r36`

### 10. Deliver a current, non-silent, hash-linked stereo master without self-approving the listening question

- ID: `distant-decision-mix-delivery-v1`
- Phase / kind: `delivery` / `evaluation`
- Author: codex-cold-start-distant-lights (agent)
- Recorded: 2026-07-19T04:25:06.517Z
- Outcome: `delivered`
- Currentness: `superseded` — MIX_HASH_CHANGED
- Bound revision: 44

**Objective**

Bind canonical score, Editor vocals, instrument stems, deterministic mix, final master, QC, and creative record into one reproducible handoff.

**Decision**

Mix all current isolated stems with explicit track/bus effects and section automation, master to -17 LUFS/-1.5 dBTP targets, independently analyze, and publish the byte-identical current VSQX beside the WAV.

**Rationale**

Objective validation can prove structure, tuning materialization, audibility, clipping safety, and provenance; it cannot decide whether the intended loneliness/return transition succeeds to a listener.

**Expected audible effect**

A playable two-minute IA song with transparent dynamics and no clipped samples.

**Alternatives considered**

- **rejected:** Mark the anchor keep from symbolic/audio metrics — The repository explicitly forbids an analyzer or agent from manufacturing human listening acceptance.

**Evidence / observations**

- Final preflight has zero errors, current delivery dependencies, and matching final WAV/VSQX digests.
- Constraint: Technical success is not a human keep decision.
- Theory issues: `LEADING_TONE_UNRESOLVED`, `MOTIF_REPETITION_HIGH`, `PARALLEL_PERFECT_INTERVAL`, `REGISTER_DENSITY_COLLISION`, `RHYTHMIC_LAYER_COLLISION`, `VIBRATO_NOTE_TOO_SHORT`, `VOCAL_HARMONY_MINOR_SECOND`, `VOICE_CROSSING`

**Actual result**

Final: 130.053 s, -16.8 LUFS, -1.50 dBTP, stereo, 0 clipped sample values. Human intent-fidelity listening remains pending.

Affected objects: `final-chorus`, `direction-return-with-solitude`

Artifacts: `delivery-r43`, `vsqx-r28`, `stem-mix-r36`

### 11. Raise the lyric-free night field without flattening distance

- ID: `distant-decision-section-balance-v2`
- Phase / kind: `arrangement` / `adjustment`
- Author: codex-cold-start-distant-lights (agent)
- Recorded: 2026-07-19T04:30:41.813Z
- Outcome: `implemented`
- Currentness: `current`
- Bound revision: 52

**Objective**

Correct instrumental sections that measured close to inaudible while retaining a large, intentional contrast from the choruses.

**Decision**

Use explicit mix-bus section dynamics of +14 dB intro, +10 dB interlude, +10 dB instrumental release, and +14 dB outro; leave vocal-section balances and all source stems unchanged.

**Rationale**

The first master measured intro/outro around -46/-51 LUFS and interludes around -37 LUFS, so the intended empty field risked disappearing on normal playback. Section-bound automation preserves structure and provenance better than hidden normalization.

**Expected audible effect**

Wind, pad, bell, and the road afterimage remain clearly quieter than vocals but are audible as intentional space rather than silence.

**Alternatives considered**

- **rejected:** Compress the entire master more aggressively — Global compression would reduce vocal phrasing and chorus openness to solve a problem confined to four lyric-free sections.

**Evidence / observations**

- Only semantic section gains changed; composition hash and all raw stem digests remained current.
- Constraint: Do not use hidden normalization; keep the user's requested emptiness and distance.

**Actual result**

The adjusted current full mix was rebuilt from unchanged stems and mastered independently; final LRA is 15.1 LU with no clipped samples.

Affected objects: `distant-intro-bus-presence`, `distant-interlude-bus-breath`, `distant-release-bus-presence`, `distant-outro-bus-presence`

Artifacts: `stem-mix-r50`, `stem-mix-r49`

### 12. Publish the section-balanced immutable delivery pair

- ID: `distant-decision-mix-delivery-v2`
- Phase / kind: `delivery` / `adjustment`
- Author: codex-cold-start-distant-lights (agent)
- Recorded: 2026-07-19T04:30:41.910Z
- Outcome: `delivered`
- Currentness: `current`
- Bound revision: 52

**Objective**

Replace the first technically valid but over-contrasted delivery in the current creative record without overwriting its bytes.

**Decision**

Create a new revision-bearing final WAV and matching-basename VSQX publication, rerun current-artifact preflight and independent audio QC, and make the creative package point only to the new current pair.

**Rationale**

Immutable paths preserve the first render for comparison while the package and hashes unambiguously identify the improved current delivery.

**Expected audible effect**

The complete song remains transparent and dynamic, with lyric-free passages now present on ordinary playback.

**Alternatives considered**

- **rejected:** Overwrite the first final WAV in place — Repository delivery policy forbids silent replacement of a same-name artifact with different bytes.

**Evidence / observations**

- The current creative-record index binds the new delivery and byte-identical score project by SHA-256.
- Constraint: Technical evidence still does not constitute a human keep decision.
- Theory issues: `LEADING_TONE_UNRESOLVED`, `MOTIF_REPETITION_HIGH`, `PARALLEL_PERFECT_INTERVAL`, `REGISTER_DENSITY_COLLISION`, `RHYTHMIC_LAYER_COLLISION`, `STALE_DELIVERY_ARTIFACT`, `STALE_MIX_ARTIFACT`, `VIBRATO_NOTE_TOO_SHORT`, `VOCAL_HARMONY_MINOR_SECOND`, `VOICE_CROSSING`

**Actual result**

Current final: 130.053 s, -17.2 LUFS, 15.1 LU LRA, -1.50 dBTP, 0 clipped values. Human listening remains pending.

Affected objects: `final-chorus`, `direction-return-with-solitude`, `distant-intro-bus-presence`, `distant-release-bus-presence`

Artifacts: `delivery-r51`, `vsqx-r28`, `stem-mix-r50`

### 13. Keep the four selective harmony answers independent of section-bus balance

- ID: `distant-decision-harmony-vocals-v2`
- Phase / kind: `harmony_vocals` / `adjustment`
- Author: codex-cold-start-distant-lights (agent)
- Recorded: 2026-07-19T04:34:31.243Z
- Outcome: `implemented`
- Currentness: `current`
- Bound revision: 52

**Objective**

Make the journal currentness model reflect that the later lyric-free section gain change did not alter vocal harmony composition, tuning, or rendering.

**Decision**

Retain the same lower harmony only on 帰れる気がした, 置いてゆける, やさしく照らした, and 青くほどける; bind this decision to the unchanged composition and current isolated harmony stem, not to unrelated mix-bus gain.

**Rationale**

The first harmony record depended on the whole mix hash and became stale when only intro/interlude/release/outro bus levels changed. The musical decision and its rendered evidence remain byte-identical.

**Expected audible effect**

The distant second voice still appears only where the lyric imagines release or return, with no new doubling elsewhere.

**Alternatives considered**

- **rejected:** Re-record the unchanged harmony decision against the new mix hash — That would preserve an accidental coupling and make every unrelated balance revision invalidate a composition-level choice.

**Evidence / observations**

- Harmony event fingerprints and the isolated Editor stem digest did not change across the section-balance revision.
- Constraint: Unrelated mix automation must not invalidate a composition-level vocal-harmony choice.
- Theory issues: `VOCAL_HARMONY_MINOR_SECOND`, `VOICE_CROSSING`

**Actual result**

4 selective phrases and 29 harmony notes remain materialized and the current isolated Editor stem retains SHA-256 629ba23ad3b6b0b206fa294ce8dd693325b03d651f9c00d7bbb55cc9e80ba36e.

Affected objects: `distant-lights-harmony`, `distant-lights-harmony-part`, `distant-harmony-chorus-return`, `distant-harmony-chorus-release`, `distant-harmony-final-outline`, `distant-harmony-final-road`

Artifacts: `vocal-stem-distant-lights-harmony-r31`

## Review status

Human listening is still pending. Technical evidence and agent rationale do not self-approve the creative result.
