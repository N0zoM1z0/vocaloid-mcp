# From a Blank Timeline to a Finished VOCALOID Song

*Engineering an agent-native VOCALOID3 MCP server for composition, tuning, rendering, mixing, mastering, and verified delivery.*

The idea sounded small: put VOCALOID behind an MCP server so a coding agent could help make a Vocaloid song. The word that made it big was *song*.

A satisfying result couldn't stop at a MIDI file, a few notes, a converted project, or the Editor pronouncing isolated syllables. The goal was closer to this: give an agent a brief, some lyrics, or an empty timeline. Let it decide form, melody, harmony, rhythm, phonemes, vocal expression, accompaniment, tempo and meter changes, and mix intent. Then let the same agent build a native VOCALOID project, render the licensed voice through the original Editor, assemble stems, master the result, listen analytically, revise a bounded section, and deliver a verified stereo WAV with provenance.

That requirement turned "write some XML" into a small production system. This article walks through how it was built, in roughly the order the problems showed up. It covers the dead ends and crashes along with what worked, and it ends with a frank account of what the system has and hasn't proven. It is not a claim that software has solved musical taste. It's a report on building an instrument through which an agent can exercise musical judgment, and on making that instrument honest about its own evidence.

The [follow-up article](from-can-it-sing-to-what-should-ia-sing.md) covers what happened once the engineering worked and the question became what the songs should say.

## Why not just generate MIDI?

Most "AI music" integrations stop at MIDI, and for good reason: notes are easy to create, validate, and route. But a Vocaloid performance carries information MIDI doesn't represent. There are lyrics and language-specific phonemes, and the binding to a specific voicebank. Velocity means consonant timing rather than loudness. Each note has accent, decay, mouth opening, bend depth and length, and portamento flags, plus a vibrato type and a depth/rate envelope. Continuous DYN, BRE, BRI, CLE, GEN, POR, PIT, and PBS curves run alongside. And there are musical parts, pre-measures, mixer state, and singer events.

An agent that only writes MIDI can suggest a melody; it can't claim to have made the vocal performance. And a system that writes VSQX but never opens it in the Editor has only proven that its own XML parser is happy.

So the definition of done was strict. An agent must be able to start without an input project, keep its musical and production intent in an inspectable canonical model, compile native artifacts, render the selected voice through the original Editor, render accompaniment, produce and mix isolated stems, master to explicit targets, run independent delivery checks, and keep enough provenance to reproduce or revise the result.

That definition shaped every decision that followed. VSQX became a derived format rather than the database. Audio analysis became part of the workflow, not an afterthought. Tool design had to optimize for context cost, retry cost, and mutation safety, not just coverage. A long song had to survive dozens of calls without the agent resending thousands of events each time.

The agent stays responsible for the art: form and section energy, contour and tessitura, harmony and tension, where fast syllabic writing is intentional, where a breath, melisma, harmony entrance, or tempo change belongs, stereo placement, and whether a warning describes a mistake or a deliberate choice. The server supplies affordances and guardrails. There is no `make_song` button, and nothing silently "corrects" an unusual passage into blandness.

"From zero" mattered too. It would have been easy to start from a known-good VSQX, replace its notes, and call it generation. We didn't. The first independent proof created an eight-measure project with 41 original notes and 62 control points without reading any existing song, and Yamaha's own loader enumerated 351 native objects from it. Existing projects were used only as format oracles, never as hidden templates.

## The shape of the system

VOCALOID3 and its libraries are 32-bit Windows software. The server is TypeScript on Node.js inside WSL. Every validation or render crosses an OS and architecture boundary:

```text
MCP client (the agent)
        │  JSON-RPC over stdio
        ▼
Node.js TypeScript MCP server (WSL)
        │  validated Windows paths, bounded subprocess protocol
        ▼
32-bit native Windows helpers
        ├── Yamaha Vsq3.dll loader probe
        └── original VOCALOID3 Editor (UI automation, licensed synthesis)
```

Pretending the Editor was an ordinary service would have hidden the hardest reliability problems rather than solved them. The server speaks MCP over stdio on purpose: it's a local, single-user bridge, and it never exposes a legacy desktop app or filesystem paths to a network.

The finished system has five planes:

```text
            CREATIVE / CONTROL: brief, lyrics, revisions, listening notes
                                     │
                    22-tool MCP surface, resources, typed results
                                     │
                              canonical *.song.json
         timeline · form · harmony · vocals · arrangement · mix · review
                    ┌────────────────┴────────────────┐
             NATIVE VOCAL                       INSTRUMENTS
         VSQ3/VSQ4 compiler                patterns + placements
         XSD + native loader               FluidSynth + SoundFont
         VOCALOID3 Editor stems            per-track stems
                    └────────────────┬────────────────┘
                    AUDIO: alignment → effects → automation → sum → master
                                     │
                    EVIDENCE: hashes · dependencies · history · reviews · QC
```

The manifest sits in the middle because VSQX is a good file to hand to the Editor and a poor source of truth. It has no natural home for renderer choices, effect chains, artifact hashes, review notes, dependencies, or edit history.

## Reading the binaries before writing them

The first question wasn't how to automate the UI. It was: what is the narrowest legitimate native path that keeps all the VOCALOID-specific performance data?

