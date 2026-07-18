# VOCALOID3 synthesis bridge reverse-engineering notes

Last updated: 2026-07-18

These notes capture the read-only IDA investigation needed to add real vocal
audio rendering to the MCP server. Addresses are for the exact binaries listed
below and must not be treated as stable API addresses. The planned bridge will
resolve exported decorated names dynamically with `GetProcAddress`.

## Binary fingerprints

### DSCL3.dll

- Path: `D:\Vocaloid\Vocaloid3FE\DSCL3.dll`
- Architecture: PE32 / Intel 80386
- Image base: `0x10000000`
- Image size: `0x7c000`
- File size: `0x68f60`
- SHA-256: `9bcdc8b8424849f18975af47ceaad984222239ddad57d1554e75b2478fb5f789`

### DSE3.dll

- Path: `D:\Vocaloid\Vocaloid3FE\DSE3.dll`
- Architecture: PE32 / Intel 80386
- Image base: `0x10000000`
- Image size: `0x802000`
- File size: 7,970,144 bytes
- SHA-256: `f251e7105eee2c8ceb8e632bf22ff50655cb7b87b7e892b6116b3b17c6a4ee5f`

## High-level render path

The useful path is the exported C++ wrapper in `DSCL3.dll`, not direct calls to
the raw DSE functions:

1. Load a VSQX with `CVSVsqManagerIF` from `Vsq3.dll`.
2. Obtain an `IVSMusicalPart` plus a sequence time map.
3. Construct `CxDaisyMidiFile` and call `EncodeMusicalPart`.
4. Construct `CRtSynthesis`, configure DB paths/voices, and call
   `OpenSynthesizer`.
5. Pass the resulting `CDaisyMidiBuffer` and a `CWaveFile` to `DoSynthesis`.
6. Close/destruct all objects in reverse order.

This keeps phonemes, singer selection, pitch curves, dynamics, vibrato, and
other VOCALOID-specific data. It is not a MIDI-only workaround.

## CRtSynthesis contract

### OpenSynthesizer

- Export:
  `?OpenSynthesizer@CRtSynthesis@@QAEHPB_WN@Z`
- IDA address: `0x1002f220`
- Effective signature:
  `int __thiscall OpenSynthesizer(const wchar_t* dseDll, double apiVersion)`
- The version guard requires `apiVersion == 20008017.0` (epsilon `0.00001`).
- A null DLL path loads `DSE.dll`; the bridge must pass the full `DSE3.dll`
  path.
- Resolves these DSE exports:
  `DSEGetVersion`, `DSECreate`, `DSEDelete`, `DSESetStaticSetting`,
  `DSESetDynamicSetting`, `DSEDoStepSynthesis`, `DSEStart`, `DSEStop`,
  `DSEReset`, `DSESetDBMPath`, `DSESetVVoiceTable`, `DSEBeginExport`, and
  `DSEEndExport`.
- Calls `CreateDSE` once as a capability/voice-table probe and deletes that
  temporary DSE before returning success.

### CreateDSE

- Export: `?CreateDSE@CRtSynthesis@@IAEHPAPAE@Z`
- IDA address: `0x1002eeb0`
- Calls `DSEGetVersion` using engine-version token `20012012.0`.
- Calls `SendVVoiceTableToDse`, `DSECreate`, then `DSESetStaticSetting`.
- Static settings observed in the wrapper include the configured sample rate,
  frame size 256, DBM path, mono output, and optional returned voice table.
- Failure sentinel: `-2`.

### DoSynthesis (public wrapper)

- Export:
  `?DoSynthesis@CRtSynthesis@@QAEHPAVCDaisyMidiBuffer@@PAVCWaveFile@@KK_NPBD2MM@Z`
- IDA address: `0x1002f450`
- Effective parameters:
  `(CDaisyMidiBuffer*, CWaveFile*, sampleRate, progressIntervalMs,
  exportMode, exportPath, exportFormat, float, float)`.
- Creates a new DSE, optionally surrounds synthesis with
  `DSEBeginExport`/`DSEEndExport`, invokes the internal renderer, deletes the
  DSE, and returns the renderer status.

### DoSynthesis (internal renderer)

- Export:
  `?DoSynthesis@CRtSynthesis@@IAEHPAUHWND__@@HPAVCWaveFile@@PAVCDaisyMidiBuffer@@K@Z`
