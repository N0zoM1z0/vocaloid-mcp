# Codex MCP-only v1 evaluation

Date: 2026-07-18

Client: `codex-cli 0.144.5`

Server: local `dist/src/index.js`, version 1.0.0

## Isolation contract

A fresh ephemeral Codex session loaded no user configuration and received only
the Vocaloid MCP server. The prompt explicitly prohibited shell/exec, direct
filesystem reads, network access, other MCPs, source VSQX files, and original
Editor rendering. The agent had to create a four-measure Japanese piece from
an empty manifest and deliver fixed, new artifact paths.

Required capabilities were:

- installed-voice discovery;
- a revisioned canonical manifest;
- two rhythmically different Japanese phrases with explicit kana readings;
- a rapid mora run and a native melisma continuation;
- bounded insertion of the second phrase;
- all five high-level tuning gesture types;
- one pitched and one drum arrangement track;
- backing/VSQX build, manifest inspection, and independent XSD validation.

The session used only `vocaloid/*` calls. Its first two manifest-create calls
were rejected by the schema; it read the actionable errors, corrected the
request, and succeeded on the third attempt without leaving the MCP workflow.

## Agent-created result

The agent named the piece **星駆ける声** and chose the installed IA voice.
Its successful mutation sequence was:

1. create manifest (revision 1);
2. align and insert the rapid first phrase with its vocal part (revision 2);
3. align and bounded-upsert the melisma phrase (revision 3);
4. apply five persistent tuning gestures (revision 4);
5. upsert Celesta arrangement (revision 5);
6. upsert drums (revision 6);
7. build backing and VSQX with provenance (revision 7);
8. inspect the final manifest and validate the project.

The score contains:

- `phrase-rapid-hoshizora`: 「星空を駆ける」 / `ほしぞらをかける`, eight
  sequential 240-tick mora notes;
- `phrase-melisma-hikari`: 「光」 / `ひかり`, three lyric units across four
  notes; the final note contains native `lyric="-"`, `phonemes="-"`;
- 12 native vocal notes total;
- five stored gestures: articulation, vibrato, pitch scoop, DYN arc, and BRI
  timbre arc;
- 12 native control points across DYN, BRI, PBS, and PIT;
- `track-accomp-celesta` and `track-drums-pulse`.

## Independent verification

The root implementation reloaded the manifest rather than trusting the
agent's report. Hash verification and semantic validation succeeded:

- composition SHA-256:
  `542da688fe0d153413b2dbb6d0a1b68d20fb6712748176c857d6ea2abe3d9a01`;
- manifest content SHA-256:
  `15fb407e7ffdb3a0cc46961d29ede7abbfdfa7f088f093b0c73ef30609a3fa68`;
- VSQX artifact SHA-256:
  `6bc7a42455077c7c4e7bd3b3bb8b395dbc59c65599d09cab20175c8eea86a5db`;
- VSQ3 XSD valid, no structural diagnostics;
- backing: 44.1 kHz, 16-bit stereo, 11.439 seconds, non-silent, no clipped
  samples; left/right RMS differ by 0.99 dB.

Artifacts:

- `artifacts/evals/mcp-v1-agent-eval.song.json`
- `artifacts/evals/mcp-v1-agent-eval-backing-v1.wav`
- `artifacts/evals/mcp-v1-agent-eval.vsqx`

This evaluation proves agent usability for from-zero score, lyrics,
expression, arrangement, and native artifact construction. It does not claim
commercial timbre quality and intentionally does not repeat the separately
gated original-Editor vocal render or score-versus-render integration tests.

## Current host singer-registration check

A later optional Editor render attempt was intentionally kept outside the
isolated agent evaluation. The VSQX passed XSD and loaded far enough for Editor
to identify its singer, but the current Windows host reported that IA would be
substituted with a default singer even though the IA VVD metadata is present on
disk. No WAV was accepted. The exporter now recognizes that exact dialog and
fails immediately as `singer_unavailable`; it never clicks through and silently
misattributes a different voice to the manifest. `vocaloid_list_voices` now
labels VVD discovery as metadata-only and Editor availability as unverified
until render. Earlier gated IA lead/harmony Editor integrations remain the
successful synthesis regression; rerunning this particular eval needs the host
IA registration/licensing state restored.

The host owner subsequently confirmed that IA_ROCKS is the currently registered
singer. A derived manifest keeps the original agent composition unchanged while
binding `track-vocal-ia-main` to `IA_ROCKS` / component ID
`BDREB7P2KTWKYDC5`:

- `artifacts/evals/mcp-v1-agent-eval-ia-rocks.song.json`
- `artifacts/evals/mcp-v1-agent-eval-ia-rocks-backing-v1.wav`
- `artifacts/evals/mcp-v1-agent-eval-ia-rocks.vsqx`

The derived VSQX contains only IA_ROCKS in its voice table and passes both the
Yamaha VSQ3 XSD and structural validation. The first bounded Editor attempt
also exposed a writer defect: control curves had been sorted within each curve
but not across curves, producing native event ticks such as `3840, 5760, ...,
0`. Editor correctly stopped on `Event Verification` because the late tick-zero
event appeared in its Message Delay Zone. The writer now globally orders all
control points by tick, the validator rejects non-monotonic native control
events, and the clean IA_ROCKS rebuild emits `0, 0, 3840, ... 7679`. The local
manual explains that accepting the dialog would reduce Editor's global
Pre-Send time to fit the pre-measures; automation deliberately fixes the score
instead of silently changing that preference. A final Editor audio render was
not repeated in the same run, so IA_ROCKS synthesis availability remains gated
on the next single bounded render rather than inferred from VVD metadata.
