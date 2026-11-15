# Problem and solution log

This is the stable index for implementation problems discovered through real
composition and listening. It records the durable problem, scope, decision, and
current status. Per-run evaluation notes from July 2026 were archived; their
links point at the last commit that contained them.

## 2026-11-15 — Voice probe blocked by a missing audio device

- **The Editor's saved audio output device disappeared**
  - Symptom: `vocaloid_probe_voice` failed in ~6 s at `wait_for_export_dialog`
    with an unexpected `VOCALOID Editor` modal; no render ran.
  - Root cause: host configuration, not code. See
    [`notes/host-troubleshooting.md`](host-troubleshooting.md).
  - Status: fixed on the host; the export helper now prints an actionable hint
    for this dialog title.

## 2026-07-19 — High-BPM IA_ROCKS cold-start validation

Detailed note (archived): [cold-start-evaluation-natsu-ame-semi-ia-rocks-20260719.md](https://github.com/N0zoM1z0/vocaloid-mcp/blob/b40a673/notes/cold-start-evaluation-natsu-ame-semi-ia-rocks-20260719.md)

- **A fresh agent could consume a bounded BPM range and finish a 190 BPM song**
  - Scope: a new `gpt-5.6-sol`/`xhigh` session received only the fixed prompt
    plus the validated `summer night, rain, cicadas` intent, including IA_ROCKS, rock, a
    180–200 BPM range, 190 preferred BPM, and a 50–70 second duration target.
  - Evidence: it independently delivered `雨と蝉のあいだ`, 48 bars and
    64.399683 seconds, at 190 BPM with the requested exact voice component.
  - Status: transfer and high-BPM engineering stability succeeded; the intent
    range/preference fields are enforced by schema and the creative record
    retains the tempo decision. Final human listening found that the band masks
    IA and that the arrangement remains flat rather than convincingly rock.
    No song revision was requested, so these findings are preserved as an
    explicit musical limitation rather than converted into a local auto-fix.

- **Delivery metrics did not establish vocal foreground or genre success**
  - Scope: the final artifact was current, non-silent, unclipped, within its
    loudness/true-peak policy, and passed every engineering readiness gate.
    Human listening still found IA buried and the rock feel unconvincing.
  - Decision: keep engineering readiness and artistic acceptance separate. A
    future diagnostic may observe section-aware vocal-to-band balance,
    consonant-band masking, and vocal-muted deltas, but must present bounded
    listening choices instead of applying an automatic vocal boost. Rock feel
    requires performance, articulation, groove, and renderer evidence; a genre
    label, high BPM, guitars, and drums are not sufficient evidence.
  - Status: open product/music limitation, intentionally not repaired in this
    song. The final listener disposition is recorded in the dated evaluation
    note without mutating the published creative-record chain.

- **Run code guessed raw edit-response nesting and failed after successful writes**
  - Scope: two resumable interruptions followed valid canonical mutations
    because run-local logging assumed `preview.diff.totalChanges` and
    `predicted_revision` fields that the production envelope does not expose.
  - Decision: make one shared client own response normalization and consistency
    checks; keep raw envelopes diagnostic-only.
  - Status: fixed. `production-mcp.mjs` returns stable `preview`, `applied`, and
    `summary` fields, rejects revision/change-count drift or incomplete integer
    fields, and has unit plus live temporary-manifest integration coverage.

- **Resume and journal code guessed canonical object topology**
  - Scope: one retry looked for `manifest.vocals.tracks` instead of top-level
    `vocal_tracks`; another tried to bind nested phrase-grammar blueprint IDs as
    top-level journal objects.
  - Decision: require tool/resource schema discovery, use canonical top-level
    vocal tracks, and bind nested phrase evidence through its owning vocal
    phrase stable ID.
  - Status: reusable prompt and shared discovery helpers updated. The song
    resumed without duplicate mutation or lost state.

- **Modal subtonics were incorrectly assigned leading-tone resolution duty**
  - Scope: D Dorian C-natural produced 17 false
    `LEADING_TONE_UNRESOLVED` warnings.
  - Decision: degree 7 is a leading tone only when it lies one semitone below
    tonic; modal whole-tone subtonics remain available without a major-key rule.
  - Status: fixed globally with major-versus-Dorian regression coverage. The
    unchanged song now has zero such findings and remains fully delivery-ready.

- **Whole-track mean pitch could invert sparse local voice roles**
  - Scope: a low lead verse could make a chorus-only lower harmony appear to be
    the upper voice and generate false crossings.
  - Decision: infer upper/lower roles from duration-weighted overlapping events,
    not non-simultaneous sections.
  - Status: fixed globally; real-crossing proposal fixtures now contain genuine
    simultaneous crossings, and separate regression coverage protects sparse
    form-specific harmony.

- **IA_ROCKS F0 analysis can select a strong second harmonic**
  - Scope: five MIDI-67 event windows were reported roughly one octave high,
    while native note numbers and within-event/neighbor evidence remained
    consistent with the score.
  - Decision: do not retune correct notes or silently fold pitch estimates to
    the expected score. A future tracker must compare subharmonic spectral
    support and temporal continuity while preserving the ability to detect a
    genuinely octave-wrong render.
  - Status: open diagnostic limitation, recorded with exact event evidence; it
    does not block the current artifact. This is deliberately not “fixed” by a
    song-specific exception or circular expected-note snapping.

## 2026-07-19 — Original-IA swordsmen cold-start validation

Detailed note (archived): [cold-start-evaluation-kaze-wa-na-o-yobanai-2026-07-19.md](https://github.com/N0zoM1z0/vocaloid-mcp/blob/b40a673/notes/cold-start-evaluation-kaze-wa-na-o-yobanai-2026-07-19.md)

- **Fresh-agent composition transfer succeeded, but orchestration is still bespoke**
  - Scope: a new `gpt-5.6-sol`/`xhigh` session independently authored and
    delivered `風は名を呼ばない` with original IA and no access to the local
    corpus, prior song artifacts, or existing compose scripts.
  - Decision: retain the reproducible runner and 23-entry creative record, but
    treat its transport/revision/recovery boilerplate as framework work rather
    than the desired long-term composition API.
  - Status: fixed prompt + validated per-song intent files + MCP prompt are now
    implemented. `scripts/lib/production-mcp.mjs` centralizes progress-aware
    900-second calls, contract reads, dry-run/edit, and journal resume behavior.

- **Long Editor calls, dead leases, and Save As filename state remain coupled failure modes**
  - Scope: a 60-second client timeout killed an otherwise valid Editor render,
    left a dead-owner lease, and a later Save As attempt observed an empty
    filename despite a valid destination parent.
  - Decision: use progress-aware long deadlines, verify dead owner PID before
    reclaiming the exact lease, retry a fresh Save dialog, and require final
    digest/non-silence evidence.
  - Status: framework client defaults long calls to 900 seconds; a valid lease
    whose recorded PID is dead is reclaimed immediately; transient Save-dialog
    discovery/filename/submit failures get one fresh-Editor retry. Real-song
    validation remains required because unit tests cannot emulate VOCALOID UI.

- **Phrase-entry homogeneity currently ignores leading rests**
  - Scope: the analyzer reported all lead/harmony phrases at one entry even
    though authored rest cells create downbeat, delayed, pickup, and offbeat
    starts.
  - Decision: do not change correct music to satisfy the warning. Future
    analysis must derive audible entry from the first non-rest cell.
  - Status: fixed. Entry signatures now use the first materialized non-rest
    event; regression coverage includes eight distinct leading-rest offsets.

- **Endpoint-only intent trends cannot describe a rise-then-release delivery arc**
  - Scope: the hilt phrase rises to one local DYN/BRI/opening crest and cools
    immediately, but a monotonic `increase` target compares only start/end.
  - Decision: correct the whole-passage declaration without changing music;
    add local arch/peak-position targets in a future intent schema.
  - Status: fixed. `delivery_dynamics` accepts `arch`/`valley`, requires at
    least three distinct DYN ticks, and reports crest/trough position evidence.

- **Creative-journal stage re-entry rejected exact retries**
  - Scope: interrupted runners replayed completed journal stages and stopped on
    duplicate stable IDs.
  - Decision: add `record_if_absent`; exact semantic equality is resumable,
    while changed content requires a new decision/supersession and still fails.
  - Status: implemented in the journal core, compact MCP action contract, and
    shared production client with append-only regression coverage.

- **Native-control verification succeeded after correcting the XML query**
  - Scope: an initial grep used the wrong tag names and falsely reported no
    controls.
  - Evidence: final VSQX contains PIT/PBS/DYN/BRI/GEN/CLE, 433 note-style
    blocks, locked phonemes, and one non-zero focus vibrato.
  - Status: no materialization regression in this song; retain schema-aware
    verification rather than ad-hoc tag guesses.

## 2026-07-19 — Distant-lights cold-start follow-up

Detailed note (archived): [tooi-hi-aoi-yoru-root-cause-and-grammar-2026-07-19.md](https://github.com/N0zoM1z0/vocaloid-mcp/blob/b40a673/notes/tooi-hi-aoi-yoru-root-cause-and-grammar-2026-07-19.md)

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

Detailed note: [`notes/host-troubleshooting.md`](host-troubleshooting.md)

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