- IDA address: `0x1002a230`
- Calls `PrepareWavFile`, seeks the Daisy buffer, starts DSE, and renders in
  256-sample frames through `DSEDoStepSynthesis`.
- Daisy events are passed as arrays of compact timestamp/event blocks.
- Generated mono 16-bit samples are appended to `CWaveFile`.
- Calls `DSEStop` and returns success/failure.

### Other relevant exports

- Constructor: `??0CRtSynthesis@@QAE@XZ` at `0x1002c370`.
  The object touches at least 1,040 bytes; allocate using the same MSVC runtime
  or a conservatively sized zeroed block before invoking the constructor.
- Destructor: `??1CRtSynthesis@@UAE@XZ`.
- `?SetDBMPath@CRtSynthesis@@QAEHPBD0@Z`.
- `?SetDseVVoiceTable@CRtSynthesis@@QAEXABV?$vector@UtagDSEVVoiceSetting@@V?$allocator@UtagDSEVVoiceSetting@@@std@@@std@@@Z`.
- `?PrepareWavFile@CRtSynthesis@@QAEHPAVCWaveFile@@KH@Z`.
- `?WriteWavFile@CRtSynthesis@@QAEH_J0PAVCWaveFile@@1@Z`.
- `?CloseSynthesizer@CRtSynthesis@@QAEHXZ`.

## Daisy encoding contract

### CxDaisyMidiFile::EncodeMusicalPart

- Export:
  `?EncodeMusicalPart@CxDaisyMidiFile@@QAEPAVCDaisyMidiBuffer@@PAUtagDaisyMidiV3EncodeStruct@@@Z`
- IDA address: `0x10014ee0`.
- The encode-struct's first two observed fields are:
  1. `IVSMusicalPart* musicalPart`
  2. `tagSequenceTimeMap* sequenceTimeMap`
- Allocates and constructs a `CDaisyMidiBuffer` of `0x5c` bytes.
- Calls `CDaisyMidiBuffer::Create(1, eventInterval, outputMode)`.
- Calls `WriteMusicalPartDaisyMidiTrack(part, timeMap)`.
- Stores the musical part start time in Daisy buffer field 20.
- The caller owns the returned `CDaisyMidiBuffer` and must invoke its virtual
  deleting destructor.

### CxDaisyMidiFile constructor

- Export: `??0CxDaisyMidiFile@@QAE@XZ` at `0x10012a00`.
- Object size used by observed fields is at least `0x60` bytes.
- Default event interval is 2000; accepted range is 50..5000.

## Vsq3 checklist (completed)

The Vsq3 investigation recovered:

1. `CVSVsqManagerIF` constructor/destructor and `sysInitialize` policy layout.
2. `fileLoadVsqFile` ownership and error behavior.
3. Root/track/part interface vtable methods needed to enumerate
   `IVSMusicalPart` objects.
4. Voice-library initialization requirements.

The x86 helper must remain isolated from the stdio MCP server, validate every
path, enforce timeouts, and return structured render diagnostics. It must never
silently claim a WAV was rendered; it must verify RIFF/WAVE headers, sample
rate, channel count, sample count, and non-silent peak/RMS before success.

## Vsq3 native bridge findings (2026-07-18)

### Binary fingerprint

- Path: `D:\Vocaloid\Vocaloid3FE\Vsq3.dll`
- PE32 / Intel 80386, image base `0x10000000`, image size `0xb6000`
- File size: `0xa4d60`
- SHA-256: `236b4be5c09d17f77e5f9c9a7455817edba01664e760908635157eef2dce7256`

### Manager initialization

- `CVSVsqManagerIF` is a four-byte wrapper around an internal `0x100`-byte
  implementation object.
- `sysInitialize` validates a `VSVsqManagementPolicy` containing 12 scalar
  words followed by a native VC9 `std::wstring`.
- Observed scalar constraints: field 0 is `-1` or positive; field 1 is 1..16;
  fields 3/4/6 are booleans; fields 2/5/7/10 are at least `-1`; field 8 is
  `-1` or at least the field-9 timeout (minimum 60); field 11 is `-1` or at
  least 60.
- The trailing string must be non-empty. The standalone helper constructs,
  assigns, and destroys it with the already-loaded VC9 `MSVCP90.dll` ABI.
  The Vocaloid runtime directory works as its value.

