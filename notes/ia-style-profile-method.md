# IA Aggregate Style Profile Method

IA is a singing medium used by many producers and genres, not one homogeneous composition style. Profiles therefore separate vocal performance, producer/cluster composition, arrangement, and master/mix evidence.

## Eligible profile families

- broad IA corpus background: wide context only, never strong guidance;
- human-reviewed producer or cluster profiles with sufficient distinct works;
- IA/IA_ROCKS vocal-performance profiles using verified vocal identity;
- IA_ROCKS native-control calibration profiles from controlled local probes;
- era/album production profiles for mix/master comparison, not composition rules.

## Aggregation

For each approved dimension record median, IQR, p10/p90, bootstrap interval, feature coverage, distinct work/producer counts, evidence level, and toolchain hash. Build both work-balanced and producer-balanced estimates. Section-conditioned features require the same privacy/sample checks as global values.

Minimum initial floors:

- general cluster: 12 distinct works and 4 producers;
- producer profile: 5 distinct works;
- vocal-performance dimension: 8 high-confidence vocal tracks.

Anything below the floor is experimental and absent from production agent guidance.

## Non-reconstructive composition dimensions

Allowed aggregate dimensions include tempo/meter ranges, section length and energy distributions, melodic range/tessitura, normalized interval histogram, onset density, syncopation, harmonic-rhythm ranges, chord-color frequency, cadence summary, and section-level arrangement density.

Forbidden fields include complete melody or chord timelines, lyrics, per-track F0, long sequence tables, source identities, nearest neighbors, paths, reversible embeddings, and exact replacement notes/chords.

## Comparison behavior

Production comparison returns per-dimension observed value, robust range/percentile band, evidence coverage/confidence, scope, and an info-level bounded observation. It returns no sortable composite similarity score and cannot invoke mutation or proposal tools.

The profile ID/version is pinned when the song skeleton is established. The agent cannot scan profiles and select the highest score. Corpus absence or profile disablement has no effect on deterministic theory analysis or rendering.

## Validation

Compare baseline, theory-only, and theory-plus-one-pinned-profile on fixed briefs/seeds. Theory-only must improve form, harmony, singability, note allocation, voice leading, and arrangement before style integration is considered. Adding a profile may move selected dimensions into a predeclared reasonable band, but must not increase theory warnings, producer dominance, or reference overlap.

Novelty calibration includes exact, transposed, rhythm-scaled, and ornamented copies as positive fixtures, plus common short motifs and common four-chord loops as negative controls. Novelty is a release safety signal, not a copyright verdict or a source of repair material.
