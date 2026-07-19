# Intent-first theory-only isolated benchmark

This benchmark asks a different question from the earlier MCP smoke tests. It does not ask only whether an agent can produce a valid VSQX. It asks whether the agent can preserve one fixed expressive purpose through score, note allocation, IA delivery, harmony, arrangement, audition, review, and release:

> Can I clearly hear the request underneath the line without IA sounding as if she is ordering the person to stay?

The fixed task is `benchmarks/intent-first/withheld-answer-anchor-v1.spec.json`. The brief, lyric surface text/readings, song/section intent, anchor purpose, semantic focus, transition, delivery arc, and listening question are held constant. The agent chooses musical realization; the benchmark does not prescribe a melody, chord progression, register, tuning recipe, or style target.

## Isolation

Run the creative attempt in a fresh temporary workspace with only the 20-tool `production` VOCALOID MCP profile. The agent must not have shell, network, another MCP, a mounted IA corpus, a style profile, a reference track, or direct filesystem reads. It may read only the general capabilities, composition-intent, music-theory, selected edit-action contracts, and the fixed task supplied in the prompt.

The evaluator requires a `vocaloid-intent-first-benchmark-trace/v1` transcript. Every successful `vocaloid_edit_song` write must have an earlier successful dry-run carrying the same mutation fingerprint. `set_composition_intent` must precede the first score/arrangement write. Invalid calls remain in the trace and are counted; they are evidence about agent usability, not silently deleted.

The trace proves only the capabilities exposed by the harness. It must not be reconstructed after the fact from a finished manifest. The trusted stdio proxy records actual production-MCP requests and responses, computes a canonical request fingerprint after removing only `dry_run`, extracts returned artifact IDs, and rejects style/corpus/reference resources. Its raw trace is still insufficient to prove that the client avoided shell, filesystem, web, or another tool. `finalize-intent-first-trace.mjs` therefore hashes and audits the complete Codex `--json` transcript; unknown action item types fail closed. Evaluation rejects a trace with no finalized client audit, any non-VOCALOID tool call, or fewer audited MCP calls than agent tool steps.

`actor: human` is never emitted by the MCP proxy. A manifest note that merely says `author_type: human` cannot complete Gate 2A: a trusted harness/operator step must separately attest the exact current review-note ID. Likewise, a delivery is valid for this benchmark only when its trace step occurs after that human attestation and its artifact records ready release-policy provenance.

## Reproducible technical run

Build a fresh run ID and inherit whatever API proxy environment the operator needs, then invoke:

```bash
scripts/run-intent-first-agent-benchmark.sh intent-first-20260719-a
```

The runner refuses an existing run directory. It renders the fixed prompt from the tracked spec, starts an ephemeral Codex client with ignored user config/rules and a read-only shell sandbox, configures only the recording VOCALOID MCP proxy, retains Codex JSONL/stderr, finalizes the transcript audit, and evaluates any resulting manifest. All mutable output stays under `build/benchmarks/<run-id>/`, which is ignored by Git.

The expected first stopping state is `awaiting_human_listening`, not `passed`. Do not use `--require-pass` for this technical phase. A later operator must listen to the current A/B, answer the fixed question, persist the hash-bound review, add the trusted human trace step, and only then allow a post-listening delivery. The runner has intentionally not been invoked from the implementation session that created it: that session is not a fresh isolated agent and cannot supply human listening evidence.

## Required sequence

1. Copy the fixed song, section, and anchor intent into canonical `composition_intent` before writing score objects.
2. Establish an 8-measure, 20–30 second anchor section with explicit meter/tempo, key/harmony, bass/cadential plan, and stable IDs.
3. Preserve each supplied Japanese lyric surface string and reading separately in phrase `linguistic_source`; use mora/phoneme alignment, rests, sustains, and melisma intentionally.
4. Bind the fixed anchor and semantic focus to current vocal/lyric/event objects. A realization hypothesis may be added, but it must be falsifiable and may not rewrite the fixed listening question.
5. Complete lead melody and IA delivery first. Then add harmony only with an explicit role, followed by bass, drums, and one core harmonic instrument. Additional layers are optional and need a mute-test rationale.
6. Run shared preflight. Structural errors must be zero. The benchmark guidance must require `warning` disposition; repair a warning or preserve it through an exact current fingerprint-bound exception after listening.
7. Build a current VSQX and audio source. Save current 20–30 second `lead_solo`, `lead_harmony`, and `minimal_band` previews for the same anchor/question.
8. Produce at least one current loudness-matched A/B pair that changes exactly one declared hypothesis family.
9. Stop for listening. The system/analyzer must not write `keep`. A listener records `keep`, `reject`, or `revise` by directly answering the fixed question and binding current intent/composition/artifact hashes.
10. Only a current `keep` plus ready release policy permits final delivery. Gate 2A additionally requires at least one human-confirmed current moment.

## Machine evaluation

`evaluateIntentFirstBenchmark` in `src/evaluation/intent-first-benchmark.ts` parses the fixed spec and trace, reloads the canonical manifest, and reruns current-artifact preflight. It reports separate Gate 1, Gate 2, and Gate 2A checks rather than one style/quality score.

It verifies:

- fixed manifest/intent/question preservation;
- lyric surface/reading provenance and fixed IA_ROCKS identity;
- production-MCP isolation, intent-before-score order, and dry-run-before-write;
- fail-closed Codex JSONL audit and exact production-tool membership;
- no style pin or corpus/style/reference operation;
- complete section/anchor coverage and stable realization binding;
- a real 20–30 second anchor scope plus separate lead/harmony vocal and bass/drums/harmonic-instrument roles;
- zero structural theory blockers and zero unresolved policy-required warnings;
- trace-linked current VSQX, three-layer anchor audition, and single-question/loudness-matched/one-family A/B provenance;
- current hash-bound `keep`, separately requiring a matching trusted human step;
- ready release policy and a current delivery created after that human step.

Missing creative audition/review/delivery evidence is `pending`, not an invented failure of musical quality. A structural contradiction, changed fixed brief/question, prohibited evidence access, missing dry-run, unresolved required warning, or stale exception is a failure. A current `reject`/`revise` produces `revision_requested`: it is a valid listening result and should lead to another bounded hypothesis, not to metric gaming.

The evaluator can report `passed` only when all checks pass, including human confirmation. Automated metrics can never promote `awaiting_human_listening` to `passed`.

The passing fixture in `tests/intent-first-benchmark.test.ts` is synthetic contract evidence only. It proves that all gates are reachable and that missing/forged process evidence is rejected; it is not an audition result and makes no claim that its generated notes are artistically successful.
