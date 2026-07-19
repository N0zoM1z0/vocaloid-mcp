# Problem and solution log

This is the stable index for implementation problems discovered through real
composition and listening. Detailed evidence belongs in a dated note; this file
records the durable problem, scope, decision, and current status.

## 2026-07-19 — Distant-lights cold-start follow-up

Detailed note: `notes/tooi-hi-aoi-yoru-root-cause-and-grammar-2026-07-19.md`

- **Reported sharp/separated vocal in final WAV**
  - Scope: absent in dry lead and processed-vocal anchor; present only after
    later delivery layers according to the listener.
  - Evidence: vocal-only and full-mix anchor spectra/loudness differ by at most
    about 0.1 dB per measured band; final mastering raises the anchor by roughly
    18 dB and reduces its LRA.
  - Decision: do not globally change IA_ROCKS, note gates, EQ, or arrangement.
    Add mastering transparency metrics and require equal-loudness source versus
    delivery A/B when peak/LRA reshaping is material.
  - Status: diagnostic A/B rendered; framework diagnostic implemented; human
    A/B result pending before publishing a replacement final.

- **Formulaic rise/fall phrase construction**
  - Scope: 20 downbeat-starting, fixed-grid phrases; 97.9% of comparable motion
    is 1–3 semitone stepwise and core theory already reported 77.9% repeated
    interval trigrams.
  - Decision: add an opt-in phrase-grammar DSL and a separate read-only
    phrase-level analyzer. Bundles are unordered style/genre option pools with
    no melody material; the agent composes final notes from intent, prosody,
    harmony, and form. Do not randomize notes or change legacy preflight.
  - Status: implemented with stable components, bundles, blueprint validation,
    manifest storage, MCP resource/tool access, and regression tests.

- **Local IA library role was underspecified**
  - Scope: post-composition aggregate comparison adds machinery but does not
    help a production agent choose richer phrase construction.
  - Decision: retire production aggregate comparison. The local library is an
    offline source of candidate, human-reviewed, non-reconstructive DSL
    vocabulary; production agents see only the DSL.
  - Status: policy and capability contract updated; no corpus path or retrieval
    was added to MCP.
