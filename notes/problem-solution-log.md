# Problem and solution log

This is the stable index for implementation problems discovered through real
composition and listening. Detailed evidence belongs in a dated note; this file
records the durable problem, scope, decision, and current status.

## 2026-07-19 — Original-IA swordsmen cold-start validation

Detailed note: `notes/cold-start-evaluation-kaze-wa-na-o-yobanai-2026-07-19.md`

- **Fresh-agent composition transfer succeeded, but orchestration is still bespoke**
  - Scope: a new `gpt-5.6-sol`/`xhigh` session independently authored and
    delivered `風は名を呼ばない` with original IA and no access to the local
    corpus, prior song artifacts, or existing compose scripts.
  - Decision: retain the reproducible runner and 23-entry creative record, but
    treat its transport/revision/recovery boilerplate as framework work rather
    than the desired long-term composition API.
  - Status: song complete; reusable resumable session scaffold remains open.

- **Long Editor calls, dead leases, and Save As filename state remain coupled failure modes**
  - Scope: a 60-second client timeout killed an otherwise valid Editor render,
    left a dead-owner lease, and a later Save As attempt observed an empty
    filename despite a valid destination parent.
  - Decision: use progress-aware long deadlines, verify dead owner PID before
    reclaiming the exact lease, retry a fresh Save dialog, and require final
    digest/non-silence evidence.
  - Status: current renders succeeded; default timeout, lease reclamation, and
    Save As recovery should be hardened in the framework.

- **Phrase-entry homogeneity currently ignores leading rests**
  - Scope: the analyzer reported all lead/harmony phrases at one entry even
    though authored rest cells create downbeat, delayed, pickup, and offbeat
    starts.
  - Decision: do not change correct music to satisfy the warning. Future
    analysis must derive audible entry from the first non-rest cell.
  - Status: open analyzer bug; warning explicitly dispositioned in this song.

- **Endpoint-only intent trends cannot describe a rise-then-release delivery arc**
  - Scope: the hilt phrase rises to one local DYN/BRI/opening crest and cools
    immediately, but a monotonic `increase` target compares only start/end.
  - Decision: correct the whole-passage declaration without changing music;
    add local arch/peak-position targets in a future intent schema.
  - Status: song declaration corrected; schema improvement remains open.

- **Native-control verification succeeded after correcting the XML query**
  - Scope: an initial grep used the wrong tag names and falsely reported no
    controls.
  - Evidence: final VSQX contains PIT/PBS/DYN/BRI/GEN/CLE, 433 note-style
    blocks, locked phonemes, and one non-zero focus vibrato.
  - Status: no materialization regression in this song; retain schema-aware
    verification rather than ad-hoc tag guesses.

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
