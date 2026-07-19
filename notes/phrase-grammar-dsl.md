# Vocal phrase grammar DSL

Status: active production-agent contract from 2026-07-19.

## Purpose

`vocaloid-phrase-grammar/v1` is a deterministic vocabulary for choosing how a
vocal phrase is constructed. It sits between phrase intent and concrete notes:

`phrase purpose -> grammar blueprint -> notes/rests/allocation -> IA delivery -> listening`

It is not an automatic melody generator and does not claim that one contour,
cadence, or IA parameter creates an emotion. The agent chooses components,
states bounded measurable limits when useful, writes the actual music, then
checks whether those choices materialized.

The final melody is authored by the agent from the current intent, lyric
prosody, harmony, and form. The DSL contains no pitch sequence, scale-degree
sequence, onset/duration sequence, continuation table, or compile-to-melody
operation. It may describe a choice after or while the agent composes, but it
cannot be expanded into template notes.

## Dimensions

- `role`: statement, continuation, answer, contrast, lift, release, hook, tag;
- `entry`: downbeat, short/long pickup, delayed, offbeat;
- `contour`: level, directional, arch/valley, plateau, early/late peak,
  terraces, leap-hold-release, pendulum, recitative pedal, asymmetric wave;
- `rhythm`: syllabic grid, long/short contrast, syncopated ties, pickup flow,
  repeated anchor, sparse breath, acceleration/deceleration, compound lilt,
  hemiola, anticipatory rest, sustained tail;
- `motion`: stepwise, repeated tone, leap recovery, chord outline, neighbor,
  appoggiatura, pentatonic gap, modal pivot, sequential cell;
- `cadence`: closed/open, soft third, suspended, deceptive, plagal, breath cut,
  downward release;
- `development`: new, exact/varied repeat, sequence, fragment, augmentation,
  diminution, displacement, inversion;
- `allocation`: syllabic, focus melisma, held/tied vowel, consonant pickup,
  repeated mora, sparse text;
- `articulation`: legato, connected accent, local detached, breath-led,
  delayed vibrato, plain tone;
- `space`: continuous span, semantic breath, caesura, boundary silence,
  tail rest, interruption.

The canonical catalog and strict blueprint schema live in
`src/phrase-grammar.ts`. `vocaloid://phrase-grammar` returns the compact index;
`vocaloid_phrase_grammar` lists components, validates a blueprint, or analyzes a
manifest.

## Bundle policy

Bundles such as `ia.transparent-longline`, `ia.rocks-forward`,
`jpop.hook-contrast`, and `night.sparse-distance` are choice palettes. They do
not populate all phrases with the same settings. `option_component_ids` is an
unordered option pool: array order has no musical meaning, the agent selects a
subset, and a bundle can never auto-fill a phrase blueprint. Every bundle
publishes `variation_axes`, `melody_material=absent`, and explicit
`avoid_as_default` warnings.

A section should normally distribute different roles and at least some
different entry, rhythm, contour, motion, cadence, or space choices. Exact
repeat remains legal when it is bound to a stable source phrase and serves an
intentional hook.

## Local IA library boundary

Production agents do not query the local IA song library. The library may be
used offline to motivate a candidate DSL component or bundle, but that addition
must be human reviewed and contain only general musical vocabulary and bounded
constraints.

The DSL must never contain:

- source title, producer, path, work/track ID, or nearest neighbor;
- a reference melody/chord sequence, lyric, long F0 contour, or reconstructive
  interval/rhythm sequence;
- a continuation table, exact replacement note, or instruction to imitate a
  particular song.

The production agent sees the versioned DSL, not the corpus and not aggregate
track statistics. This makes the library useful for expanding compositional
choices without turning it into a retrieval or copying surface.

## Analysis boundary

`vocaloid_phrase_grammar` / `analyze_manifest` is read-only and separate from
the core theory preflight. It reports phrase-level evidence such as:

- repeated entry positions;
- stepwise/repeated-tone concentration;
- normalized contour clusters;
- peak-position concentration;
- normalized duration fingerprints;
- explicit blueprint limit mismatches.

It does not change severity in the existing theory ruleset, generate repair
notes, mutate a manifest, or decide whether the music is good. A finding should
lead to an intent-preserving bounded alternative and equal-loudness audition,
not random diversification.