Three sources of truth were available locally, and each catches a different kind of mistake. The Editor manual explains semantics such as the Japanese phoneme set and note properties. The bundled VSQ3/VSQ4 XML schemas check structure and bounds. And the Editor's own projects and native loader expose requirements the schemas can't express.

The reverse engineering was read-only and pinned to exact binary hashes (`DSCL3.dll`, `DSE3.dll`, and `Vsq3.dll`, all PE32). Addresses inside a proprietary DLL are not an API, and the helpers resolve decorated exports by name at runtime.

The first useful bridge was a validator, not a synthesizer. `native/vsq_probe.c` loads a project through Yamaha's `Vsq3.dll`, initializes its manager interface, calls the file loader, and walks the resulting object tree. Getting there meant understanding a Visual C++ 2008 ABI: a manager that wraps an implementation object, an initialization policy containing a VC9 `std::wstring`, objects that expose a generic interface at an offset, and child enumeration through a VC9 pointer-vector layout. The probe was checked against a real-world V4 project (20,402 objects, six tracks) and the first MCP smoke project (83 objects). That gave a far stronger compatibility signal than XML validation alone.

It also corrected us. An early load failure was blamed on the phoneme string `4 a`, which looked plausible if `4` were a count or a typo. The manual and the bundled `KanaNote.lua` say otherwise: `4` is the official Japanese flap, used for sounds like ら. The real problems were elsewhere. Phoneme elements needed raw symbols, every note needed the standard style attributes including the vibrato fields, and string fields needed Editor-compatible CDATA. Once those were fixed, a generated project containing `4 a` loaded as 77 native objects, and the incorrect rejection was replaced by a regression test. That became a project rule: a validator reports what it observes, not what we expect to be valid.

### The synthesis path we didn't take

IDA showed a plausible way to skip the Editor entirely:

```text
VSQX → musical part + time map
     → CxDaisyMidiFile::EncodeMusicalPart → Daisy event buffer
     → CRtSynthesis::OpenSynthesizer → DSE3, 256-sample frames → WAV
```

Several contracts were recovered for the pinned build: `OpenSynthesizer` expects API version `20008017.0`, engine negotiation uses token `20012012.0`, rendering proceeds in 256-sample frames, and the event encoding keeps phonemes, singer selection, pitch, dynamics, and vibrato rather than flattening them to MIDI.

The probe reached every step before synthesis: it loaded the project, chose a part, built the time map, encoded the events, loaded both DLLs, and resolved the exports. Then this:

```text
DSESetDBMPath result=-100
DoSynthesis failed
```

Decompiling further showed that the "path" argument was really a registry key pattern, and that the engine checks 32-bit registry state for voicebank installation and activation. That is where licensing lives. So we stopped treating direct synthesis as the production path. The project doesn't patch activation checks or emulate undocumented voice tables. The original Editor already has the legitimate context to render an installed voice, so the automation moved up to that boundary.

The dead end still paid for itself. It produced a vendor-loader compatibility test, accurate binary fingerprints, confirmation that synthesis consumes VOCALOID-specific data, and a clear understanding of where registration state enters. Most of all, it gave a reason for choosing Editor automation other than convenience. A well-documented abandoned path keeps the next person from repeating an unsafe experiment.

## Writing native VSQX from zero

The writer uses VOCALOID's resolution of 480 ticks per quarter note. Song positions are zero-based `measure, beat, tick` coordinates, converted through the tempo and meter maps, and kept distinct from part-relative ticks. Mixing those two coordinate spaces is the easiest way to shift a whole part by a pre-measure.

It supports VSQ3 and VSQ4, up to 16 vocal tracks, multiple named parts per track, tempo and meter changes, mixer state, mono or stereo WAV audio parts, full note content (lyric, locked phonemes, velocity, accent, decay, opening, bends, portamento flags, vibrato type, length, and depth/rate envelopes), and all eight master curves. Ranges are enforced before a project ever reaches the Editor: PIT is −8192 to 8191, PBS is 0 to 24 semitones, and the rest are 0 to 127.

Validation is a stack, not a boolean:

1. Zod schemas reject malformed tool input.
2. Semantic checks cover ranges, ordering, overlaps, part boundaries, and references.
3. The file is written to a temporary sibling path.
4. `xmllint` validates it against the bundled XSD.
5. Selected fixtures are loaded by the native `Vsq3.dll` probe.
6. Editor integration confirms the project loads and synthesizes.
7. Only then is the file atomically renamed into place.

No single layer stands in for the others.

The first agent proof came from a Codex CLI session restricted to the MCP, with no shell and no raw XML. From an abstract brief it built an eight-measure IA_ROCKS project at 132 BPM with 41 notes, locked Japanese phonemes, 34 DYN, 6 PBS, and 22 PIT points, expressive note styles, and three vibratos with editable envelopes. It validated cleanly, and the native loader enumerated 351 objects. It wasn't a song yet (no accompaniment, mix, or history), but it settled the most important distinction: generation, not template mutation.

## Driving a desktop application safely

Manual export showed that generated projects could sing. The next job was to make export bounded, observable, and safe enough to run unattended.

