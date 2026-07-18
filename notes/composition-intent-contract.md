# Composition Intent Contract

## Purpose

The production system already knows how to make IA sing a complete timeline. This contract adds the creative question that must come first:

> What is IA meant to sing out in this phrase?

`composition_intent` preserves that answer as canonical creative state instead of leaving it only in an agent prompt. It does not claim that software can decide whether a phrase is moving. Deterministic code checks coverage, references, provenance, and measurable realization evidence; listening decides whether the phrase works.

## Three distinct domains

1. `composition_intent` declares what the current work, section, and phrase are trying to do.
2. `composition_guidance` declares theory rules, strictness, review policy, exceptions, and an optional aggregate style pin.
3. corpus/style evidence describes broad, sanitized observations and can never author or mutate intent.

The distinction is a hard boundary. An IA profile may report a broad register or performance range. It may not choose the narrator, addressee, semantic focus, phrase transition, delivery arc, realization hypothesis, or listening question.

## Hierarchy and context budget

Intent is inherited at three levels:

- song: premise, point of view, addressee, central tension, start state, intended destination, and creative invariants;
- section: dramatic function and the state transition assigned to one canonical section ID;
- phrase direction: a local utterance purpose, semantic focus, delivery arc, falsifiable realization hypothesis, and one listening question.

Every section should eventually have a concise section intent. A song initially needs only one to three explicit anchor phrases. Other phrases inherit their section direction unless they depart from it. Per-note prose is deliberately excluded.

The schema is `vocaloid-composition-intent/v1` and is defined in `src/intent/types.ts`. Free text is bounded, strict objects reject unknown fields, and controlled tags do not form a closed emotion ontology. Ambiguity, restraint, and deliberate non-resolution remain valid creative choices.

## Plan-before-score lifecycle

A phrase direction is a score-independent logical object. It may be written before a VOCALOID phrase, lyric unit, note, tuning gesture, chord, or arrangement track exists. This makes the intended order possible:

1. declare the phrase purpose and listening question;
2. compose the realization;
3. bind `realization_links` to stable manifest object IDs;
4. render a bounded audition;
5. record a listening decision.

An absent `realization_links` is an incomplete but valid planning state and does not block audition. Once links are supplied, every typed reference must exist. An unknown section emits `INTENT_SECTION_REFERENCE_INVALID`; an unknown score/tuning/arrangement target emits `INTENT_REALIZATION_REFERENCE_INVALID` before the manifest is written.

The current internal mutation entry points are:

- `setSongManifestCompositionIntent`;
- `upsertSongManifestSectionIntent`;
- `upsertSongManifestPhraseDirection`;
- `bindSongManifestPhraseRealization`.

They use the existing expected-revision, backup, canonical validation, and atomic write path. Public MCP actions and dry-run deltas are intentionally deferred until the analyzer/preflight integration milestone.

## Hash boundary

`songIntentHash` computes a canonical SHA-256 over `composition_intent`.

- Intent participates in `content_hash` and the `intent` history-diff domain.
- Intent does not participate in `composition_hash` or `mix_hash`.
- Changing only intent therefore leaves byte-identical score/audio artifacts technically current.
- Changing intent makes an earlier intent-fidelity listening decision stale.
- Changing notes, tuning, harmony, or arrangement changes `composition_hash` and also makes that decision stale.
- A legacy manifest without `composition_intent` gains no default object and keeps its existing hashes.

This separates two different questions: “Does this artifact still represent the score?” and “Does this artifact still answer the current artistic question?” Rebuilding identical audio cannot answer the second one; a new listening decision can.

## Listening review binding

An existing manifest review note may carry an optional `intent_fidelity` basis:

    {
      review_kind: "intent_fidelity",
      phrase_direction_id,
      listening_question_id,
      intent_hash,
      composition_hash,
      artifact_id,
      artifact_sha256,
      comparison_artifact_ids?,
      outcome: "keep" | "reject" | "revise"
    }

Adding a structured review requires a current phrase direction, question, intent hash, composition hash, selected artifact digest, and technically current selected artifact. Stored reviews remain readable after later edits. Inspection resolves them as current or stale with stable reasons such as `INTENT_HASH_MISMATCH`, `COMPOSITION_HASH_MISMATCH`, or `ARTIFACT_NOT_CURRENT`.

`keep` is accepted only when the full basis is current. A deterministic analyzer, corpus worker, or audio metric cannot create acceptance. `reject` and `revise` are first-class listening outcomes rather than failed tool calls.

## Technical and creative gates

- XML/schema/timeline/reference contradictions may block score/build.
- Missing intent or an unbound phrase may not block audition; the agent needs to hear experiments.
- `composition_guidance.intent_review_policy` is optional and has no parse-time default. Old manifests retain old delivery behavior.
- A future explicit `required_for_delivery` policy may require anchor coverage and a current listening review before final delivery.
- Style outliers never satisfy or override creative readiness.

## Audition discipline

The first creative closure should be a 20–30 second anchor passage:

1. IA lead solo;
2. lead plus harmony;
3. bass, drums, and one harmonic instrument;
4. optional full layers;
5. timbre and mix refinement.

One loudness-matched A/B answers one registered listening question. A musical choice is a hypothesis, not an emotion recipe: rising contour does not always mean hope, minor does not always mean sadness, and the presence of DYN/PIT/vibrato data does not prove a phrase is alive.

## Anti-copy and import boundary

Intent authoring imports no corpus, style profile, per-track feature, or nearest-reference API. Restricted corpus/style modules are contract-tested against importing the four intent mutation capabilities. Phrase realization, melody continuation, lyric allocation, and repair remain unable to reach the per-track corpus store.

The local IA library can accumulate evidence about the voice and broad musical practice, but the current work's meaning remains an original decision grounded in the user's brief and lyrics.
