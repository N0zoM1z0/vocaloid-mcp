# Local IA library to phrase-grammar curation method

Status: the earlier aggregate-profile and post-composition comparison design
was superseded on 2026-07-19.

The production agent does not query the local IA library and does not receive a
track aggregate, percentile comparison, nearest work, or next-note suggestion.
The maintained production surface is the versioned phrase-grammar DSL described
in `notes/phrase-grammar-dsl.md`.

## Permitted offline use

Local-library analysis may reveal that the current DSL lacks a broadly useful
musical choice. A maintainer can propose a new component or bundle only when it:

- is expressed as general role/entry/contour/rhythm/motion/cadence/development/
  allocation/articulation/space vocabulary;
- contains bounded invariants and misuse risks;
- is human reviewed and versioned;
- cannot reconstruct or identify a source work;
- contains no melody/chord/lyric sequence, path, track/work ID, producer
  ranking, nearest neighbor, or continuation material.

Provenance may be recorded as `local_library_abstraction`; it does not expose
which tracks motivated the abstraction. A production agent can select or reject
the component using the current phrase intent and theory, then must materialize
and audition it like any theory-curated component.

## Rejected production behavior

- no pre-composition aggregate style range;
- no post-composition percentile/style-fit comparison;
- no adaptive profile selection or similarity optimization;
- no corpus-derived repair proposal;
- no runtime corpus or restricted-index access from MCP.

This keeps the local library useful for expanding the team's compositional DSL
without turning it into an imitation or retrieval system.