Menu enumeration found **File → Export → Wave…** at command ID 33299. Export is a two-dialog transaction: VOCALOID's *Export Wave File* options dialog, then Windows' *Export to Wave File* save dialog. Neither dialog's controls exist the instant the window appears; common-dialog children are created asynchronously, especially on a hidden desktop.

The first prototype got that wrong. It enumerated the save dialog before the filename box existed, then tried to exit the disabled main window while the modal was still open, and VOCALOID crashed with an access violation during teardown. That wasn't a synthesis bug or a malformed project. It was a state-machine bug. The rebuilt helper:
- waits, within a deadline, for the exact controls it needs;
- recognizes each dialog by title, structure, and owning process;
- cancels known modals before touching the main window, and waits for it to be enabled before sending Exit;
- never sends a blind close into an unknown UI state, and if a modal can't be unwound, terminates only the process it launched.

After submitting, it waits for the output file to stay stable across four 250 ms observations.

Two more failure modes became explicit errors. When the requested singer is unavailable, VOCALOID offers to substitute a default one, and clicking through would produce valid-looking audio with false provenance, so the helper matches that dialog and fails with `singer_unavailable`. And when a project triggers the Editor's *Event Verification* adjustment, the helper refuses by default rather than letting the Editor silently rewrite what is supposed to be the canonical score.

A render is a transaction:
1. Validate the source project.
2. Fingerprint the Editor and helper binaries. Version 3.2.1.1 is allow-listed; unknown builds need an explicit opt-in.
3. Take a host-wide lease. The lease file records a lease ID, process ID, request ID, and time, and it is reclaimed only when it is both old and its owner is dead.
4. Render to a temporary path while reporting progress and honoring cancellation.
5. Parse the RIFF/WAVE structure, and reject silence or impossible sample counts.
6. Atomically commit the file, release the lease, and clean up the owned process.

A failed render never leaves a file at the requested path.

The first hardened exports ran clean: a Japanese `4 a` smoke test (10 s of audio from a 13.7 s helper run) and an agent-written sketch called `雨のあとで` (16.4 s of audio, −7.9 dBFS peak), with no residual processes. At that point there was a real minimal loop: an agent could create a native project, and the original Editor could sing it.

The Editor keeps finding new ways to block an unattended export. Months later, a probe that had worked for weeks started failing within seconds. The Editor's saved audio output device was a pair of headphones that was no longer plugged in, and at launch it raised a modal ("Cannot find the selected audio output device") followed by its Preferences window, on a desktop nobody could see. The helper can't read that dialog's text across processes, so it now names the likely cause and the fix whenever it sees those window titles. The general lesson holds: a renderer's contract includes every dialog it can raise.

## From snippets to songs

A working vocal renderer is necessary but not sufficient. A song needs form, simultaneous vocal roles, accompaniment, tempo and meter structure, and enough length to expose problems a ten-second test never shows.

The structured song model added multiple vocal tracks with their own mixer settings, multiple named parts per track, global tempo and meter maps, and WAV audio parts placed with pre-measures in mind. Audio parts are references, not embedded assets. The server checks that each one is 16-bit PCM at 44.1, 48, or 96 kHz, mono or stereo, derives its play time from the audio rather than trusting the caller, and converts the WSL path into one the Windows Editor can read. Moving the WAV later breaks the reference; that's documented rather than hidden.

Accompaniment uses FluidSynth with a General MIDI SoundFont as a deterministic first backend. The arrangement model is not a user-supplied MIDI file. It holds typed pitched notes, drum hits, tempo and meter events, mixer choices, and reusable patterns with placements. The renderer converts these to a temporary MIDI file only to drive FluidSynth, validates the 16-bit stereo output, and deletes the MIDI. The canonical song keeps higher-level identities, so a future VST or DAW renderer can replace FluidSynth without changing song positions or IDs. The GM SoundFont is explicitly a *draft* timbre source: labeling GM program 106 "shamisen" doesn't make it an idiomatic shamisen.

The first song-scale experiment had a two-bar intro, six-bar verse, two-bar pre-chorus, and six-bar chorus, a tempo lift from 128 to 132 BPM, 176 pitched notes, 127 drum hits, 56 lead notes, and 12 harmony notes. It rendered: 40.3 seconds of lead, harmony, and backing, created without any existing project. It also measured −9.0 LUFS integrated, +0.3 dBTP true peak, and 9,844 full-scale samples. That isn't a master; it's clipped audio. "A WAV exists" was clearly not completion, and the project gained an audio-quality plane.

## Long songs, fast lyrics, and mastering

The next requirements came straight from listening: longer songs, richer arrangements, changing grooves, rapid Vocaloid-style lyrics, melisma, intentional stereo, and filenames that identify the song.

At the file level every note still has one lyric/phoneme pair, but an agent shouldn't hand-map every mora to every note. Phrases are written as rhythm cells, using 1/16, 1/32, and 1/64 values, dots, N-in-M tuplets, rests, gate percentages, and per-cell pitch, velocity, style, and vibrato. In `sequential` mode, morae flow across voiced cells, which is how rapid syllabic lines are written. In `explicit` mode, repeating a lyric index produces native continuation notes (`lyric="-"`, `phonemes="-"`), which is how one syllable stretches over several pitches. The abstraction makes intent easier to express without inventing anything non-native.

