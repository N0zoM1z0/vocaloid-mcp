# VOCALOID3 MCP capability audit

Date: 2026-07-18

Scope: current local repository at commit `758abd7`, the 37 tools actually
returned by `tools/list`, the current test suite, retained agent-created
artifacts, the installed VOCALOID3 Editor/IA_ROCKS closure, the local
`VOC3_Manual.pdf`, and the current official MCP specification/TypeScript SDK
guidance.

This is a capability and product audit, not a feature wish list inferred from
memory. Every priority below is tied to an observed code path, manual feature,
test boundary, or agent evaluation.

## Executive conclusion

The server already has a real **composition-to-audio** foundation, including
from-zero canonical manifests, native VSQX, tempo/meter changes, dense Japanese
lyrics and melisma, tuning gestures, multi-track arrangement, original Editor
rendering with IA_ROCKS, stems, reproducible mixing, audio analysis, and bounded
mastering. It is well past a MIDI generator.

It is not yet an unattended **production closure** for a long-running agent.
The four highest-value gaps are:

1. final Editor master and mastered delivery cannot be committed back to the
   canonical manifest through any public MCP tool;
2. a complete read-only preflight does not exist, so some structural problems
   fail only after accompaniment rendering/build has begun;
3. original Editor automation has no host-wide render lock, progress/cancel
   path, verified voice probe, or complete record of dialog-driven state
   changes;
4. the MCP surface costs too much agent context while returning weakly typed
   outputs: 37 tools currently serialize to 153,222 bytes, roughly 38.3k tokens.

Therefore the next milestone should be **truthful, atomic, observable closure**,
then **fast audition/revision**, and only then broader musical helpers and
higher-quality rendering.

## Evidence baseline

### Current working closure

The retained IA_ROCKS evaluation manifest is revision 10 and contains backing,
VSQX, master, and delivery roles. Independent re-analysis on this audit found:

| Artifact | Hash/size | Source composition | LUFS | LRA | True peak | Stereo balance |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Editor master | matches manifest | matches | -22.0 | 7.9 LU | -13.3 dBTP | 0.009 dB |
| mastered delivery | matches manifest | matches | -16.0 | 7.9 LU | -7.2 dBTP | 0.009 dB |

This proves the installed IA_ROCKS path can produce a valid native Editor WAV
and a checked delivery. It does not prove that every step is accessible through
the public MCP surface; that distinction exposes the first P0 gap below.

### Test boundary

`npm test` on this audit completed 34 tests: 32 passed and 2 were intentionally
skipped. The skipped cases are the original Editor stem integration unless
`VOCALOID_INTEGRATION_TEST=1`, and a manually exported fixture that is not
currently present.

The stdio MCP regression invokes 31 of the 37 tools. The public MCP path is not
called for:

- `vocaloid_inspect_project`
- `vocaloid_list_control_points`
- `vocaloid_add_notes`
- `vocaloid_add_control_points`
- `vocaloid_render_vocal_stems`
- `vocaloid_analyze_vocal_stem`

Some of these have direct module tests, but module coverage does not catch MCP
schema/serialization/registration errors.

### MCP surface measurement

An SDK client connected to the built stdio server and measured the actual
`tools/list` result:

| Measurement | Result |
| --- | ---: |
| tools | 37 |
| serialized tool catalog | 153,222 bytes |
| rough size at four characters/token | 38,298 tokens |
| description characters | 19,562 |
| input-schema characters | 114,719 |
| output-schema characters | 8,769 |
| top-level input properties without their own description | 116 |
| tools using generic/untyped `data` output | 37/37 |
| tools with annotations | 37/37 |

Some of the 116 properties are nested schemas whose children are documented,
so the number is not equivalent to 116 totally unexplained concepts. It still
shows that the schema presented to a model is large and unevenly described.

A fresh ephemeral Codex CLI session was then given only this MCP, forbidden to
use shell/filesystem/network/mutations, and asked to inspect one manifest and
decide whether public MCP could register a new master and delivery. It correctly
returned `mcp_only_provenance_closed=false`, but the one-inspection task used
34,774 tokens. That independently confirms both the provenance gap and the
catalog cost.

### Manual coverage

The local original manual at
`/mnt/d/Vocaloid/Vocaloid3FE/VOC3_Manual.pdf` documents:

- up to 16 vocal tracks (PDF pages 5 and 37);
- Pre-Send adjustment and its Event Verification path (PDF pages 49–50);
- singer selection per musical part (PDF page 90);
- phoneme editing and the User Word Dictionary (PDF pages 100–107);
- VEL, DYN, BRE, BRI, CLE, OPE, GEN, POR, PIT, and PBS expression controls
  (PDF pages 109–112);
- VST2 track inserts, send/return, master inserts, individual-track WAV export,
  WAV import, and SMF import of note on/off, velocity, and pitch bend
  (PDF pages 113–115).

The current server covers most native score/expression concepts, but not all of
those workflow capabilities at a high level.

## Capability matrix

| Domain | Current state | Evidence-backed limitation |
| --- | --- | --- |
| From-zero composition | strong | proven by independent four-bar and 96-measure Codex creations |
| Long-form structure | strong | sections, patterns, placements, 16 tracks, meter/tempo events |
| Rapid lyrics/melisma | strong for Japanese | explicit 1/16–1/64 cells, tuplets, mora mapping and native `-` continuation |
| Native vocal expression | strong but partial | all major curves except a high-level OPE/opening arc; only one voice per manifest track |
| Voice discovery | partial | VVD metadata lists IA and IA_ROCKS, but does not prove Editor registration/licensing |
| Original Editor render | works but operationally fragile | no global mutex, progress/cancel, runtime fingerprint gate, or complete dialog audit |
| Stems | strong but one option mismatch | vocal-stem workflow does not expose `allow_pre_send_adjustment` |
| Score-vs-render analysis | useful numeric evidence | F0/timing/vibrato analyzer does not identify phoneme identity or judge intelligibility/emotion |
| Arrangement | strong for draft production | FluidR3/GM notes lack CC, sustain, key-switch/articulation, audio loops, and per-track renderer choice |
| Mix/master | reproducible and measured | no masking/phase/spectral diagnostics, bus hierarchy, sidechain, or effect-parameter automation |
| Provenance | strong until final delivery | build/stems/mix record artifacts; raw Editor render and `master_wav` do not accept a manifest |
| Revision safety | strong optimistic writes | no public history/diff/restore or mutation dry-run |
| Interop | low-level inspect/edit only | no VSQX/VSQ/MIDI import into the canonical stable-ID manifest |
| Agent API | functional but heavy | 153 KB tool catalog and every output schema has generic `data` |
| Evaluation | promising, not statistical | two important agent creations, but no repeatable multi-prompt success benchmark |

## P0 — complete before claiming unattended production closure

### 1. Manifest-aware master and delivery workflows

Observed gap:

- `vocaloid_build_song_manifest`, instrument/vocal stem renderers,
  `vocaloid_analyze_vocal_stem`, and `vocaloid_render_stem_mix` record their
  artifacts.
- `vocaloid_render_wav` only accepts VSQX/WAV paths.
- `vocaloid_master_wav` only accepts input/output WAV paths.
- `recordSongManifestArtifacts()` exists internally, but no public tool calls it
  for master/delivery.
- The retained revision-10 master/delivery records therefore required an
  internal call outside the public MCP workflow.

Recommended API:

- `vocaloid_render_manifest_master`: takes manifest revision, a verified VSQX
  artifact ID, output path, timeout and explicit Pre-Send policy; server computes
  hash/quality and atomically records role `master`.
- `vocaloid_master_manifest_delivery`: takes manifest revision, a verified
  `master` or `mix` artifact ID, output path and quality policy; server performs
  mastering, independently verifies it, and atomically records role `delivery`.

Do not expose a permissive “trust this arbitrary artifact metadata” tool as the
main path. The server should compute hashes, validate dependency IDs, bind the
current composition hash, and reject stale sources itself.

Acceptance criteria:

- a fresh Codex MCP-only session creates master and delivery records without
  shell or direct file writes;
- `inspect_song_manifest` shows the complete dependency chain and verified
  hashes after each atomic revision;
- any render, quality, stale-revision, or manifest-commit failure leaves no
  claimed artifact and no partial final file;
- reusing a stale VSQX/mix artifact is rejected before Editor/FFmpeg work begins.

### 2. One comprehensive read-only song preflight

Observed gap:

`validateManifestSemantics()` validates many bounds and references, but not
vocal-part overlap on one track. A controlled audit inserted a second part at
the same start. The mutation was accepted and wrote revision 11 with two parts;
`buildSongManifest()` later failed with:

```text
tracks[0].parts[1] overlaps the previous part on its track
```

Similar combined direct-note/compiled-phrase overlaps and some arrangement
end-of-song conditions can surface later than the manifest mutation that
introduced them.

Recommended API:

- `vocaloid_preflight_song`, read-only, returning every issue in one result with
  stable issue codes, severity, object IDs, musical positions, and suggested
  repair scope.
- Separate pure score/manifest checks from optional host checks so basic lint
  never launches the Editor.

Checks should cover:

- part and note/phrase overlaps across every representation;
- part, pattern placement, chord, automation, and artifact bounds;
- dangling or nonexistent artifact dependencies and stale/hash-mismatched files;
- voice metadata versus verified Editor availability;
- lyric/phoneme lock/inventory state and rapid-phrase resolution warnings;
- song-end, mix-headroom, and requested delivery-policy readiness.

Acceptance criteria:

- the overlap fixture returns `PART_OVERLAP` before creating a WAV;
- one call returns all independent problems rather than failing at the first;
- zero mutation and zero Editor process on pure preflight;
- every build/render tool runs the same core preflight internally.

### 3. Make original Editor automation serialized, observable, and truthful

Observed gaps:

- no mutex/lock/semaphore exists around the single host Editor;
- a concurrent agent can race dialogs, output files, and global Pre-Send state;
- each vocal-stem render may run for 600 seconds and up to 16 tracks are rendered
  serially, but no MCP progress or cancellation is propagated;
- `vocaloid_render_wav` exposes `allow_pre_send_adjustment`, while
  `vocaloid_render_vocal_stems` hard-codes false;
- the native helper returns only process ID, bytes, elapsed time and forced
  termination. It does not report whether it actually accepted Event
  Verification, so “allowed” can be mistaken for “changed” in provenance;
- dialog titles, class/control IDs and command IDs are hard-coded for the tested
  English Editor, with no executable fingerprint gate.

Recommended changes:

- a host-wide render lease with owner/request ID, bounded timeout, typed `BUSY`
  result, and guaranteed release on every exit path;
- progress stages for queued, Editor launched, voice verified, export requested,
  dialog handled, synthesizing, file stable, audio verified, cleanup, committed;
- cancellation that terminates only the helper-owned process and removes only
  its temporary file;
- propagate explicit Pre-Send policy to both master and vocal-stem workflows;
- return `pre_send_dialog_seen`, `pre_send_adjusted`, dialog/action log,
  executable version/hash, and cleanup state;
- validate the Editor executable fingerprint/version against known profiles and
  fail diagnostically on an unknown build/localization.

Acceptance criteria:

- two concurrent render requests produce one render plus one typed busy/queued
  result, never two uncontrolled Editors;
- cancellation and timeout leave no Editor/helper/temp output;
- recorded metadata distinguishes “permission granted” from “dialog actually
  accepted”;
- the current IA_ROCKS short smoke passes through master and isolated-stem paths.

### 4. Verified voice availability and cached host readiness

Observed gap:

`vocaloid_list_voices` correctly labels VVD discovery as metadata-only. The
installed files expose IA and IA_ROCKS, but the user confirmed only IA_ROCKS is
registered; an independent agent selected IA and learned that only at render.

Recommended API:

- `vocaloid_probe_voice`: an explicit, bounded short render using a generated
  safe note, with no project mutation;
- cache the result by voice component ID plus Editor/helper fingerprint and
  expiry;
- include a configured preferred/verified voice in host readiness and preflight.

Acceptance criteria:

- current host reports IA_ROCKS verified and IA unavailable/unknown without
  silent singer substitution;
- a cached result can be read without opening the Editor;
- a changed Editor/helper/voice fingerprint invalidates the cache.

### 5. Typed outputs and a smaller default tool surface

Observed gap:

Every tool advertises the same `{ok, data: unknown, warnings}` output. The
official MCP tool specification supports concrete `outputSchema` and requires a
server to conform when one is declared. The current schema gives the model no
typed knowledge of revision, artifact, quality, page, or error result shapes.

Recommended design:

- define concrete success/error schemas per workflow;
- retain concise text for humans/backward compatibility, but make
  `structuredContent` authoritative;
