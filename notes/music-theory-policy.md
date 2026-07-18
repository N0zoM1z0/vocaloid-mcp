# Music Theory Policy Contract

This note defines the deterministic theory boundary introduced by `core/v1`. It is a contract for implementation and review, not a claim that one textbook style is universally correct.

## Decision order

The production workflow uses lexicographic priorities:

1. preserve the user's brief, lyric meaning, and declared song/section/phrase intent;
2. make the melody, harmony, rhythm, note allocation, IA delivery, and arrangement traceably serve that intent;
3. make form, timeline, harmony, singability, note allocation, voice leading, and arrangement internally coherent;
4. pass novelty and provenance gates;
5. optionally compare the completed symbolic composition with one pinned aggregate IA profile.

Style evidence never suppresses a structural error and never supplies the next note, chord, lyric allocation, or repair patch.

## Severity

- `error`: contradictory or uninterpretable symbolic state. Score/build must stop. No exception may suppress it.
- `warning`: concrete musical or performance risk. It never blocks audition/build; a delivery policy can require a repair or fingerprint-bound exception.
- `info`: composition/style observation. It never blocks build and is release-advisory unless a caller explicitly includes `info` in `required_review_severities`.

Every rule has a stable uppercase code and an explicit rule version. A ruleset has a stable ID and content hash. Reports are sorted deterministically so an unchanged composition produces byte-stable findings.

`src/theory/rules.ts` is the single registry for each analyzer code, version, domain, allowed severity class, and structural status. Domain analyzers locate evidence, but report construction rejects an unregistered code or a version/domain/severity that disagrees with the registry. Only registry-owned structural findings that actually resolve to `error` enter score/build blockers; a warning-level partial chord parse or unresolved color tone remains auditionable.

## Symbolic analyzer boundary

`analyzeManifestTheory` builds one read-only symbolic index, then reports separate form, timeline, key/harmony, melody, rhythm, vocal/note-allocation, voice-leading, arrangement, and performance metrics. Its interval queries and register occupancy use bounded indexes/sweeps; a 20,000-event vocal fixture and a 20,000-event overlapping-arrangement fixture are required to finish within two seconds on the development host without mutating the manifest.

The analyzer can locate such things as incomplete harmonic coverage, unresolved sustained non-chord tones, unbalanced leaps, missing breath windows, mora/consonant timing budgets, unsuitable melisma phonemes, compound-meter/pattern conflicts, cross-voice collisions, slash-bass conflicts, register crowding, duplicated accompaniment roles, and section-density mismatches. Practical instrument and IA tessitura ranges are conservative warnings, not renderer facts.

These findings describe symbolic coherence and audition risks. They do not infer whether a phrase is moving, authentically "IA-like", or faithful to the declared intent; they never read the corpus/style profile and never write `keep`, `accepted`, or another listening conclusion. Intent-realization evidence and the human listening gate are separate contracts.

The same analyzer runs inside `vocaloid_preflight_song`, build preflight, final-delivery preflight, and mutation dry-run. A dry-run evaluates both the current and predicted manifests, then reports issue identities/codes, changed metrics, changed intent evidence, listening-review staleness, stale exceptions, and the predicted release gate without mutating the canonical file. This prevents a repair path from using a different theory implementation than the final build gate.

## Bounded proposal contract

`vocaloid_preflight_song` can opt into `vocaloid-theory-proposals/v1`. The proposal layer is a deterministic, read-only projection over the same manifest and theory report. It can offer voicing, harmony, local melody repair, scale-aware/register transpose, and breath-redistribution hypotheses. It cannot query a corpus, style profile, reference track, nearest neighbor, or continuation table.

Each proposal is bound to the current manifest revision, composition hash, source issue code, and exact issue fingerprint. A response contains at most 3 alternatives for one issue, at most 3 candidates bound to one phrase direction, and at most 3–8 alternatives overall. Alternatives in one group use A/B/C labels, an exact rationale, explicit before/after object fields, a predicted issue/metric delta, and the stable IDs affected. Predicted deltas are symbolic projections rather than proof: every proposal identifies the issue codes that must be rechecked by the real mutation preview.

