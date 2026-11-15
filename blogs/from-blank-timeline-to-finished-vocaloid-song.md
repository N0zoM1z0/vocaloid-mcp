# From a Blank Timeline to a Finished VOCALOID Song

## Engineering an Agent-Native VOCALOID3 MCP for Composition, Tuning, Rendering, Mixing, Mastering, and Verified Delivery

- **Project checkpoint:** 2026-07-18; paired VSQX delivery update 2026-07-19
- **Implementation:** TypeScript, Model Context Protocol, native Win32 helpers, VOCALOID3 Editor, FluidSynth, FFmpeg
- **Primary verified voice:** IA_ROCKS
- **Implementation baseline described:** local commit `91545a0`, with the later paired-delivery convention documented below
- **Current verification:** 47 tests discovered, 45 passed, 2 intentionally skipped, 0 failed

---

## Abstract

This project began with a deceptively simple idea: expose VOCALOID through an MCP server so that a coding agent could help make a Vocaloid song.

The crucial word was **song**.

A successful system could not stop at generating a Standard MIDI File, emitting a few notes, converting an existing VSQX project, or making the editor pronounce isolated syllables. The intended user experience was much closer to this:

> Give an agent a creative brief, lyrics, or even an empty timeline. Let it design form, melody, harmony, rhythm, phonemes, vocal expression, accompaniment, tempo and meter changes, mix intent, and delivery targets. Then let the same agent produce a native VOCALOID project, render the licensed voice through the original editor, assemble stems, master the result, listen analytically, revise bounded sections, and deliver a verified stereo WAV with provenance.

That requirement transformed the work from “write some XML” into a small production system. It required reverse engineering enough of a legacy 32-bit Windows application to automate it safely; understanding Yamaha's VSQ3/VSQ4 data model; designing a canonical song representation suitable for long-running agent sessions; separating creative intent from derived artifacts; building deterministic accompaniment and audio-processing backends; and, perhaps most importantly, reducing the interaction cost until a fresh agent could use the system without repeatedly rediscovering its schema.

This article reconstructs the entire engineering path from the first native probe to the three complete IA_ROCKS delivery pairs now in `artifacts/songs/` and `artifacts/vsqxs/`. It includes the dead ends, crashes, false assumptions, interface redesigns, quality failures, and test evidence. It also draws a strict boundary between what the system has actually proven and what still requires better instruments, broader voice coverage, human listening, or future protocol work.

This is not a claim that software has solved musical taste. It is a report on building an auditable instrument through which an agent can exercise musical judgment.

---

## Contents

