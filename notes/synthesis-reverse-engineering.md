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

The workflow is now exposed as `vocaloid_render_wav`. It validates the VSQX,
renders to a temporary sibling path, parses RIFF/WAVE chunks and sample data,
rejects silent output, then atomically renames the validated WAV. Existing
outputs require an explicit overwrite and receive a timestamped backup.