Long accompaniment can't require thousands of repeated events. Patterns are written once and placed many times, with section, repeat count, transposition, and velocity scaling. One reference case expands eight source events and two placements into a 96-measure arrangement of 192 shamisen notes and 384 drum hits, deterministically.

Audio analysis combines direct PCM inspection with FFmpeg's EBU R128 measurements. It reports duration, format, sample peak and RMS, crest factor, integrated loudness, loudness range, true peak, the exact count of full-scale samples, per-channel levels, and left/right balance. Mastering writes a new file using two-pass loudness normalization and then measures the result again instead of trusting the filter. It also states the obvious limitation: normalization can't restore transients that clipping already destroyed. The clipped 16-measure song came back at −13.8 LUFS, −1.0 dBTP, and zero full-scale samples. Later, FFmpeg's `loudnorm` was caught occasionally landing slightly above the requested true-peak ceiling, so the masterer now applies a recorded corrective gain, re-measures, and fails if the result is still more than 0.05 dB over.

The 96-measure stress test, `月影疾走`, was the first long piece: 172 seconds, ten tempo events from 96 to 156 BPM, a 4/4 → 6/8 → 4/4 arc, nine instrument roles, 81 pattern placements, nearly 4,000 accompaniment events, and about 400 vocal notes. Its first mix leaned hard left, with a 17.2 dB difference between channels. The agent had assumed pan 0 meant center, as it does in many signed-pan APIs. VOCALOID's mixer is `0 = hard left`, `64 = center`, `127 = hard right`. That one assumption produced audibly wrong output. The native scale is now spelled out in schemas and descriptions, and per-channel analysis runs after every render. With lead at 64 and harmony at 96, raw balance dropped to 0.58 dB, and the master measured −14.2 LUFS, −1.0 dBTP, and zero clipped samples. Its loudness range came in at 12.6 LU against a 9 LU target, and the system reported that miss instead of letting the other passing metrics paper over it.

One Editor export in that run exited without producing a WAV. Because rendering goes through a temporary file and verification, no false artifact appeared, and a retry succeeded. Filenames got the same scrutiny: `agent-longform-master.wav` stops meaning anything the moment a second song exists, so every artifact name now carries the song slug, its role, and a revision.

## The canonical manifest

The 96-measure song proved that long pieces were possible, and that pushing a whole song through monolithic calls wasn't sustainable. The answer was the biggest architectural change in the project: a canonical, revisioned `*.song.json`.

A finished production contains a lot that VSQX can't hold: semantic sections and energy, chord intent, reusable patterns and renderer settings, stable identities for phrases, effects, reviews, and artifacts, raw-stem dependencies, effect chains and section dynamics, analysis results, revision history, and delivery readiness. The manifest holds it all, in bounded domains: timeline, sections, harmony, vocals, arrangement, mix, artifacts, and review. Every object has an ID that is unique across the whole manifest.

**Three hashes answer three different questions.** `content_hash` covers the whole document. `composition_hash` excludes mix intent, artifact records, and bookkeeping. `mix_hash` binds the current composition to the current mix intent. So changing an EQ doesn't invalidate expensive vocal stems, changing a melody invalidates stems, mix, and delivery, and adding a review note changes the history without pretending the audio changed.

**Writes use optimistic concurrency.** Every mutation carries `expected_revision`. The server loads and validates the manifest, checks the revision, applies exactly one bounded change, increments the revision, records the parent hash, recomputes the hashes, writes a temporary file, and renames it into place. If something else got there first, the write fails with the current revision and the agent re-inspects instead of overwriting newer work. Same-path writes keep timestamped backups, and restoring history creates a *new* revision based on an old state. It never rewinds the counter.

**Stable IDs make bounded work possible.** Without them, "make the second chorus harmony softer" is an array-index edit waiting to go wrong. With them, an agent can fetch one section and only what intersects it, update one phrase, transpose specific events, remove an object only when no references would dangle, and attach a review note to an exact object. Zero-match transforms, dangling references, out-of-bounds placements, and ID collisions are all rejected.

**Dry runs execute the real write path.** A dry run copies the manifest, runs the same mutation code a real write would, and returns the predicted revision and hashes, a music-aware diff, and preflight results, then throws the copy away. A separate "validation implementation" always drifts from the real one. A dry run should answer exactly one question: what would this call do?

**Artifacts form a dependency graph.** The server computes artifact records itself; callers can't register an arbitrary path as a trusted master. Each record holds a role, normalized path, size, SHA-256 digest, source revision, source composition hash (and mix hash where relevant), dependencies, and renderer or analysis metadata. Currentness is recursive. A composition artifact is current when its composition hash matches, a mix artifact when its mix hash matches, and a delivery only when it and everything it depends on are current. That closed a real bug in which an obsolete mix had counted as "ready" after the mix intent changed.

**Build is a provenance transaction.** `vocaloid_build_song_manifest` runs preflight, renders accompaniment, compiles the VSQX, validates both, computes digests, and records the backing-to-project link in one operation. It registers nothing unless every output is verified, and it removes anything a failed build left behind. This is where a set of scripts became a production state machine.

## Japanese lyrics and tuning you can inspect

