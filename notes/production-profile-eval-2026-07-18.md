# Production-profile Codex MCP evaluation

Date: 2026-07-18

Client: `codex-cli 0.144.5`

Server: local `dist/src/index.js`, default `production` profile

## Isolation

The successful session used `--ignore-user-config --ephemeral --sandbox
read-only` and loaded only this stdio MCP. Codex 0.144 exposes MCP calls through
its JavaScript orchestration entrypoint, so the prompt allowed that entrypoint
only for `mcp__vocaloid__*`, `list_mcp_resources`, and `read_mcp_resource`.
It explicitly prohibited `exec_command`, shell, direct filesystem access,
network access, and every other MCP.

The production catalog contained exactly 20 tools and serialized to less than
80 KB. Every production tool advertised a concrete output schema. Style,
capability, lyric, and call-example material was available on demand as MCP
resources instead of inflating every tool definition.

## Failure found by the agent test

The first mutation session created a valid revision-1 skeleton and aligned
`風を駆ける` / `かぜをかける`, but Codex cancelled both
`vocaloid_edit_song(dry_run=true)` calls. Direct stdio reproduction of the same
vocal-part preview completed successfully in 256 ms, proving that neither the
server nor preflight was hung.

The cause was the composite tool's static MCP annotation:

```text
destructiveHint: true
```

Codex correctly treated even the read-only `dry_run=true` variant as a
potentially destructive noninteractive call. The router is now marked
non-destructive because every same-path write creates a timestamped backup and
manifest history restore is monotonic; its description states that guarantee.
A protocol regression asserts this annotation. An exact on-demand
`vocaloid://examples/from-zero` resource was also added because the successful
agent still needed six schema corrections across vocal and arrangement calls.

The same evaluation also caught a separate instruction error: `BLRG...` is IA,
not IA_ROCKS. The server now imports one canonical IA_ROCKS component constant,
`BDREB7P2KTWKYDC5`, from the style palette rather than duplicating the ID in
agent instructions.

## Successful rerun

The clean rerun created
`artifacts/evals/production-profile-agent-smoke-v2.song.json` entirely through
public MCP calls:

1. revision 1: four-bar 4/4, 132 BPM skeleton with intro and verse;
2. successful vocal dry-run, then revision 2 with a six-mora IA_ROCKS phrase;
3. successful arrangement dry-run, then revision 3 with a non-empty pitched
   guitar track;
4. final cached-voice preflight with no build or render.

Independent root verification, rather than the agent's report, found:

- manifest revision: 3;
- composition SHA-256:
  `47e066be378d07ca21d04d6ea6a597ae76ea142ba35c5755918b70af496d6cc5`;
- content SHA-256:
  `5fd42df394c886b8403bf206a640fdb873cfc34c933e1ea9bbb4548d922ddc59`;
- one IA_ROCKS voice, one vocal track/part/phrase, six vocal events;
- one pitched arrangement track with four direct events;
- zero preflight errors, warnings, or infos;
- score/build readiness true;
- render blocked only by the deliberately absent current VSQX;
- no Editor lease or residual evaluation process.

The final Codex report is retained as
`artifacts/evals/production-profile-agent-smoke-final-v5.md`.

## Remaining routing friction

The corrected agent completed the task but reported six parameter/schema
corrections. This is acceptable evidence of recovery, not the desired steady
state. Future repeated routing evaluations should instruct the agent to read
`vocaloid://examples/from-zero` and track whether invalid-call count falls.
Creative long-song evaluation remains separate because composition quality and
native render duration would obscure basic routing measurements.

