# IA Corpus Data Contract

The local IA library is read-only source material for offline cataloging, validation, aggregate profile construction, and release-time novelty checks. It is not a retrieval-augmented melody generator.

## Roots and immutability

- Source root: `VOCALOID_IA_CORPUS_ROOT` (expected local value `/mnt/d/Entertainment/Music/VOCALOID/IA`).
- Derived root: `VOCALOID_IA_ANALYSIS_ROOT` (default repository-local `build/ia-corpus`).
- The scanner resolves real paths inside the source root, opens no source write handles, and sends subprocess arguments without shell interpolation.
- Archives are inventory-only by default. Executables, DLLs, BIN files, Editor packages, and voicebanks are permanently excluded.

## Evidence records

Each local file record stores source and decoded-PCM digests, size, mtime, codec, sample format, metadata-normalization version, and pipeline provenance. Audio estimates additionally store confidence, alternatives, model/library version, parameter hash, and validation status.

Identity has two levels:

- work: the underlying composition, weighted once in composition statistics;
- version: release, master, remix, off-vocal, duet, or encoding variant.

Automatic clustering only creates review candidates. Voice identity, producer, duet/human/off-vocal status, and reference suitability require human verification before entering a production profile.

## Storage classes

- Restricted local: absolute paths, track/work IDs, per-track features, fingerprints, embeddings, section estimates, F0, note/chord sequences, and audit match identities.
- Git-safe: schemas, code, synthetic fixtures, aggregate profiles approved as non-reconstructive, and provenance summaries without local paths.
- Production MCP: aggregate profile ranges and corpus status counts only.

The production server process must not import or load the restricted per-track store. Novelty analysis runs in an isolated local worker and returns a strict sanitized response without reference identity.

## Production export firewall

Every exported cell meets a sample floor and is work/producer balanced. Small cells are suppressed. Profiles expose robust ranges, coverage, confidence, and toolchain hashes; they do not expose titles, representative tracks, included work IDs, nearest neighbors, long n-grams, chord timelines, F0 contours, lyrics, paths, or reversible embeddings.

Validation includes leave-one-work-out, leave-one-producer-out, leave-one-album-out, and contribution-dominance tests. A profile that depends strongly on one source is experimental and cannot enter production instructions.

## Allowed checkpoints

1. Before composition: optional broad aggregate ranges only.
2. After a theory-ready symbolic composition: dimension-level observation without exact corpus-derived repair.
3. Before release: sanitized novelty/copy-risk audit.

The restricted store is unreachable during per-note generation, continuation, lyric allocation, and repair proposal execution.