### Native VSQ tree

- `fileLoadVsqFile` returns the primary `IVSVsqRoot*` interface.
- Concrete objects use primary interface at offset 0 and the generic
  `IVSVsqObject` interface at offset `+4`.
- Generic vtable slot 6 enumerates child objects into a VC9 pointer vector.
- The VC9 vector layout is six pointers/words: iterator proxy, two reserved
  words, begin, end, capacity. Vsq3's internal constructor is at RVA
  `0x725b0` for the pinned binary.
- Primary vtable RVAs identify important types:
  - root: `0x85258`
  - musical part: `0x85ac4`
  - VS track: `0x85d1c`
- Therefore a generic child with primary vtable `0x85ac4` converts to the
  `IVSMusicalPart*` expected by DSCL by subtracting four bytes.

### Executable proof

`native/vsq_probe.c` plus `scripts/build-native.sh` builds a statically linked
32-bit Windows probe. Against the real Creative/GHOST V4 project it loaded the
project with Yamaha's own Vsq3 implementation and enumerated 20,402 native
objects, six VS tracks, and six musical parts. Against the MCP-generated smoke
project it enumerated 83 objects, one VS track, and one musical part.

This native validation also exposed XML-compatibility requirements that XSD
validation alone missed:

1. VOCALOID phoneme elements contain raw symbols such as `a` or `k a`.
2. Every generated note needs the standard note-style attributes (including
   `vibLen` and `vibType`), and string-bearing fields should use CDATA like
   editor-produced VSQX files.

Important correction: the earlier probe iteration incorrectly blamed `4 a`
for a load failure. `4` is an official Japanese flap/tap phoneme (for example
`4 a` for ら). The local manual's Japanese phonetic table and bundled
`KanaNote.lua` both confirm it. A fresh generated VSQ3 containing `4 a`, note
style, vibrato sequences, and DYN points loaded successfully through the native
probe (77 objects, one track, one musical part). The numeric-prefix rejection
was removed and replaced by a regression test.

## First end-to-end native render attempt (2026-07-18)

The probe now has an optional render mode:

```text
vsq_probe.exe <Vocaloid3FE-dir> <project.vsqx> [output.wav VoiceDB-dir]
```

For the MCP-generated, Vsq3-valid smoke project it successfully completed all
pre-synthesis stages: loaded the VSQX, selected the first musical part, created
the sequence-time map, encoded the part as Daisy MIDI, loaded `DSCL3.dll`, and
loaded `DSE3.dll`. `OpenSynthesizer` resolved the expected DSE entry points.

The first actual render stopped at database initialization:

```text
DSESetDBMPath result=-100
DoSynthesis failed
render_status=71
```

The attempted arguments were the Vocaloid runtime directory and
`D:\Vocaloid\VoiceDB`. No output file is written for this failure, and the
probe also refuses to report success for silent PCM.

Offline inspection of the pinned `DSE3.dll` shows that `DSESetDBMPath` calls
two internal initialization routines and references the relative database
names `DATABASE\\VOICE3` and `DATABASE\\VOICE2`. The exact meaning of its two
path arguments and the source of error `-100` still need live decompilation in
IDA. The next target is `DSE3.dll`; the investigation must use legitimate
installed/registered voice databases and must not patch or bypass activation.

## DSE registry-path findings (2026-07-18)

Live decompilation of the pinned DSE3 build corrected the interpretation of
`DSESetDBMPath`:

- Its first argument is a registry-key format string, not a filesystem path.
  The editor passes `SOFTWARE\\VCLDASGN3\\%s`.
- Internal RVA `0x5520` formats that string with `COMMON` and checks the
  installed system/activation state.
- Internal RVA `0x8180` enumerates
  `HKLM\\SOFTWARE\\VCLDASGN3\\DATABASE\\VOICE2` and `VOICE3`, checking values
  including `INSTALLED`, `TIME`, `ORGID`, and `KEYS`.
- The 32-bit registry contains legitimate installed IA and IA_ROCKS entries.
  Direct diagnostics currently return `VOICE2=0` and `VOICE3=-100`; the latter
  remains the blocker for direct DSCL/DSE rendering.
- `DSESetVVoiceTable` requires version token `0x13000202` and copies a table of
  64-byte voice-setting entries. The exact entry layout is still pending.