Notes that merely trigger vowel-like sounds are not a vocal performance. Japanese text needs explicit pronunciation evidence, and expression needs controls an agent can reason about.

The Japanese G2P is conservative on purpose. Its output is limited to the phoneme inventory in the VOCALOID3 manual. It handles hiragana and katakana, yōon, long vowels, the moraic nasal, common foreign-kana combinations, and explicit choices for affricates and nasal *g*. Kanji always needs an explicit kana reading; nothing is guessed from an opaque dictionary. The manifest keeps every layer distinct: the original text, the supplied reading, the normalized reading, the mora units, the phoneme tokens, and the rhythm alignment. A generated reading is never mislabeled as the original lyric.

Small っ has no phoneme of its own, so the agent has to choose a timing strategy: a positioned rest for the closure, or an explicitly experimental repetition of the following consonant. The tool doesn't forbid expressive writing. It forces an ambiguous linguistic choice into recorded intent.

`vocaloid_align_japanese_phrase` combines the reading with rhythm slots in `sequential` or `explicit` mode and returns a phrase whose events already have stable IDs, so tuning, analysis, and reviews can refer to the same note even after unrelated sections change.

Agents reason better about "soften the entrance", "add a small scoop", or "open the chorus timbre" than about dozens of raw PIT samples. The gesture layer (articulation, vibrato, pitch scoop, dynamics arc, opening arc, timbre arc) compiles intent into bounded native controls. It updates velocity, accent, decay, opening, bends, portamento, and vibrato, and writes sparse PBS, PIT, DYN, BRE, BRI, CLE, GEN, and POR curves. The manifest keeps both the gesture and what it compiled to. There is no "make it emotional" preset and no pitch quantization of rendered audio.

The guardrails flag tessitura, leaps, phrase length, breath opportunities, consonant collisions, mora density, and harmony risk, but they don't ban density or dissonance. Vocaloid music often depends on rapid lyrics, abrupt register jumps, and synthetic precision. The finished J-rock and wa-rock songs deliberately keep their density warnings on the designated rapid lines. The warnings point at what to listen to; they aren't proof the writing should be slowed down.

Voice readiness is an active probe, not a file check. The probe renders a tiny `ら` (`4 a`) project through the original Editor, verifies the audio, and caches the result per voice component and per Editor/helper fingerprint. A verified result lasts seven days, an unavailable one 24 hours, and a transient error ten minutes. Rebuilding either binary invalidates the cache, and finding a VVD file on disk never counts as proof that the voice can sing.

## Stems, score-versus-render analysis, and mixing

A master straight out of the Editor is fine for a smoke test, but iteration needs stems tied back to the score.

`vocaloid_render_instrument_stems` renders each arrangement track separately, with the agent explicitly choosing whether to keep authored pan and renderer effects. `vocaloid_render_vocal_stems` starts from the hash-verified VSQX. For each vocal track it builds a temporary project, mutes the other vocals, physically removes the backing parts (removing rather than muting rules out hidden contamination of the master), optionally centers pan or overrides volume, renders through the Editor, verifies the result, and records those choices as dependencies.

The two families start at different times. Instrument stems begin at the start of the song; Editor stems begin at the start of the project, which includes pre-measures. The mixer computes the exact pre-measure duration across the tempo map and delays the right stems before summing. Timeline origin is artifact metadata, never guessed from where the audio seems to start.

`vocaloid_analyze_vocal_stem` lines up stable score events with an isolated vocal. It downmixes to mono at 8 kHz, uses 40 ms frames with 10 ms hops, and runs a YIN-style pitch estimate near each expected note rather than open-ended transcription. Per note, it reports the F0 contour, median and 95th-percentile cents error, voiced ratio, energy and voiced onsets, estimated consonant lead, release behavior, and vibrato depth, rate, and regularity. It summarizes systematic offsets per phrase and marks events shorter than about 120 ms as resolution-limited. The output is observational. It never applies an offset automatically, because an early energy onset may just be a consonant, and it makes no claim about intelligibility or emotion.

Because the mix has its own hash, changing an EQ, fader, or section ramp doesn't invalidate stems whose composition is unchanged. "Make the bridge vocal brighter" becomes a fast deterministic remix instead of another multi-minute Editor export. Effects are typed and ordered: gain, pan, high-pass, low-pass, parametric EQ, compressor, de-esser, a bounded multi-tap room, delay, and limiter. Disabled effects stay in the intent but are skipped. There is no hidden normalization, auto-centering, or makeup gain. The render order is fixed:

```text
decode / resample → timeline alignment → track section automation
  → track effect chain → sum (normalization off) → bus automation
  → bus effects → PCM encode → independent analysis
```

Both the requested graph and the actual FFmpeg filter graph are kept as evidence. Section dynamics refer to semantic section IDs rather than time ranges. The review layer can render section previews and loudness-matched A/B clips, and attach a listening note ("the consonants blur in `chorus-2-fast-line-3`") to an exact section, object, or artifact, so the note survives as structured context instead of disappearing into chat.

## Preflight, staged readiness, and delivery

