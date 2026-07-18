# Three-style IA_ROCKS production closure

Date: 2026-07-18

Paired final VSQX publication added: 2026-07-19

This checkpoint tests the public production MCP as an agent-facing composition
surface, not merely the underlying TypeScript modules. The reusable runner uses
local deterministic helpers only to plan rhythm slots and accompaniment notes;
all canonical writes, dry-runs, preflight, VSQX/backing builds, original Editor
exports, stem mixing, mastering, review notes, artifact hashes, and final WAV
analysis go through the 20-tool `production` MCP profile.

## Reproduce or resume

Build TypeScript first. The source lyric file for the wa-rock evaluation must
remain at `artifacts/evals/[Lyrics] Hanairo Biyori.txt`; it is deliberately
untracked.

```bash
npm run build
npm run eval:styles -- --song=wa --through=delivery --resume
npm run eval:styles -- --song=rock --through=delivery --resume
npm run eval:styles -- --song=summer --through=delivery --resume
```

`--song=all` is also supported, as are the bounded stop points `compose`,
`build`, `mix`, and `delivery`. Resume inspects current composition/mix hashes
and immutable artifacts before deciding what work remains. Vocal tracks are
exported as independent canonical transactions, with a short VOCALOID3 quiet
period between them. A failed harmony export therefore cannot delete or repeat
an already committed lead stem on the next resume.

## Delivered evidence

| Song | Composition evidence | Arrangement | Final WAV evidence | Current VSQX evidence |
| --- | --- | --- | --- | --- |
| 花色日和 — Hanairo Biyori（和風ロック） | 146 measures; 820 vocal events; lead + 13 selected harmony destinations; 4/4 → 6/8 → 4/4; 9 tempo points | shamisen, koto, shakuhachi, taiko, guitar, bass, drums | 256.474 s; stereo 44.1 kHz/16-bit; -15.2 LUFS; 5.7 LU LRA; -1.10 dBTP; 0 clipped samples; -1.14 dB balance; SHA-256 `39723f64e976601e7c86390025fe7537164423e507041eede4beedb941d0c254` | source revision 16; 383,831 bytes; SHA-256 `81e9ad994d87d05658f520a95a56fceedecfcb2466dbed9e724bb0399e5bc153` |
| 火花の航路（疾走 J-Rock） | 78 measures; 433 vocal events; lead + 8 harmony phrases; one explicit 2/4 turnaround; 9 tempo points | double guitars, bass, piano, strings, drums | 126.564 s; stereo 44.1 kHz/16-bit; -14.0 LUFS; 4.8 LU LRA; -1.00 dBTP; 0 clipped samples; +1.16 dB balance; SHA-256 `53b96224b6d8791c320785f857bc5777f2a5208e214199739d808480d1c86626` | source revision 19; 204,646 bytes; SHA-256 `e3edbac8b4752b74c577c20aeb7c7e3d8b021166d218f74c41335d51d0f80c9d` |
| 夏の夜に浮かぶ声（Dream Pop） | 78 measures; 411 vocal events; lead + 7 harmony phrases; repeated 6/8 ↔ 4/4 changes; 8 tempo points | two pads, bells, clean guitar, fretless bass, soft kit | 198.001 s; stereo 44.1 kHz/16-bit; -17.2 LUFS; 9.6 LU LRA; -1.50 dBTP; 0 clipped samples; +0.26 dB balance; SHA-256 `5bb246d2eaf0262a2495a97e4690aa1ceced62a476f3234f06d794ba09a4daaf` | source revision 19; 193,720 bytes; SHA-256 `7d08bd7761b98dde8b887ed83a2ee59a9427eb61d19bd575fbb1164ef4e7466e` |

Clean listening copies (only QC-passed final WAVs; no backing/stems/mixes):

- `artifacts/songs/hanairo-biyori-wa-rock-ia-rocks-final.wav`
- `artifacts/songs/hibana-kouro-ia-rocks-j-rock-final.wav`
- `artifacts/songs/natsu-no-yoru-ia-rocks-dream-pop-final.wav`

Matching current-composition native projects:

- `artifacts/vsqxs/hanairo-biyori-wa-rock-ia-rocks-final.vsqx`
- `artifacts/vsqxs/hibana-kouro-ia-rocks-j-rock-final.vsqx`
- `artifacts/vsqxs/natsu-no-yoru-ia-rocks-dream-pop-final.vsqx`