No activation checks are bypassed or patched.

## Editor render closed loop and agent proof (2026-07-18)

The generated `native-vsqx-smoke-style.vsqx` was opened by the original
VOCALOID3 Editor. The UI displayed the generated notes and IA_ROCKS part,
playback advanced normally, and manual Export Wave succeeded. Win32 menu
enumeration identified `File > Export > Wave...` as command ID `33299`; helper
scripts for menu/UI discovery and bounded `WM_COMMAND` dispatch live under
`scripts/`. Future automation must launch minimized, use a single bounded
export operation, validate the resulting RIFF/WAVE, and close the editor so it
does not interrupt the user.

Separately, Codex CLI was configured with only the local Vocaloid MCP and told
not to use shell/XML. It created
`artifacts/evals/codex-agent-from-zero-tuned.vsqx` from an abstract brief:

- VSQ3, IA_ROCKS, 132 BPM, 4/4, eight measures
- 41 original notes and locked Japanese phonemes
- 34 DYN, 6 PBS, and 22 PIT points
- expressive note styles plus three selected long-note vibratos with editable
  depth/rate envelopes
- XSD/structural validation: valid, no diagnostics
- Yamaha `Vsq3.dll` native load: 351 objects, one track, one musical part

This proves the current project writer does not require an input VSQX. The real
corpus project was used only as a format/behavior oracle and validation fixture.

## Editor export automation safety notes (2026-07-18)

The first export-helper prototype established the two-stage UI contract:

1. VOCALOID's `Export Wave File` options dialog (master/current/selected/
   separate tracks, sample rate, channel mode).
2. Windows' `Export to Wave File` common Save dialog.

A non-interactive Windows desktop prevented visible UI, but the common dialog
did not create its normal shell filename controls without an Explorer shell.
The replacement helper starts the editor minimized on the normal desktop and
uses an out-of-context `EVENT_OBJECT_SHOW` guard to move dialogs offscreen.

One diagnostic run enumerated the Save dialog before its asynchronously created
filename control existed, then attempted to exit the disabled MFC owner while
the modal dialog was still active. VOCALOID3.exe raised an access violation
during teardown. This was an automation cleanup bug, not a VSQX or synthesis
failure. The helper now:

- waits for both filename and Save controls until the bounded deadline;
- cancels every known modal dialog before touching the owner;
- waits for the owner to become enabled before sending Exit;
- terminates the helper-owned process directly if the modal cannot be unwound,
  instead of sending Exit/Close into an invalid UI state;
- hooks only `EVENT_OBJECT_SHOW`, not partially constructed windows.

No VOCALOID or exporter process remained after the failed run. After explicit
user confirmation, the hardened helper completed both integration exports with
no forced termination or residual process:

- Japanese `4 a` smoke: 13.657 s helper runtime; 44.1 kHz, 16-bit stereo;
  10.008 s audio; peak -18.47 dBFS; RMS -38.46 dBFS; non-silent.
- Codex-created `雨のあとで`: 14.641 s helper runtime; 44.1 kHz, 16-bit
  stereo; 16.370 s audio; peak -7.92 dBFS; RMS -23.01 dBFS; non-silent.

The helper also treats Editor's singer-substitution warning as a provenance
failure. It matches the exact dialog text, reports `singer_unavailable`, and
does not click through to render with an unknown default singer. VVD metadata
on disk is therefore advertised separately from Editor registration/licensing;
only a successful render proves current synthesis availability.

The workflow is now exposed as `vocaloid_render_wav`. It validates the VSQX,
renders to a temporary sibling path, parses RIFF/WAVE chunks and sample data,
rejects silent output, then atomically renames the validated WAV. Existing
outputs require an explicit overwrite and receive a timestamped backup.

## Structured songs, harmony, and native accompaniment (2026-07-18)

The single-part writer has been retained for compatibility and a separate
`vocaloid_create_song` workflow now models long-form arrangements directly:

- zero-based measure/beat/tick positions after the VSQX pre-measure count-in;
- ordered tempo and time-signature maps;
- up to 16 vocal tracks, each with its own singer slot and mixer unit;
- multiple named, non-overlapping musical parts per track;
- absolute song positions for notes and control curves, converted to each
  part's relative ticks by the server;
- explicit lead/double/harmony/countermelody tracks for simultaneous voices;
- native V3 `seTrack`/`karaokeTrack` and V4 `monoTrack`/`stTrack` WAV parts.