- add descriptions to agent-choice fields, especially nested manifest inputs;
- make a default `manifest-production` profile with only high-level compose,
  inspect, preflight, render, review, mix and deliver tools;
- move low-level raw VSQX editing into an optional `legacy-vsqx` profile/server
  and keep `full` for diagnostics;
- expose large manifests, contours and analysis reports as MCP resources or
  `resource_link` outputs rather than embedding them in every result.

Acceptance criteria:

- no production tool returns untyped `data`;
- default `tools/list` is materially below the current 153 KB; an initial target
  is under 80 KB and at most 20 high-level tools;
- a repeatable Codex routing benchmark completes common inspect/revise/deliver
  tasks with fewer than half the current catalog/context cost and no loss in
  success rate;
- low-level functionality remains available explicitly rather than disappearing.

## P1 — highest creative and iteration leverage

### 6. Section previews, loudness-matched A/B, and review notes

Long-song iteration should not require a full Editor export for every decision.
Add semantic-section preview render with configurable handles/count-in, plus an
A/B comparator that loudness-matches two artifacts and reports time alignment,
spectral/level differences, and dependency provenance.

Numeric metrics cannot judge emotion, diction, timbre, or whether an
arrangement feels crowded. Add manifest review notes tied to section/time/object
IDs so a human can write “the second chorus consonants blur” and the next agent
can revise exactly that scope. This is safer and more useful than inventing one
opaque “vocal quality score.”

### 7. Public history, diff, restore, and mutation dry-run

The manifest stores revisions/hashes and writes backups, and the repository has
Git, but an MCP-only agent cannot list, diff, or restore canonical revisions.
Add:

- `vocaloid_list_manifest_history`
- `vocaloid_diff_manifest_revisions`
- `vocaloid_restore_manifest_revision` with expected current revision
- `dry_run=true` or separate preview for transform/remove/upsert operations

Diffs should be music-aware: changed sections, notes, lyrics, controls, routing,
mix decisions, artifacts and hashes, not only raw JSON lines.

### 8. Import existing material into the canonical model

The low-level tools inspect/edit VSQX, and the manual supports SMF import, but
there is no VSQX/VSQ/MIDI-to-manifest path. Add an importer that assigns stable
IDs, preserves unsupported native fields as explicit warnings/raw extensions,
and never pretends imported backing MIDI is a finished mix.

This unlocks covers, collaboration, recovery of old projects, and systematic
revision of the existing VSQX corpus without abandoning canonical provenance.

### 9. Musical guardrails that assist rather than replace the agent

Harmony/key events are currently stored but are not interpreted. Note
transposition does not update or validate them. Add deterministic helpers for:

- chord-symbol parsing and pitch classes;
- melody/chord-tone and non-chord-tone annotation;
- range/tessitura, leap, voice-leading and harmony-collision lint;
- optional diatonic transpose that explicitly updates selected key/chord data;
- deterministic harmony/voicing candidates, always returned as proposals or a
  dry-run diff.

The server should provide calculation and constraints; the agent remains the
composer.

### 10. Vocal performance and intelligibility lint

Build an IA_ROCKS profile from documented/empirical evidence and report:

- range and sustained tessitura;
- breath/phrase length and rest opportunities;
- morae-per-second and consonant collision risk;
- extreme jumps, legato gaps, portamento opportunities and vibrato suitability;
- phoneme-aware onset/release expectations where evidence permits.

The current score-vs-render analyzer should remain measurement-first. It
currently cannot identify phoneme identity, so it must not claim lyric
intelligibility without a new alignment/recognition layer and evaluation data.

### 11. Repeatable agent evaluation harness

One four-bar and one 96-measure creation prove possibility, not reliability.
Create two suites:

1. read-only routing/reasoning evaluations with stable answers;
2. creative mutation evaluations in isolated temporary workspaces, scored by
   validators and optional bounded IA_ROCKS smoke renders.

Track completion rate, invalid calls, retries, total tool/context tokens,
revisions, stale-write recovery, artifact hashes, render cleanup, and quality
gate results. Add every public tool to a stdio MCP regression, while keeping the
real Editor suite explicitly gated for the host.

## P2 — expression and sound-quality expansion

These are valuable after P0/P1 because none fixes a false-success or late-fail
boundary by itself.

### Vocal expression

- high-level OPE/opening arcs across stable events; per-note opening already
  exists, but the manual exposes OPE as its own control lane;
