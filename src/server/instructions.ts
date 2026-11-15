import { IA_ROCKS_COMPONENT_ID } from "../style-palettes.js";

/** Workflow guidance sent to MCP clients during initialization. */
export const SERVER_INSTRUCTIONS = [
  `Compose from a revisioned canonical song manifest.`,
  `Read vocaloid://capabilities, vocaloid://composition-intent-contract, vocaloid://music-theory-policy, vocaloid://phrase-grammar, and vocaloid://creative-decision-journal first; read the on-demand action contract before each compact envelope tool.`,
  `Declare what the song, section, and 1–3 anchor phrases are trying to say; then establish form, meter/tempo, key/harmony/bass, an agent-selected phrase-grammar blueprint, melody, Japanese note allocation, isolated IA delivery, harmony, and minimal/full arrangement.`,
  `Phrase grammar is an unordered style/genre choice vocabulary, not automatic melody generation: never expand a bundle as a template.`,
  `Compose concrete pitch, scale-degree, onset, and duration material yourself from intent, lyric prosody, harmony, and form; then validate selected components, materialize them in notes/rests/allocation, and run phrase-grammar analysis before delivery.`,
  `Production agents never query the local song library; offline library work may only add human-reviewed, non-reconstructive DSL components.`,
  `Append concise evidence-bound decisions with vocaloid_creative_journal after each stage; do not store raw hidden chain-of-thought.`,
  `Use vocaloid_edit_song with dry_run before bounded writes, then preflight, build, render, review, and master.`,
  `Set composition guidance explicitly when final delivery must require theory-warning disposition or current intent review; exceptions must copy an exact current issue fingerprint and become structural errors when their targets change.`,
  `When preflight returns bounded proposals, treat them only as revision-bound A/B hypotheses: keep one listening question fixed, run the candidate through vocaloid_edit_song dry_run, inspect the actual theory/intent delta, and audition before a separate write.`,
  `Close one 20–30 second anchor passage through lead_solo → lead_harmony → minimal_band before treating full-song rendering as creative progress; one loudness-matched A/B answers one registered listening question and only an explicit human/agent listening note may write keep/reject/revise.`,
  `Compare premaster and final delivery at equal loudness whenever mastering reports transparency-review risk.`,
  `Japanese kanji require an explicit kana reading: preserve supplied lyric text separately, align morae to stable rhythm cells, repeat mora indices for melisma, and choose small-っ timing explicitly.`,
  `Preserve stable IDs and pass expected_revision on every write.`,
  `Use IA_ROCKS component ${IA_ROCKS_COMPONENT_ID} unless the user requests another verified voice;`,
  `BLRGDDR4M3WM2LC6 is IA, not IA_ROCKS.`,
  `Artifacts must match manifest hashes; native gesture materialization and an actual non-silent Editor render are separate evidence.`,
  `Publish a hash-bound creative-record package with the final song and VSQX.`,
  `VOCALOID pan is 0=left, 64=center, 127=right.`,
  `The bundled GM SoundFont is draft quality and does not prove authentic acoustic articulation.`,
].join(" ");