WAV parts are not accepted on metadata trust alone. The server parses the RIFF
header and sample data, enforces the VOCALOID3 manual's 16-bit PCM plus
44.1/48/96 kHz sample-rate and mono/stereo channel
constraints, converts the readable WSL path to a Windows path for the Editor,
and derives `playTime` from audio duration across the song's tempo map. Project
inspection reports the resulting audio-part metadata and stored file path.

Both V3 and V4 structured fixtures pass their Yamaha XSDs. A native V3 Editor
integration test then combined two simultaneous IA vocal tracks (lead and a
third/fourth harmony in a separate track) with a stereo 44.1 kHz/16-bit backing
part. Master export completed without forced termination or residual process:

- project: 2 vocal tracks, 2 musical parts, 6 notes, 4 DYN points, 1 WAV part;
- helper runtime: 16.313 seconds;
- output: 6.014 seconds, 44.1 kHz, 16-bit stereo, non-silent;
- peak: -13.26 dBFS; RMS: -25.32 dBFS.

This closes the structural and native-render path for harmony plus real audio
accompaniment. It does not yet generate instrumental stems or make perceptual
mix decisions; those require higher-level composition, listening analysis, and
mix/master tools on top of this deterministic VSQX layer.

## Agent-composed instrumental and 16-measure song (2026-07-18)

FluidSynth 2.3.4 and the FluidR3 GM SoundFont provide the first replaceable
instrumental renderer backend. `vocaloid_render_accompaniment` accepts the same
measure/beat/tick timeline as the structured VSQX writer, up to 15 melodic GM
tracks plus channel-10 percussion, per-track volume/pan, tempo/meter changes,
and a requested song end. It writes a temporary format-1 SMF only as the
bounded synth process input, deletes it after rendering, verifies the resulting
16-bit stereo PCM, rejects silence, and atomically commits the WAV. The MCP
also exposes the full 128-program and standard percussion map. This default
SoundFont is intentionally described as draft quality; a compatible custom SF2
can replace it without changing the composition model.

An ephemeral local Codex CLI session was restricted by instruction to the
Vocaloid MCP and given an abstract 16-measure Japanese pop-rock brief. It used
the tools rather than shell/XML and recovered from two schema mistakes (signed
pan and an out-of-range send level) without leaving partial outputs. The final
artifacts were created from zero:

- form: 2-bar instrumental intro, 6-bar verse, 2-bar pre-chorus, 6-bar chorus;
- tempo: 128 BPM, rising to 132 BPM at the chorus;
- accompaniment: four GM tracks, 176 pitched notes, 127 drum hits (303 events);
- vocal: IA_ROCKS lead with 56 notes/17 controls and chorus harmony with 12
  notes/6 controls, on two independent tracks;
- VSQ3: two musical parts, 68 notes, 23 controls, one stereo WAV part;
- validation: Yamaha XSD and structural diagnostics both clean;
- backing: 38.368 seconds, peak -4.45 dBFS, RMS -24.15 dBFS;
- original-Editor Master: 40.263 seconds, 44.1 kHz/16-bit stereo, non-silent,
  26.344-second helper runtime, no forced termination or residual process.

The eval also exposed the next real quality gate. Independent FFmpeg EBU R128
analysis measured the Master at -9.0 LUFS integrated, 13.5 LU LRA, and +0.3
dBFS true peak; the basic PCM analyzer likewise reported a 0 dBFS sample peak.
The workflow is therefore complete as a composition/render loop but this output
is not claimed as mastered. The next tools must expose clipping/true-peak and
loudness analysis, adjustable audio/mixer gain, stem replacement, and a bounded
revision/mastering pass with explicit headroom targets.

## Long-form rhythm, Japanese palette, and mastering (2026-07-18)

The MCP now separates audio inspection from mutation. `vocaloid_analyze_wav`
combines exact PCM sample-domain analysis with FFmpeg EBU R128 metrics, while
`vocaloid_master_wav` performs two-pass loudnorm into a distinct output and
accepts the file only after a second independent quality measurement. The old
16-measure Master contained 9,844 full-scale sample values (about 0.277% of all
sample values), measured -9.0 LUFS and +0.3 dBTP. Its descriptively named
revision `hoshikuzu-letter-master-v1.wav` measures -13.8 LUFS, -1.0 dBTP and
zero full-scale samples. The result reports `sourceClipped=true`: normalization
can prevent further clipping but cannot reconstruct source transients, so the
proper artistic revision remains a lower-level re-render.