- singer selection per part, matching the manual, rather than requiring a new
  track for every singer change;
- project-local pronunciation lexicon and auditable reading candidates before
  automating the global Editor User Word Dictionary;
- additional language phoneme/G2P modules only when a verified voicebank for
  that language is actually in scope.

### Rhythm and arrangement

- seeded swing/groove/humanize transforms with previewable deltas;
- tempo-ramp expansion and accelerando/ritardando helpers;
- MIDI CC, sustain, pitch bend, aftertouch/articulation/key-switch events;
- audio sample/loop tracks and per-track SoundFont/renderer choice;
- instrument range/articulation profiles, especially for shamisen, koto,
  shakuhachi and taiko, without claiming GM presets are realistic performances.

### Mix and mastering

- vocal-versus-backing masking and intelligibility bands;
- phase correlation/mono compatibility, DC offset, spectral tilt, sibilance and
  transient diagnostics;
- subgroup buses, sidechain ducking and send buses;
- time-varying effect parameters for reverb throws, delay automation, filters
  and pan motion;
- mastering-readiness recommendations and revision comparisons, not a magical
  one-number auto-master.

### Strategic renderer expansion

A high-quality VST/DAW or better sample renderer is the biggest remaining
timbre ceiling. It should consume the same manifest/stem contract so creative
state does not depend on one renderer. This is a strategic project, not a reason
to weaken the current deterministic FluidSynth draft path.

### Reference-audio workflows

Optional cover/remake support can add tempo/beat estimation, vocal F0-to-note
candidates, lyric timing alignment and reference-section comparison. It is not
required for from-zero creation, so it should not precede the production
closure and revision loop.

## P3 — useful later

- FLAC/24-bit delivery packages, tags, cover-art and distribution metadata;
- generalized multi-language dictionaries without a registered target voice;
- remote/shared server deployment and auth, while the current product remains a
  single-user local Editor bridge.

## Features not worth prioritizing now

- More one-off “style preset” tools. Existing atomic music/tuning primitives are
  sufficient; presets would increase catalog cost and hide artistic decisions.
- An opaque server-side “write a whole song” function. Composition belongs to
  the agent; the MCP should expose deterministic domain operations, validation,
  rendering and evidence.
- Claiming loudnorm is mastering. It controls loudness/true peak but cannot
  restore clipped transients or guarantee the requested dynamics and timbre.
- Direct DSE/DLL synthesis reverse engineering as the production dependency.
  The original Editor export already closes synthesis safely; the more valuable
  engineering work is observability, serialization, review and renderer
  abstraction.
- A rushed MCP SDK v2 migration. On 2026-07-18 the official TypeScript SDK says
  v2 is beta and expects stable release with the 2026-07-28 specification;
  v1.x remains the supported production release until then. Current 1.29.0 is
  therefore appropriate while the server fixes product-level gaps.

## Recommended implementation order

1. `preflight_song` plus shared internal validation.
2. manifest-aware Editor master and mastered-delivery workflows.
3. Editor lease, progress/cancel, actual dialog-state metadata and fingerprint
   preflight; propagate Pre-Send policy to vocal stems.
4. verified/cached voice probe and host readiness.
5. concrete output schemas and a default high-level tool profile/resources.
6. full stdio coverage plus one bounded IA_ROCKS native smoke.
7. section preview, A/B comparison and human review notes.
8. manifest history/diff/restore and dry-run.
9. VSQX/MIDI import.
10. harmony and vocal-performance guardrails.
11. OPE, groove/CC/effect automation and masking analysis.
12. renderer-quality expansion behind the stable manifest/stem interface.

The completion gate for steps 1–6 should be a fresh Codex session that starts
from an empty manifest, uses only public Vocaloid MCP calls, passes preflight,
renders IA_ROCKS, records every artifact through delivery, verifies the final
WAV and provenance, and leaves no Editor/helper/temp process or file.

## Protocol references

- MCP 2025-06-18 tools and concrete output schemas:
  <https://modelcontextprotocol.io/specification/2025-06-18/server/tools>
- MCP progress for long-running operations:
  <https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/progress>
- MCP resources and resource templates:
  <https://modelcontextprotocol.io/specification/2025-06-18/server/resources>
- official TypeScript SDK status and production-version guidance:
  <https://github.com/modelcontextprotocol/typescript-sdk>
