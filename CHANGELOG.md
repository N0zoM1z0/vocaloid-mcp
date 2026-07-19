# Changelog

All notable repository-level milestones are recorded here. Detailed implementation evidence remains in `notes/`, and the full narrative remains in `blogs/`.

## [1.0.0] — 2026-07-19

### Added

- Native VSQ3/VSQ4 creation, inspection, validation, editing, and structured multi-track song compilation.
- Hash-pinned Yamaha native-loader validation and bounded Win32 VOCALOID3 Editor export helpers.
- Revisioned canonical song manifests with stable IDs, dry-run mutation, history, content/composition/mix hashes, and artifact provenance.
- Japanese kana/phoneme normalization, mora allocation, rapid lyrics, melisma, small-`っ` policy, and inspectable tuning gestures.
- Multi-instrument accompaniment, isolated vocal/instrument stems, deterministic effect chains, section automation, mixing, mastering, preview, A/B, and delivery QC.
- Deterministic symbolic theory analysis, bounded repair proposals, fingerprint-bound exceptions, staged readiness, and intent-aware release policy.
- Canonical composition intent, anchor-passage audition, intent-fidelity review binding, and hash-chained creative decision journals.
- A non-generative phrase-grammar DSL whose bundles contain no melody material and cannot query the local IA corpus at runtime.
- Voicebank registration/readiness diagnostics and cross-component render-identity collision protection for IA and IA_ROCKS.
- A fixed composition-agent prompt plus strict per-song intent files with duration, BPM range/preference, exact voice identity, listener question, and source boundaries.
- Four tracked creative-record packages and matching publishable native VSQX projects from intent-first and fresh-agent evaluations.
- Three paired Traditional Chinese/English retrospectives, with real Editor screenshots and data-derived audio visualizations.

### Changed

- The production MCP surface now exposes 22 high-level tools, 14 core on-demand resources, one optional local supplied-lyric resource, and one reusable composition prompt.
- Tuning gestures must be materialized into native expression before build; declaration alone is insufficient evidence.
- Modal scale degree 7 is treated as a leading tone only when it lies one semitone below tonic.
- Cross-voice ordering is inferred from duration-weighted simultaneous material rather than unrelated whole-track means.
- Shared production clients normalize and verify mutation preview/apply revisions and change counts.
- The local IA library role was narrowed from production aggregate comparison to offline, human-reviewed, non-reconstructive phrase-vocabulary curation.
- `artifacts/evals/` and `artifacts/songs/` are local-only; durable creative records and native VSQX projects remain tracked.

### Verification

- 102 automated tests discovered: 100 passed, 2 intentionally skipped by environment, 0 failed.
- Fresh `gpt-5.6-sol`/`xhigh` sessions completed original-IA and IA_ROCKS songs without runtime access to the local corpus, prior song artifacts, or reference melodies.
- The 190 BPM IA_ROCKS stability run produced a schema-valid two-track VSQ3 project, real-Editor vocal renders, a current mastered delivery, and a complete 24-entry creative record.

### Known limitations

- Technical readiness does not establish musical quality or intent fidelity.
- The latest human listening review found the IA_ROCKS vocal masked by accompaniment and the intended rock character insufficient despite all technical gates passing.
- The deterministic GM/SoundFont accompaniment backend is draft quality and does not reproduce musician-like rock articulation or high-end production sound.
- The vocal F0 analyzer can select a strong second harmonic in some IA_ROCKS windows; it deliberately does not snap estimates to expected score pitch.
- Original-Editor automation remains tied to a local, fingerprinted legacy Windows environment and is not a general remote service.
- Final WAVs, local corpus content, voicebanks, licensing state, and multi-gigabyte evaluation workspaces are not distributed.

[1.0.0]: ../../tree/v1.0.0