As capabilities piled up, failures could happen at very different stages, and a single `valid: false` stopped being useful. `vocaloid_preflight_song` is one read-only pass over the whole song. It doesn't open the Editor unless asked to probe a voice. It groups issues by domain (structure, vocal overlap, phoneme evidence, performance density and breath, harmony and tessitura, arrangement, mixer intent, artifact provenance, and host readiness) and reports readiness per stage:

- **score**: the musical structure is valid;
- **build**: it can compile and render accompaniment;
- **render**: a current VSQX and a verified voice exist;
- **mix**: the required current stems exist;
- **delivery**: the mix or master and its QC are current.

A brand-new song is correctly score-ready and render-not-ready, because no VSQX exists yet. That's an accurate workflow state, not an error.

One small check shows the philosophy well. A long track comment once passed preflight and then failed inside the VSQX compiler, which has a 256-character limit. The fix moved that deterministic failure in front of the expensive build as `NATIVE_TRACK_COMMENT_TOO_LONG`. Preflight should catch anything that can be caught cheaply.

History scans the current file and its backups, verifies each one, and shows music-aware diffs by domain; restore creates a new revision. Mastering for delivery (`vocaloid_master_manifest_delivery`) starts from a current manifest mix artifact, never from an arbitrary WAV path. It checks source digests and hashes, masters to bounded targets, re-measures independently, and records the result. Delivery is accepted only when every dependency is current and the file passes format, loudness, loudness-range, true-peak, clipping, and balance policy. The listening copy is then published next to a VSQX of the same composition under the same basename. Identical existing files are reused, and a same-named file with different bytes is never overwritten.

## Designing the MCP for agents, not for its author

By the time the first IA_ROCKS song closed, the server could do almost everything, and a fresh agent still struggled to use it.

At one checkpoint it exposed 37 tools whose definitions took 153 KB, roughly 38,000 tokens, and every one returned an untyped `data` blob. A fresh agent spent about 35,000 tokens just figuring out how to call things. That's a product defect even if every tool works: agents pay for tool names, descriptions, nested schemas, and outputs in their context window, and that context is then unavailable for lyrics, harmony, and actual reasoning.

The fix had three parts. First, cut the surface down to task-level operations. For a while this meant profiles (a compact production set plus `full` and `legacy-vsqx` sets for diagnostics); today there is a single surface of 22 tools. All score, intent, arrangement, and mix writes go through one tool, `vocaloid_edit_song`, which takes an action name and a strict payload and always supports `dry_run`. Second, move reference material into on-demand resources: a capability map, per-action contracts, intent and theory policies, style palettes, and an exact from-zero call example. The example was added after a real agent needed six schema corrections to build a four-bar test song. Third, give every tool a concrete typed output and one consistent error shape (`code`, `message`, `retryable`, `suggested_action`).

Two protocol bugs showed that metadata is runtime behavior, not documentation:

- **A typed output caught the server lying.** Master and delivery calls succeeded and then came back to the client as JSON-RPC `-32602` errors, because the strict output schema was missing two fields the runtime returned. Output schemas validate the public contract *after* the side effect, which is exactly when a mismatch is most dangerous. They were fixed and regression-tested.
- **An annotation made a correct agent refuse a safe call.** The first production evaluation kept cancelling `vocaloid_edit_song` dry runs. The server answered them in 256 ms; the tool was simply annotated `destructiveHint: true`, so the agent reasonably treated every call as dangerous. Dry runs never write, real writes keep backups, and restore is monotonic, so the annotation now describes that recovery contract instead of the mere existence of a write path.

Errors carry enough to recover: stale revisions report the current revision, a busy Editor reports who holds the lease, a missing voice says which one, a stale artifact names the dependency. An agent can make one targeted inspection instead of guessing at schemas.

Finally, the public MCP is the product boundary. Calling TypeScript functions directly proves the logic, but not that a real agent sees usable descriptions, schemas, resources, annotations, and outputs. Protocol-level evaluations found bugs that module tests never could.

## Two independent agent evaluations

The **creative evaluation** ran an ephemeral Codex CLI with only the VOCALOID MCP available: no shell, filesystem, network, source projects, or other tools. It wrote a four-measure song, `星駆ける声`, from zero: two kana-aligned phrases, 12 vocal notes including a native melisma, tuning gestures compiled to 12 control points, celesta and drums, a VSQ3 with zero schema diagnostics, and a balanced stereo backing. It also found a real writer bug. Control points were sorted within each curve but not in the global order the native file requires, which is what had triggered the Editor's Event Verification dialog. The writer and validator now enforce global order, and accepting that dialog requires explicit permission.

The **routing evaluation** measured friction rather than music. A read-only session could call only the production tools and read resources. The first run found the `destructiveHint` problem and six schema stumbles. After the fixes, a rerun built a four-bar, 132 BPM song entirely through public calls (skeleton, dry-run then write of a six-mora IA_ROCKS phrase, dry-run then write of a guitar track, then a cached-voice preflight), ending with zero preflight issues and no leftover lease or process.

Neither replaces a full-song audio closure. Together they guard against two kinds of self-deception: a powerful implementation only its author knows how to call, and a polished interface whose pipeline has never rendered a real voice. Every agent report was checked from outside, against revisions, hashes, event counts, schema diagnostics, WAV headers, process cleanup, and final digests. A plausible story doesn't become evidence by being repeated.

