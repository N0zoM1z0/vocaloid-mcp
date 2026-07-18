# Music Theory Policy Contract

This note defines the deterministic theory boundary introduced by `core/v1`. It is a contract for implementation and review, not a claim that one textbook style is universally correct.

## Decision order

The production workflow uses lexicographic priorities:

1. preserve the user's brief, lyric meaning, and declared formal intent;
2. make form, timeline, harmony, singability, note allocation, voice leading, and arrangement internally coherent;
3. pass novelty and provenance gates;
4. optionally compare the completed symbolic composition with one pinned aggregate IA profile.

Style evidence never suppresses a structural error and never supplies the next note, chord, lyric allocation, or repair patch.

## Severity

- `error`: contradictory or uninterpretable symbolic state. Score/build must stop. No exception may suppress it.
- `warning`: concrete musical or performance risk. Delivery requires a repair or a fingerprint-bound exception.
- `info`: composition/style observation. It never blocks build or delivery.

Every rule has a stable uppercase code and an explicit rule version. A ruleset has a stable ID and content hash. Reports are sorted deterministically so an unchanged composition produces byte-stable findings.

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

Changing a target makes the exception stale. Error-level structural issues cannot be excepted. Novelty/copy-risk overrides require a human author and remain release-review events.

## Hash boundary

`composition_guidance` is optional and has no parse-time default. It participates in `content_hash` and history diff, but not `composition_hash` or `mix_hash`. Adding or reviewing policy therefore does not make score/audio artifacts stale.

## Style pin

A song can pin one aggregate style profile ID/version. The pin is provenance, not a recipe. Changing it requires an explicit guidance revision. Production code never receives a reference track ID, title, path, nearest neighbor, or reconstructive sequence.