After final independent QC, the runner copies the hash-identical canonical
delivery into `artifacts/songs/` and the hash-identical current VSQX artifact
into `artifacts/vsqxs/` under the same basename. It verifies both sources and
both pre-existing targets before creating either missing copy, reuses identical
files, and refuses to replace a same-name file with different bytes. The VSQX
contains the current vocal composition, native tuning, and backing reference;
the final WAV's later isolated-stem mix/master remains provenance in the
canonical manifest rather than being embedded back into VSQX. Large generated
audio under `artifacts/songs/` remains a local-only delivery and is ignored as
an entire directory. The compact native projects under `artifacts/vsqxs/` are
intentionally eligible for source control and repository publication.

All three current manifests pass score, build, render, mix, and delivery
readiness with zero errors. The summer song has zero warnings. Rock intentionally
retains 50 consonant-collision and 5 high-mora-density warnings in its designated
rapid lyric cells. Hanairo intentionally retains 112 collision and 8 density
warnings in eleven rapid lines; an `artifact_check=all` audit adds one warning
for the preserved obsolete `stem-mix-r26`. That stale historical mix is not a
current delivery dependency.

The supplied Hanairo file SHA-256 is
`dcee0aaae443d01a3bc0a32fb2cd3e2bff55d09acdcca0ad52d22bc499829949`.
The manifest separately preserves original lyric text, supplied romanization,
derived kana reading, normalized reading, locked phonemes, reading overrides,
and source provenance. It does not treat a generated kana/phoneme string as the
original lyric.

## Defects found by the closure and fixed

1. Canonical track/part comments could pass preflight and then exceed the native
   VSQX 256-character field. Preflight now reports
   `NATIVE_TRACK_COMMENT_TOO_LONG` or `NATIVE_PART_COMMENT_TOO_LONG` before
   build.
2. Inspect/preflight could treat an old mix or delivery as current after a mix
   intent change. Artifact summaries now expose dependencies, source revision,
   composition hash, SHA-256, metadata, `currentComposition`, and `currentMix`;
   delivery rejects a mix whose `source_mix_hash` is stale.
3. Successful master/delivery calls were returned to an MCP client as `-32602`
   because their strict typed output schemas omitted `sourceRevision` and
   `manifestContentHash`. The schemas now match the successful runtime result.
4. FFmpeg loudnorm can report a measured true peak slightly above its requested
   ceiling. Mastering now applies a recorded correction gain when independent
   analysis exceeds the target, re-analyzes, and fails if it still exceeds the
   bounded tolerance.
5. A long summer harmony export exited at `wait_for_wave`. Cleanup correctly
   released the host lock and recorded no false vocal artifact, but the previous
   all-tracks batch also removed the successful lead output. The reference
   workflow now makes each vocal track its own resumable transaction. The next
   run committed lead, then harmony, then completed mix and delivery without
   manual Editor intervention.

## Current agent surface, checked from the running server

- `production`: 20 high-level tools.
- `full`: 49 high- and low-level tools.
- `legacy-vsqx`: 16 low-level tools.
- All profiles: 9 resources, including five style palettes, capabilities,
  Hanairo provenance, and a from-zero example.
- IA_ROCKS component `BDREB7P2KTWKYDC5` is the only voice assumed by these
  evaluations. Availability is host-probed and cached; VVD discovery alone is
  not accepted as synthesis proof.

The production profile now covers from-zero canonical composition, Japanese
mora/G2P/melisma, tempo and meter arcs, lead/harmony, tuning gestures, groove,
typed mix intent, preflight, immutable build artifacts, original Editor vocal
stems, draft instrument stems, manifest-aware mix/master/delivery, independent
audio QC, section preview/A-B review, review notes, and monotonic
history/diff/restore.

## Remaining boundaries (verified, not inferred)

1. The style names prove compositional roles, not release-grade timbre. The
   current instrument audio uses FluidR3 GM. In particular, the shamisen, koto,
   shakuhachi, and taiko labels do not prove idiomatic sampled articulations.
   A licensed SF2, VST/DAW renderer, or recorded player remains the largest
   audible-quality upgrade.
2. Canonical VSQX import exists; canonical MIDI/SMF import does not. MIDI CC,
   sustain, aftertouch, keyswitch/articulation events, audio loops, and per-track
   renderer routing are also absent from the manifest model.
3. The mix engine has deterministic typed effects and section gain automation,
   but no masking/phase diagnostics, sidechain ducking, subgroup/send-bus graph,
   or effect-parameter automation.
4. Numeric score-versus-render analysis covers pitch, timing, energy, and
   vibrato. It cannot prove lyric intelligibility, emotion, acoustic instrument
   authenticity, or artistic quality. Human listening notes are still required.
5. The MCP provides style guardrails and bounded workflows; it deliberately
   does not replace the agent's choices of melody, lyrics, harmony, density,
   breath, or arrangement. A statistical multi-prompt agent benchmark remains
   useful for measuring first-pass success and context cost.
