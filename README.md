# VOCALOID MCP

> An agent-native MCP server for composing, tuning, rendering, mixing, and auditing native VOCALOID3/4 projects. Built **just for fun**.

![A 48-bar cold-start composition: engineering passed, human listening still found the musical gap](docs/assets/ame-semi-no-aida-arrangement-map.svg)

A coding agent can start from an empty timeline or a short creative brief and work through:

```text
intent
  → form / harmony / melody
  → Japanese note allocation
  → IA delivery (tuning gestures)
  → arrangement
  → original VOCALOID3 Editor rendering
  → stems / mix / master / QC
  → VSQX + hash-bound creative record
```

This is not a MIDI-to-VSQX converter and not a one-button hit-song generator. Notes, lyrics, phonemes, note expression, vibrato, and control curves compile into native VSQ3/VSQ4 structures, and your own licensed VOCALOID3 Editor does the singing.

## What works

- Create native VSQ3/VSQ4 projects from zero and validate them against Yamaha's XSDs.
- Render the requested locally licensed singer through the original VOCALOID3 Editor. Fail closed on singer substitution, and catch identical-output collisions between voicebanks.
- Write Japanese lyrics with explicit kana readings, phonemes, mora allocation, rests, melisma, and deliberate small-`っ` timing.
- Compile articulation, dynamics, timbre, vibrato, and pitch gestures into native note styles and control curves.
- Keep one revisioned canonical song manifest with stable IDs, dry-run previews, bounded edits, history, and separate content/composition/mix hashes.
- Render accompaniment (FluidSynth + GM SoundFont), isolated vocal and instrument stems, effect chains, section automation, mixes, previews, A/B pairs, and masters.
- Measure LUFS, LRA, sample and true peak, clipping, channel balance, and score-versus-render pitch, timing, and vibrato.
- Run deterministic music-theory and arrangement diagnostics that flag risks but never write notes.
- Keep a hash-chained creative journal: intent → theory → note allocation → delivery → arrangement → mix.

### What it cannot decide

Passing every engineering gate does not make a song musically successful.

| Engineering can establish | Engineering cannot decide |
| --- | --- |
| The VSQX is structurally valid | The melody is memorable |
| The requested singer rendered non-silent audio | The performance feels alive |
| Native controls were materialized | The tuning is tasteful |
| The delivery is current and unclipped | IA sits correctly in the mix |
| A phrase avoids concrete theory risks | The phrase says what the listener needs to hear |

The latest 190 BPM IA_ROCKS test passed every gate, and the honest human verdict was still that the vocal was buried and it did not really feel like rock. Keeping that distinction visible is the point.

## Quick start

### Requirements

- Node.js 20+ and npm.
- `xmllint` (schema validation), FFmpeg (analysis and mastering), FluidSynth plus a GM SoundFont (default `/usr/share/sounds/sf2/FluidR3_GM.sf2`).
- To actually sing: WSL2 on Windows with your own legitimate VOCALOID3 Editor and an installed, licensed voicebank. The `i686-w64-mingw32-gcc` cross compiler builds the native export helper.

The repository contains no VOCALOID binaries, voicebanks, activation data, or final song audio.

### Build and test

```bash
npm install
npm test              # clean TypeScript build + 96 tests (2 skip without local fixtures)
npm run build:native  # build/native/vocaloid_export.exe and vsq_probe.exe (needed for rendering)
```

### Connect an MCP client

The server speaks MCP over stdio and is meant to be a local, single-user desktop bridge.

```bash
claude mcp add vocaloid -- node /absolute/path/to/vocaloid/dist/src/index.js
```

Or with a generic client configuration:

```json
{
  "mcpServers": {
    "vocaloid": {
      "command": "node",
      "args": ["/absolute/path/to/vocaloid/dist/src/index.js"]
    }
  }
}
```

### Host configuration

