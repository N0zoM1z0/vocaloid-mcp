# Creative decision journal policy

The canonical manifest stores what the song is. The creative journal stores a concise,
auditable account of why the current realization was chosen and what evidence should be
heard or inspected. It is deliberately not a raw hidden chain-of-thought transcript.

## Required chain

Every delivered composition must have current decisions covering:

1. intent;
2. form, meter/tempo, harmony, and melody;
3. Japanese note allocation;
4. IA delivery;
5. arrangement.

Record adjustments, audition outcomes, mix choices, and retrospectives when they occur.
A report may be generated at any time, but publishing a final creative-record package is
blocked until all five core dimensions are current and both a current song artifact and a
current VSQX artifact are supplied.

## What one decision records

Use one stable decision ID for one bounded choice. State the objective, selected decision,
concise rationale, alternatives and their dispositions, expected audible effect, evidence,
actual result when known, and the next listening or implementation step. Bind it to at
least one stable manifest object, registered artifact, or intent/composition/mix hash.

Evidence must distinguish these levels:

- declared: an intent or gesture exists in the canonical manifest;
- materialized: the generated VSQX contains the corresponding native notes, controls, or
  expression values;
- rendered: the original VOCALOID Editor produced a non-silent digest-bound vocal stem;
- heard: a named human or agent made an explicit listening judgement against one question.

Do not infer one level from another. In particular, a declared gesture is not evidence that
PIT, PBS, DYN, opening, or vibrato was serialized, and a structurally valid VSQX is not proof
that the host Editor rendered audible vocals.

## Freshness and revision

The journal is an append-only SHA-256 hash chain. Each entry captures the manifest
revision/hashes, selected stable-object fingerprints, and selected artifact digests. A later
manifest change does not erase the decision; it makes the entry stale when a bound object,
artifact, or requested hash dependency changes. Replace a stale or rejected decision by
appending a new entry with `supersedes_decision_ids`.

Use `expected_revision` for records that mutate the journal. Journal writes never increment
the manifest revision and therefore cannot invalidate composition or audio artifacts.

## Workflow

Read `vocaloid://creative-journal-contract/{action}` before using the compact
`vocaloid_creative_journal` envelope.

- `record`: validate or append one decision.
- `list`: query decisions with pagination and current/stale/superseded resolution.
- `report`: render the complete timeline as Markdown.
- `publish`: create a self-contained record directory containing the current manifest
  snapshot, hash-chained JSONL journal, Markdown report, and an index bound to final
  deliverable digests.

The published package links the final WAV and VSQX rather than duplicating large media.
Keep the deliverables at stable repository paths and preserve their immutable digests.

