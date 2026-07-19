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
  - Status: diagnostic A/B rendered and heard. The user found B slightly noisier
    than A only under direct comparison, while overall quality and the
    arrangement/verse controls were acceptable. Keep the current delivery;
    no global mastering, voice, EQ, gate, or arrangement change is justified.

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

## 2026-07-19 — IA visible in files but absent from Editor

Detailed note: `notes/ia-voicebank-registration-2026-07-19.md`

- **Metadata discovery was mistaken for singer availability**
  - Scope: IA and IA_ROCKS VVD/DDI/DDB files and `INSTALLED=1` entries existed,
    but IA initially had an all-zero activation-time marker and did not appear
    in Editor.
  - Decision: treat VVD as metadata only; inspect bounded registry marker
    presence before an Editor probe and never expose/copy license marker values.
  - Status: IA's marker is now non-zero and IA appears in Editor; both voices
    pass isolated original-Editor renders. A third visible
    `IA_Alpha_TypeC_trial` bank has active registration but remains render-
    inconclusive because two attempts failed at Save-dialog filename automation.

- **A non-silent probe could accept singer fallback**
  - Scope: an old IA and IA_ROCKS probe pair had byte-identical WAV digests yet
    both were cached as verified.
  - Decision: reject exact cross-component digest collision on one host as
    unverified identity, even if the WAV is non-silent.
  - Status: guard implemented; current IA and IA_ROCKS forced probes are
    non-silent and have distinct SHA-256 digests.
