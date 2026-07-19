import { alignJapanesePhrase } from "./japanese.js";
import { IA_ROCKS_COMPONENT_ID } from "./style-palettes.js";


const EXAMPLE_NOTE_SLOTS = [
  { id: "verse-line-01-cell-1", duration: 240, note_number: 67, mora_index: 0 },
  { id: "verse-line-01-cell-2", duration: 240, note_number: 69, mora_index: 1 },
  { id: "verse-line-01-cell-3", duration: 240, note_number: 71, mora_index: 2 },
  { id: "verse-line-01-cell-4", duration: 240, note_number: 72, mora_index: 3 },
  { id: "verse-line-01-cell-5", duration: 240, note_number: 71, mora_index: 4 },
  { id: "verse-line-01-cell-6", duration: 240, note_number: 69, mora_index: 5 },
] as const;

const EXAMPLE_ALIGNED_PHRASE = alignJapanesePhrase({
  text: "風を駆ける",
  reading: "かぜをかける",
  phrase_id: "verse-line-01",
  start: { measure: 1, beat: 0, tick: 0 },
  allocation: "explicit",
  note_slots: EXAMPLE_NOTE_SLOTS.map((slot) => ({ ...slot })),
}).phrase;

export const FROM_ZERO_AGENT_EXAMPLE = {
  schema: "vocaloid-mcp-agent-example/v1",
  purpose: "Mechanical payload reference with exact field names; it is not evidence that the phrase or song is creatively complete.",
  invariants: [
    "For a new work, declare song/section/anchor-phrase intent and one listening question before treating these mechanical score calls as composition.",
    "Close a 20-30 second lead_solo, lead_harmony, and minimal_band anchor ladder before expanding full-song infrastructure or consulting optional style observations.",
    "Copy data.phrase from align_japanese_phrase as an object; do not reconstruct its phonemes.",
    "Read vocaloid://edit-song-contract/{action}; put only that schema's fields inside the edit tool payload envelope.",
    "For every edit, use the current manifest revision, preview first, then repeat the same payload with dry_run=false.",
    "Same-path writes require overwrite=true and create a timestamped backup.",
    "All IDs are lowercase stable IDs and remain unchanged across unrelated revisions.",
  ],
  calls: [
    {
      step: 1,
      tool: "vocaloid_create_song_manifest",
      arguments: {
        output_path: "/absolute/path/example.song.json",
        song_id: "example-song",
        slug: "example-song",
        title: "Example Song",
        format: "vsq3",
        pre_measure: 1,
        time_signatures: [{ measure: 0, numerator: 4, denominator: 4 }],
        tempos: [{ position: { measure: 0, beat: 0, tick: 0 }, bpm: 132 }],
        sections: [
          { id: "intro", name: "Intro", kind: "intro", start: { measure: 0, beat: 0, tick: 0 }, end: { measure: 1, beat: 0, tick: 0 } },
          { id: "verse", name: "Verse", kind: "verse", start: { measure: 1, beat: 0, tick: 0 }, end: { measure: 4, beat: 0, tick: 0 } },
        ],
        response_format: "json",
      },
    },
    {
      step: 2,
      tool: "vocaloid_align_japanese_phrase",
      save: "aligned.data.phrase",
      arguments: {
        text: "風を駆ける",
        reading: "かぜをかける",
        phrase_id: "verse-line-01",
        start: { measure: 1, beat: 0, tick: 0 },
        allocation: "explicit",
        note_slots: EXAMPLE_NOTE_SLOTS,
        response_format: "json",
      },
    },
    {
      step: 3,
      tool: "vocaloid_edit_song",
      repeat: "First dry_run=true; after success repeat unchanged with dry_run=false.",
      arguments: {
        action: "upsert_vocal_part",
        payload: {
          input_path: "/absolute/path/example.song.json",
          output_path: "/absolute/path/example.song.json",
          expected_revision: 1,
          overwrite: true,
          dry_run: true,
          voice: { id: "voice-ia-rocks", name: "IA_ROCKS", component_id: IA_ROCKS_COMPONENT_ID },
          track: { id: "lead", name: "IA_ROCKS Lead", voice_id: "voice-ia-rocks" },
          part: {
            id: "verse-lead",
            section_id: "verse",
            name: "Verse Lead",
            start: { measure: 1, beat: 0, tick: 0 },
            end: { measure: 3, beat: 0, tick: 0 },
            phrases: [EXAMPLE_ALIGNED_PHRASE],
          },
        },
        response_format: "json",
      },
    },
    {
      step: 4,
      tool: "vocaloid_edit_song",
      repeat: "Use revision 2; preview first, then apply.",
      arguments: {
        action: "upsert_arrangement",
        payload: {
          input_path: "/absolute/path/example.song.json",
          output_path: "/absolute/path/example.song.json",
          expected_revision: 2,
          overwrite: true,
          dry_run: true,
          track: {
            kind: "pitched",
            id: "drive-guitar",
            name: "Drive Guitar",
            program: 30,
            pan: 64,
            notes: [
              { id: "guitar-c3", position: { measure: 0, beat: 0, tick: 0 }, duration: 960, note_number: 48, velocity: 88 },
              { id: "guitar-g3", position: { measure: 0, beat: 2, tick: 0 }, duration: 960, note_number: 55, velocity: 86 },
            ],
          },
        },
        response_format: "json",
      },
    },
    {
      step: 5,
      tool: "vocaloid_preflight_song",
      arguments: {
        manifest_path: "/absolute/path/example.song.json",
        artifact_check: "none",
        include_performance_warnings: true,
        check_voice_cache: true,
        include_theory_proposals: true,
        max_theory_proposals: 6,
        response_format: "json",
      },
    },
  ],
} as const;