1. [The real problem: complete production, not MIDI generation](#1-the-real-problem-complete-production-not-midi-generation)
2. [Constraints and definition of done](#2-constraints-and-definition-of-done)
3. [The final system at a glance](#3-the-final-system-at-a-glance)
4. [Phase I: archaeology, schemas, and native reverse engineering](#4-phase-i-archaeology-schemas-and-native-reverse-engineering)
5. [Phase II: generating native VSQX from zero](#5-phase-ii-generating-native-vsqx-from-zero)
6. [Phase III: safely automating the original VOCALOID3 Editor](#6-phase-iii-safely-automating-the-original-vocaloid3-editor)
7. [Phase IV: moving from vocal snippets to structured songs](#7-phase-iv-moving-from-vocal-snippets-to-structured-songs)
8. [Phase V: long-form rhythm, fast lyrics, arrangement, and mastering](#8-phase-v-long-form-rhythm-fast-lyrics-arrangement-and-mastering)
9. [Phase VI: the canonical song manifest](#9-phase-vi-the-canonical-song-manifest)
10. [Phase VII: Japanese lyrics and inspectable tuning gestures](#10-phase-vii-japanese-lyrics-and-inspectable-tuning-gestures)
11. [Phase VIII: stems, score-versus-render analysis, and reproducible mixing](#11-phase-viii-stems-score-versus-render-analysis-and-reproducible-mixing)
12. [Phase IX: preflight, host readiness, history, and delivery](#12-phase-ix-preflight-host-readiness-history-and-delivery)
13. [Phase X: redesigning the MCP for agents](#13-phase-x-redesigning-the-mcp-for-agents)
14. [The complete production workflow](#14-the-complete-production-workflow)
15. [Independent agent evaluations](#15-independent-agent-evaluations)
16. [Three complete style closures](#16-three-complete-style-closures)
17. [Failure ledger: what broke and what each failure taught us](#17-failure-ledger-what-broke-and-what-each-failure-taught-us)
18. [Testing and evidence strategy](#18-testing-and-evidence-strategy)
19. [Chronological checkpoint history](#19-chronological-checkpoint-history)
20. [Repository map and reproducibility](#20-repository-map-and-reproducibility)
21. [Safety, provenance, and operational boundaries](#21-safety-provenance-and-operational-boundaries)
22. [What is proven, what is not, and what should come next](#22-what-is-proven-what-is-not-and-what-should-come-next)
23. [Engineering lessons that generalize beyond VOCALOID](#23-engineering-lessons-that-generalize-beyond-vocaloid)
24. [Appendix: production tools and resources](#24-appendix-production-tools-and-resources)

---

## 1. The real problem: complete production, not MIDI generation

Many “AI music” integrations choose MIDI as their boundary. That is understandable: MIDI notes are easy to create, validate, and route to an instrument. But a Vocaloid performance contains information that ordinary MIDI does not represent faithfully:

- lyrics and language-specific phonemes;
- singer identity and voicebank component binding;
- note-level velocity as consonant timing rather than conventional loudness;
- accent, decay, opening, bend depth, bend length, and portamento flags;
- vibrato type, onset, depth envelope, and rate envelope;
- time-varying DYN, BRE, BRI, CLE, GEN, POR, PIT, and PBS curves;
- musical-part boundaries, pre-measures, mixer settings, and singer events;
- native editor behavior, including licensed synthesis and project compatibility.

An agent that emits only MIDI can suggest a melody. It cannot claim to have created the actual vocal performance. Likewise, a system that generates VSQX but never opens it in the target editor has only proven that its XML parser is satisfied—not that VOCALOID accepts, renders, or preserves it.

We therefore adopted a much stronger definition:

> The MCP is complete only when an agent can begin without an input VSQX, preserve musical and production intent in an inspectable canonical model, compile native VOCALOID artifacts, render the selected licensed voice through the original editor, render accompaniment, produce and mix isolated stems, master to explicit targets, run independent delivery checks, and retain enough provenance to reproduce or revise the result.

This definition changed every architectural decision. VSQX became a derived format rather than the sole database. Audio analysis became part of the workflow rather than an afterthought. Tool design had to optimize not only capability coverage but also context cost, retry cost, and mutation safety. A long song had to survive dozens of calls without asking the agent to resend thousands of events every time.

### 1.1 “Agent-assisted” does not mean “agent-hidden”

The agent remains responsible for artistic choices:

- song form and section energy;
- melodic contour and tessitura;
- chord progression and harmonic tension;
- where fast syllabic writing is intentional;
- where a breath, rest, melisma, harmony entrance, or tempo change belongs;
- stereo placement and effect intent;
- whether a warning describes a defect or a deliberate style choice.

The MCP supplies affordances and guardrails. It does not silently compose a generic song behind a single `make_song` button, and it does not auto-correct every unusual passage into stylistic blandness. Its analyzers report observable risk; they do not substitute numeric thresholds for taste.

### 1.2 Why “from zero” mattered

At several points it would have been easy to start with a known-good VSQX, replace its notes, and describe the result as generation. We explicitly rejected that shortcut. The earliest independent Codex proof created an eight-measure project containing 41 original notes and 62 control points without reading or copying an existing song. Yamaha's native loader later enumerated 351 objects from that generated project.

Existing projects were used only as format or behavior oracles: examples against which to compare native structure, object trees, and editor behavior. They were never used as hidden musical templates for the final compositions.

---

## 2. Constraints and definition of done

The development environment imposed several constraints that are easy to miss when looking only at the finished tool list.

### 2.1 Legacy application boundary

VOCALOID3 Editor and its libraries are 32-bit Windows software. Most of the orchestration and MCP implementation runs in a modern Linux/WSL environment under Node.js. Native validation and rendering therefore cross an operating-system and architecture boundary:

```text
Codex / MCP client
        |
        | JSON-RPC over stdio
        v
Node.js TypeScript MCP server in WSL/Linux
        |
        | validated Windows paths + bounded subprocess protocol
        v
32-bit native Windows helpers
        |
        +--> Yamaha Vsq3.dll loader/probe
        |
        +--> original VOCALOID3 Editor UI and licensed synthesis
```

This is why the project contains both TypeScript modules and native C/PowerShell helpers. Trying to pretend that the editor was a normal HTTP service would have hidden the hardest reliability problems rather than solving them.

### 2.2 The original editor is the synthesis authority

The system may inspect installed VVD metadata, but a file on disk does not prove that a singer is registered, licensed, or usable by the current editor. Only an actual render proves availability. For the production workflow, the original VOCALOID3 Editor—not a reimplementation—is the authority for voice synthesis.

This also establishes a licensing boundary. The reverse-engineering work was used to understand file loading and legitimate installed behavior. It did not patch activation checks, bypass voice registration, redistribute voice data, or attempt to replace the licensed engine.

### 2.3 Local, single-user MCP transport

The current server uses MCP over `stdio`, which is appropriate for a local desktop bridge. It avoids exposing a legacy editor and filesystem paths over a network. A future remote service would need authentication, tenant isolation, secret management, and a substantially different threat model; none of that is implied by the current local design.

### 2.4 One verified production voice

The final style evaluations use the exact IA_ROCKS component ID:

```text
BDREB7P2KTWKYDC5
```

Another locally visible identifier, `BLRGDDR4M3WM2LC6`, belongs to IA rather than IA_ROCKS. Confusing those IDs once was enough to justify a single canonical constant and an active voice-readiness probe. The architecture supports other voices, but this checkpoint claims end-to-end production evidence only for IA_ROCKS.

### 2.5 A concrete completion matrix

The following table summarizes the standard eventually used to decide whether the project had a real closed loop.

| Layer | Required evidence |
| --- | --- |
| Composition | A new song can start from an empty manifest; no source VSQX is required. |
| Lyrics | Original text, kana reading, normalized reading, mora alignment, and locked phonemes remain distinguishable. |
| Vocal expression | High-level intent compiles into inspectable native note styles, vibrato data, and control curves. |
| Structure | Multiple sections, vocal tracks, parts, tempo changes, meter changes, and reusable arrangement patterns are supported. |
| Native compatibility | XSD validation and Yamaha's own Vsq3 loader both accept generated VSQX. |
| Voice synthesis | The original editor renders non-silent audio without singer substitution. |
| Accompaniment | Multi-instrument and drum arrangements render to verified stereo audio. |
| Iteration | Stable IDs and bounded edits allow section-scale changes without resending the whole song. |
| Stems | Vocal and instrument tracks can be rendered separately with explicit pan/dry decisions and artifact provenance. |
| Mix | Ordered effects and section dynamics are deterministic and stored as intent. |
| Master | Integrated loudness, LRA, true peak, clipping, and stereo balance are measured independently. |
| Delivery | A final WAV is accepted only when its dependency chain and hashes are current; the matching current-composition VSQX is published under the same basename. |
| Recovery | Failed renders do not produce false artifacts; successful prior work can be resumed. |
| Agent usability | The default tool catalog is compact, typed, documented, and supplemented by on-demand resources. |

---

## 3. The final system at a glance

The mature system has five conceptually separate planes.

```text
                         CREATIVE / CONTROL PLANE

             Agent brief, lyrics, revisions, listening notes
                                |
                                v
                 20-tool production MCP profile
             + resources, typed outputs, dry-run, preflight
                                |
                                v
                       canonical *.song.json
      timeline | form | harmony | vocals | arrangement | mix | review
                                |
               +----------------+----------------+
               |                                 |
               v                                 v
       NATIVE VOCAL PLANE                 INSTRUMENT PLANE
       VSQ3/VSQ4 compiler                 patterns/placements
       XSD + native loader                FluidSynth + SF2
       VOCALOID3 Editor                   per-track stems
       per-vocal-track stems                      |
               |                                 |
               +----------------+----------------+
                                v
                         AUDIO PRODUCTION PLANE
                   alignment -> effects -> automation
                   stem sum -> bus -> analysis -> master
                                |
                                v
                         EVIDENCE / DELIVERY PLANE
               hashes | dependencies | history | reviews | QC
                                |
                                v
        artifacts/songs/<song>-<style>-final.wav
        artifacts/vsqxs/<song>-<style>-final.vsqx
```

### 3.1 The implementation layers

| Layer | Representative modules | Responsibility |
| --- | --- | --- |
| MCP routing | `src/index.ts`, `src/agent-examples.ts`, `src/style-palettes.ts` | Tool profiles, descriptions, input/output schemas, resources, high-level routing. |
| Canonical state | `src/song-manifest.ts`, `src/manifest-history.ts`, `src/mutation-preview.ts` | Stable IDs, hashes, revisions, backups, dry-runs, artifact graph. |
| Musical compilation | `src/vsqx.ts`, `src/vocal-phrase.ts`, `src/japanese.ts`, `src/harmony.ts`, `src/tempo.ts` | VSQX structures, lyric alignment, phonemes, gestures, harmony and groove guardrails. |
| Rendering | `src/render.ts`, `src/voice-readiness.ts`, `src/accompaniment.ts`, `src/stems.ts` | Original-editor exports, voice probe, FluidSynth backing, isolated stems. |
| Audio production | `src/stem-mix.ts`, `src/audio-quality.ts`, `src/audio-review.ts`, `src/delivery.ts` | Effects, automation, analysis, previews, A/B, mastering, final provenance. |
| Native boundary | `native/vsq_probe.c`, `native/vocaloid_export.c`, PowerShell helpers | 32-bit loader inspection and bounded Win32 editor automation. |
| Verification | `tests/*.test.ts`, `notes/*.md`, `artifacts/evals/` | Unit, integration, protocol, agent-routing, and full-song evidence. |

### 3.2 Why the canonical manifest sits in the center

VSQX is excellent as an interchange format for the editor, but poor as the only source of truth for an agent production system. It does not naturally retain all arrangement renderer choices, mix effect chains, artifact hashes, review notes, dependency relationships, or mutation history. Rewriting one XML file also makes bounded concurrent editing difficult.

The `.song.json` manifest therefore stores creative and production intent. VSQX, backing tracks, stems, mixes, analyses, and mastered WAVs are derived artifacts. That distinction is the foundation for reproducibility and honest staleness detection.

---

## 4. Phase I: archaeology, schemas, and native reverse engineering

The first engineering question was not “how do we automate the UI?” It was “what is the narrowest legitimate native path that preserves all VOCALOID-specific performance data?”

### 4.1 Start with documents and schemas, not guesses

The local VOCALOID3 installation provided three complementary sources of truth:

1. the editor manual, especially phoneme and expression semantics;
2. the bundled VSQ3/VSQ4 XML schemas;
3. editor-produced projects and the native loader's behavior.

Each source catches a different class of error. The XML schema checks structural shape and bounds. The manual explains user-facing semantics such as Japanese phonemes and note properties. Native loading exposes compatibility requirements that a schema cannot express, including the precise representation of string fields and note-style defaults.

This three-source approach prevented the project from calcifying around assumptions inferred from a single sample.

### 4.2 Fingerprint every binary before trusting addresses

Read-only IDA investigation was tied to exact binary fingerprints. Addresses in a proprietary 32-bit DLL are not APIs and must never be assumed stable across builds.

| Binary | Architecture | SHA-256 |
| --- | --- | --- |
| `DSCL3.dll` | PE32 / Intel 80386 | `9bcdc8b8424849f18975af47ceaad984222239ddad57d1554e75b2478fb5f789` |
| `DSE3.dll` | PE32 / Intel 80386 | `f251e7105eee2c8ceb8e632bf22ff50655cb7b87b7e892b6116b3b17c6a4ee5f` |
| `Vsq3.dll` | PE32 / Intel 80386 | `236b4be5c09d17f77e5f9c9a7455817edba01664e760908635157eef2dce7256` |

The native helper resolves decorated exports dynamically. Reverse-engineered addresses remain documentation for the pinned build, not hard-coded universal entry points.

### 4.3 Recovering the native object tree

The first useful bridge was not a synthesizer. It was a validator.

`native/vsq_probe.c` loads a VSQX through Yamaha's own `Vsq3.dll`, initializes `CVSVsqManagerIF`, calls `fileLoadVsqFile`, and walks the resulting object hierarchy. The work required understanding several ABI details:

- `CVSVsqManagerIF` wraps an internal implementation object;
- initialization receives a policy containing scalar fields plus a Visual C++ 2008 `std::wstring`;
- concrete objects expose both a primary interface and a generic `IVSVsqObject` interface at an offset;
- a generic vtable method enumerates children through a VC9 pointer-vector layout;
- primary vtable identities distinguish roots, tracks, and musical parts.

The probe was validated against two very different projects:

- a real-world V4 corpus project: 20,402 objects, six vocal tracks, six musical parts;
- the early MCP smoke project: 83 objects, one track, one musical part.

This provided a far stronger compatibility signal than XML parsing alone.

### 4.4 Native validation corrected our own false assumptions

One early load failure was incorrectly attributed to the phoneme string `4 a`. That seemed plausible only if `4` were interpreted as a count or malformed token. The manual and bundled `KanaNote.lua` showed the opposite: `4` is the official Japanese flap/tap phoneme used for sounds such as ら.

The actual incompatibilities were elsewhere:

- phoneme elements needed raw symbols such as `a` or `k a`;
- every note needed the standard note-style attributes, including vibrato fields;
- string-bearing elements needed editor-compatible CDATA handling.

After correcting those details, a newly generated VSQ3 project containing `4 a`, note styles, vibrato sequences, and DYN points loaded successfully as 77 native objects. The numeric-phoneme rejection was deleted and a regression test was added.

This episode became an important project rule: **a validator must report observed facts, not reinforce our intuition about what ought to be valid.**

### 4.5 Exploring direct DSCL/DSE synthesis

IDA revealed a plausible native render path:

```text
VSQX
  -> CVSVsqManagerIF / IVSMusicalPart
  -> sequence time map
  -> CxDaisyMidiFile::EncodeMusicalPart
  -> CDaisyMidiBuffer
  -> CRtSynthesis::OpenSynthesizer
  -> DSE3 step synthesis
  -> CWaveFile
```

Important recovered contracts included:

- `OpenSynthesizer` expects API version `20008017.0`;
- DSE engine negotiation uses version token `20012012.0`;
- the engine renders in 256-sample frames;
- `EncodeMusicalPart` receives both the musical part and a sequence time map;
- the high-level wrapper retains phonemes, singer selection, pitch, dynamics, and vibrato instead of flattening the performance to ordinary MIDI.

For the exact fingerprinted DSCL3 build, the most useful recovered exports were:

| Native contract | Decorated export / address in pinned image | Observed role |
| --- | --- | --- |
| Synthesizer open | `?OpenSynthesizer@CRtSynthesis@@QAEHPB_WN@Z` / `0x1002f220` | Load the requested DSE DLL, verify API version, resolve engine exports, and perform an initial capability/voice-table probe. |
| DSE instance creation | `?CreateDSE@CRtSynthesis@@IAEHPAPAE@Z` / `0x1002eeb0` | Negotiate engine version, send voice table, create the engine, and apply static settings. |
| Public synthesis wrapper | `?DoSynthesis@CRtSynthesis@@QAEHPAVCDaisyMidiBuffer@@PAVCWaveFile@@KK_NPBD2MM@Z` / `0x1002f450` | Create one DSE instance, optionally wrap export begin/end, render, and destroy it. |
| Internal frame renderer | `?DoSynthesis@CRtSynthesis@@IAEHPAUHWND__@@HPAVCWaveFile@@PAVCDaisyMidiBuffer@@K@Z` / `0x1002a230` | Seek Daisy events, start DSE, call step synthesis in 256-sample frames, append mono PCM, and stop. |
| Musical-part encoder | `?EncodeMusicalPart@CxDaisyMidiFile@@QAEPAVCDaisyMidiBuffer@@PAUtagDaisyMidiV3EncodeStruct@@@Z` / `0x10014ee0` | Encode an `IVSMusicalPart` plus time map into an owned `CDaisyMidiBuffer`. |
| Daisy encoder constructor | `??0CxDaisyMidiFile@@QAE@XZ` / `0x10012a00` | Initialize an encoder whose default event interval is 2000, with an observed accepted range of 50..5000. |
| Synthesis wrapper constructor | `??0CRtSynthesis@@QAE@XZ` / `0x1002c370` | Initialize a native object touching at least 1,040 bytes in the observed build. |

`EncodeMusicalPart` allocated a `0x5c`-byte Daisy buffer and transferred ownership to the caller, which must use its native deleting destructor. These sizes, addresses, and MSVC ABI details are recorded as findings for one hash-pinned binary, not as a supported SDK. The production renderer does not call them.

The native probe reached all pre-synthesis stages: it loaded the VSQX, selected a musical part, created the time map, encoded Daisy events, loaded `DSCL3.dll`, loaded `DSE3.dll`, and resolved the expected exports.

The first actual synthesis stopped here:

```text
DSESetDBMPath result=-100
DoSynthesis failed
render_status=71
```

Further decompilation showed why. The first argument to `DSESetDBMPath` was not an ordinary voice-database directory; it was a registry-key format such as `SOFTWARE\VCLDASGN3\%s`. The engine inspected 32-bit registry state under `DATABASE\VOICE2` and `DATABASE\VOICE3`, including installation and activation-related values. A direct diagnostic still returned `VOICE3=-100`.

At that point the correct engineering decision was to stop treating direct DSE invocation as the production path. The project did not patch activation checks or try to emulate undocumented voice tables. The original editor already had the legitimate context needed to synthesize the installed voice. Automation moved upward to that supported application boundary.

### 4.6 Why the “dead end” was still valuable

The native investigation was not wasted. It produced:

- a Yamaha-loader compatibility test independent of our XML parser;
- accurate binary fingerprints and ABI boundaries;
- confirmation that native synthesis consumes VOCALOID-specific performance data;
- a clear understanding of where licensing and registration state enters;
- evidence for choosing editor automation without pretending it was merely expedient.

In systems work, a well-characterized abandoned path is often a deliverable. It prevents future maintainers from repeating the same unsafe experiment and explains why the chosen architecture exists.

---

## 5. Phase II: generating native VSQX from zero

Once the loader probe existed, the next task was to build a native project writer that did not depend on template extraction.

### 5.1 The timing model

The writer uses the VOCALOID resolution of 480 ticks per quarter note. High-level song positions are represented as zero-based musical coordinates:

```text
measure, beat, tick
```

These coordinates are converted through the tempo and meter map. Musical-part-local editing remains distinct from song-global placement, because conflating those coordinate spaces is an easy way to shift notes by a pre-measure or part offset.

The structured song writer supports:

- VSQ3 and VSQ4 output;
- up to 16 vocal tracks;
- multiple named musical parts per track;
- tempo changes;
- time-signature changes;
- mixer state;
- mono or stereo WAV audio parts;
- note styles, vibrato data, and all supported master curves.

### 5.2 Native note content

A note is not just pitch, onset, and duration. The writer can preserve:

- lyric text;
- locked phoneme string;
- velocity/consonant timing;
- accent and decay;
- opening;
- bend depth and length;
- rise and fall portamento flags;
- vibrato type and tail length;
- normalized vibrato depth/rate envelope points.

Time-varying performance curves support the native domains:

```text
DYN BRE BRI CLE GEN POR PIT PBS
```

PIT uses the native `-8192..8191` range, while PBS uses `0..24` semitones. The other master curves use `0..127`. These ranges are validated before an invalid project reaches the editor.

### 5.3 Validation is a stack, not a boolean

Every generated project passes multiple layers:

1. TypeScript and Zod reject malformed tool input.
2. Semantic validation checks ranges, ordering, overlaps, part boundaries, and references.
3. The file is written to a temporary sibling path.
4. `xmllint` validates it against the bundled `vsq3.xsd` or `vsq4.xsd`.
5. Selected fixtures are loaded by Yamaha's native `Vsq3.dll` probe.
6. Editor integration confirms real load and synthesis behavior.
7. Only a verified result is atomically moved into its final path.

No single layer is allowed to stand in for all the others.

### 5.4 The first from-zero agent proof

A local Codex CLI session was configured with only the Vocaloid MCP and instructed not to use shell or raw XML. From an abstract brief it created an original eight-measure IA_ROCKS project at 132 BPM in 4/4 containing:

- 41 vocal notes;
- locked Japanese phonemes;
- 34 DYN points;
- 6 PBS points;
- 22 PIT points;
- expressive note styles;
- three long-note vibratos with editable depth and rate envelopes.

The project passed schema and semantic validation with no diagnostics. Yamaha's loader enumerated 351 objects, one track, and one musical part. That proved the central claim: the MCP could create a real native vocal project from an empty starting point.

It did not yet prove a finished song. There was no accompaniment, production mix, artifact history, or delivery gate. But the hardest foundational distinction—generation rather than template mutation—was settled.

---

## 6. Phase III: safely automating the original VOCALOID3 Editor

Manual export demonstrated that generated projects could sing. The next challenge was to make that process bounded, observable, and safe enough for an unattended agent call.

### 6.1 Discovering the command and dialog contract

Win32 menu enumeration identified:

```text
File -> Export -> Wave...    command ID 33299
```

The native state machine also records the editor's Exit command (`57665`) and track-editor command (`65281`) for bounded control/diagnostics. It does not dispatch arbitrary menu IDs supplied by the MCP caller.

The export is a two-dialog transaction:

1. VOCALOID's **Export Wave File** options dialog, which selects master/current/separate output and audio settings;
2. Windows' **Export to Wave File** save dialog, which chooses the destination.

The helper cannot assume that controls exist the instant a dialog window appears. Common-dialog children are created asynchronously, especially when the editor runs offscreen or without a normal Explorer shell.

### 6.2 The first cleanup crash

An early prototype enumerated the save dialog before its filename control existed. It then attempted to exit the disabled MFC owner while the modal dialog remained active. VOCALOID3 raised an access violation during teardown.

This was not a synthesis bug and not a malformed VSQX. It was an automation state-machine bug.

The repaired native helper now:

- waits until both filename and Save controls exist or a bounded deadline expires;
- hooks only `EVENT_OBJECT_SHOW`, avoiding partially constructed child windows;
- recognizes each expected dialog by title, structure, and process ownership;
- cancels known modals before touching the owner window;
- waits for the owner to become enabled before dispatching Exit;
- terminates only the helper-owned process if a modal cannot be safely unwound;
- never sends a blind close command into an unknown UI state.

After the save request, the helper waits for the output to remain stable across four 250 ms observations before returning control to the Node verifier. Event verification is tied to the exact expected dialog, and accepting the known Pre-Send adjustment requires both explicit caller permission and the expected confirmation control. The result distinguishes “permission was granted,” “the dialog was observed,” and “an adjustment was actually accepted.”

The important lesson was that “we can click the menu” is not the same as “we have an automatable renderer.” Cleanup and failure behavior are part of the renderer contract.

### 6.3 Fail closed on singer substitution

VOCALOID can display a warning and substitute a default singer when the requested voice is unavailable. Clicking through would create valid-looking audio with false provenance.

The helper matches the singer-substitution dialog, returns the typed error `singer_unavailable`, and refuses to render under an unknown voice. This is why `vocaloid_list_voices` and `vocaloid_probe_voice` answer different questions:

- voice listing says metadata exists on disk;
- a successful probe proves that the current editor can actually synthesize the component.

### 6.4 Render as a transaction

`vocaloid_render_wav` performs the following transaction:

1. validate the source VSQX;
2. fingerprint the editor and helper binaries;
3. acquire the host-wide editor lease;
4. select a temporary sibling WAV path;
5. launch the editor and begin bounded automation;
6. observe progress and cancellation state;
7. wait for a stable output file;
8. parse RIFF/WAVE chunks and PCM metadata;
9. reject silence, malformed headers, or impossible sample counts;
10. atomically rename the verified temporary output;
11. release the lease and clean up the helper-owned process.

An existing destination requires explicit overwrite permission and receives a timestamped backup first. A failed render does not leave a file at the requested final path.

### 6.5 Fingerprints, progress, cancellation, and the editor lease

The current render bridge recognizes the pinned editor fingerprint as version 3.2.1.1. Unknown fingerprints are refused unless the caller explicitly opts into the risk.

The public progress model exposes eight stages:

```text
validating
fingerprinting
waiting/acquiring lease
launching
synthesizing
verifying
committing
cleanup
```

Cancellation uses a unique file observed by the native helper and an abort signal in the Node layer. The host-wide lease is created atomically at `build/runtime/vocaloid-editor-render.lock` and records a lease ID, process ID, request ID, and acquisition time. A lock is considered stale only after the age threshold and a dead-owner check; release succeeds only when the lease ID still matches.

This prevents two agent calls from racing the single desktop editor and gives `EDITOR_BUSY` enough diagnostic information to retry intelligently.

### 6.6 First hardened exports

After explicit user confirmation, the repaired automation completed two bounded renders without residual processes or forced termination:

| Project | Helper runtime | Audio | Peak | RMS |
| --- | ---: | --- | ---: | ---: |
| Japanese `4 a` smoke | 13.657 s | 10.008 s, 44.1 kHz, 16-bit stereo | -18.47 dBFS | -38.46 dBFS |
| Codex-created `雨のあとで` | 14.641 s | 16.370 s, 44.1 kHz, 16-bit stereo | -7.92 dBFS | -23.01 dBFS |

At this point the project had a genuine minimal closed loop: an agent could create a native project and the original editor could export non-silent audio from it. Everything that followed expanded that loop from a vocal demonstration into a production workflow.

---

## 7. Phase IV: moving from vocal snippets to structured songs

A working vocal renderer is necessary but not sufficient. A finished song needs form, simultaneous vocal roles, accompaniment, tempo and meter structure, and enough duration to expose problems that never appear in a ten-second smoke test.

### 7.1 A structured native song model

The original single-part project writer was retained for compatibility, while `vocaloid_create_song` introduced a song-scale input model. It supports:

- multiple vocal tracks, each with explicit mixer state;
- multiple named musical parts per vocal track;
- global tempo and time-signature maps;
- musical positions expressed as measure/beat/tick;
- mono and stereo WAV audio parts;
- automatic audio-part duration calculation across tempo changes;
- pre-measure-aware placement;
- native V3/V4 project generation.

This was the first point where lead, harmony, and backing could coexist in one VOCALOID project. A structural integration fixture rendered two simultaneous IA vocal tracks and one stereo backing part. The project contained six notes, four DYN points, and one WAV part; the resulting master was 6.014 seconds, stereo, non-silent, and measured -13.26 dBFS peak and -25.32 dBFS RMS.

### 7.2 Audio parts are references, not embedded assets

VOCALOID audio parts refer to external WAV files. The server therefore validates the referenced audio before writing the project:

- 16-bit PCM;
- 44.1, 48, or 96 kHz;
- mono or stereo;
- parseable RIFF/WAVE structure;
- play time derived rather than trusted from caller input.

Because the editor runs on Windows, a WSL path must be converted into an editor-readable Windows path. Moving the WAV later invalidates the project reference; the VSQX does not contain a copy. This behavior is documented rather than hidden because it affects reproducibility.

### 7.3 Why the accompaniment renderer uses MIDI internally but the product does not stop there

FluidSynth 2.3.4 and the installed FluidR3 GM SoundFont became the first deterministic accompaniment backend. The arrangement model itself is not a user-supplied MIDI file. It contains typed pitched notes, drum hits, tempo and meter events, track mixer choices, patterns, and placements. During rendering, the backend converts those events to a temporary format-1 SMF, invokes FluidSynth, validates the resulting 16-bit stereo PCM, and deletes the temporary MIDI.

This is an important distinction:

- MIDI is an internal event transport for one renderer;
- the canonical song retains higher-level musical identities and production intent;
- the vocal performance remains native VSQX and original-editor synthesis;
- a future VST or DAW renderer can replace FluidSynth without changing song positions or stable IDs.

The renderer supports up to 15 melodic MIDI channels plus channel 10 drums, explicit program/bank selection, volume, pan, tempo and meter changes, reusable patterns, placement transposition, and an optional custom SoundFont path.

FluidR3 GM is deliberately described as a **draft-quality** timbre backend. Selecting GM program 106 and labeling a role “shamisen” does not prove an idiomatic shamisen performance. The role is useful for arrangement planning and style differentiation, but release-grade acoustic authenticity requires a licensed library, a dedicated VST, or a real player.

### 7.4 The 16-measure experiment

The first agent-composed song-scale experiment used:

- a two-bar intro;
- a six-bar verse;
- a two-bar pre-chorus;
- a six-bar chorus;
- a tempo lift from 128 to 132 BPM;
- 176 pitched accompaniment notes;
- 127 drum hits;
- 56 lead notes and 17 lead controls;
- 12 harmony notes and 6 harmony controls.

The combined original-editor master was 40.263 seconds. Structurally, this was a success: a new song with lead, harmony, and backing had been composed and rendered without an existing VSQX.

Sonically, it revealed the next class of defects. The raw export measured approximately:

- -9.0 LUFS integrated;
- 13.5 LU LRA;
- +0.3 dBTP true peak;
- 9,844 full-scale samples, roughly 0.277% of all samples.

That is not a mastering success. It is clipped source audio. The failure justified building an audio-quality plane instead of treating “a WAV exists” as completion.

---

## 8. Phase V: long-form rhythm, fast lyrics, arrangement, and mastering

The next requirements came directly from listening: longer songs, richer instrumentation, changing grooves, rapid Vocaloid lyrics, melisma, stereo intent, and delivery names that identify the song.

### 8.1 A phrase compiler above the one-note/one-lyric file format

At the VSQX level, each note still has a lyric/phoneme pair. That does not mean the agent should manually map every mora to every low-level note.

`vocaloid_compile_vocal_phrase`, later integrated with the manifest phrase model, accepts musical rhythm cells that can express:

- 1/16, 1/32, and 1/64 subdivisions;
- dotted values;
- N-in-the-time-of-M tuplets;
- rests;
- note gate percentages;
- pitch, velocity, style, and vibrato per cell;
- sequential lyric allocation for fast syllabic passages;
- explicit repeated lyric indices for melisma.

In sequential mode, morae are assigned across rapid voiced cells. In explicit mode, repeating the same lyric source index generates native continuation notes with:

```text
lyric="-"
phonemes="-"
```

That is the native representation of one lyric extending across multiple notes. The abstraction therefore makes the agent's intent easier to express without inventing a non-native result.

### 8.2 Reusable patterns and placements

Long-form accompaniment cannot require thousands of repeated input events. The arrangement layer separates a compact source pattern from placements. Each placement can select a section, repeat count, transposition, velocity scale, and other bounded transformations.

One reference example expands only eight source events and two placements into a 96-measure arrangement containing 192 shamisen notes and 384 drum hits. The expansion remains deterministic and inspectable; the manifest retains both the reusable source and every semantic placement.

The installed GM palette was checked for roles including:

- Shakuhachi, program 77;
- Shamisen, program 106;
- Koto, program 107;
- Taisho Koto, bank 8 / program 107;
- Taiko, program 116;
- conventional guitars, basses, keys, strings, pads, bells, and drum-kit notes.

Again, these names describe General MIDI presets, not guaranteed acoustic realism.

### 8.3 Audio analysis and two-pass mastering

The audio analyzer combines direct PCM inspection with FFmpeg's EBU R128 measurements. It reports:

- duration, sample rate, bit depth, and channels;
- sample peak and RMS;
- crest factor;
- integrated LUFS;
- loudness range (LRA);
- true peak;
- the exact count of full-scale PCM samples;
- per-channel peak and RMS;
- left/right balance and a channel-imbalance flag.

The mastering tool writes a distinct output and performs a measured two-pass loudness normalization. It re-analyzes the file after processing rather than trusting the filter request. It also states an important limitation: loudness normalization cannot reconstruct transient detail already destroyed by clipping.

The corrected version of the 16-measure experiment measured -13.8 LUFS, -1.0 dBTP, and zero full-scale samples. That proved the QC loop, while also demonstrating why analysis must happen before the project declares success.

Later full-song closure exposed a subtle FFmpeg behavior: `loudnorm` could report an independently measured true peak slightly above the requested ceiling. The masterer now applies a recorded corrective gain when that happens, re-analyzes the output, and fails if it remains more than 0.05 dB above the bounded target.

### 8.4 The 96-measure stress test

The next long-form agent evaluation created the 96-measure song `月影疾走` with:

- 172.408 seconds of audio;
- ten tempo events spanning 96 to 156 BPM;
- a 4/4 -> 6/8 -> 4/4 meter arc;
- nine instrument and drum roles;
- 81 pattern placements;
- 3,128 pitched events and 861 drum events;
- 311 lead notes and 85 harmony notes;
- 41 vocal control points.

The first vocal mix was unintentionally left-heavy. The agent had interpreted pan `0` as center, a convention used by some signed pan APIs. VOCALOID's native mixer instead uses:

```text
0   = hard left
64  = center
127 = hard right
```

The result had a 17.196 dB left/right RMS difference. This was not merely a documentation typo: it produced audibly wrong output.

The response was to add explicit mixer inspection and update tools, document the native scale in schemas and descriptions, and require per-channel audio analysis after render. The revision placed lead at 64 and harmony at 96. Raw balance improved to 0.583 dB. The final master measured -14.2 LUFS, -1.0 dBTP, zero clipped samples, and 12.6 LU LRA.

The LRA target had been 9 LU, so the system reported the miss honestly rather than calling every other passing metric a full success. That distinction later informed separate readiness gates and typed QC results.

One Editor export also exited without a WAV. Because the renderer used a temporary output, validation, and atomic commit, it did not create a false artifact. A retry succeeded.

### 8.5 Artifact naming is part of usability

Early filenames such as `agent-longform-master.wav` became ambiguous as soon as more than one song existed. The project adopted descriptive, versionable names:

```text
<song>-backing-v1.wav
<song>.vsqx
<song>-mix-v1.wav
<song>-master-v1.wav
<song>-<style>-final.wav
```

This seems small compared with reverse engineering, but agent workflows are sensitive to ambiguity. A name that carries the song slug, role, and version reduces accidental reuse and makes artifact review dramatically easier.

---

## 9. Phase VI: the canonical song manifest

The 96-measure experiment proved that long songs were possible. It also proved that passing a whole song through monolithic calls was unsustainable. A canonical, revisioned manifest became the largest architectural change in the project.

### 9.1 Why VSQX could not remain the database

A finished production contains information outside native VSQX:

- semantic sections and energy arcs;
- chord intent;
- reusable accompaniment patterns and renderer settings;
- stable identities for phrases, effects, reviews, and artifacts;
- raw stem dependencies;
- mix effect chains and section dynamics;
- audio-analysis results;
- revision history and optimistic concurrency;
- source hashes and delivery readiness.

Trying to encode all of this into comments or sidecar conventions around a mutable VSQX would make staleness impossible to reason about. The project therefore made `*.song.json` the canonical source and treated all media files as derived artifacts.

### 9.2 Manifest domains

The manifest is divided into bounded musical and production domains:

1. **Timeline** — resolution, pre-measures, tempo map, meter map, and duration.
2. **Sections** — semantic form, positions, energy, descriptions, and review scope.
3. **Harmony** — keys and chord events retained as creative intent and guardrail context.
4. **Vocals** — voices, tracks, mixer state, parts, direct notes, phrases, controls, and tuning gestures.
5. **Arrangement** — pitched/drum tracks, patterns, placements, direct events, and renderer settings.
6. **Mix** — stem intent, ordered effect chains, section dynamics, and bus configuration.
7. **Artifacts** — paths, roles, hashes, sizes, dependencies, source revisions, and renderer metadata.
8. **Review** — human or agent listening notes attached to sections, objects, and artifacts.

Global stable IDs exist for songs, sections, voice declarations, tracks, parts, phrases, notes, controls, patterns, placements, effects, automation, artifacts, and reviews. IDs must be unique across the manifest, not merely within one array.

### 9.3 Three hashes answer three different questions

One content hash cannot distinguish a melodic change from an EQ adjustment. The manifest therefore computes three related SHA-256 identities from canonical JSON with sorted keys:

- `content_hash` covers the complete canonical document, excluding the hash field itself;
- `composition_hash` excludes downstream mix intent, artifact records, revision counters, and timestamps;
- `mix_hash` binds current composition identity to current mix intent.

This separation has concrete consequences:

- changing an EQ does not invalidate expensive raw vocal stems;
- changing a melody does invalidate stems, mix, and delivery;
- changing only a review note changes content history without pretending the audio composition changed;
- an old mix can remain in history while being clearly marked non-current.

### 9.4 Optimistic concurrency for agent calls

Every mutation includes `expected_revision`. The server loads and validates the manifest, compares the current revision, applies exactly one bounded mutation, increments the revision, records the parent hash, recalculates hashes, writes a temporary sibling, and atomically renames it.

If another call has already advanced the manifest, the write fails with the current revision and hash. The agent is told to inspect again rather than silently overwriting newer work.

Same-path mutations create timestamped backups. That allows a monotonic restore operation: restoring history does not decrement the revision or rewrite the past; it creates a new revision whose content is based on the selected historical state.

### 9.5 Stable IDs make bounded work possible

Without stable identities, an instruction such as “make the second chorus harmony softer” is an array-index mutation waiting to go wrong. With stable IDs, the agent can:

- fetch one section and intersecting objects;
- update one phrase while preserving the rest of a vocal part;
- transpose selected events without reconstructing their track;
- remove an object only when referential integrity remains valid;
- attach a review note to an exact section, phrase, track, or artifact;
- compare music-aware history domains instead of raw JSON line noise.

The server rejects zero-match transformations, dangling references, empty invalid phrases, out-of-bounds placements, and stable-ID collisions.

### 9.6 Dry-run executes the real mutation path

`dry_run` is not a shallow validator. The server copies the manifest to a temporary path, invokes the same mutation logic used for a real write, and returns:

- predicted revision and hashes;
- a music-aware diff;
- preflight results;
- the exact prospective result shape.

It then deletes the temporary file. This matters because a separate “validation implementation” inevitably drifts from the write path. Dry-run should answer, “what would this exact call do?”

### 9.7 Artifacts form a dependency graph

Artifact entries are computed by the server, not accepted as arbitrary caller claims. Each record can contain:

- stable artifact ID and role;
- normalized path;
- byte size;
- SHA-256 digest;
- source revision;
- source composition hash;
- source mix hash when relevant;
- dependency artifact IDs;
- renderer, audio, and analysis metadata.

Currentness is recursive:

- a composition artifact is current when its source composition hash matches;
- a mix artifact is current when its source mix hash matches;
- a delivery is current only when its own source identity and every dependency are current and readable.

This fixed a subtle bug found during the final style closure: an obsolete mix could still exist and had previously been mistaken for mix readiness after the mix intent changed. The manifest now preserves the historical artifact without allowing it to satisfy a current delivery gate.

### 9.8 Build is a provenance transaction

`vocaloid_build_song_manifest` runs preflight, renders accompaniment, compiles VSQX, validates both, computes digests, and records the backing-to-VSQX relationship in one manifest-aware operation. It only commits artifact records if all required output is verified. If a later step fails, files created by that failed transaction are removed rather than registered as partial success.

This is the point at which “a set of scripts” became a coherent production state machine.

---

## 10. Phase VII: Japanese lyrics and inspectable tuning gestures

VOCALOID composition is not complete when notes merely trigger vowel-like sound. Japanese text requires explicit pronunciation evidence, and expressive performance requires controls above the level of arbitrary curve points.

### 10.1 Manual-backed G2P, not a hidden dictionary guess

The Japanese G2P implementation is deliberately conservative. Its output is limited to the phoneme inventory documented in the local VOCALOID3 manual. It handles:

- hiragana and katakana normalization;
- yoon combinations;
- long vowels;
- the moraic nasal;
- common foreign-kana combinations;
- explicit choices for affricates and nasal-g behavior;
- word boundaries represented by spaces in the reading.

Kanji requires an explicit kana reading. The tool does not silently guess a pronunciation from an opaque dictionary. This preserves a clean evidence chain:

```text
original lyric text
    -> user/agent-supplied kana reading
    -> normalized reading
    -> mora units
    -> manual-backed phoneme tokens
    -> rhythm alignment
```

These layers remain distinct in the manifest, including overrides and source provenance. A generated kana string is never mislabeled as the original lyric.

### 10.2 Small っ must become timing, not an invented phoneme

The manual inventory has no standalone phoneme token for small `っ`. The system therefore requires an explicit strategy:

- represent the closure with a positioned rest; or
- deliberately attach/repeat the following consonant under an experimental `attach_next` strategy.

This is a good example of an agent-friendly guardrail. The tool does not refuse expressive writing, but it forces an ambiguous linguistic choice into inspectable intent.

`ヴ` similarly uses an explicit fallback when the available voice inventory requires `/b/`-like handling. Irregular pronunciations are evidence, not hidden exceptions.

### 10.3 Mora alignment and rapid lyrics

`vocaloid_align_japanese_phrase` combines reading evidence with rhythm slots. Two modes cover the important cases:

- `sequential`: allocate successive morae over voiced cells, suitable for rapid syllabic writing;
- `explicit`: map each cell to a chosen mora index, with repeated indices compiling to native melisma continuations.

The resulting phrase has stable event IDs before tuning is applied. That means later gestures, analysis, and reviews can refer to the same musical note even after unrelated sections change.

### 10.4 A gesture compiler instead of opaque presets

Agents reason better about phrases such as “soften the entrance,” “add a restrained scoop,” or “open the chorus timbre” than about dozens of raw PIT samples. The gesture layer translates musical intent into bounded native controls while retaining both levels in the manifest.

Current gesture types include:

- articulation;
- vibrato;
- pitch scoop;
- dynamics arc;
- opening arc;
- timbre arc.

The compiler can update note velocity, accent, decay, opening, bend, portamento, and vibrato, and generate sparse PBS/PIT/DYN/BRE/BRI/CLE/GEN/POR curves. Targets are stable event IDs; numerical ranges and ordering remain visible. There is no uninspectable “make it emotional” preset and no automatic pitch quantization of rendered audio.

### 10.5 Guardrails should preserve intentional extremity

The project checks tessitura, leaps, phrase length, breath opportunity, consonant collisions, mora density, and harmony risk. It does not universally block high density or dissonance. Vocaloid styles often depend on rapid lyrics, abrupt registers, and synthetic precision.

The final J-Rock and wa-rock songs intentionally retain density and consonant warnings in designated rapid passages. The warnings remain useful because they locate listening targets. They are not treated as proof that the composition must be normalized into slower writing.

### 10.6 Voice readiness is an active probe

The IA_ROCKS readiness probe generates a tiny safe project using `ら` / `4 a`, centers the mixer, locks the phoneme, renders through the original editor, verifies non-silent audio, and deletes the temporary project and WAV.

Results are cached by voice component plus editor/helper fingerprints:

- verified result: seven days;
- unavailable result: 24 hours;
- transient error: ten minutes.

The cache is written atomically. It reduces repeated editor launches while remaining invalidated by a binary change. Crucially, it never treats VVD discovery alone as synthesis proof.

---

## 11. Phase VIII: stems, score-versus-render analysis, and reproducible mixing

Rendering a master directly from the editor is useful for a smoke test. It is not enough for production iteration. The project therefore separated vocal and instrument stems, then connected those stems back to the score and manifest.

### 11.1 Instrument stems

`vocaloid_render_instrument_stems` renders each pitched or drum arrangement track separately through the configured accompaniment backend. The agent explicitly chooses whether to preserve authored pan and renderer effects or request a centered/dry source.

Each result is verified as stereo, non-silent audio and registered with its track stable ID, composition hash, digest, and renderer metadata. This makes a later mix reproducible rather than dependent on whatever state happened to be active in an external mixer.

### 11.2 Vocal stems through the original editor

`vocaloid_render_vocal_stems` starts from the hash-verified VSQX artifact. For each requested vocal track it:

1. verifies the VSQX digest and source composition hash;
2. creates a temporary project;
3. mutes other vocal tracks;
4. physically removes backing audio parts;
5. optionally centers pan or applies a volume override;
6. renders through the original editor;
7. verifies the WAV;
8. records dry/center decisions and dependencies in the manifest.

Removing the backing rather than merely muting it is an extra safeguard against hidden master contamination. Lead and harmony integration tests verified two independent non-silent stereo stems.

### 11.3 Two timeline origins must be aligned

Instrument stems begin at `song_start`. Vocal editor stems begin at `project_start`, which includes pre-measures. A naive sample-zero sum therefore shifts one family relative to the other.

The mix renderer computes the exact pre-measure duration across the tempo map and delays the appropriate stems before summing. This rule is explicit in the filter graph and test fixtures. Timeline origin is treated as artifact metadata, not guessed from audible onset.

### 11.4 Score-versus-render vocal analysis

`vocaloid_analyze_vocal_stem` aligns stable score events with an isolated vocal WAV. Its current signal path converts to mono 8 kHz analysis audio and uses 40 ms frames with 10 ms hops. A YIN-style estimator measures pitch near the expected note rather than attempting unrestricted transcription.

Per-note observations include:

- F0 contour;
- median and p95 absolute cents error;
- voiced ratio;
- energy onset;
- voiced onset;
- estimated consonant lead;
- release behavior;
- vibrato depth, rate, and regularity.

Phrase summaries aggregate systematic timing and pitch behavior. Events shorter than roughly 120 ms are marked as resolution-limited. Continuous voiced boundaries receive special handling so the analyzer does not mistake every legato transition for a fresh consonant.

The output is observational. It does not auto-apply an estimated offset, because an early energy onset may be a consonant rather than a synchronization defect. It does not claim phoneme recognition, intelligibility scoring, or emotion detection. A synthetic +100-cent / 5 Hz vibrato regression and a real IA editor stem both passed.

### 11.5 Separate composition and mix identities

Raw stems are expensive, especially when the original editor must render them. Because the manifest has a separate `mix_hash`, changing an EQ, fader, or section ramp does not invalidate stems whose composition source is unchanged.

This is a major practical optimization for agent iteration: “make the bridge vocal brighter” can be a fast deterministic remix instead of another multi-minute editor export.

### 11.6 Typed effect chains

The mix model supports ordered, typed effects:

- gain;
- pan;
- high-pass filter;
- low-pass filter;
- parametric EQ;
- compressor;
- de-esser;
- bounded multi-tap room/reverb;
- delay;
- limiter.

Disabled effects remain in the intent graph but are skipped during render. There is no hidden normalization, automatic centering, or implicit makeup gain. A track's authored choices are changed only through explicit parameters.

The deterministic render order is:

```text
decode / resample / stereo float
    -> timeline alignment
    -> track section automation
    -> ordered track effect chain
    -> sum with normalize disabled
    -> mix-bus section automation
    -> ordered bus effects
    -> PCM encoding
    -> independent analysis
```

Both the requested graph and the resulting FFmpeg filter graph are retained as evidence.

### 11.7 Section dynamics, preview, A/B, and review notes

Section automation uses semantic section IDs rather than raw time ranges. A target/section pair has one stable automation object, including target gain and ramp intent.

The review layer can:

- render a bounded section preview;
- produce loudness-matched A/B clips;
- retain source artifact and section provenance;
- attach human listening notes to a section, object, or artifact ID.

This closes an important loop that numeric analysis cannot: a human can say “the consonants blur in `chorus-2-fast-line-3`” or “the harmony masks the lead in this delivery,” and the note survives as structured production context rather than disappearing into chat history.

---

## 12. Phase IX: preflight, host readiness, history, and delivery

As capabilities accumulated, failures could occur at very different stages. A single `valid: false` was no longer useful. The project introduced an aggregate preflight with stage-specific readiness.

### 12.1 One read-only pass over the whole song

`vocaloid_preflight_song` evaluates the canonical manifest without opening the editor unless the caller explicitly requests a voice probe. It groups issues into domains such as:

- structure and bounds;
- vocal overlap;
- voice and phoneme evidence;
- performance density and breath risk;
- harmony and tessitura;
- arrangement patterns and placements;
- mixer intent;
- artifact provenance and readability;
- host readiness.

Representative checks include:

- overlapping vocal notes;
- notes or placements outside section/song bounds;
- unlocked or inventory-invalid phonemes;
- rapid mora density;
- likely consonant collisions;
- long phrases with insufficient breath opportunity;
- large leaps and risky tessitura;
- sustained non-chord tones and minor-second harmony collisions;
- extreme pan values;
- unverified selected voice;
- missing, unreadable, digest-mismatched, or stale artifacts;
- native track/part comments longer than the compiler's 256-character boundary.

The comment check deserves emphasis. A long Hanairo comment originally passed high-level preflight and then failed during VSQX build. The fix added `NATIVE_TRACK_COMMENT_TOO_LONG` and `NATIVE_PART_COMMENT_TOO_LONG`, moving a deterministic failure in front of an expensive build.

### 12.2 Readiness is staged

Preflight reports separate gates:

- **score readiness** — musical/canonical structure is valid;
- **build readiness** — the score can compile and render accompaniment;
- **render readiness** — a current VSQX and verified voice/host are available;
- **mix readiness** — required current stems exist;
- **delivery readiness** — current mix/master dependencies and QC are satisfied.

A fresh composition can therefore be score-ready while correctly being render-not-ready because no VSQX artifact exists yet. This is not an error; it is an accurate workflow state.

Artifact checks support `none`, `current`, and `all`. `all` can report preserved stale historical artifacts without allowing them to block or satisfy the current dependency chain.

### 12.3 History, diff, and monotonic restore

Manifest history scans the current file and timestamped backups, verifies each candidate, and exposes music-aware changes in domains such as timeline, vocals, arrangement, mix, artifacts, and review. A restore copies selected historical content into a new revision with a new parent relationship. It does not erase the intervening history.

This provides practical rollback without using destructive Git operations on generated creative state.

### 12.4 Manifest-aware mastering and delivery

`vocaloid_master_manifest_delivery` begins from a current manifest mix artifact, not an arbitrary WAV path. It validates source digest, composition and mix identities, runs bounded mastering, independently measures the result, and records the artifact transaction.

The delivery stage verifies:

- source and dependency currentness;
- exact file hash and byte size;
- stereo channel count;
- sample rate and bit depth policy;
- integrated loudness target/tolerance;
- loudness-range policy;
- true-peak ceiling;
- zero full-scale clipping;
- channel-balance policy;
- review/QC metadata.

The clean listening copy is published only after this gate passes. The runner also publishes the current-composition VSQX under the same basename in `artifacts/vsqxs/`. It verifies both source hashes and both existing targets before creating either missing copy. Identical destinations are reused, while a same-name WAV or VSQX with different bytes is never silently overwritten. The VSQX preserves the vocal score, native tuning, mixer state, and backing reference; the final isolated-stem mix/master remains manifest provenance rather than being embedded back into the project file.

---

## 13. Phase X: redesigning the MCP for agents

By the first IA_ROCKS closure, the implementation had many capabilities. It was still too expensive for a fresh agent to discover and route reliably.

### 13.1 Measuring context friction

At one checkpoint the flat MCP exposed 37 tools whose serialized definitions occupied 153,222 bytes—roughly 38,000 tokens by a crude four-bytes-per-token estimate. All 37 returned a generic untyped `data` envelope. A fresh Codex inspection task consumed 34,774 tokens.

This is a product defect even if every tool works. Agents pay for tool names, descriptions, nested schemas, and outputs in their active context. A huge catalog reduces the context available for lyrics, harmony, section plans, listening notes, and actual reasoning.

The remediation had three parts:

1. create task-oriented profiles;
2. move reference material into on-demand resources;
3. give every production tool a concrete typed output.

Current measured catalogs are:

| Profile | Tools | Serialized catalog size | Intended user |
| --- | ---: | ---: | --- |
| `production` | 20 | 77,905 bytes | Default agent song workflow |
| `full` | 49 | 217,352 bytes | Diagnostics and low-level development |
| `legacy-vsqx` | 16 | 60,818 bytes | Compatibility with early clients |

All profiles expose nine resources.

### 13.2 Workflow tools and low-level tools serve different purposes

The full profile retains narrow operations useful for debugging: listing individual notes, adding curves, inspecting the native mixer, rendering a bare WAV, and so on. The production profile emphasizes complete, provenance-safe workflow steps:

- create and inspect a canonical song;
- edit one bounded domain with dry-run;
- align a Japanese phrase;
- preflight;
- build current artifacts;
- render stems;
- analyze and mix;
- review;
- master and deliver;
- inspect or restore history.

The server still covers low-level API surface, but the default agent does not have to choose among dozens of near-adjacent operations for routine production.

### 13.3 Resources remove static reference material from every call

Nine MCP resources provide information that is important but not needed in every tool definition:

- `vocaloid://capabilities`;
- `vocaloid://examples/from-zero`;
- the Hanairo lyric/provenance resource;
- style palettes for wa-rock Hanairo, IA J-Rock, summer-night air, piano ballad, and electro speed;
- an additional style/capability index resource.

The exact from-zero example was added after a real agent needed six parameter/schema corrections while building a four-bar smoke song. Descriptions alone were not enough; an on-demand, valid call sequence reduced ambiguity without bloating the catalog.

### 13.4 Typed outputs are part of routing reliability

Every production tool advertises a concrete output schema. This helps the client distinguish a manifest summary from a render result, a preflight report, or a delivery record. It also catches server/schema drift.

The three-song closure found exactly such a drift: successful master and delivery calls were returned to the MCP client as JSON-RPC `-32602` errors because strict output schemas omitted `sourceRevision` and `manifestContentHash`, even though runtime processing had succeeded. The output schemas were corrected and regression-tested.

Typed outputs are therefore not decorative documentation. They validate the server's public contract after the side effect, which is precisely when a mismatch is most dangerous.

### 13.5 Tool annotations can change agent behavior

The first production-profile Codex evaluation repeatedly cancelled `vocaloid_edit_song(dry_run=true)`. A direct stdio reproduction completed in 256 ms, so the server was not hung.

The cause was its static annotation:

```text
destructiveHint: true
```

Codex correctly treated the call as potentially destructive even when the runtime parameter selected dry-run. The composite router was changed to non-destructive because:

- dry-run never changes the canonical file;
- real same-path writes create timestamped backups;
- history restore is monotonic;
- the description explicitly states these guarantees.

This does not mean mutations are risk-free. It means MCP annotations must describe the tool's actual recovery contract, not merely the existence of a write-capable branch.

### 13.6 Actionable errors reduce retry loops

Errors now distinguish conditions such as:

- stale expected revision;
- editor busy with lease details;
- singer unavailable;
- unknown editor fingerprint;
- missing or stale artifact;
- hash mismatch;
- preflight stage blocked;
- out-of-bounds placement;
- zero-match transformation;
- invalid phoneme evidence;
- output audio silent or malformed.

Where possible, errors report the current revision/hash, blocking object ID, expected dependency, or next safe action. This lets an agent recover with a targeted inspection rather than repeatedly guessing different schemas.

### 13.7 The public MCP is the product boundary

The three-style workflow intentionally routes canonical writes, preflight, builds, editor renders, stem mixes, mastering, review notes, artifact hashes, and final QC through the production MCP. Local deterministic helpers are used only to plan reference rhythm slots and accompaniment notes.

This distinction matters. Calling TypeScript functions directly can prove implementation logic, but it does not prove that a real agent sees usable descriptions, schemas, resources, annotations, and outputs. Protocol-level evaluations exposed bugs that module tests could not.

---

## 14. The complete production workflow

The following walkthrough shows how the pieces fit together in an agent session. It is intentionally more explicit than a one-call demo because the revision and evidence boundaries are part of the design.

### 14.1 Step 0: select the production surface

The server defaults to:

```bash
VOCALOID_MCP_PROFILE=production
```

Before composing, the agent reads:

```text
vocaloid://capabilities
vocaloid://examples/from-zero
vocaloid://styles/<selected-style>
```

This gives it the exact IA_ROCKS component, coordinate conventions, a valid mutation sequence, and a palette of stylistic roles without forcing all of that material into every tool schema.

### 14.2 Step 1: check the host without paying for a new render unnecessarily

`vocaloid_host_readiness` reads the exact editor/helper fingerprints, current editor lease, and non-expired voice-probe cache without launching VOCALOID. `vocaloid_probe_voice` then reads or refreshes the cached IA_ROCKS synthesis proof. Build, preflight, and renderer calls report their own missing external dependencies when those stages are reached.

The separation is useful: a missing `ffmpeg` and an unregistered singer require completely different recovery paths.

### 14.3 Step 2: create only the skeleton

The initial manifest contains the title/slug, resolution, pre-measures, duration, tempo map, meter map, sections, harmony intent, and renderer configuration. It does not need hundreds of notes yet.

A typical form might establish:

```text
intro -> verse 1 -> pre-chorus -> chorus
      -> verse 2 -> pre-chorus -> chorus
      -> bridge -> final chorus -> outro
```

The server returns revision 1 and all three hashes. From this point onward, every mutation cites the expected revision.

### 14.4 Step 3: write one bounded section at a time

The agent can use the composite `vocaloid_edit_song` tool for a selected operation or narrower full-profile tools during diagnosis. A healthy long-song loop is:

1. inspect current revision or request one section;
2. prepare a vocal part, phrase, arrangement track, harmony event, or mix change;
3. run the exact mutation with `dry_run=true`;
4. inspect predicted diff and preflight issues;
5. apply the same bounded mutation with the current revision;
6. repeat for the next domain.

Only the affected section or track needs to appear in context. Stable IDs keep unrelated content untouched.

### 14.5 Step 4: align lyrics before applying tuning

For Japanese lyrics the agent supplies original text and explicit kana reading, then calls `vocaloid_align_japanese_phrase` with rhythm cells. The output contains manual-backed phonemes and stable note IDs.

Only after the note identities exist does the agent apply tuning gestures. This order avoids building expressive curves around temporary array indices.

For rapid passages, the agent can deliberately use 1/32 or 1/64 cells, shorter gates, and sequential morae. For a held word, explicit repeated mora indices produce native hyphens. The preflight report then shows density and consonant risk without forbidding the chosen style.

### 14.6 Step 5: construct arrangement roles and placements

The arrangement should encode musical roles rather than anonymous MIDI channels:

- rhythm guitar, lead guitar, bass, piano, strings, pad, bells;
- shamisen, koto, shakuhachi, or taiko draft roles;
- drum kit with explicit hits;
- reusable pattern IDs and section placements.

Tempo curves, groove, swing, and seeded humanization are inspectable transformations. A seed makes timing and velocity deltas reproducible. The agent can compare the predicted mutation before applying it.

### 14.7 Step 6: preflight before creating expensive artifacts

The first full preflight should use cached voice readiness and current artifact checks. The agent resolves **errors** before build. It classifies **warnings** into:

- unintended defects to revise;
- known renderer limitations;
- intentional style decisions to retain and review later.

The manifest may be score/build ready while render/mix/delivery remain false. That is expected before artifacts exist.

### 14.8 Step 7: build backing and native VSQX

`vocaloid_build_song_manifest` compiles both derived score artifacts from the same immutable composition revision. On success the manifest advances and records:

- validated VSQX path, digest, bytes, and composition source;
- verified stereo backing path, digest, bytes, and audio metadata;
- the dependency that the VSQX audio part refers to that backing.

If composition changes after this point, both artifacts become historical rather than current.

### 14.9 Step 8: render immutable stems

Instrument stems can be rendered by track in one deterministic backend pass. Vocal stems should be rendered as independent canonical transactions:

```text
lead transaction -> verify -> commit
quiet period
harmony transaction -> verify -> commit
```

This design came from a real long-harmony failure. It ensures that a failed harmony export does not remove or repeat an already successful lead render during resume.

The agent chooses dry/center/pan behavior explicitly. The renderer acquires the editor lease, enforces the fingerprint policy, and records progress/cancellation evidence.

### 14.10 Step 9: analyze vocals against the score

The score-versus-render analyzer maps each stable note to observed pitch, timing, voicing, release, and vibrato. The agent can then revise a bounded phrase if, for example:

- consonant lead consumes too much of a short note;
- a scoop overshoots consistently;
- a vibrato begins too early;
- a harmony note is weakly voiced;
- the apparent offset is systematic across a phrase.

The recommendation remains advisory. The tool never silently shifts the score.

### 14.11 Step 10: author mix intent

The agent adds effect chains and section dynamics to stable track IDs or the mix bus. A typical intent might include:

- high-pass and de-essing on lead;
- subtractive EQ on harmony;
- compression and a small room on vocals;
- pan and filtering for instrumental roles;
- section gains that lift choruses and preserve a quieter bridge;
- a bus limiter used only as explicitly configured.

Because this changes `mix_hash` but not `composition_hash`, raw stems remain reusable.

### 14.12 Step 11: render, measure, preview, and review

`vocaloid_render_stem_mix` verifies every input digest and timeline origin, produces the exact ordered filter graph, writes the mix, and returns loudness/peak/stereo evidence.

The agent can request a section preview or loudness-matched A/B before deciding whether the revision is better. Human observations can be written back as review notes attached to exact IDs.

### 14.13 Step 12: master from the manifest, not from memory

The master operation consumes the current manifest mix artifact and target policy. It performs measured loudness normalization, bounded true-peak correction, independent re-analysis, and atomic artifact registration.

It does not accept “the most recent WAV in a directory” as provenance.

### 14.14 Step 13: run the final delivery gate

Final inspection should use current artifact checks and verify all readiness stages. A delivery is accepted only when:

- there are no blocking preflight errors;
- selected voice evidence is current;
- build, stems, and mix match the current hashes;
- the mastered WAV matches its artifact digest;
- sample format, stereo, loudness, LRA policy, true peak, clipping, and balance pass;
- any intentional warnings and listening notes are preserved.

Only then are the hash-identical listening copy and current-composition native project placed under the matching basenames in `artifacts/songs/` and `artifacts/vsqxs/`.

### 14.15 Step 14: revise without losing the past

If the listener wants a different chorus, the agent can inspect that section, dry-run a phrase/arrangement/mix mutation, and apply it with the current revision. Composition changes stale downstream artifacts automatically. Mix-only changes reuse stems. History can show which musical domains changed, and restore creates a new revision if an experiment should be rolled back.

That is the closed loop: not simply generation, but **compose -> render -> observe -> revise -> deliver** with stable evidence at every boundary.

---

## 15. Independent agent evaluations

Unit tests prove deterministic code paths. They do not prove that an unfamiliar agent can discover and use the MCP. Two isolated Codex evaluations were therefore run for different purposes.

### 15.1 Evaluation A: from-zero creative use through MCP only

The first evaluation used `codex-cli 0.144.5` in an ephemeral environment with only the Vocaloid MCP available. Shell, direct filesystem access, network access, source VSQX files, and unrelated MCPs were prohibited.

The agent created the four-measure song `星駆ける声` from zero. The final result contained:

- manifest revision 7;
- two kana-aligned phrases;
- 12 vocal notes;
- a native `-` melisma continuation;
- five classes of high-level tuning gestures at that checkpoint;
- 12 compiled vocal control points;
- Celesta and drum accompaniment;
- a valid VSQ3 project with zero XSD diagnostics;
- a non-silent 44.1 kHz stereo backing with 0.99 dB left/right RMS difference.

The evaluation found a real writer defect: control points had been sorted within each curve type but not globally in the order required by the native file. That triggered the editor's Event Verification / Pre-Send adjustment path. The writer and validator were corrected to enforce global order.

The automation now defaults to refusing Pre-Send adjustment. A caller must explicitly set `allow_pre_send_adjustment=true`, and the render result records whether the dialog was seen and whether adjustment was accepted. This avoids quietly letting the editor rewrite an allegedly canonical score.

The evaluation also separated a voice metadata issue from agent creativity. IA metadata existed, but active synthesis availability was not initially proven. After the correct IA_ROCKS binding was confirmed, the original editor rendered the result. The early IA_ROCKS master took 19.234 seconds of helper runtime and produced 13.328 seconds of audio with approximately -22 LUFS, -13.3 dBTP, and 0.009 dB stereo imbalance. A delivery version measured -16 LUFS, 7.9 LU LRA, and -7.2 dBTP.

### 15.2 Evaluation B: production-profile routing

The second evaluation focused on interface friction, not song quality. It used an ephemeral, read-only Codex session that could call only the 20 production tools and read MCP resources.

The first run found the `destructiveHint` problem described earlier. It also revealed that the agent needed six schema corrections across vocal and arrangement calls. The server gained the exact `vocaloid://examples/from-zero` resource and corrected the IA_ROCKS component guidance.

The clean rerun created `production-profile-agent-smoke-v2.song.json` entirely through public MCP calls:

1. revision 1: a four-bar 4/4, 132 BPM skeleton with intro and verse;
2. vocal dry-run followed by revision 2 with a six-mora IA_ROCKS phrase;
3. arrangement dry-run followed by revision 3 with a non-empty guitar track;
4. cached-voice preflight without opening the editor.

Independent verification found:

- revision 3;
- composition hash `47e066be378d07ca21d04d6ea6a597ae76ea142ba35c5755918b70af496d6cc5`;
- content hash `5fd42df394c886b8403bf206a640fdb873cfc34c933e1ea9bbb4548d922ddc59`;
- one IA_ROCKS voice, vocal track, part, and phrase;
- six vocal events;
- one pitched arrangement track with four direct events;
- zero preflight errors, warnings, or infos;
- score/build readiness true;
- render readiness false only because no current VSQX had deliberately been built;
- no residual editor lease or evaluation process.

This is a modest musical artifact by design. Its purpose was to measure whether an agent could find the happy path through the reduced public surface.

### 15.3 Why both evaluations were necessary

The creative evaluation asked, “can an isolated agent actually invent and compile a small native performance?” The routing evaluation asked, “can a fresh agent operate the production API without shell or source-code knowledge?”

Neither substitutes for full-song audio closure. Together they prevent two common forms of self-deception:

- a powerful implementation that only its author knows how to call;
- a polished interface whose underlying musical pipeline has never rendered a real voice.

---

## 16. Three complete style closures

The final checkpoint exercised the complete production surface with three deliberately different arrangements. The reusable runner uses deterministic local helpers only to plan reference note/rhythm material. All canonical mutation, dry-run, preflight, build, original-editor vocal export, stem mix, master, review, artifact registration, and final QC flow through the public 20-tool production MCP.

This wording is precise: the runner is a reproducible reference workflow, while the isolated Codex sessions above are the evidence of autonomous MCP routing and from-zero creative use. The three songs prove end-to-end scale and style parameterization, not a statistical benchmark of prompt-to-song artistic quality.

### 16.1 Hanairo Biyori — wa-rock

The wa-rock song uses the user-supplied lyric file `artifacts/evals/[Lyrics] Hanairo Biyori.txt`. The file remains deliberately untracked, while its SHA-256 is retained as provenance:

```text
dcee0aaae443d01a3bc0a32fb2cd3e2bff55d09acdcca0ad52d22bc499829949
```

The manifest separately stores original lyric text, supplied romanization, derived kana reading, normalized reading, locked phonemes, reading overrides, and source evidence.

Composition evidence:

- final canonical manifest revision 41;
- 146 measures;
- 820 vocal events;
- lead plus 13 selected harmony destinations;
- 4/4 -> 6/8 -> 4/4;
- nine tempo points;
- seven arrangement tracks;
- shamisen, koto, shakuhachi, taiko, guitar, bass, and drums.

Final delivery:

| Metric | Value |
| --- | ---: |
| Duration | 256.474 s |
| Format | stereo, 44.1 kHz, 16-bit PCM |
| Integrated loudness | -15.2 LUFS |
| LRA | 5.7 LU |
| True peak | -1.10 dBTP |
| Full-scale clipped samples | 0 |
| Stereo balance | -1.14 dB |
| SHA-256 | `39723f64e976601e7c86390025fe7537164423e507041eede4beedb941d0c254` |

The manifest intentionally retains 112 consonant-collision and eight high-density warnings across eleven rapid lyric lines. An `artifact_check=all` audit also reports one obsolete historical mix, `stem-mix-r26`; it is preserved for history but is not a dependency of the current delivery.

Delivery pair:

```text
artifacts/songs/hanairo-biyori-wa-rock-ia-rocks-final.wav
artifacts/vsqxs/hanairo-biyori-wa-rock-ia-rocks-final.vsqx
```

The paired VSQX comes from source revision 16, is 383,831 bytes, and has SHA-256 `81e9ad994d87d05658f520a95a56fceedecfcb2466dbed9e724bb0399e5bc153`.

### 16.2 Hibana no Kouro — driving J-Rock

Composition evidence:

- final canonical manifest revision 25;
- 78 measures;
- 433 vocal events;
- lead plus eight harmony phrases;
- one explicit 2/4 turnaround inside the larger meter plan;
- nine tempo points;
- six arrangement tracks;
- double guitars, bass, piano, strings, and drums.

Final delivery:

| Metric | Value |
| --- | ---: |
| Duration | 126.564 s |
| Format | stereo, 44.1 kHz, 16-bit PCM |
| Integrated loudness | -14.0 LUFS |
| LRA | 4.8 LU |
| True peak | -1.00 dBTP |
| Full-scale clipped samples | 0 |
| Stereo balance | +1.16 dB |
| SHA-256 | `53b96224b6d8791c320785f857bc5777f2a5208e214199739d808480d1c86626` |

The current song intentionally retains 50 consonant-collision and five high-density warnings in designated rapid cells.

Delivery pair:

```text
artifacts/songs/hibana-kouro-ia-rocks-j-rock-final.wav
artifacts/vsqxs/hibana-kouro-ia-rocks-j-rock-final.vsqx
```

The paired VSQX comes from source revision 19, is 204,646 bytes, and has SHA-256 `e3edbac8b4752b74c577c20aeb7c7e3d8b021166d218f74c41335d51d0f80c9d`.

### 16.3 Natsu no Yoru ni Ukabu Koe — summer-night dream pop

Composition evidence:

- final canonical manifest revision 26;
- 78 measures;
- 411 vocal events;
- lead plus seven harmony phrases;
- repeated 6/8 <-> 4/4 changes;
- eight tempo points;
- six arrangement tracks;
- two pads, bells, clean guitar, fretless bass, and a soft kit.

Final delivery:

| Metric | Value |
| --- | ---: |
| Duration | 198.001 s |
| Format | stereo, 44.1 kHz, 16-bit PCM |
| Integrated loudness | -17.2 LUFS |
| LRA | 9.6 LU |
| True peak | -1.50 dBTP |
| Full-scale clipped samples | 0 |
| Stereo balance | +0.26 dB |
| SHA-256 | `5bb246d2eaf0262a2495a97e4690aa1ceced62a476f3234f06d794ba09a4daaf` |

This manifest passes with zero warnings as well as zero errors.

Delivery pair:

```text
artifacts/songs/natsu-no-yoru-ia-rocks-dream-pop-final.wav
artifacts/vsqxs/natsu-no-yoru-ia-rocks-dream-pop-final.vsqx
```

The paired VSQX comes from source revision 19, is 193,720 bytes, and has SHA-256 `7d08bd7761b98dde8b887ed83a2ee59a9427eb61d19bd575fbb1164ef4e7466e`.

### 16.4 Readiness and warning interpretation

All three current manifests pass score, build, render, mix, and delivery readiness with zero errors. The presence of intentional rapid-lyric warnings in two songs does not contradict readiness. Readiness answers whether the production graph is valid and current. Warnings identify passages whose artistic success should be checked by listening.

This distinction is healthier than either extreme:

- blocking every stylistic risk would make the guardrail compose the song;
- suppressing every warning would remove valuable review targets.

### 16.5 Resume behavior was tested by a real failure

A long summer harmony export exited during `wait_for_wave`. The renderer released the host lock and recorded no false vocal artifact. However, the old all-tracks batch transaction also removed the already successful lead output during cleanup.

The runner was redesigned so that each vocal track is its own canonical transaction with a 1.5-second quiet period between editor runs. On resume, the workflow inspects current composition hashes and existing immutable artifacts. It reused the committed lead, rendered only the missing harmony, and proceeded through mix and delivery without manual intervention.

This is one of the strongest closure results in the project: recovery behavior was not inferred from code; it was forced by a real multi-minute render failure.

---

## 17. Failure ledger: what broke and what each failure taught us

The following table condenses the most consequential failures. It is also a map of why the current architecture is more complicated than a VSQX serializer.

| Failure or wrong assumption | Observable symptom | Root cause | Engineering response |
| --- | --- | --- | --- |
| `4 a` treated as invalid | Native load failure was blamed on numeric phoneme prefix | Incorrect inference; `4` is the official Japanese flap phoneme | Consulted manual and bundled script, corrected XML details, added native regression accepting `4 a` |
| XSD-valid project still incompatible | Schema passed but Yamaha loader failed | Raw phoneme, note-style, vibrato, and CDATA conventions not fully expressed by XSD | Added native `Vsq3.dll` loader as a second validator |
| Direct synthesis returned `DSESetDBMPath=-100` | No WAV after Daisy encoding and engine load | Undocumented registry/activation and voice-table context | Stopped at licensing boundary; adopted original Editor as production synthesis authority |
| Save dialog controls missing | Helper could not enter filename | Asynchronous common-dialog construction on offscreen desktop | Wait for exact controls within bounded deadline |
| Editor access violation during cleanup | VOCALOID crashed while helper exited | Disabled MFC owner was closed while modal dialog remained active | Cancel modals first, wait for enabled owner, terminate only helper-owned process if unwind fails |
| Singer substitution | Editor offered to replace requested singer | VVD metadata did not guarantee registered/licensed availability | Match warning, return `singer_unavailable`, fail closed, add active probe/cache |
| Raw 16-measure master clipped | +0.3 dBTP and 9,844 full-scale samples | Levels were judged by render completion, not delivery analysis | Added PCM + EBU R128 analysis and measured two-pass mastering |
| 96-measure mix mostly left | 17.196 dB channel imbalance | Agent assumed pan 0 meant center | Documented native 0/64/127 scale; added mixer tools and per-channel QC |
| Master missed LRA target | -14.2 LUFS and -1 dBTP passed, LRA 12.6 did not | Loudness and dynamic-range targets are distinct | Reported partial pass honestly; split QC metrics/readiness |
| Editor exited without WAV | No final output | Legacy UI/render transient | Temporary output + verification prevented false artifact; bounded retry succeeded |
| Global control order wrong | Event Verification / Pre-Send appeared | Curves sorted only within type, not in native global order | Fixed writer/validator; made Pre-Send adjustment explicit and recorded |
| Voice component confusion | IA ID used where IA_ROCKS expected | Duplicated guidance and similar local metadata | Added one canonical IA_ROCKS constant and active binding test |
| Dry-run cancelled by Codex | Agent refused harmless preview | Static `destructiveHint: true` overrode runtime dry-run meaning | Corrected annotation based on backup/restore contract; added regression |
| Six schema corrections in fresh agent run | Agent recovered but wasted calls/context | Descriptions lacked an exact end-to-end example | Added on-demand from-zero resource and smaller production surface |
| Long native comment failed only at build | High-level preflight passed, compiler rejected more than 256 characters | Native field boundary absent from preflight | Added exact comment-length issue codes |
| Old mix appeared ready | Delivery inspection considered preserved stale artifact | Currentness did not fully include `mix_hash`/dependency state | Added `currentComposition`/`currentMix`; reject stale source mix hash |
| Successful call returned `-32602` | Master/delivery side effect succeeded but MCP result failed validation | Strict output schema omitted two runtime fields | Synchronized typed schemas and added protocol regression |
| True peak slightly exceeded request | Independent analysis above requested ceiling | FFmpeg loudnorm measurement/rounding difference | Apply recorded corrective gain, re-analyze, enforce +0.05 dB tolerance |
| Summer harmony failed at `wait_for_wave` | Long batch could not complete; lead was unnecessarily removed | Multi-track vocal export shared one cleanup transaction | Commit one vocal track per transaction; add quiet period and hash-aware resume |
| Generic output on 37 tools | Agent spent large context budget understanding results | API coverage grew without product-level tool design | Concrete output schemas, profiles, resources, composite workflows |

### 17.1 The pattern behind the failures

Nearly every defect crossed an abstraction boundary:

- schema versus native loader;
- metadata versus licensed runtime state;
- UI command versus modal lifecycle;
- musical intent versus file-format encoding;
- render success versus audio quality;
- artifact existence versus current provenance;
- server behavior versus MCP client interpretation.

That pattern suggests a general principle: integration systems need explicit contracts at every boundary, plus evidence generated on the far side of the boundary. Valid input is not evidence of valid output.

---

## 18. Testing and evidence strategy

The test strategy deliberately mixes cheap deterministic checks with progressively more expensive native and full-workflow evidence. No single test category is described as proving the whole system.

### 18.1 Current automated result

At the checkpoint documented by this article, a clean run of:

```bash
npm test
```

performed a strict TypeScript build and discovered 47 Node test cases:

```text
tests:     47
passed:    45
failed:     0
skipped:    2
```

The two skips are intentional environmental integrations:

1. isolated lead/harmony export through the original Editor, enabled with `VOCALOID_INTEGRATION_TEST=1`;
2. analysis of the user's earlier manually exported WAV fixture, skipped when that external file is unavailable.

The integration behavior represented by the first skip was exercised separately during the real IA_ROCKS closures. It is not run on every unit-test invocation because it launches licensed desktop software and serializes the host for multiple seconds.

### 18.2 Test pyramid

| Layer | Examples | What it proves | What it cannot prove |
| --- | --- | --- | --- |
| Pure musical/unit | chord parser, tempo expansion, mora alignment, phrase compilation, seeded groove | Deterministic transformations, bounds, stable IDs | Native editor behavior or audio quality |
| Manifest/property | revision conflicts, hash corruption, dangling removal, history restore, dry-run | Canonical integrity and transactional semantics | That a compiled song sounds correct |
| File/format | VSQ3/VSQ4 create/edit, XSD, WAV parser, PCM clipping count | Structural compatibility and measurable sample facts | Licensed singer availability |
| Renderer component | FluidSynth tracks, all typed effects, mastering, section A/B | Deterministic backend and audio-analysis contracts | Artistic authenticity of GM timbres |
| MCP protocol | tool listing, concrete schemas, resources, stdio execution | Public routing contract, annotations, serialized outputs | Whether a fresh agent chooses tools well |
| Native loader | Yamaha Vsq3 object traversal | The vendor loader accepts generated projects | That the editor can synthesize the selected singer |
| Editor integration | isolated vocal stem/export | Licensed application renders non-silent audio safely | Full-song dependency/currentness |
| Agent isolation | ephemeral Codex MCP-only evaluations | Discoverability and actual agent routing | Statistical quality across many prompts |
| Full closure | three style workflows through final WAV QC | End-to-end scale, provenance, resume, and delivery | Human artistic consensus or acoustic realism |

### 18.3 Notable automated regressions

The current suite explicitly covers:

- compact pattern expansion across 96 measures;
- multi-track pitched/drum accompaniment to verified stereo PCM;
- the installed Japanese GM palette including a bank variation;
- EBU loudness analysis and bounded mastering;
- section preview and loudness-matched A/B provenance;
- manifest-aware delivery and atomic artifact registration;
- host-wide editor lease acquisition and release;
- reproducible seeded swing/humanization;
- chord-symbol parsing for harmony guardrails;
- VSQX import into a stable-ID canonical manifest;
- manual-inventory Japanese G2P, kana normalization, explicit kanji reading, small-`っ` policy, rapid alignment, and melisma;
- music-aware history diff and monotonic restore;
- a compact, fully typed production MCP with workflow resources;
- real stdio listing and execution of the core workflow;
- mutation dry-run with zero canonical writes;
- revision stability, corruption detection, and dangling-reference rejection;
- backing/VSQX build with artifact provenance;
- preflight aggregation and stage separation;
- native 256-character comment boundaries;
- all typed effects, section automation, and separate `mix_hash` behavior;
- per-track instrument stems;
- tempo-curve expansion;
- gesture compilation into validated VSQX;
- score-versus-render pitch, consonant, release, and vibrato analysis;
- VSQ3 and VSQ4 create/edit/paginate/validate paths;
- acceptance of numeric Japanese flap phonemes;
- local IA metadata discovery;
- native corpus inspection;
- WAV silence, clipping, per-channel levels, and imbalance.

### 18.4 Synthetic audio has a narrow role

Synthetic fixtures are valuable when the expected answer is exact. For example, a generated tone can verify +100 cents of pitch offset or a 5 Hz vibrato; a full-scale PCM sample can verify clipping counters; known channel gains can verify stereo balance.

Synthetic tests cannot prove that IA pronounces a lyric intelligibly or that a chorus feels exciting. Those claims require original-editor output and listening. The project uses synthetic signals to calibrate measurement logic, not to simulate away the real renderer.

### 18.5 Independent verification after an agent report

Agent evaluations were checked from the root process rather than accepted from the agent's prose. Verification included manifest revisions and hashes, object/event counts, XSD diagnostics, WAV headers and channel metrics, editor lease/process cleanup, and final artifact digests.

This prevents a plausible narrative from becoming evidence by repetition.

### 18.6 Repository scale at this checkpoint

Approximate checked-in implementation/documentation line counts are:

| Area | Lines |
| --- | ---: |
| TypeScript source under `src/` | 16,801 |
| TypeScript tests under `tests/` | 4,423 |
| Native C helpers | 1,320 |
| Three-style workflow runner | 1,405 |
| Engineering notes under `notes/` | 1,998 |

Line count is not a quality metric, but it conveys why the final system should be understood as a production bridge rather than a short XML conversion script.

---

## 19. Chronological checkpoint history

All checkpoints below were created on 2026-07-18. The sequence is useful because it shows how each major feature followed concrete evidence from the prior stage.

| Time (+08:00) | Commit | Checkpoint | Main consequence |
| --- | --- | --- | --- |
| 15:31 | `0c64959` | `feat: bootstrap agent-driven VOCALOID3 MCP` | Initial 10-tool server, VSQX writer, native probes, editor export helper, 8-measure from-zero proof; 7,093 insertions. |
| 15:47 | `ce27169` | `feat: add structured songs and native accompaniment` | Multi-track/multi-part song model, tempo/meter maps, and native WAV audio parts. |
| 16:03 | `088c253` | `feat: render agent-composed instrumental backing` | FluidSynth/GM backend and multi-instrument/drum event model. |
| 16:29 | `45531e2` | `feat: add long-form rhythm and mastering workflows` | Phrase compiler, pattern placement, PCM/EBU analysis, two-pass mastering. |
| 17:01 | `7a239e4` | `feat: add agent-controlled stereo mixer revisions` | Native mixer inspection/update and per-channel balance checks after the left-pan failure. |
| 17:31 | `5549379` | `feat: add revisioned song manifest workflow` | Canonical stable-ID state, hashes, optimistic concurrency, and bounded mutations. |
| 17:44 | `d3e94c6` | `feat: render provenance-linked vocal and instrument stems` | Isolated stems and dependency-linked artifact records. |
| 17:57 | `efcf6dc` | `feat: analyze vocal score against rendered stems` | Pitch/timing/vibrato observations tied back to stable score events. |
| 18:11 | `95c281c` | `feat: add reproducible stem effects and section mixing` | Separate `mix_hash`, typed effects, automation, deterministic stem sum. |
| 19:02 | `30e698a` | `feat: add Japanese lyric and tuning workflow` | Manual-backed G2P, mora alignment, gestures, first isolated MCP-only creative evaluation. |
| 19:24 | `ebf1425` | `feat: bind eval workflow to IA ROCKS` | Correct voice intent and IA_ROCKS-specific evaluation artifacts. |
| 19:33 | `758abd7` | `feat: close IA ROCKS render and delivery loop` | Original-editor IA_ROCKS master/delivery evidence and hardened Pre-Send behavior. |
| 19:54 | `76cec42` | `docs: audit remaining Vocaloid MCP capabilities` | Evidence-based P0/P1/P2 audit; measured catalog/context problem and missing production gates. |
| 21:48 | `6a4974d` | `feat: add production composition and delivery workflows` | Preflight, lease, voice cache, review, history, import, delivery, harmony/groove, profiles/resources. |
| 21:52 | `6d0d677` | `fix: bind agent guidance to IA ROCKS component` | Replaced duplicated/wrong voice ID guidance with the exact canonical constant. |
| 22:12 | `2513cb7` | `feat: harden production MCP agent routing` | Exact from-zero resource, corrected annotation, successful compact-profile Codex evaluation. |
| 23:37 | `91545a0` | `feat: close three-style IA ROCKS delivery workflow` | Resumable wa-rock, J-Rock, and dream-pop production closures plus final artifact fixes. |

### 19.1 What the timeline reveals

The project did not begin with a complete architecture drawn in advance. It stabilized through successive feedback loops:

```text
native uncertainty
  -> loader evidence
  -> from-zero project
  -> editor audio
  -> longer-song defects
  -> canonical state
  -> stems and analysis
  -> production provenance
  -> agent routing audit
  -> full-style closure
```

That sequence is worth preserving because later abstractions—especially hashes, editor locking, output schemas, currentness gates, and per-track transactions—make much more sense when connected to the defect that demanded them.

### 19.2 The first tool surface versus the current one

The bootstrap server exposed ten direct tools:

```text
vocaloid_list_voices
vocaloid_inspect_project
vocaloid_validate_project
vocaloid_list_notes
vocaloid_list_control_points
vocaloid_create_project
vocaloid_update_note_expressions
vocaloid_render_wav
vocaloid_add_notes
vocaloid_add_control_points
```

That was the right surface for proving native project creation and repair. An agent could observe notes/curves, create or modify a VSQX, validate it, and ask the original editor for audio. It was not yet a song-production API: there were no semantic sections, canonical history, arrangement roles, stem identities, mix hashes, or delivery readiness.

The present profile architecture preserves those low-level operations in `full`/`legacy-vsqx` while routing normal work through canonical production tools. This avoids a false choice between API coverage and a usable workflow: maintainers retain diagnostic precision, while creative agents begin with task-level operations and load low-level context only when needed.

---

## 20. Repository map and reproducibility

### 20.1 Important paths

```text
vocaloid/
├── src/
│   ├── index.ts                 MCP server, profiles, resources, schemas
│   ├── song-manifest.ts         canonical model, hashing, mutations, artifacts
│   ├── song-preflight.ts        cross-domain issues and readiness gates
│   ├── vsqx.ts                  VSQ3/VSQ4 compiler and native project operations
│   ├── japanese.ts              manual-backed Japanese reading/phoneme logic
│   ├── vocal-phrase.ts          rhythm-cell and melisma compiler
│   ├── render.ts                editor render transaction
│   ├── editor-lease.ts          host-wide serialization
│   ├── voice-readiness.ts       active synthesis probe/cache
│   ├── accompaniment.ts         FluidSynth arrangement renderer
│   ├── stems.ts                 vocal/instrument stem workflows
│   ├── vocal-analysis.ts        score-versus-render measurements
│   ├── stem-mix.ts              alignment, effects, automation, summing
│   ├── audio-quality.ts         loudness, peak, clipping, mastering
│   ├── audio-review.ts          preview and loudness-matched A/B
│   ├── delivery.ts              manifest-aware master/delivery
│   ├── manifest-history.ts      list/diff/monotonic restore
│   ├── mutation-preview.ts      exact dry-run path
│   └── style-palettes.ts        on-demand style guidance
├── native/
│   ├── vsq_probe.c              Yamaha Vsq3 loader/object-tree probe
│   └── vocaloid_export.c        bounded original-editor export state machine
├── scripts/
│   ├── build-native.sh
│   ├── generate-style-evals.mjs resumable reference production runner
│   └── *.ps1                    Win32 discovery/launch/control helpers
├── tests/                       unit, integration, protocol regressions
├── notes/                       checkpoint-specific evidence and design notes
├── artifacts/evals/             manifests, builds, stems, mixes, analyses
├── artifacts/songs/             QC-passed final listening copies only
├── artifacts/vsqxs/             matching current-composition native projects
└── blogs/                        long-form technical retrospectives
```

The complete `artifacts/songs/` directory and most large evaluation media are intentionally ignored by Git: final listening WAVs are local-only and must not be published with the repository. The much smaller final native projects under `artifacts/vsqxs/` are intentionally trackable and publishable alongside source code, tests, and engineering notes. The externally supplied Hanairo lyric file remains deliberately untracked; its digest is captured in the manifest/report.

### 20.2 Build and test

The Node project requires Node.js 20 or newer. The pinned core dependencies are MCP SDK 1.29.0, `@xmldom/xmldom` 0.9.10, Zod 4.4.3, and TypeScript 5.9.3.

```bash
npm install
npm run build
npm test
```

Native Windows helpers are built through:

```bash
scripts/build-native.sh
```

The local draft accompaniment backend requires FluidSynth, a compatible SoundFont, and FFmpeg for the documented audio workflows. On the tested Debian/Ubuntu-style environment:

```bash
sudo apt-get install fluidsynth fluid-soundfont-gm ffmpeg
```

The project can accept a different readable SF2 path. The GM default is a reproducibility baseline, not a quality ceiling.

### 20.3 Start the MCP server

The server speaks JSON-RPC/MCP over standard input/output. Diagnostics go to standard error so they cannot corrupt protocol frames.

```bash
VOCALOID_MCP_PROFILE=production node dist/src/index.js
```

For low-level development:

```bash
VOCALOID_MCP_PROFILE=full node dist/src/index.js
```

For early-client compatibility:

```bash
VOCALOID_MCP_PROFILE=legacy-vsqx node dist/src/index.js
```

### 20.4 Load it into an isolated Codex CLI session

A one-off configuration can load the local server without editing global configuration:

```bash
codex exec --skip-git-repo-check \
  -c 'mcp_servers.vocaloid.command="node"' \
  -c 'mcp_servers.vocaloid.args=["/absolute/path/to/vocaloid/dist/src/index.js"]' \
  'Use only the Vocaloid MCP. Read its capabilities and from-zero example, then create and preflight a new canonical song.'
```

For a strict evaluation, additionally disable unrelated tools, filesystem access, shell access, and network access. That makes it possible to distinguish MCP usability from an agent reading implementation files behind the scenes.

### 20.5 Reproduce or resume the three style workflows

```bash
npm run build
npm run eval:styles -- --song=wa --through=delivery --resume
npm run eval:styles -- --song=rock --through=delivery --resume
npm run eval:styles -- --song=summer --through=delivery --resume
```

The runner also accepts:

```text
--song=all
--through=compose
--through=build
--through=mix
--through=delivery
```

Resume does not merely check whether a filename exists. It checks current composition/mix hashes, immutable artifact records, digests, and dependencies before deciding which bounded transaction remains.

### 20.6 Operational checklist before a long render

Before committing several minutes of editor time:

1. build TypeScript and run the fast test suite;
2. verify the original editor/helper fingerprints;
3. ensure no live editor lease or unrelated editor process exists;
4. run host readiness and cached IA_ROCKS probe;
5. preflight with score/build errors at zero;
6. verify output paths are versioned and within the workspace;
7. render lead and harmony as separate transactions;
8. inspect exact artifact hashes before mixing;
9. run independent final analysis after mastering;
10. publish only a hash-identical QC-passed final WAV to `artifacts/songs/` and its hash-verified current-composition VSQX to `artifacts/vsqxs/` under the same basename.

---

## 21. Safety, provenance, and operational boundaries

This project controls a desktop application, writes large media files, and can run for minutes. Safety is therefore part of its functional design rather than a paragraph added at release time.

### 21.1 Filesystem safety

Write operations are constrained to approved workspace paths. Output paths are normalized and validated before crossing into Windows. Existing outputs require explicit overwrite intent; canonical files receive timestamped backups; derived artifacts prefer new immutable, version-bearing names.

Every important write follows a temporary-sibling pattern:

```text
validate intent
    -> write/render temporary sibling
    -> verify complete content
    -> close the verified output
    -> atomic rename
```

This avoids publishing a half-written VSQX, manifest, WAV, or analysis as success.

### 21.2 Process ownership and serialization

The exporter only manipulates the process it launched for the request. Unknown editor windows are not treated as disposable. The host-wide lease prevents concurrent automation. Stale-lock recovery requires both age and a dead process owner, and lease release checks the unique lease ID.

Cancellation is bounded and observable. Cleanup attempts to unwind known modals safely; only when that is impossible does it terminate the helper-owned process. A failed call must leave neither a false artifact nor a dangling lock.

### 21.3 Fail closed at identity boundaries

The system refuses to guess across the most consequential identity boundaries:

- an unknown editor fingerprint requires explicit opt-in;
- a singer-substitution dialog is an error, not permission to use a default voice;
- a VVD file is metadata, not availability proof;
- an artifact filename is not enough without digest and source hashes;
- a stale mix is not delivery-ready merely because it is readable;
- a Pre-Send adjustment is not accepted unless explicitly allowed;
- a silent or malformed WAV is never reported as a render.

### 21.4 Licensing boundary

IDA and the native probes were used to understand the local installed application, validate generated files, and characterize legitimate render paths. The project does not bypass activation, patch DSE checks, redistribute proprietary binaries or voice databases, or claim that a direct engine wrapper replaces the licensed editor.

This is not only a legal/ethical boundary; it makes the production claim more trustworthy. The voice heard in the final WAV is rendered by the installed original editor under its actual registration state.

### 21.5 Provenance is computed, not asserted

Callers do not get to register an arbitrary path and hash as a trusted current master. The server computes digests, bytes, audio properties, source revisions, and dependency relationships after producing or reading the artifact. Manifest loading re-verifies canonical hashes. Delivery walks the dependency graph.

This design treats provenance as executable state, not descriptive metadata.

### 21.6 No hidden “helpful” audio changes

The mix engine does not silently normalize, center, limit, or add makeup gain. The masterer writes a new output rather than modifying the source. Corrective true-peak gain is recorded. Score-versus-render estimates are observations rather than automatic timing/pitch edits.

An agent should be able to explain why the final audio differs from the stems by reading the manifest and render result.

### 21.7 Local source control discipline

Generated audio is kept out of ordinary source commits. The Git history records code, evidence checkpoints, and the compact final VSQX projects; those VSQX files may be published with the repository. Final WAVs under `artifacts/songs/` remain strictly local delivery artifacts and are ignored as a whole directory. User-supplied untracked lyric and planning files are left untouched. A remote push remains a separate explicit decision, not a side effect of building or documenting the project.

---

## 22. What is proven, what is not, and what should come next

### 22.1 Capabilities with concrete evidence

| Capability | Evidence at this checkpoint |
| --- | --- |
| Generate native projects from zero | Independent eight-measure/41-note VSQX and MCP-only four-measure manifest, no source project input |
| V3/V4 structure | Automated create/edit/validate tests for both formats; native V3 loader fixtures |
| Original IA_ROCKS synthesis | Active probe plus multiple editor-rendered stems/masters/final songs |
| Long-form structure | 96-measure stress test and 146-measure final wa-rock song |
| Multiple vocal roles | Lead/harmony projects, isolated stems, and three final two-role songs |
| Tempo and meter arcs | 4/4, 6/8, 2/4 transitions and multi-point tempo maps in final deliveries |
| Rapid Japanese lyrics and melisma | Manual-backed mora alignment, native `-` continuation, intentional density warnings |
| Inspectable vocal tuning | Note expression, vibrato envelopes, six high-level gesture families, native curves |
| Multi-instrument arrangement | FluidSynth/GM roles, drums, patterns, placements, seeded groove/humanization |
| Reproducible stems and mix | Composition/mix hashes, isolated artifacts, timeline alignment, ordered effects/automation |
| Objective audio QC | LUFS, LRA, true/sample peak, clipping, per-channel levels, balance, crest factor |
| Manifest-aware master/delivery | Current dependency graph, atomic registration, independent re-analysis, final hashes |
| Agent usability | 20-tool typed production surface, nine resources, two isolated Codex evaluations |
| Failure recovery | Editor lease cleanup, false-artifact prevention, per-track vocal resume after real failure |
| Bounded revision | Stable IDs, expected revisions, dry-run, history/diff, monotonic restore |

### 22.2 Boundaries that remain

#### Instrument sound quality

The largest audible limitation is the FluidR3 GM accompaniment backend. It proves arrangement, timing, orchestration roles, stereo routing, and renderer replaceability. It does not prove release-grade guitars, pads, drums, shamisen, koto, shakuhachi, or taiko articulations.

A high-quality next step is a licensed VST/DAW or sample-library renderer that consumes the same canonical positions and emits one artifact per stable track. It should add explicit articulation/keyswitch mapping rather than hiding instrument-specific behavior behind generic program numbers.

#### Import coverage

Canonical VSQX import exists. Canonical MIDI/SMF import does not. The model also lacks full MIDI CC, sustain pedal, aftertouch, keyswitch/articulation events, audio loops, and per-track renderer routing.

#### Mix topology and diagnostics

The mix engine has deterministic insert effects, section gain automation, and a mix bus. It does not yet have:

- masking or spectral-collision diagnostics;
- phase/mono compatibility analysis;
- sidechain ducking;
- subgroup and send-bus graphs;
- effect-parameter automation;
- general external-plugin latency compensation.

#### Linguistic intelligence

Requiring explicit kana for kanji is safe and auditable, but creates authoring friction. A future morphological analyzer/lexicon could provide ranked reading candidates with source evidence. It should not silently collapse ambiguous readings into one opaque answer.

#### Voice coverage

Only IA_ROCKS has complete production evidence in this checkpoint. Other installed metadata should be probed and evaluated independently. Voice-specific ranges, phoneme quirks, dynamics, and expression defaults should become explicit profiles rather than assumed portability.

#### Perceptual and artistic judgment

Numeric analysis can observe pitch, timing, energy, vibrato, loudness, peak, clipping, and balance. It cannot prove:

- lyric intelligibility;
- emotional delivery;
- whether a hook is memorable;
- whether a harmony is aesthetically appropriate;
- acoustic authenticity;
- whether the mix feels exciting or fatiguing;
- overall artistic quality.

Structured listening notes are the current bridge. Learned or reference-audio analyzers could assist later, but they should preserve uncertainty and never be advertised as objective taste.

#### Agent benchmarking

Two isolated sessions and three reference workflows prove feasibility, not a distribution. A useful next benchmark would run multiple fresh prompts and report:

- percentage reaching each readiness gate;
- invalid-call count before the first successful mutation;
- tool/catalog/context tokens consumed;
- dry-run-to-apply ratio;
- number of stale-revision recoveries;
- wall-clock and editor time;
- human-rated musical outcome under blinded listening.

This would separate MCP usability from the composition ability of any one model or prompt.

#### Remote/multi-user deployment

The current stdio bridge is intentionally local and single-host. A remote system would require authenticated transport, per-user storage isolation, job queues, editor-host scheduling, authorization around proprietary voices, cancellation ownership, and secure artifact delivery. Exposing the current local helper directly over a network would be the wrong abstraction.

### 22.3 A practical next-step order

The most valuable future sequence is:

1. integrate one high-quality licensed accompaniment renderer with per-track stable-ID provenance;
2. build a repeated multi-prompt agent-routing benchmark and improve schemas/examples based on measured failures;
3. add canonical MIDI/SMF import plus CC/sustain/articulation representation;
4. add masking, phase/mono, subgroup/send, and sidechain capabilities to the deterministic mix graph;
5. add evidence-bearing Japanese reading candidates;
6. probe and profile additional legitimately installed voices;
7. expand human listening workflows and reference-audio comparisons.

Direct DSE activation work is not a priority. The original editor already provides a legitimate, verified synthesis boundary, while accompaniment quality and agent evaluation offer much greater user-visible value.

---

## 23. Engineering lessons that generalize beyond VOCALOID

### 23.1 Define the user's terminal artifact first

If the target had been “a MIDI file,” the architecture could have stopped after one afternoon. Defining the target as a complete, listenable, revisable, verified song exposed all the missing layers early enough to build them deliberately.

### 23.2 Use the vendor's loader as an oracle when schemas are incomplete

An XSD validates document grammar, not every behavior of a legacy application. A small native probe can provide a powerful second line of evidence without turning reverse engineering into a replacement implementation.

### 23.3 Move to the highest legitimate stable boundary

The direct DSE path was technically interesting but depended on undocumented registration state. The original editor was a more truthful production boundary. Good systems engineering includes knowing when not to keep digging downward.

### 23.4 UI automation is a protocol state machine

Menu IDs and button clicks are the easy part. Ownership, asynchronous control creation, modal sequencing, cancellation, cleanup, timeouts, output stability, and unknown dialogs define whether automation is safe.

### 23.5 Separate creative intent from derived formats

The canonical manifest makes VSQX, stems, mixes, and masters reproducible. It also gives the agent a stable semantic model that survives renderer changes. This pattern applies to CAD, video editing, DAWs, and other creative tools with opaque output formats.

### 23.6 One hash rarely answers every staleness question

Composition and mix change at different costs. Separate hashes let the system reuse expensive stems after an EQ revision while invalidating everything after a melody change. Hash boundaries should reflect the economics and dependency graph of the workflow.

### 23.7 Stable IDs beat array indexes in long agent sessions

Agents edit semantically: “this chorus phrase,” “that harmony entrance,” “the current vocal stem.” Stable identities make those references durable and make diffs/reviews meaningful.

### 23.8 Dry-run should execute the exact write path

A second validation implementation will drift. Copying canonical state, performing the real mutation, and returning its diff/preflight gives the agent an honest preview.

### 23.9 Tool quantity is not agent capability

The 37-tool catalog technically exposed more operations but consumed too much context and forced unnecessary routing decisions. Profiles, resources, typed outputs, and workflow tools converted implementation coverage into usable capability.

### 23.10 Protocol metadata is executable behavior

The wrong `destructiveHint` caused a correct agent to refuse a safe preview. A missing output-schema field converted a successful master into a protocol error. Descriptions, annotations, and result schemas are part of the runtime, not merely documentation.

### 23.11 Warnings should guide taste, not replace it

Rapid lyrics and dissonance may be defects or intentional style. The right guardrail points to the exact risk and lets the agent/human decide, while hard errors remain reserved for states that cannot produce a truthful artifact.

### 23.12 Test recovery, not only the happy path

The summer harmony failure improved the transaction model more than another clean render would have. A production closure should deliberately verify locks, partial outputs, resume decisions, stale artifacts, and repeated calls.

### 23.13 Measure on the far side of every expensive boundary

After XML generation, load it natively. After editor synthesis, parse the WAV. After mixing, analyze channels and peaks. After mastering, remeasure true peak. After an agent reports success, independently inspect hashes and processes.

### 23.14 Preserve uncertainty in the API

“Voice metadata found” is not “voice available.” “Density warning” is not “bad lyric.” “Pitch estimate” is not “wrong note.” “GM shamisen role” is not “authentic shamisen.” Precise names prevent downstream agents from turning partial evidence into false certainty.

---

## 24. Appendix: production tools and resources

### 24.1 The 20-tool production profile

| Tool | Purpose |
| --- | --- |
| `vocaloid_host_readiness` | Read editor/helper fingerprints, editor lease, and cached verified voices without launching the editor. |
| `vocaloid_probe_voice` | Perform or reuse a bounded original-editor `ら` render to prove one exact component is synthesizable. |
| `vocaloid_align_japanese_phrase` | Convert explicit Japanese reading plus rhythm slots into stable mora/phoneme events, including rapid and melismatic modes. |
| `vocaloid_create_song_manifest` | Create the revision-1 canonical timeline, form, harmony, and renderer skeleton. |
| `vocaloid_import_vsqx_manifest` | Convert an existing V3/V4 vocal score into a new stable-ID canonical manifest with source provenance and explicit warnings. |
| `vocaloid_edit_song` | Dry-run or apply bounded timeline, section, vocal, tuning, arrangement, groove, mix, transform, and removal operations. |
| `vocaloid_inspect_song_manifest` | Verify canonical hashes and summarize current revision, domains, inventories, and artifacts. |
| `vocaloid_preflight_song` | Aggregate structural, performance, voice, artifact, mix, and delivery issues into stage-specific readiness. |
| `vocaloid_get_song_section` | Read one semantic section plus only intersecting vocal, harmony, and arrangement material. |
| `vocaloid_build_song_manifest` | Render verified backing and compile validated VSQX from one immutable composition revision, then record both artifacts. |
| `vocaloid_render_instrument_stems` | Render selected arrangement tracks separately with explicit pan and renderer-FX policy. |
| `vocaloid_render_vocal_stems` | Render selected vocal tracks through the original editor with other vocals muted and backing removed. |
| `vocaloid_analyze_vocal_stem` | Compare isolated vocal audio with stable score events and store pitch/timing/vibrato analysis. |
| `vocaloid_render_stem_mix` | Align hash-verified stems, apply ordered effects/section automation, sum without hidden normalization, and analyze the result. |
| `vocaloid_render_manifest_master` | Render a current hash-verified VSQX through the original editor and record/analyze a manifest master artifact. |
| `vocaloid_master_manifest_delivery` | Master a current manifest mix to bounded targets, verify it independently, and register delivery provenance. |
| `vocaloid_review_audio` | Create section previews or loudness-matched A/B artifacts with source/section provenance. |
| `vocaloid_review_song` | List, add, or resolve qualitative listening notes bound to sections, positions, objects, and artifacts. |
| `vocaloid_manifest_history` | List verified history, calculate music-aware diffs, or restore a prior state as a new monotonic revision. |
| `vocaloid_analyze_wav` | Read-only PCM and EBU R128 analysis for loudness, peaks, clipping, crest, per-channel levels, and balance. |

The `full` profile exposes 49 tools, including lower-level VSQX creation/editing, project inspection, individual note/control operations, raw WAV mastering, Japanese G2P, mixer access, granular manifest upserts, and diagnostics. The `legacy-vsqx` profile exposes 16 early low-level tools for older clients.

### 24.2 The nine on-demand resources

| URI | Content |
| --- | --- |
| `vocaloid://capabilities` | Profile guidance, canonical workflow, constraints, verified voice/component, and honest renderer boundaries. |
| `vocaloid://examples/from-zero` | Exact valid call shapes for a fresh canonical song, vocal phrase, arrangement, preflight, and build path. |
| `vocaloid://styles` | Index of available style palettes. |
| `vocaloid://styles/wa-rock-hanairo` | Wa-rock form, tempo/meter, vocal, harmony, instrumentation, and mix guidance for Hanairo. |
| `vocaloid://styles/ia-j-rock` | Driving IA J-Rock palette. |
| `vocaloid://styles/summer-night-air` | Airy summer-night/dream-pop palette. |
| `vocaloid://styles/piano-ballad` | Piano-ballad palette. |
| `vocaloid://styles/electro-speed` | Fast electro palette. |
| `vocaloid://lyrics/hanairo-biyori` | Supplied-lyric provenance and workflow guidance without pretending derived pronunciation is original text. |

### 24.3 Artifact role and currentness vocabulary

| Term | Meaning |
| --- | --- |
| Canonical manifest | The revisioned creative/production truth; not itself an audio delivery. |
| Composition artifact | Derived from `composition_hash`, such as backing, VSQX, or raw stems. |
| Mix artifact | Derived from current composition plus `mix_hash`. |
| Delivery artifact | Mastered/QC-checked output whose dependencies recursively match current state. |
| Historical artifact | Verified, preserved output from an older composition or mix; useful for comparison but not readiness. |
| Current composition | Artifact source composition hash equals the manifest's current composition hash. |
| Current mix | Artifact source mix hash equals the current mix hash and its dependencies remain current. |
| Readiness | A stage-specific statement that required state and evidence exist now; not a claim of artistic excellence. |

### 24.4 Audio metric interpretation

| Metric | What the system uses it for | Important limitation |
| --- | --- | --- |
| Integrated LUFS | Program loudness target and A/B matching | Does not describe moment-to-moment impact by itself |
| LRA | Long-term dynamic-range policy | A style choice, not universally “lower is better” |
| True peak (dBTP) | Intersample peak ceiling | Must be remeasured after processing |
| Sample peak/full-scale count | Detect exact PCM clipping | Zero clipped samples does not prove unclipped upstream processing |
| Per-channel RMS/peak | Routing and balance evidence | Intentional asymmetry can be artistically correct |
| Crest factor | Peak-to-average context | Cannot identify the cause of excessive compression alone |
| F0/cents | Score/render pitch observation | Unreliable for very short/unvoiced regions; not intelligibility |
| Onset/consonant lead | Timing review | Energy onset is not automatically a score offset |
| Vibrato depth/rate/regularity | Compare rendered expression with intent | Does not measure whether vibrato is tasteful |

### 24.5 Source notes behind this retrospective

Detailed checkpoint evidence remains available in the repository:

- [`notes/synthesis-reverse-engineering.md`](../notes/synthesis-reverse-engineering.md) — native DLL, Vsq3 loader, DSE investigation, and editor automation;
- [`notes/long-form-workflows.md`](https://github.com/N0zoM1z0/vocaloid-mcp/blob/b40a673/notes/long-form-workflows.md) — rapid lyrics, melisma, patterns, and long-song examples;
- [`notes/song-manifest-design.md`](../notes/song-manifest-design.md) — canonical state and concurrency contract;
- [`notes/song-manifest-workflows.md`](../notes/song-manifest-workflows.md) — bounded agent mutation examples;
- [`notes/stem-mix-workflow.md`](../notes/stem-mix-workflow.md) — alignment, effect order, and mix hashing;
- [`notes/score-render-analysis.md`](../notes/score-render-analysis.md) — vocal measurement method and limitations;
- [`notes/japanese-lyrics-and-gestures.md`](../notes/japanese-lyrics-and-gestures.md) — phoneme evidence, mora timing, and gesture compilation;
- [`notes/codex-mcp-v1-eval.md`](https://github.com/N0zoM1z0/vocaloid-mcp/blob/b40a673/notes/codex-mcp-v1-eval.md) — isolated creative Codex evaluation;
- [`notes/production-profile-eval-2026-07-18.md`](https://github.com/N0zoM1z0/vocaloid-mcp/blob/b40a673/notes/production-profile-eval-2026-07-18.md) — compact-profile routing evaluation;
- [`notes/capability-audit-2026-07-18.md`](https://github.com/N0zoM1z0/vocaloid-mcp/blob/b40a673/notes/capability-audit-2026-07-18.md) — evidence-driven gap audit;
- [`notes/style-eval-closure-2026-07-18.md`](https://github.com/N0zoM1z0/vocaloid-mcp/blob/b40a673/notes/style-eval-closure-2026-07-18.md) — exact final-song hashes, QC metrics, and resume defects.

---

## Conclusion

The project now does what the original idea actually demanded: it gives an agent a practical path from an empty timeline to a complete, native, rendered, mixed, mastered, and verified VOCALOID song, delivered as both a final listening WAV and the matching current-composition VSQX project.

The most important result is not any single tool or WAV. It is the closed evidence loop:

```text
creative intent
  -> canonical revision
  -> native score and rendered stems
  -> measurable audio
  -> bounded listening/revision
  -> current dependency graph
  -> final delivery
```

That loop survived real failures: a mistaken phoneme diagnosis, a UI cleanup crash, a licensing boundary, clipping, accidental hard-left pan, missed LRA, global curve ordering, agent annotation friction, native comment limits, stale mix provenance, strict output-schema mismatch, true-peak overshoot, and a failed long harmony export. Each failure made the public contract more truthful.

There is still meaningful work ahead. FluidR3 GM is not a release-grade band or authentic Japanese ensemble. Only IA_ROCKS has complete voice evidence. Numeric analysis cannot decide whether a lyric moves a listener. MIDI import, advanced articulations, sidechain/bus topology, spectral diagnostics, broader voice profiles, and statistical agent benchmarks remain open.

But the boundary has shifted decisively. This is no longer a note generator, a MIDI converter, or a VSQX demo. It is an agent-facing production instrument with native synthesis, durable creative state, reproducible audio operations, recovery semantics, and honest final checks—the foundation needed for agents and people to make complete Vocaloid music together.