A proposal never calls a mutation function. To evaluate one, the agent must:

1. copy the candidate's action patch into `vocaloid_edit_song` together with the canonical input/output path;
2. keep the candidate's `expectedRevision` and set `dry_run=true`;
3. inspect the actual introduced/resolved issue codes, theory metrics, intent evidence, and review-staleness delta;
4. reject stale hashes/revisions and any candidate that creates a worse structural or intent conflict;
5. audition meaningful alternatives before selecting one; only then may the chosen action be submitted as a separate write.

When a source issue intersects a declared phrase direction, all alternatives preserve that direction's existing listening question and expose its phrase purpose. Theory repair is therefore subordinate to “what should IA sing out here?” It must not silently replace the phrase purpose, semantic focus, or listening question. A proposal without linked intent uses a clearly labelled diagnostic question and cannot manufacture an emotional or `keep` conclusion.

## Evidence

Evidence is one of:

- `symbolic_exact`: directly derived from manifest/VSQX positions, notes, lyrics, or stable IDs;
- `audio_measured`: direct audio measurements such as duration or loudness;
- `audio_estimated`: model-derived tempo, pitch, chord, section, or vocal estimates;
- `human_verified`: curated identity, role, genre, voicebank, or review decisions.

Low-confidence `audio_estimated` evidence cannot create a structural blocker.

## Exceptions

An exception binds:

- one stable issue code;
- one or more exact manifest object IDs;
- a SHA-256 fingerprint of the target state;
- a rationale, author type, and creation timestamp.

`set_composition_guidance` installs the policy and validates every supplied exception against the current `core/v1` report. `upsert_theory_exception` accepts only an issue's current exact code, unordered-equal object-ID set, and target fingerprint. A free-text review note does not suppress a finding. More than one exception for the same exact issue state is invalid.

A valid exception moves only that exact warning/info finding from `issues` to `ignoredIssues`; it does not rewrite the score or claim the musical choice succeeds. The fingerprint commits the rule version, symbolic evidence, target object state, and local issue context. Changing a targeted note, chord, section, or other relevant object makes the old exception stale. A stale/forbidden exception stops suppressing the underlying finding, appears in `staleExceptions`, and creates the structural `THEORY_EXCEPTION_STALE` error. Remove it with `remove_objects`/`object_type=theory_exception`, repair the current issue, or create a new exception from the newly inspected fingerprint after listening. Error-level structural issues cannot be excepted. Novelty/copy-risk overrides require a human author and remain separate release-review events.

## Release policy

`vocaloid_preflight_song` returns a separate `releasePolicy` object. This is deliberately not the score/build gate:

- no `composition_guidance`: policy is disabled/ready and legacy delivery behavior is unchanged;
- `required_review_severities`: every still-active finding at a listed warning/info severity must be repaired or precisely excepted;
- any stale exception is a structural build and release blocker;
- `intent_review_policy.mode=required_for_delivery` enforces only its explicit song/section/anchor/current-audition requirements;
- `off` and `advisory` keep creative-readiness evidence visible without blocking delivery.

`vocaloid_master_manifest_delivery` reruns current artifact, structural build, and release-policy checks before creating the output WAV. A blocked call creates no delivery file or artifact record. This does not prevent exploratory VSQX/build/render/anchor audition: creative questions must be heard before they can be reviewed.

## Hash boundary

`composition_guidance` is optional and has no parse-time default. It participates in `content_hash` and history diff, but not `composition_hash` or `mix_hash`. Adding or reviewing policy therefore does not make score/audio artifacts stale.

`composition_intent` is a separate optional creative declaration. It participates in `content_hash` and has a derived `intent_hash`, but does not enter `composition_hash` or `mix_hash`. An intent-only edit invalidates intent-fidelity listening review instead of forcing a byte-identical score/audio rebuild. See `composition-intent-contract.md`.

## Style pin

A song can pin one aggregate style profile ID/version. The pin is provenance, not a recipe. Changing it requires an explicit guidance revision. Production code never receives a reference track ID, title, path, nearest neighbor, or reconstructive sequence.