## Three finished songs

The final checkpoint exercised the whole surface on three deliberately different IA_ROCKS arrangements. Every canonical write, dry run, preflight, build, Editor export, stem mix, master, review, and QC step went through the public MCP.

| | `花色日和` (wa-rock) | `火花の航路` (J-rock) | `夏の夜に浮かぶ声` (dream pop) |
| --- | --- | --- | --- |
| Length | 4:16 · 146 measures | 2:07 · 78 measures | 3:18 · 78 measures |
| Vocal events | 820 (lead + 13 harmony entrances) | 433 (lead + 8 harmony phrases) | 411 (lead + 7 harmony phrases) |
| Meter / tempo | 4/4 → 6/8 → 4/4, 9 tempo points | one 2/4 turnaround, 9 tempo points | repeated 6/8 ↔ 4/4, 8 tempo points |
| Arrangement | shamisen, koto, shakuhachi, taiko, guitar, bass, drums | double guitars, bass, piano, strings, drums | two pads, bells, clean guitar, fretless bass, soft kit |
| Loudness / LRA / true peak | −15.2 LUFS / 5.7 LU / −1.10 dBTP | −14.0 LUFS / 4.8 LU / −1.00 dBTP | −17.2 LUFS / 9.6 LU / −1.50 dBTP |
| Kept warnings | 112 consonant-collision, 8 density (rapid lines) | 50 consonant-collision, 5 density | none |

The wa-rock song uses lyrics the user supplied. That file stays out of Git, and only its SHA-256 is recorded. All three pass every readiness stage with zero errors, and the editable projects are in [`artifacts/vsqxs/`](../artifacts/vsqxs/README.md). The remaining warnings don't contradict readiness. Readiness says the production graph is valid and current; warnings point at passages whose success has to be judged by ear. Blocking every stylistic risk would let the guardrails compose the song, and hiding every warning would throw away useful listening targets.

The strongest result of the closure was a failure. A long harmony export in the dream-pop song died while waiting for the WAV. The renderer released the lock and registered no false artifact, but the old all-tracks batch also deleted the lead stem that had already succeeded. Vocal stems became one transaction per track, with a short quiet period between Editor runs. On resume, the workflow checked the current hashes and existing artifacts, reused the committed lead, rendered only the missing harmony, and carried on through mix and delivery without intervention. Recovery wasn't inferred from reading the code; a real multi-minute failure forced it.

## What broke, and why

| What went wrong | Root cause | What changed |
| --- | --- | --- |
| `4 a` "rejected" | wrong guess; `4` is the official flap | read the manual, fixed the real XML issues, added a regression test |
| XSD-valid project failed to load | conventions the schema doesn't express | Yamaha's loader as a second validator |
| direct synthesis returned `-100` | registry and activation context | stopped at the licensing boundary; the Editor is the synthesis authority |
| Editor crashed on cleanup | main window closed under an open modal | cancel modals first, then touch only the owned process |
| singer quietly substituted | metadata ≠ licensed availability | fail with `singer_unavailable`; active probe and cache |
| clipped first song | "render finished" treated as done | PCM + EBU R128 analysis, measured mastering |
| mix 17 dB to the left | pan 0 assumed to mean center | native 0/64/127 scale documented; per-channel QC |
| Event Verification dialog | curves sorted per type, not globally | global ordering; explicit permission to adjust |
| dry runs refused by the agent | `destructiveHint: true` | annotation reflects the backup/restore contract |
| success reported as `-32602` | output schema missing fields | schemas synced, protocol regression test |
| stale mix looked ready | currentness ignored mix hash and dependencies | recursive currentness checks |
| harmony failure deleted the lead | one cleanup transaction for all tracks | one transaction per vocal track, hash-aware resume |
| 37 untyped tools, 38k tokens | coverage grew without product design | task-level tools, resources, typed outputs |

Almost every defect sat on a boundary: schema versus native loader, metadata versus licensed runtime state, UI command versus modal lifecycle, musical intent versus file encoding, render success versus audio quality, a file existing versus being current, and server behavior versus how the client interprets it. Integration systems need an explicit contract at every boundary, plus evidence gathered on the far side of it. Valid input is not evidence of valid output.

## Testing and evidence

The test suite mixes cheap deterministic checks with progressively more expensive native and end-to-end evidence, and no category claims to prove the whole system:

- Pure unit tests cover tempo expansion, mora alignment, phrase compilation, and seeded groove.
- Manifest tests cover revision conflicts, hash corruption, dangling references, history, and dry-run semantics.
- Format tests cover VSQ3/VSQ4 round trips, XSD validation, and WAV parsing and clipping counts.
- Renderer tests cover FluidSynth tracks, every effect type, and mastering.
- Protocol tests start the real stdio server and drive a manifest from creation to a measured stem mix.
- Native-loader and Editor tests run when the licensed host is available.

Synthetic signals calibrate the measurements: a generated tone verifies +100 cents and 5 Hz vibrato detection, and known channel gains verify balance. They can't show that IA pronounces a word intelligibly or that a chorus is exciting; those claims need the real renderer and real listening.

Today `npm test` runs a clean TypeScript build and 96 tests. 94 pass, and 2 skip when local fixtures (a manually exported WAV and a real-world V4 project) aren't present.