Defaults match the original development host. Override them with environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VOCALOID_EDITOR_PATH` | `/mnt/d/Vocaloid/Vocaloid3FE/VOCALOID3.exe` | VOCALOID3 Editor; only allow-listed builds are automated |
| `VOCALOID_VOICE_DIR` | `/mnt/d/Vocaloid/VoiceDB` | VVD voice metadata root |
| `VOCALOID_EXPORT_HELPER` | `build/native/vocaloid_export.exe` | Win32 export helper |
| `VOCALOID_POWERSHELL_PATH` | `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe` | Runs the export wrapper |
| `VOCALOID_REG_EXE` | `/mnt/c/Windows/System32/reg.exe` | Read-only voicebank registration check |
| `VOCALOID_READ_ROOTS` / `VOCALOID_WRITE_ROOTS` | repository (+ `/mnt/d/Vocaloid` for reads) | Extra `:`-separated filesystem roots |
| `VOCALOID_VOICE_CACHE_PATH` | `build/runtime/voice-readiness.json` | Voice probe cache (verified results last 7 days) |
| `VOCALOID_EDITOR_LOCK_PATH` | `build/runtime/vocaloid-editor-render.lock` | Host-wide Editor render lease |
| `FFMPEG_PATH` / `FLUIDSYNTH_PATH` | `/usr/bin/ffmpeg` / `/usr/bin/fluidsynth` | Audio tools |

Before a long render, call `vocaloid_host_readiness` and then `vocaloid_probe_voice` for the exact voice component. If the probe fails, see [host troubleshooting](notes/host-troubleshooting.md).

## MCP surface

22 tools, 14 resources (plus one optional local lyric resource), and one prompt.

| Area | Tools |
| --- | --- |
| Host | `vocaloid_host_readiness`, `vocaloid_probe_voice` |
| Composition | `vocaloid_phrase_grammar`, `vocaloid_align_japanese_phrase`, `vocaloid_creative_journal` |
| Manifest | `vocaloid_create_song_manifest`, `vocaloid_import_vsqx_manifest`, `vocaloid_inspect_song_manifest`, `vocaloid_get_song_section`, `vocaloid_edit_song`, `vocaloid_preflight_song`, `vocaloid_manifest_history` |
| Render | `vocaloid_build_song_manifest`, `vocaloid_render_vocal_stems`, `vocaloid_render_instrument_stems`, `vocaloid_render_stem_mix`, `vocaloid_render_manifest_master`, `vocaloid_master_manifest_delivery` |
| Review | `vocaloid_analyze_wav`, `vocaloid_analyze_vocal_stem`, `vocaloid_review_audio`, `vocaloid_review_song` |

`vocaloid_edit_song` is the single write path for score, intent, arrangement, and mix: one `action` (for example `upsert_vocal_part`, `apply_tuning`, `upsert_arrangement`, `upsert_effect_chain`, `set_composition_intent`) with a strict `payload`. Every action supports `dry_run` and requires `expected_revision`. Every tool returns `{ ok, data, warnings }` on success and `{ ok: false, error: { code, message, retryable, suggested_action } }` on failure.

Resources start at `vocaloid://capabilities`. They include the edit, intent, theory, phrase-grammar, and creative-journal contracts, style palettes, and a from-zero call example. See [song manifest workflows](notes/song-manifest-workflows.md) for complete payloads.

## Compose a song from an intent file

```bash
cp intents/template.intent.json intents/my-song.intent.json   # fill in the brief
npm run --silent compose:prompt -- --intent=intents/my-song.intent.json
```

The brief declares the voice component, duration, BPM range (optional preferred value), scene, dramatic motion, one listener question, things to avoid, and source boundaries. The rendered prompt ([`prompts/vocaloid-composition-agent.md`](prompts/vocaloid-composition-agent.md) plus the validated brief) is the whole task for a fresh agent. The same prompt is available over MCP as `vocaloid_compose_from_intent`.

### Creative boundaries

- **Intent comes before score.** `vocaloid-composition-intent/v1` declares song, section, and anchor-phrase purpose before any note exists.
- **Theory is a guardrail.** The `core/v1` analyzer separates structural errors, musical risks, and style observations. It never decides that a phrase is moving.
- **Phrase grammar is vocabulary, not a template.** Bundles are unordered option pools with `melody_material=absent`; they never produce a pitch sequence.
- **No corpus at runtime.** Production agents cannot query local songs, reference melodies, or similarity targets.

### Evidence ladder

```text
declared     a gesture or intent exists in the canonical state
materialized native VSQX notes / styles / controls contain it
rendered     the original Editor produced non-silent, identity-checked audio
heard        a named listener answered one explicit question
```

Technical QC never signs off a human `keep` decision.

## Compositions

