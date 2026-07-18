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

An optional `realization_hypothesis.symbolic_targets` makes only musical claims that code can actually test: melody contour/range, onset or note-duration trajectory, harmonic-tension direction, DYN direction, arrangement-density direction, and semantic-focus duration/beat placement. These targets do not encode emotion. Without a structured target, the analyzer reports the observed musical evidence with relation `unknown`; it never converts prose such as “more moving” into a fake score.

## Plan-before-score lifecycle

A phrase direction is a score-independent logical object. It may be written before a VOCALOID phrase, lyric unit, note, tuning gesture, chord, or arrangement track exists. This makes the intended order possible:

1. declare the phrase purpose and listening question;
2. compose the realization;
3. bind `realization_links` to stable manifest object IDs;
4. render a bounded audition;
5. record a listening decision.

An absent `realization_links` is an incomplete but valid planning state and does not block audition. Once links are supplied, every typed reference must exist. An unknown section emits `INTENT_SECTION_REFERENCE_INVALID`; an unknown score/tuning/arrangement target emits `INTENT_REALIZATION_REFERENCE_INVALID` before the manifest is written.

The canonical mutation entry points are:

- `setSongManifestCompositionIntent`;
- `upsertSongManifestSectionIntent`;
- `upsertSongManifestPhraseDirection`;
- `bindSongManifestPhraseRealization`.

They use the existing expected-revision, backup, canonical validation, and atomic write path. The same four operations are public `vocaloid_edit_song` actions: `set_composition_intent`, `upsert_section_intent`, `upsert_phrase_direction`, and `bind_phrase_realization`. The production tool keeps a compact `{ action, payload, response_format }` envelope; read `vocaloid://edit-song-contract/{action}` for the exact strict payload schema, and use `dry_run=true` before writing.

Process policy is written separately through `set_composition_guidance` and `upsert_theory_exception`. Neither action is allowed to author phrase purpose or infer it from style/corpus evidence.

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
      comparison_artifacts?: [{ artifact_id, artifact_sha256 }],
      hypothesis_family?,
      layer_assessment?,
      outcome: "keep" | "reject" | "revise"
    }

Adding a structured review requires a current phrase direction, question, intent hash, composition hash, selected artifact digest, and technically current selected artifact. Stored reviews remain readable after later edits. Inspection resolves them as current or stale with stable reasons such as `INTENT_HASH_MISMATCH`, `COMPOSITION_HASH_MISMATCH`, or `ARTIFACT_NOT_CURRENT`.

New A/B reviews should use digest-bound `comparison_artifacts`; legacy ID-only comparisons remain readable. A changed comparison digest or a stale comparison dependency also stales the decision. `layer_assessment` can explicitly record that a layer supports the question, obscures it, is uncertain, or causes no audible loss when muted, together with a `keep`/`remove`/`revise`/`defer` action. This is authored listening evidence, never an analyzer inference.

`keep` is accepted only when the full basis is current. A deterministic analyzer, corpus worker, or audio metric cannot create acceptance. `reject` and `revise` are first-class listening outcomes rather than failed tool calls.

## Technical and creative gates

- XML/schema/timeline/reference contradictions may block score/build.
- Missing intent or an unbound phrase may not block audition; the agent needs to hear experiments.
- `composition_guidance.intent_review_policy` is optional and has no parse-time default. Old manifests retain old delivery behavior.
- `off` and `advisory` report creative state without changing delivery behavior.
- An explicit `required_for_delivery` policy enforces its selected requirements before final mastering: song intent, full section-intent coverage, a minimum number of anchor phrases, and/or current audition review.
- `require_current_audition_review=true` requires every current anchor to have the current lead-solo → lead-harmony → minimal-band audition ladder and an explicit digest/hash-bound `keep` review. A metric or analyzer cannot sign that review.
- Required creative review affects only final delivery. It does not block score/build/render/anchor-preview experimentation.
- Style outliers never satisfy or override creative readiness.

`vocaloid_preflight_song` returns the shared `core/v1` theory report, creative-readiness report, and a separate `releasePolicy` result. Its score/build gates consume only registered error-level structural theory findings; missing intent, missing audition layers, and listening status remain auditionable. The final-delivery tool reruns build/release checks before writing audio. Every edit dry-run compares before/after reports and returns introduced/resolved issue codes, changed theory metrics, changed phrase evidence, creative status, stale exceptions, predicted release policy, and whether a current listening decision would become stale. This comparison cannot create a new listening outcome.

When bounded theory proposals are requested, any candidate whose stable targets intersect a phrase direction inherits that direction's exact purpose and listening-question ID. All A/B/C variants in the issue group must answer that same question. A pitch, voicing, duration, or breath repair may improve symbolic coherence, but it cannot redefine what IA is meant to sing out, manufacture a new emotional label, or silently sign `keep`; selection still requires a dry-run followed by listening.

## Audition discipline

The first creative closure should be a 20–30 second anchor passage:

1. IA lead solo;
2. lead plus harmony;
3. bass, drums, and one harmonic instrument;
4. optional full layers;
5. timbre and mix refinement.

One loudness-matched A/B answers one registered listening question. A musical choice is a hypothesis, not an emotion recipe: rising contour does not always mean hope, minor does not always mean sadness, and the presence of DYN/PIT/vibrato data does not prove a phrase is alive.

`vocaloid_review_audio` keeps this inside the existing compact tool surface. `anchor_preview` derives the same bounded passage from stable realization links and records its layer/question/intent provenance. `compare_anchor_ab` fixes that passage and question, permits one declared hypothesis family, loudness-matches the two outputs, and returns both digests as a review-binding template. Neither action chooses a winner. `vocaloid_review_song` is the only step that persists the listener's outcome.

## Anti-copy and import boundary

Intent authoring imports no corpus, style profile, per-track feature, or nearest-reference API. Restricted corpus/style modules are contract-tested against importing the four intent mutation capabilities. Phrase realization, melody continuation, lyric allocation, and repair remain unable to reach the per-track corpus store.

The local IA library can accumulate evidence about the voice and broad musical practice, but the current work's meaning remains an original decision grounded in the user's brief and lyrics.