## What's proven, and what isn't

With concrete evidence, the system can generate native projects from zero in both V3 and V4. It synthesizes through the original Editor with verified voice identity, handles long-form structure, multiple vocal roles, tempo and meter arcs, rapid Japanese lyrics, and melisma, and compiles inspectable tuning into native controls. It also covers multi-instrument arrangement, reproducible stems and mixes, objective audio QC, manifest-aware mastering and delivery, failure recovery, and bounded revision with dry runs and history, all behind an MCP surface a fresh agent can actually use.

The boundaries are just as concrete:

- **Instrument sound.** The GM SoundFont proves arrangement, timing, routing, and that the renderer can be swapped out. It doesn't prove release-quality guitars or authentic Japanese instruments. The next step is a licensed sample-library or VST renderer that consumes the same positions and emits one stem per stable track, with explicit articulation mapping.
- **Import.** VSQX import exists; MIDI import, CC, sustain, aftertouch, and keyswitches don't.
- **Mix topology.** There is no masking or phase analysis yet, and no sidechain, sends, subgroups, or effect-parameter automation.
- **Language.** Explicit kana for kanji is safe and auditable, but it adds friction. Ranked reading candidates with evidence would help, as long as ambiguity is never silently collapsed.
- **Taste.** The measurements observe pitch, timing, energy, vibrato, loudness, peaks, and balance. They can't prove intelligibility, emotional delivery, a memorable hook, appropriate harmony, or whether a mix feels exciting or tiring. Structured listening notes are the bridge for now.
- **Benchmarks.** A handful of sessions and reference songs prove feasibility, not a distribution. A real benchmark would run many fresh briefs and report how far each gets, invalid calls before the first successful write, context consumed, and blinded human ratings.

Direct engine work is not a priority. The Editor already provides a legitimate, verified synthesis boundary, and accompaniment quality and agent evaluation offer far more visible value.

## Lessons that travel beyond VOCALOID

**Define the user's final artifact first.** "A MIDI file" would have ended the project in an afternoon. "A complete, listenable, revisable, verified song" exposed the missing layers early enough to build them on purpose.

**When a schema is incomplete, use the vendor's loader as an oracle.** A small native probe gives a second line of evidence without turning reverse engineering into a reimplementation.

**Move to the highest legitimate stable boundary.** The direct engine path was interesting and depended on undocumented registration state. Knowing when to stop digging downward is part of the job.

**UI automation is a protocol state machine.** Menu IDs and clicks are the easy part. Ownership, asynchronous controls, modal order, cancellation, cleanup, output stability, and unknown dialogs decide whether it's safe.

**Keep creative intent separate from derived formats.** A canonical manifest makes every derived file reproducible and gives the agent a semantic model that survives renderer changes. The same pattern fits CAD, video, and DAW tooling.

**One hash rarely answers every staleness question.** Composition and mix change at different costs, and the hash boundaries should follow the dependency graph and its economics.

**Stable IDs beat array indices in long agent sessions.** Agents think in "this chorus phrase" and "that harmony entrance". IDs make those references durable and make diffs and reviews meaningful.

**Dry runs should execute the exact write path.** A second implementation will drift.

**Tool count is not capability.** Fewer task-level tools, on-demand resources, and typed results turned coverage into something an agent can use.

**Protocol metadata is executable behavior.** An annotation made a correct agent refuse a safe call, and a missing schema field turned a successful master into an error.

**Test recovery, not just the happy path.** One failed harmony export improved the transaction model more than another clean render would have.

**Measure on the far side of every expensive boundary.** After writing XML, load it natively. After synthesis, parse the WAV. After mixing, check the channels. After mastering, measure the true peak again. After an agent reports success, check the hashes yourself.

**Keep uncertainty in the API.** "Voice metadata found" is not "voice available". A density warning is not a bad lyric, a pitch estimate is not a wrong note, and a GM shamisen is not a shamisen. Precise names stop downstream agents from turning partial evidence into false certainty.

## Where this leaves us

The project now does what the original idea demanded. It gives an agent a practical path from an empty timeline to a complete native VOCALOID song: rendered by the real Editor, mixed, mastered, verified, and delivered as a listening WAV alongside the matching editable project. The most important result isn't any single tool or file. It's the closed evidence loop: intent becomes a canonical revision, the revision becomes a native score and rendered stems, the stems become measurable audio, listening leads to bounded revision, and the dependency graph decides what may be delivered.

That loop survived a mistaken phoneme diagnosis, a crashing cleanup, a licensing wall, clipping, hard-left pan, a missed loudness range, mis-ordered curves, annotation friction, a native field limit, a stale mix, a schema mismatch, true-peak overshoot, a failed long export, and an unplugged pair of headphones. Each failure made the public contract more truthful.

There's real work left. GM instruments aren't a band, numeric analysis can't tell whether a lyric moves anyone, and the mix graph still lacks the tools a mix engineer would reach for first. But this is no longer a note generator or a VSQX demo. It's an agent-facing production instrument with native synthesis, durable creative state, reproducible audio, recovery semantics, and honest final checks, which is the foundation agents and people need to make complete Vocaloid music together.