Each tracked package holds a manifest snapshot, the append-only creative journal, a readable report, and a digest-bound index. Final WAV files stay local.

| Composition | Voice | Scale | Record |
| --- | --- | ---: | --- |
| `朝がほどく前に` | IA_ROCKS | 28-second intent-first demo | [record](artifacts/creative-records/asa-ga-hodoku-mae-ni-20260719-a/) |
| `遠い灯、青い夜` | IA_ROCKS | 2:10 cold-start song | [record](artifacts/creative-records/tooi-hi-aoi-yoru-ia-20260719-a/) |
| `風は名を呼ばない` | IA | 3:10 fresh-agent song | [record](artifacts/creative-records/kaze-wa-na-o-yobanai-ia-20260719/) |
| `雨と蝉のあいだ` | IA_ROCKS | 64 seconds at 190 BPM | [record](artifacts/creative-records/natsu-ame-semi-ia-rocks-20260719/) |
| `初雪のホーム` | IA_ROCKS | 31 seconds at 108 BPM | [record](artifacts/creative-records/hatsuyuki-platform-ia-rocks-20261115/) |

Editable native projects are in [`artifacts/vsqxs/`](artifacts/vsqxs/README.md).

## Repository layout

```text
src/
  index.ts                stdio entry point
  server/                 MCP server: instructions, results, schemas, resources
    tools/                host, composition, manifest, render, review tools
  song-manifest.ts        public manifest API (barrel)
  song-manifest/          schema, store (hashing/validation/IO), mutations, build
  theory/                 deterministic symbolic analysis and bounded proposals
  intent/                 composition-intent schema, realization, review
  vsqx.ts                 VSQ3/VSQ4 reader/writer
  render.ts               original-Editor export boundary
  stems.ts, stem-mix.ts   isolated rendering, effects, automation, summing
  delivery.ts             mastering and delivery QC
  audio-quality.ts, audio-review.ts, vocal-analysis.ts
native/                   Win32 export helper and Yamaha loader probe (C)
scripts/                  prompt renderer, export wrappers, shared MCP client
prompts/, intents/        composition-agent prompt and per-song briefs
tests/                    unit and stdio integration tests
notes/                    contracts, workflows, troubleshooting, problem log
blogs/                    long-form retrospectives (July 2026 snapshot)
artifacts/                creative records and publishable VSQX projects
```

| Path | Tracked | Contents |
| --- | --- | --- |
| `artifacts/creative-records/`, `artifacts/vsqxs/` | yes | manifests, journals, reports, native projects |
| `artifacts/songs/`, `artifacts/evals/` | no | final listening WAVs, stems, previews, traces |
| `build/` | no | working manifests, runtime caches, native helper binaries |

## Further reading

- Contracts: [composition intent](notes/composition-intent-contract.md), [music theory policy](notes/music-theory-policy.md), [phrase grammar](notes/phrase-grammar-dsl.md), [creative journal](notes/creative-decision-journal.md)
- Workflows: [song manifest](notes/song-manifest-workflows.md), [manifest design](notes/song-manifest-design.md), [Japanese lyrics and gestures](notes/japanese-lyrics-and-gestures.md), [stem mix](notes/stem-mix-workflow.md), [score-versus-render analysis](notes/score-render-analysis.md)
- Host: [troubleshooting](notes/host-troubleshooting.md), [synthesis reverse engineering](notes/synthesis-reverse-engineering.md), [problem/solution log](notes/problem-solution-log.md)
- Stories: [articles](blogs/README.md)

## Safety and legal boundary

- Filesystem writes are restricted to configured roots; overwrites are explicit and revision-bound.
- Editor operations hold a host-wide lease and only terminate processes owned by the active render.
- Singer availability requires a real Editor probe; VVD files on disk are only metadata.
- The project does not patch activation checks, copy licensing markers, redistribute voice data, or replace the licensed synthesis engine.
- Reverse-engineering findings are tied to exact local binary hashes and documented as observations, not vendor APIs.
- The GM SoundFont accompaniment is a reproducible draft renderer, not a claim of authentic instrument performance.

## License

Source code and documentation are under the [MIT License](LICENSE). VOCALOID, voicebanks, Yamaha software, supplied lyrics, and other third-party material remain under their owners' licenses and are not redistributed here.