The phrase compiler is grounded in both the local VOCALOID3 manual and installed
VSQX corpus behavior. The editor exposes quantization through 1/64 plus triplets,
and a note may contain multiple phoneme symbols. Real projects use lyric `-` and
phoneme `-` for a note that continues the previous syllable, and also split
composite pronunciations across successive notes. The MCP therefore offers two
high-level allocation modes: sequential lyric consumption for rapid syllabic
runs and explicit lyric indices for melisma, with automatic native continuation
events. It also supports rests, gates, dotted values, tuplets, cell overrides,
note expression, and vibrato. The low-level VSQX representation is unchanged.

Accompaniment patterns and placements make long structures compact without
flattening their musical intent. A test arrangement uses eight source events and
two placements to expand 96 measures into 192 shamisen notes plus 384 drum hits.
Placements can repeat, transpose, or scale velocity, so intro, verse, pre-chorus,
chorus, bridge, and outro may use different grooves over one tempo/meter map.
FluidR3 preset inspection verified bank/program access to Shakuhachi (0/0/77),
Shamisen (0/0/106), Koto (0/0/107), Taisho Koto (0/8/107), Taiko Drum
(0/0/116), Timpani, Woodblock, and Shanai. These are draft composition colors,
not a claim of realistic Japanese-instrument production quality.

## Agent-created 96-measure song and stereo mixer revision (2026-07-18)

A fresh Codex CLI session was restricted to the Vocaloid MCP and asked to write
a named Japanese long-form song without reading or copying any source project.
It created `月影疾走` (`tsukikage-shissou`) with the following structure:

- 96 measures and 172.408 seconds of Editor-exported audio;
- intro, verse 1, pre-chorus, chorus 1, interlude, verse 2, bridge, final
  chorus, and outro;
- ten tempo events from 96 to 156 BPM and a 4/4 to 6/8 to 4/4 meter map;
- Shamisen, Koto, Shakuhachi, Taiko, pick bass, distortion guitar, synth
  strings, piano, and channel-10 drums;
- 81 patterns and 81 placements expanded into 3,128 pitched accompaniment
  notes plus 861 drum hits;
- IA_ROCKS lead (311 notes) and an independent harmony/counterline (85 notes),
  all locked phonemes, with 1/16 and 1/32 lyrics, triplets, pickups, rests,
  syncopation, four explicit melismas, selective vibrato, and 41 controls;
- clean Yamaha XSD and structural validation with no overlaps or out-of-range
  events.

The first render revealed a semantic MCP failure that aggregate loudness did not
catch. The stereo backing was balanced within 0.17 dB, but the VSQX vocal units
used pan 0 and 10 because the agent treated zero as center. VOCALOID pan actually
uses 0=hard left, 64=center, and 127=hard right. The resulting mix differed by
17.196 dB RMS between channels. This was audible even though the WAV header said
stereo and its aggregate loudness/clipping checks passed.

The MCP now exposes read-only mixer inspection, atomic mixer updates, per-channel
peak/RMS/clipping, signed L-minus-R RMS balance, and a review flag above 3 dB.
A second MCP-only agent inspected the evidence and chose lead pan 64 plus harmony
pan 96. The derived `tsukikage-shissou-v2.vsqx` remained XSD-valid. Its original
Editor mix measures L/R RMS -28.627/-28.044 dBFS (0.583 dB toward the right),
-21.4 LUFS, -6.0 dBTP, and zero clipped samples. The named v2 master measures
L/R RMS -19.596/-19.114 dBFS (0.482 dB toward the right), -14.2 LUFS, -1.0 dBTP,
and zero clipped samples. Its 12.6 LU loudness range does not meet the requested
9 LU target; the tool now reports that separately rather than equating LUFS and
true-peak success with full dynamic-range success.

This eval also exercised failure honesty: the first v2 render attempt saw the
Editor exit during synthesis and produced no committed WAV or fake master. A
single bounded retry succeeded with normal Editor cleanup. The generated VSQX
revisions are retained as evaluation fixtures; WAV files remain ignored build
artifacts with descriptive song/version names.
