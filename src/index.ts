#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import type { ResponseFormat } from "./types.js";
import { renderAccompaniment } from "./accompaniment.js";
import { analyzeAudioQuality, masterWav } from "./audio-quality.js";
import { listGeneralMidi } from "./gm.js";
import { compileVocalPhrase, type VocalPhraseInput } from "./vocal-phrase.js";
import { renderProjectToWav } from "./render.js";
import {
  buildSongManifest,
  createSongManifest,
  getSongManifestSection,
  inspectSongManifest,
  ManifestArrangementTrackSchema,
  ManifestChordChangeSchema,
  ManifestKeyChangeSchema,
  ManifestRemovalSchema,
  ManifestSectionSchema,
  ManifestTempoSchema,
  ManifestTimeSignatureSchema,
  ManifestTransformSchema,
  ManifestVocalPartSchema,
  ManifestVocalTrackMetadataSchema,
  ManifestVoiceSchema,
  removeSongManifestObjects,
  transformSongManifestEvents,
  upsertSongManifestArrangementTrack,
  upsertSongManifestSection,
  upsertSongManifestVocalPart,
} from "./song-manifest.js";
import {
  renderSongManifestInstrumentStems,
  renderSongManifestVocalStems,
} from "./stems.js";
import { discoverVoices } from "./voices.js";
import { analyzeSongManifestVocalStem } from "./vocal-analysis.js";
import {
  addControlPointsToProject,
  addNotesToProject,
  createProject,
  createSong,
  inspectProjectMixer,
  inspectProject,
  listControlPoints,
  listNotes,
  updateNoteExpressionsInProject,
  updateProjectMixer,
  validateProject,
} from "./vsqx.js";


const server = new McpServer(
  { name: "vocaloid-mcp-server", version: "0.8.0" },
  {
    instructions: `Use this server to compose, arrange, tune, mix-check, and master native VOCALOID projects. Start with voice/instrument discovery. For a new long song, use a song manifest as canonical source, add one vocal part or arrangement track per upsert, and inspect revision/hash before every mutation. Preserve globally unique stable IDs. Build a stereo backing and validated VSQX from the manifest; use one-shot create_song only for small projects. For revisionable mixing or listening feedback, render selected instrument stems and original-Editor vocal stems. Explicitly choose preserve_pan/center and effects/dry; never assume artistic routing. Artifacts must match the current composition_hash. Run score-vs-render analysis on an isolated vocal stem before tuning: distinguish energy onset, voiced onset/consonant lead, sustained pitch center, contour, release, and vibrato. Treat rapid-note limited-resolution and estimated global offsets honestly; analysis proposes evidence and never auto-quantizes expression. Named sections, tempo/meter maps, patterns, rapid rhythm cells, tuplets, and melisma remain agent decisions. VOCALOID pan is 0=hard left, 64=center, 127=hard right. Analyze stems and Master per channel, fix clipped/unintended imbalance, then master to requested LUFS/true peak. Use slugged revision names. The bundled GM SoundFont is draft quality.`,
  },
);

const ResponseFormatSchema = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("Response representation: concise Markdown or JSON");
const PathSchema = z
  .string()
  .min(1)
  .max(4096)
  .describe("Absolute path, or a path relative to the vocaloid-mcp-server project root");
const CurveSchema = z.enum(["DYN", "BRE", "BRI", "CLE", "GEN", "POR", "PIT", "PBS"]);
const ToolOutputSchema = z.object({
  ok: z.boolean(),
  data: z.unknown(),
  warnings: z.array(z.string()),
});

const NormalizedVibratoPointSchema = z
  .object({
    position: z
      .number()
      .int()
      .min(0)
      .max(65_536)
      .describe("Position across the entire note: 0 is the start and 65536 is the end"),
    value: z.number().int().min(0).max(127).describe("Vibrato depth or rate value"),
  })
  .strict();

const VibratoSchema = z
  .object({
    type: z
      .number()
      .int()
      .min(0)
      .max(16)
      .describe(
        "Built-in vibrato: 0 off, 1-4 normal, 5-8 extreme, 9-12 fast, 13-16 slight",
      ),
    length: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe("Percentage of the note occupied by vibrato, counted backward from note end"),
    depth: z.array(NormalizedVibratoPointSchema).max(128).optional(),
    rate: z.array(NormalizedVibratoPointSchema).max(128).optional(),
  })
  .strict();

const NoteSchema = z
  .object({
    tick: z.number().int().min(0).describe("Note start tick relative to the musical part"),
    duration: z.number().int().min(1).describe("Note duration in ticks"),
    note_number: z.number().int().min(0).max(127).describe("MIDI note number; 60 is middle C"),
    lyric: z.string().max(32).describe("Displayed lyric, such as 'あ'"),
    phonemes: z
      .string()
      .max(32)
      .optional()
      .describe(
        "Raw VOCALOID phoneme symbols (for example 'a', 'k a', or Japanese flap '4 a'); do not invent a token-count prefix",
      ),
    phoneme_locked: z.boolean().default(false).describe("Lock explicit phonemes in the editor"),
    velocity: z.number().int().min(0).max(127).default(64),
    style: z
      .record(z.string().min(1).max(32), z.number().int())
      .optional()
      .describe("Optional VSQX note-style values, for example accent, decay, or opening"),
    vibrato: VibratoSchema.optional().describe(
      "Optional note vibrato with editable normalized depth/rate envelopes",
    ),
  })
  .strict();

const ControlPointSchema = z
  .object({
    tick: z.number().int().min(0).describe("Control point tick relative to the musical part"),
    value: z.number().int().describe("Curve value; range is checked for the selected curve"),
  })
  .strict();

const MusicalPositionSchema = z
  .object({
    measure: z.number().int().min(0).max(100_000).describe("Zero-based song measure"),
    beat: z
      .number()
      .int()
      .min(0)
      .max(31)
      .describe("Zero-based beat in the active time signature denominator"),
    tick: z.number().int().min(0).max(1919).default(0).describe("Tick offset within the beat"),
  })
  .strict();

const PositionedNoteSchema = NoteSchema.omit({ tick: true })
  .extend({
    position: MusicalPositionSchema.describe("Absolute musical position in the song"),
  })
  .strict();

const PositionedControlPointSchema = z
  .object({
    position: MusicalPositionSchema.describe("Absolute musical position in the song"),
    value: z.number().int().describe("Curve value; range is checked for the selected curve"),
  })
  .strict();

const SongCurveSchema = z
  .object({
    curve: CurveSchema,
    points: z.array(PositionedControlPointSchema).min(1).max(10_000),
  })
  .strict();

const RhythmValueSchema = z
  .object({
    denominator: z.union([
      z.literal(1), z.literal(2), z.literal(4), z.literal(8),
      z.literal(16), z.literal(32), z.literal(64),
    ]),
    dots: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
    tuplet: z
      .object({
        played: z.number().int().min(2).max(16),
        in_time_of: z.number().int().min(1).max(16),
      })
      .strict()
      .optional()
      .describe("For triplet eighths use denominator=8, played=3, in_time_of=2"),
  })
  .strict();

const VocalLyricUnitSchema = z
  .object({
    lyric: z.string().min(1).max(32),
    phonemes: z.string().min(1).max(32),
    phoneme_locked: z.boolean().default(false),
  })
  .strict();

const VocalRhythmCellSchema = z
  .object({
    duration: z
      .union([z.number().int().min(1), RhythmValueSchema])
      .describe("Explicit ticks or a whole/half/quarter/8th/16th/32nd/64th dotted/tuplet value"),
    rest: z.boolean().default(false),
    note_number: z.number().int().min(0).max(127).optional(),
    lyric_index: z.number().int().min(0).optional(),
    lyric: z.string().min(1).max(32).optional(),
    phonemes: z.string().min(1).max(32).optional(),
    phoneme_locked: z.boolean().optional(),
    gate_percent: z.number().int().min(1).max(100).default(100),
    velocity: z.number().int().min(0).max(127).default(64),
    style: z.record(z.string().min(1).max(32), z.number().int()).optional(),
    vibrato: VibratoSchema.optional(),
  })
  .strict();

const VocalPhraseSchema = z
  .object({
    start: MusicalPositionSchema,
    allocation: z
      .enum(["sequential", "explicit"])
      .default("sequential")
      .describe(
        "Sequential consumes one lyric per note; explicit uses lyric_index so one lyric may span several notes with automatic '-' continuations",
      ),
    lyrics: z.array(VocalLyricUnitSchema).min(1).max(5000),
    cells: z.array(VocalRhythmCellSchema).min(1).max(20_000),
  })
  .strict();

const SongPartSchema = z
  .object({
    name: z.string().min(1).max(256),
    comment: z.string().max(256).optional(),
    start: MusicalPositionSchema.describe("Inclusive absolute song position"),
    end: MusicalPositionSchema.describe("Exclusive absolute song position"),
    notes: z.array(PositionedNoteSchema).max(5000).default([]),
    phrases: z
      .array(VocalPhraseSchema)
      .max(256)
      .default([])
      .describe(
        "Phrase-level lyric/rhythm input supporting rests, syncopation, 1/64 values, tuplets, rapid syllables, and melisma",
      ),
    control_curves: z.array(SongCurveSchema).max(8).default([]),
  })
  .strict();

const SongTrackSchema = z
  .object({
    name: z.string().min(1).max(256),
    comment: z.string().max(256).optional(),
    voice: z
      .object({
        name: z.string().min(1).max(256),
        component_id: z.string().length(16),
      })
      .strict(),
    bank_select: z.number().int().min(0).max(127).default(0),
    program_change: z.number().int().min(0).max(127).default(0),
    mixer: z
      .object({
        volume: z.number().int().min(-898).max(600).default(0),
        pan: z
          .number()
          .int()
          .min(0)
          .max(127)
          .default(64)
          .describe("VOCALOID pan: 0=hard left, 64=center, 127=hard right"),
        mute: z.boolean().default(false),
        solo: z.boolean().default(false),
        send_level: z.number().int().min(-898).max(0).default(-898),
        send_enabled: z.boolean().default(false),
      })
      .strict()
      .optional(),
    parts: z.array(SongPartSchema).min(1).max(256),
  })
  .strict();

const SongAudioPartSchema = z
  .object({
    name: z.string().min(1).max(256),
    comment: z.string().max(256).optional(),
    kind: z
      .enum(["mono", "stereo"])
      .describe("Must match the WAV channel count; mono uses 1 channel and stereo uses 2"),
    file_path: PathSchema.describe("Existing 16-bit PCM WAV accompaniment or stem"),
    start: MusicalPositionSchema.describe("Absolute song position where audio playback begins"),
  })
  .strict();

const AccompanimentNoteSchema = z
  .object({
    position: MusicalPositionSchema,
    duration: z.number().int().min(1).describe("Duration in ticks; 480 is one quarter note"),
    note_number: z.number().int().min(0).max(127),
    velocity: z.number().int().min(1).max(127).default(88),
  })
  .strict();

const AccompanimentPatternNoteSchema = z
  .object({
    offset: MusicalPositionSchema.describe("Measure/beat/tick offset within the pattern"),
    duration: z.number().int().min(1),
    note_number: z.number().int().min(0).max(127),
    velocity: z.number().int().min(1).max(127).default(88),
  })
  .strict();

const AccompanimentPatternSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
    measures: z.number().int().min(1).max(256),
    notes: z.array(AccompanimentPatternNoteSchema).min(1).max(20_000),
  })
  .strict();

const AccompanimentPlacementSchema = z
  .object({
    pattern_id: z.string().min(1).max(64),
    start: MusicalPositionSchema.describe("Measure-aligned placement start"),
    repeats: z.number().int().min(1).max(1024).default(1),
    transpose: z.number().int().min(-48).max(48).default(0),
    velocity_scale: z.number().gt(0).max(4).default(1),
  })
  .strict();

const AccompanimentTrackSchema = z
  .object({
    name: z.string().min(1).max(255),
    program: z
      .number()
      .int()
      .min(0)
      .max(127)
      .describe("Zero-based General MIDI program: 0 acoustic piano, 24 nylon guitar, 33 finger bass"),
    bank_msb: z.number().int().min(0).max(127).default(0),
    bank_lsb: z.number().int().min(0).max(127).default(0),
    volume: z.number().int().min(0).max(127).default(100),
    pan: z
      .number()
      .int()
      .min(0)
      .max(127)
      .default(64)
      .describe("MIDI pan: 0=hard left, 64=center, 127=hard right"),
    notes: z.array(AccompanimentNoteSchema).max(20_000).default([]),
    patterns: z.array(AccompanimentPatternSchema).max(256).default([]),
    placements: z.array(AccompanimentPlacementSchema).max(5000).default([]),
  })
  .strict()
  .refine((track) => track.notes.length > 0 || track.placements.length > 0, {
    message: "Each accompaniment track needs direct notes or pattern placements",
  });

const DrumHitSchema = z
  .object({
    position: MusicalPositionSchema,
    note_number: z
      .number()
      .int()
      .min(0)
      .max(127)
      .describe("General MIDI percussion note on channel 10; e.g. 36 kick, 38 snare, 42 closed hi-hat"),
    velocity: z.number().int().min(1).max(127).default(96),
    duration: z.number().int().min(1).default(60),
  })
  .strict();

const DrumPatternHitSchema = z
  .object({
    offset: MusicalPositionSchema,
    note_number: z.number().int().min(0).max(127),
    velocity: z.number().int().min(1).max(127).default(96),
    duration: z.number().int().min(1).default(60),
  })
  .strict();

const DrumPatternSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
    measures: z.number().int().min(1).max(256),
    hits: z.array(DrumPatternHitSchema).min(1).max(50_000),
  })
  .strict();

const DrumPlacementSchema = z
  .object({
    pattern_id: z.string().min(1).max(64),
    start: MusicalPositionSchema.describe("Measure-aligned placement start"),
    repeats: z.number().int().min(1).max(1024).default(1),
    velocity_scale: z.number().gt(0).max(4).default(1),
  })
  .strict();

const ManifestIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,95}$/u)
  .describe("Globally unique stable lowercase ID; preserve it across unrelated revisions");

const ManifestMutationPathSchema = z
  .object({
    input_path: PathSchema.describe("Readable canonical .song.json manifest"),
    output_path: PathSchema.describe(
      "Destination .song.json; may equal input_path only with overwrite=true, which creates a backup",
    ),
    expected_revision: z.number().int().min(1).describe("Revision returned by the latest inspect/mutation"),
    overwrite: z.boolean().default(false),
    response_format: ResponseFormatSchema,
  })
  .strict();

type ToolOutput = z.infer<typeof ToolOutputSchema>;

function textResult(
  data: unknown,
  responseFormat: ResponseFormat,
  summary: string,
  warnings: string[] = [],
) {
  const output: ToolOutput = { ok: true, data, warnings };
  const text =
    responseFormat === "json"
      ? JSON.stringify(output, null, 2)
      : [`## ${summary}`, "", "```json", JSON.stringify(data, null, 2), "```", ...(
          warnings.length > 0 ? ["", `Warnings: ${warnings.join("; ")}`] : []
        )].join("\n");
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: output,
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const output: ToolOutput = { ok: false, data: null, warnings: [message] };
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    structuredContent: output,
  };
}

function normalizeNotes(notes: z.infer<typeof NoteSchema>[]) {
  return notes.map((note) => ({
    tick: note.tick,
    duration: note.duration,
    noteNumber: note.note_number,
    lyric: note.lyric,
    ...(note.phonemes !== undefined ? { phonemes: note.phonemes } : {}),
    phonemeLocked: note.phoneme_locked,
    velocity: note.velocity,
    ...(note.style !== undefined ? { style: note.style } : {}),
    ...(note.vibrato !== undefined
      ? {
          vibrato: {
            type: note.vibrato.type,
            length: note.vibrato.length,
            ...(note.vibrato.depth !== undefined ? { depth: note.vibrato.depth } : {}),
            ...(note.vibrato.rate !== undefined ? { rate: note.vibrato.rate } : {}),
          },
        }
      : {}),
  }));
}

function normalizePositionedNotes(notes: z.infer<typeof PositionedNoteSchema>[]) {
  return notes.map((note) => {
    const normalized = normalizeNotes([{ ...note, tick: 0 }])[0]!;
    const { tick: _tick, ...withoutTick } = normalized;
    return { ...withoutTick, position: note.position };
  });
}

function normalizeVocalPhrase(
  phrase: z.infer<typeof VocalPhraseSchema>,
): VocalPhraseInput {
  return {
    start: phrase.start,
    allocation: phrase.allocation,
    lyrics: phrase.lyrics.map((lyric) => ({
      lyric: lyric.lyric,
      phonemes: lyric.phonemes,
      phonemeLocked: lyric.phoneme_locked,
    })),
    cells: phrase.cells.map((cell) => ({
      duration: typeof cell.duration === "number"
        ? cell.duration
        : {
            denominator: cell.duration.denominator,
            dots: cell.duration.dots,
            ...(cell.duration.tuplet
              ? {
                  tuplet: {
                    played: cell.duration.tuplet.played,
                    inTimeOf: cell.duration.tuplet.in_time_of,
                  },
                }
              : {}),
          },
      rest: cell.rest,
      ...(cell.note_number !== undefined ? { noteNumber: cell.note_number } : {}),
      ...(cell.lyric_index !== undefined ? { lyricIndex: cell.lyric_index } : {}),
      ...(cell.lyric !== undefined ? { lyric: cell.lyric } : {}),
      ...(cell.phonemes !== undefined ? { phonemes: cell.phonemes } : {}),
      ...(cell.phoneme_locked !== undefined ? { phonemeLocked: cell.phoneme_locked } : {}),
      gatePercent: cell.gate_percent,
      velocity: cell.velocity,
      ...(cell.style !== undefined ? { style: cell.style } : {}),
      ...(cell.vibrato !== undefined
        ? {
            vibrato: {
              type: cell.vibrato.type,
              length: cell.vibrato.length,
              ...(cell.vibrato.depth !== undefined ? { depth: cell.vibrato.depth } : {}),
              ...(cell.vibrato.rate !== undefined ? { rate: cell.vibrato.rate } : {}),
            },
          }
        : {}),
    })),
  };
}

const NoteExpressionSchema = z
  .object({
    accent: z.number().int().min(0).max(100).optional(),
    decay: z.number().int().min(0).max(100).optional(),
    opening: z.number().int().min(0).max(127).optional(),
    bend_depth: z.number().int().min(0).max(100).optional(),
    bend_length: z.number().int().min(0).max(100).optional(),
    rise_portamento: z.boolean().optional(),
    fall_portamento: z.boolean().optional(),
  })
  .strict();

const VibratoUpdateSchema = z
  .object({
    type: z.number().int().min(0).max(16).optional(),
    length: z.number().int().min(0).max(100).optional(),
    depth: z.array(NormalizedVibratoPointSchema).max(128).optional(),
    rate: z.array(NormalizedVibratoPointSchema).max(128).optional(),
  })
  .strict();

const NoteExpressionUpdateSchema = z
  .object({
    note_index: z
      .number()
      .int()
      .min(0)
      .describe("Stable note index returned by vocaloid_list_notes"),
    velocity: z.number().int().min(0).max(127).optional(),
    lyric: z.string().max(32).optional(),
    phonemes: z
      .string()
      .max(32)
      .optional()
      .describe("Raw VOCALOID phoneme symbols, such as 'a', 'k a', or Japanese '4 a'"),
    phoneme_locked: z.boolean().optional(),
    expression: NoteExpressionSchema.optional(),
    vibrato: VibratoUpdateSchema.optional(),
  })
  .strict();

function normalizeNoteExpressionUpdates(
  updates: z.infer<typeof NoteExpressionUpdateSchema>[],
) {
  return updates.map((update) => {
    const expression = update.expression;
    const style: Record<string, number> = {};
    if (expression?.accent !== undefined) style.accent = expression.accent;
    if (expression?.decay !== undefined) style.decay = expression.decay;
    if (expression?.opening !== undefined) style.opening = expression.opening;
    if (expression?.bend_depth !== undefined) style.bendDep = expression.bend_depth;
    if (expression?.bend_length !== undefined) style.bendLen = expression.bend_length;
    if (expression?.rise_portamento !== undefined) {
      style.risePort = expression.rise_portamento ? 1 : 0;
    }
    if (expression?.fall_portamento !== undefined) {
      style.fallPort = expression.fall_portamento ? 1 : 0;
    }
    return {
      noteIndex: update.note_index,
      ...(update.velocity !== undefined ? { velocity: update.velocity } : {}),
      ...(update.lyric !== undefined ? { lyric: update.lyric } : {}),
      ...(update.phonemes !== undefined ? { phonemes: update.phonemes } : {}),
      ...(update.phoneme_locked !== undefined
        ? { phonemeLocked: update.phoneme_locked }
        : {}),
      ...(Object.keys(style).length > 0 ? { style } : {}),
      ...(update.vibrato !== undefined
        ? {
            vibrato: {
              ...(update.vibrato.type !== undefined ? { type: update.vibrato.type } : {}),
              ...(update.vibrato.length !== undefined
                ? { length: update.vibrato.length }
                : {}),
              ...(update.vibrato.depth !== undefined
                ? { depth: update.vibrato.depth }
                : {}),
              ...(update.vibrato.rate !== undefined ? { rate: update.vibrato.rate } : {}),
            },
          }
        : {}),
    };
  });
}

server.registerTool(
  "vocaloid_list_voices",
  {
    title: "List Installed VOCALOID Voices",
    description: `Discover installed V3/V4 voice metadata from VVD files.

Use this before creating a project so the component ID and voice name match a locally installed voicebank. The default search root is /mnt/d/Vocaloid/VoiceDB. This tool only reads small VVD metadata files; it does not read DDB audio databases.

Returns voice name, 16-character component ID, voice format version, source path, and default timbre parameters.`,
    inputSchema: z
      .object({
        directories: z
          .array(z.string().min(1).max(4096))
          .max(10)
          .optional()
          .describe("Optional allowed voice database roots"),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ directories, response_format }) => {
    try {
      const voices = await discoverVoices(directories);
      return textResult(
        { total: voices.length, voices },
        response_format,
        `Found ${voices.length} VOCALOID voice${voices.length === 1 ? "" : "s"}`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_list_instruments",
  {
    title: "List Accompaniment Instruments",
    description: `List zero-based General MIDI programs and channel-10 percussion note numbers for vocaloid_render_accompaniment.

Use search to find an instrument family or name, such as piano, guitar, bass, strings, pad, kick, snare, or hi-hat. An empty search returns all 128 programs and the standard percussion map.`,
    inputSchema: z
      .object({
        search: z.string().max(128).optional(),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ search, response_format }) => {
    try {
      const result = listGeneralMidi(search);
      return textResult(
        result,
        response_format,
        `Found ${result.programs.length} programs and ${result.drums.length} percussion sounds`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_inspect_project",
  {
    title: "Inspect VOCALOID Project",
    description: `Summarize a V3 or V4 VSQX project without modifying it.

Returns format/version, voices, tempo and time signatures, track/part layout, note and control-point counts, and structural diagnostics such as overlaps or notes beyond a part's playTime. Use vocaloid_list_notes or vocaloid_list_control_points for paginated event detail.`,
    inputSchema: z
      .object({ path: PathSchema, response_format: ResponseFormatSchema })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ path, response_format }) => {
    try {
      const summary = await inspectProject(path);
      return textResult(
        summary,
        response_format,
        `${summary.sequenceName || "Untitled"}: ${summary.tracks.length} vocal tracks`,
        summary.diagnostics,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_inspect_mixer",
  {
    title: "Inspect VOCALOID Vocal Mixer",
    description: `Read every vocal mixer unit in a V3/V4 VSQX without modifying it.

Returns track names/numbers, volume, pan, mute/solo, send routing, and an interpreted pan position. VOCALOID pan is not a signed value: 0=hard left, 64=center, 127=hard right. Use this before render and compare it with vocaloid_analyze_wav per-channel measurements so intentional stereo placement is distinguishable from an accidental one-sided mix.`,
    inputSchema: z
      .object({ path: PathSchema, response_format: ResponseFormatSchema })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ path, response_format }) => {
    try {
      const result = await inspectProjectMixer(path);
      return textResult(
        result,
        response_format,
        `Inspected ${result.vocalUnits.length} vocal mixer units`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_update_mixer",
  {
    title: "Update VOCALOID Vocal Mixer",
    description: `Atomically revise vocal-track mixer placement and write a derived V3/V4 VSQX.

Each update targets a VSQX track_number and may change volume, pan, mute/solo, or send routing while preserving every unspecified field. Pan uses the native 0..127 scale: 0=hard left, 64=center, 127=hard right. This tool does not force a centered mix; it gives the agent explicit artistic control. Call vocaloid_inspect_mixer before and after, validate the derived project, render to a new versioned mix path, then use vocaloid_analyze_wav to verify actual channel balance. Existing output requires overwrite=true and receives a timestamped backup.`,
    inputSchema: z
      .object({
        input_path: PathSchema,
        output_path: PathSchema,
        updates: z
          .array(
            z
              .object({
                track_number: z.number().int().min(0).max(127),
                volume: z.number().int().min(-898).max(600).optional(),
                pan: z
                  .number()
                  .int()
                  .min(0)
                  .max(127)
                  .optional()
                  .describe("0=hard left, 64=center, 127=hard right"),
                mute: z.boolean().optional(),
                solo: z.boolean().optional(),
                send_level: z.number().int().min(-898).max(0).optional(),
                send_enabled: z.boolean().optional(),
              })
              .strict(),
          )
          .min(1)
          .max(128),
        overwrite: z.boolean().default(false),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await updateProjectMixer(
        params.input_path,
        params.output_path,
        params.updates.map((update) => ({
          trackNumber: update.track_number,
          ...(update.volume !== undefined ? { volume: update.volume } : {}),
          ...(update.pan !== undefined ? { pan: update.pan } : {}),
          ...(update.mute !== undefined ? { mute: update.mute } : {}),
          ...(update.solo !== undefined ? { solo: update.solo } : {}),
          ...(update.send_level !== undefined ? { sendLevel: update.send_level } : {}),
          ...(update.send_enabled !== undefined ? { sendEnabled: update.send_enabled } : {}),
        })),
        params.overwrite,
      );
      return textResult(
        result,
        params.response_format,
        `Updated mixer for tracks ${result.updatedTrackNumbers.join(", ")}`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_validate_project",
  {
    title: "Validate VOCALOID Project",
    description: `Validate a V3 or V4 VSQX project using structural checks and xmllint/XSD when the matching schema is available.

The local defaults are /mnt/d/Vocaloid/Vocaloid3FE/vsq3.xsd and vsq4.xsd. Pass schema_path only to use another trusted schema. This tool does not modify the project.`,
    inputSchema: z
      .object({
        path: PathSchema,
        schema_path: PathSchema.optional(),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ path, schema_path, response_format }) => {
    try {
      const result = await validateProject(path, schema_path);
      return textResult(
        result,
        response_format,
        result.valid ? `Valid ${result.format} project` : `Invalid ${result.format} project`,
        result.diagnostics,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_list_notes",
  {
    title: "List VOCALOID Notes",
    description: `List notes from one VSQX musical part with filtering and pagination.

track_number is the VSQX track number, not its array index. part_index is zero-based. start_tick/end_tick and returned note ticks are relative to the part; partStart gives its absolute project tick. Filtering includes notes that overlap the requested half-open range.`,
    inputSchema: z
      .object({
        path: PathSchema,
        track_number: z.number().int().min(0).max(127).default(0),
        part_index: z.number().int().min(0).default(0),
        start_tick: z.number().int().min(0).optional(),
        end_tick: z.number().int().min(1).optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(50),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      if (
        params.start_tick !== undefined &&
        params.end_tick !== undefined &&
        params.end_tick <= params.start_tick
      ) {
        throw new Error("end_tick must be greater than start_tick");
      }
      const result = await listNotes(
        params.path,
        params.track_number,
        params.part_index,
        params.start_tick,
        params.end_tick,
        params.offset,
        params.limit,
      );
      return textResult(
        result,
        params.response_format,
        `${result.page.count} of ${result.page.total} notes`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_list_control_points",
  {
    title: "List VOCALOID Control Points",
    description: `List DYN/BRE/BRI/CLE/GEN/POR/PIT/PBS points from one VSQX part.

Ticks are relative to the part. V4's single-letter curve IDs are normalized to the familiar V3 names. Omit curve to list every master control curve. Results are filtered to [start_tick, end_tick) and paginated.`,
    inputSchema: z
      .object({
        path: PathSchema,
        track_number: z.number().int().min(0).max(127).default(0),
        part_index: z.number().int().min(0).default(0),
        curve: CurveSchema.optional(),
        start_tick: z.number().int().min(0).optional(),
        end_tick: z.number().int().min(1).optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(200).default(100),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      if (
        params.start_tick !== undefined &&
        params.end_tick !== undefined &&
        params.end_tick <= params.start_tick
      ) {
        throw new Error("end_tick must be greater than start_tick");
      }
      const result = await listControlPoints(
        params.path,
        params.track_number,
        params.part_index,
        params.curve,
        params.start_tick,
        params.end_tick,
        params.offset,
        params.limit,
      );
      return textResult(
        result,
        params.response_format,
        `${result.page.count} of ${result.page.total} control points`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_render_accompaniment",
  {
    title: "Render Instrumental Accompaniment",
    description: `Compose and render a real 16-bit PCM stereo WAV accompaniment from structured instrumental notes and drum hits.

This is an audio renderer, not a MIDI deliverable: a temporary Standard MIDI File is used only inside the bounded FluidSynth process and is deleted afterward. Tracks use SoundFont bank MSB/LSB plus program, volume/pan, and absolute zero-based measure/beat/tick positions. Reusable per-track and drum patterns can be placed, repeated, transposed, and velocity-scaled across 3-4 minute arrangements, making different intro/verse/pre/chorus/bridge grooves concise. Tempo and meter changes use the same coordinate system as vocaloid_create_song. The verified non-silent WAV can be passed directly as a stereo audio_part, then vocaloid_render_wav exports the combined vocal/harmony/backing Master. The bundled GM SoundFont is suitable for drafts and includes Shamisen, Koto, Shakuhachi, Taiko, and Taisho Koto; soundfont_path can select a better compatible SF2 within an allowed read root.`,
    inputSchema: z
      .object({
        output_path: PathSchema,
        time_signatures: z
          .array(
            z
              .object({
                measure: z.number().int().min(0).max(100_000),
                numerator: z.number().int().min(1).max(32),
                denominator: z.union([
                  z.literal(1),
                  z.literal(2),
                  z.literal(4),
                  z.literal(8),
                  z.literal(16),
                  z.literal(32),
                ]),
              })
              .strict(),
          )
          .min(1)
          .max(256)
          .default([{ measure: 0, numerator: 4, denominator: 4 }]),
        tempos: z
          .array(
            z.object({ position: MusicalPositionSchema, bpm: z.number().min(20).max(400) }).strict(),
          )
          .min(1)
          .max(5000)
          .default([{ position: { measure: 0, beat: 0, tick: 0 }, bpm: 120 }]),
        end: MusicalPositionSchema.describe("Exclusive song end; all notes and drum hits must end before it"),
        tracks: z.array(AccompanimentTrackSchema).min(1).max(15),
        drums: z.array(DrumHitSchema).max(50_000).default([]),
        drum_patterns: z.array(DrumPatternSchema).max(256).default([]),
        drum_placements: z.array(DrumPlacementSchema).max(5000).default([]),
        sample_rate: z.union([z.literal(44_100), z.literal(48_000), z.literal(96_000)]).default(44_100),
        gain: z.number().gt(0).max(10).default(0.2),
        reverb: z.boolean().default(true),
        chorus: z.boolean().default(true),
        soundfont_path: PathSchema.optional(),
        overwrite: z.boolean().default(false),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await renderAccompaniment({
        outputPath: params.output_path,
        timeSignatures: params.time_signatures,
        tempos: params.tempos,
        end: params.end,
        tracks: params.tracks.map((track) => ({
          name: track.name,
          program: track.program,
          bankMsb: track.bank_msb,
          bankLsb: track.bank_lsb,
          volume: track.volume,
          pan: track.pan,
          notes: track.notes.map((note) => ({
            position: note.position,
            duration: note.duration,
            noteNumber: note.note_number,
            velocity: note.velocity,
          })),
          patterns: track.patterns.map((pattern) => ({
            id: pattern.id,
            measures: pattern.measures,
            notes: pattern.notes.map((note) => ({
              offset: note.offset,
              duration: note.duration,
              noteNumber: note.note_number,
              velocity: note.velocity,
            })),
          })),
          placements: track.placements.map((placement) => ({
            patternId: placement.pattern_id,
            start: placement.start,
            repeats: placement.repeats,
            transpose: placement.transpose,
            velocityScale: placement.velocity_scale,
          })),
        })),
        drums: params.drums.map((hit) => ({
          position: hit.position,
          noteNumber: hit.note_number,
          velocity: hit.velocity,
          duration: hit.duration,
        })),
        drumPatterns: params.drum_patterns.map((pattern) => ({
          id: pattern.id,
          measures: pattern.measures,
          hits: pattern.hits.map((hit) => ({
            offset: hit.offset,
            noteNumber: hit.note_number,
            velocity: hit.velocity,
            duration: hit.duration,
          })),
        })),
        drumPlacements: params.drum_placements.map((placement) => ({
          patternId: placement.pattern_id,
          start: placement.start,
          repeats: placement.repeats,
          velocityScale: placement.velocity_scale,
        })),
        sampleRate: params.sample_rate,
        gain: params.gain,
        reverb: params.reverb,
        chorus: params.chorus,
        ...(params.soundfont_path !== undefined ? { soundfontPath: params.soundfont_path } : {}),
        overwrite: params.overwrite,
      });
      return textResult(
        result,
        params.response_format,
        `Rendered ${result.durationSeconds.toFixed(3)} seconds of accompaniment audio`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_compile_vocal_phrase",
  {
    title: "Compile Vocal Lyrics and Rhythm Phrase",
    description: `Compile phrase-level lyrics and rhythm cells into native VOCALOID note events without writing a project.

Use this to preview rapid lyrics, tuplets, syncopation, rests, pickups, and melisma before vocaloid_create_song. Sequential allocation consumes one lyric unit per note cell, which makes 1/16–1/64 or tuplet syllabic runs concise. Explicit allocation uses lyric_index: consecutive cells pointing to the same lyric automatically compile to the real-world VSQX continuation representation lyric='-' and phonemes='-'. A cell may override lyric/phonemes to split diphthongs or consonant clusters across notes. Rhythm values use 480 PPQ and support dotted notes and N-in-the-time-of-M tuplets; explicit tick durations remain available. Returns positioned notes plus phrase density/continuation statistics.`,
    inputSchema: z
      .object({
        time_signatures: z
          .array(
            z
              .object({
                measure: z.number().int().min(0).max(100_000),
                numerator: z.number().int().min(1).max(32),
                denominator: z.union([
                  z.literal(1), z.literal(2), z.literal(4),
                  z.literal(8), z.literal(16), z.literal(32),
                ]),
              })
              .strict(),
          )
          .min(1)
          .max(256)
          .default([{ measure: 0, numerator: 4, denominator: 4 }]),
        phrase: VocalPhraseSchema,
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = compileVocalPhrase(
        params.time_signatures,
        normalizeVocalPhrase(params.phrase),
      );
      return textResult(
        result,
        params.response_format,
        `Compiled ${result.noteCells} vocal notes (${result.continuations} continuations, fastest ${result.fastestNoteTicks ?? 0} ticks)`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_create_song",
  {
    title: "Create Structured VOCALOID Song",
    description: `Create a complete multi-track, multi-part V3/V4 VSQX song from nothing using musical positions.

Use this for long-form composition, lead/double/harmony/countermelody vocal tracks, named sections, tempo changes, meter changes, and real mono/stereo WAV backing or stems. Positions are zero-based measure/beat/tick coordinates after the count-in; the server converts them to VSQX project and part-relative ticks. Parts may contain direct notes and/or phrase-level lyric/rhythm cells for rapid syllables, tuplets, rests, syncopation, and melisma. Each track is monophonic and may contain many non-overlapping parts; use separate tracks for simultaneous harmony. Notes and control curves use absolute song positions, so agents can revise arrangements without manually calculating part offsets. Every track has an explicit installed voice and mixer settings. Audio headers are verified and their playTime is calculated across the tempo map. Call vocaloid_list_voices first. Use a descriptive sequence-based output filename. The project is written atomically and does not copy any source VSQX.`,
    inputSchema: z
      .object({
        output_path: PathSchema,
        format: z.enum(["vsq3", "vsq4"]).default("vsq3"),
        sequence_name: z.string().min(1).max(256).default("Agent Song"),
        pre_measure: z.number().int().min(0).max(127).default(1),
        time_signatures: z
          .array(
            z
              .object({
                measure: z.number().int().min(0).max(100_000),
                numerator: z.number().int().min(1).max(32),
                denominator: z.union([
                  z.literal(1),
                  z.literal(2),
                  z.literal(4),
                  z.literal(8),
                  z.literal(16),
                  z.literal(32),
                ]),
              })
              .strict(),
          )
          .min(1)
          .max(256)
          .default([{ measure: 0, numerator: 4, denominator: 4 }])
          .describe("Strictly ordered meter changes; the first must be at measure 0"),
        tempos: z
          .array(
            z
              .object({
                position: MusicalPositionSchema,
                bpm: z.number().min(20).max(400),
              })
              .strict(),
          )
          .min(1)
          .max(5000)
          .default([{ position: { measure: 0, beat: 0, tick: 0 }, bpm: 120 }])
          .describe("Strictly ordered tempo changes; the first must be at song position 0:0:0"),
        tracks: z
          .array(SongTrackSchema)
          .min(1)
          .max(16)
          .describe("Independent vocal tracks; use additional tracks for doubles and harmony"),
        audio_parts: z
          .array(SongAudioPartSchema)
          .max(256)
          .default([])
          .describe(
            "Optional real WAV accompaniment/stems embedded as native VSQX audio parts; metadata and playTime are derived from the files",
          ),
        overwrite: z.boolean().default(false),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await createSong({
        outputPath: params.output_path,
        format: params.format,
        sequenceName: params.sequence_name,
        preMeasure: params.pre_measure,
        timeSignatures: params.time_signatures,
        tempos: params.tempos,
        tracks: params.tracks.map((track) => ({
          name: track.name,
          ...(track.comment !== undefined ? { comment: track.comment } : {}),
          voice: { name: track.voice.name, componentId: track.voice.component_id },
          bankSelect: track.bank_select,
          programChange: track.program_change,
          ...(track.mixer
            ? {
                mixer: {
                  volume: track.mixer.volume,
                  pan: track.mixer.pan,
                  mute: track.mixer.mute,
                  solo: track.mixer.solo,
                  sendLevel: track.mixer.send_level,
                  sendEnabled: track.mixer.send_enabled,
                },
              }
            : {}),
          parts: track.parts.map((part) => {
            const curveNames = new Set<string>();
            for (const entry of part.control_curves) {
              if (curveNames.has(entry.curve)) {
                throw new Error(`${track.name}/${part.name} contains duplicate curve ${entry.curve}`);
              }
              curveNames.add(entry.curve);
            }
            return {
              name: part.name,
              ...(part.comment !== undefined ? { comment: part.comment } : {}),
              start: part.start,
              end: part.end,
              notes: [
                ...normalizePositionedNotes(part.notes),
                ...part.phrases.flatMap((phrase) =>
                  compileVocalPhrase(
                    params.time_signatures,
                    normalizeVocalPhrase(phrase),
                  ).notes
                ),
              ],
              controlCurves: Object.fromEntries(
                part.control_curves.map((entry) => [entry.curve, entry.points]),
              ),
            };
          }),
        })),
        audioParts: params.audio_parts.map((audio) => ({
          name: audio.name,
          ...(audio.comment !== undefined ? { comment: audio.comment } : {}),
          kind: audio.kind,
          filePath: audio.file_path,
          start: audio.start,
        })),
        overwrite: params.overwrite,
      });
      return textResult(
        result,
        params.response_format,
        `Created ${result.format} song with ${result.tracks} tracks and ${result.parts} parts`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_create_project",
  {
    title: "Create VOCALOID Project",
    description: `Create a complete schema-valid, single-track V3 or V4 VSQX project from nothing.

No input VSQX is read, copied, sampled, or required. Call vocaloid_list_voices first and pass an installed voice's name/component_id. Note ticks are relative to the new musical part. Notes may include note expression and selective vibrato depth/rate envelopes; control_curves can atomically add the complete DYN/BRE/BRI/CLE/GEN/POR/PIT/PBS tuning. Writes are restricted to the server workspace unless VOCALOID_WRITE_ROOTS explicitly adds another root. Existing output is refused unless overwrite=true; overwrites create a timestamped backup.`,
    inputSchema: z
      .object({
        output_path: PathSchema,
        format: z.enum(["vsq3", "vsq4"]).default("vsq4"),
        voice: z
          .object({
            name: z.string().min(1).max(256),
            component_id: z.string().length(16),
          })
          .strict(),
        bank_select: z.number().int().min(0).max(127).default(0),
        program_change: z.number().int().min(0).max(127).default(0),
        sequence_name: z.string().min(1).max(256).default("Agent Song"),
        track_name: z.string().min(1).max(256).default("Lead Vocal"),
        part_name: z.string().min(1).max(256).default("Verse 1"),
        bpm: z.number().min(20).max(400).default(120),
        numerator: z.number().int().min(1).max(32).default(4),
        denominator: z.union([
          z.literal(1),
          z.literal(2),
          z.literal(4),
          z.literal(8),
          z.literal(16),
          z.literal(32),
        ]).default(4),
        pre_measure: z.number().int().min(0).max(127).default(4),
        notes: z.array(NoteSchema).max(1000).default([]),
        control_curves: z
          .array(
            z
              .object({
                curve: CurveSchema,
                points: z.array(ControlPointSchema).min(1).max(5000),
              })
              .strict(),
          )
          .max(8)
          .default([])
          .describe(
            "Optional complete DYN/BRE/BRI/CLE/GEN/POR/PIT/PBS curves for a tuned project created in one atomic write",
          ),
        overwrite: z.boolean().default(false),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const curveNames = new Set<string>();
      for (const entry of params.control_curves) {
        if (curveNames.has(entry.curve)) {
          throw new Error(`control_curves contains duplicate curve ${entry.curve}`);
        }
        curveNames.add(entry.curve);
      }
      const result = await createProject({
        outputPath: params.output_path,
        format: params.format,
        voice: { name: params.voice.name, componentId: params.voice.component_id },
        bankSelect: params.bank_select,
        programChange: params.program_change,
        sequenceName: params.sequence_name,
        trackName: params.track_name,
        partName: params.part_name,
        bpm: params.bpm,
        numerator: params.numerator,
        denominator: params.denominator,
        preMeasure: params.pre_measure,
        notes: normalizeNotes(params.notes),
        controlCurves: Object.fromEntries(
          params.control_curves.map((entry) => [entry.curve, entry.points]),
        ),
        overwrite: params.overwrite,
      });
      return textResult(result, params.response_format, `Created ${result.format} project`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_update_note_expressions",
  {
    title: "Update VOCALOID Note Expressions",
    description: `Retune selected notes in an existing VSQX and write a derived project.

Use vocaloid_list_notes first; note_index is the stable index returned there. This tool updates pronunciation velocity, lyric/phonemes, accent, decay, opening, bend depth/length, rising/falling portamento, and built-in vibrato. Vibrato depth/rate envelopes use normalized positions across the whole note (0..65536) and values 0..127. Passing vibrato type 0 turns vibrato off and clears its envelopes. Unspecified fields are preserved. Existing outputs require overwrite=true and are backed up first.`,
    inputSchema: z
      .object({
        input_path: PathSchema,
        output_path: PathSchema,
        track_number: z.number().int().min(0).max(127).default(0),
        part_index: z.number().int().min(0).default(0),
        updates: z.array(NoteExpressionUpdateSchema).min(1).max(1000),
        overwrite: z.boolean().default(false),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await updateNoteExpressionsInProject(
        params.input_path,
        params.output_path,
        params.track_number,
        params.part_index,
        normalizeNoteExpressionUpdates(params.updates),
        params.overwrite,
      );
      return textResult(
        result,
        params.response_format,
        `Updated expressions on ${result.updated} notes`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_analyze_wav",
  {
    title: "Analyze WAV Mix Quality",
    description: `Read a WAV and return actionable mix/master quality metrics without modifying it.

Combines sample-domain RIFF analysis with FFmpeg EBU R128 measurement: integrated LUFS, loudness range, sample peak, true peak, RMS, crest factor, full-scale sample count/ratio, per-channel peak/RMS/clipping, stereo L-R RMS balance, and target deltas. A stereo difference above 3 dB sets channelImbalance=true and identifies the louder side; this is a review signal, not an assumption that every artistic mix must be centered. Recommendations distinguish accidental routing, source clipping, and correctable loudness/true-peak issues. Use this on accompaniment and original-Editor Master renders before deciding whether to call vocaloid_update_mixer, lower levels, re-render, or master.`,
    inputSchema: z
      .object({
        path: PathSchema,
        target_lufs: z.number().min(-24).max(-5).default(-14),
        target_true_peak_dbfs: z.number().min(-6).max(-0.1).default(-1),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await analyzeAudioQuality(
        params.path,
        params.target_lufs,
        params.target_true_peak_dbfs,
      );
      return textResult(
        result,
        params.response_format,
        `Analyzed ${result.durationSeconds.toFixed(3)} seconds: ${result.integratedLufs.toFixed(1)} LUFS, ${result.truePeakDbfs.toFixed(1)} dBFS true peak`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_master_wav",
  {
    title: "Master WAV to Loudness and True-Peak Targets",
    description: `Create a new mastered 16-bit PCM WAV using measured two-pass EBU R128 loudness normalization and true-peak limiting.

The source is never modified and input_path must differ from output_path. The tool first measures loudness, renders to a temporary sibling, independently re-analyzes the result, and atomically commits only when integrated loudness is within 0.6 LU and true peak within 0.2 dB of the requested ceilings. Existing output is refused unless overwrite=true, which creates a timestamped backup. If the source already contains full-scale clipped samples, success reports sourceClipped=true: mastering can prevent new overs but cannot reconstruct lost transients, so a lower-level remix/re-render remains preferable.`,
    inputSchema: z
      .object({
        input_path: PathSchema,
        output_path: PathSchema,
        target_lufs: z.number().min(-24).max(-5).default(-14),
        target_true_peak_dbfs: z.number().min(-6).max(-0.1).default(-1),
        target_loudness_range_lu: z.number().min(1).max(20).default(11),
        overwrite: z.boolean().default(false),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await masterWav({
        inputPath: params.input_path,
        outputPath: params.output_path,
        targetLufs: params.target_lufs,
        targetTruePeakDbfs: params.target_true_peak_dbfs,
        targetLoudnessRangeLu: params.target_loudness_range_lu,
        overwrite: params.overwrite,
      });
      const warnings = [
        ...(result.sourceClipped
          ? ["The source contained clipped samples; re-render the mix with more headroom to restore transient quality"]
          : []),
        ...(!result.loudnessRangeTargetMet
          ? [`Output LRA is ${result.output.loudnessRangeLu.toFixed(1)} LU versus the requested ${result.targetLoudnessRangeLu.toFixed(1)} LU; revise section dynamics or bus compression rather than claiming the dynamic-range target was met`]
          : []),
      ];
      return textResult(
        result,
        params.response_format,
        `Mastered to ${result.output.integratedLufs.toFixed(1)} LUFS and ${result.output.truePeakDbfs.toFixed(1)} dBFS true peak`,
        warnings,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_render_wav",
  {
    title: "Render VOCALOID Project to WAV",
    description: `Render a validated V3/V4 VSQX through the installed original VOCALOID3 Editor and return verified audio metrics.

This is a bounded workflow operation: it launches a helper-owned minimized editor, guards export dialogs offscreen, selects Master Track WAV export, waits for a stable output, closes the editor, validates RIFF/WAVE structure, and rejects silent audio. It never reports success from file existence alone. Output is written to a temporary sibling and atomically renamed only after validation. Existing output is refused unless overwrite=true; replacement creates a timestamped backup. The native helper must first be built with scripts/build-native.sh.`,
    inputSchema: z
      .object({
        input_path: PathSchema.describe("Source V3/V4 .vsqx project"),
        output_path: PathSchema.describe("Destination .wav path within an allowed write root"),
        timeout_seconds: z
          .number()
          .int()
          .min(10)
          .max(600)
          .default(300)
          .describe("Total editor launch, synthesis, export, and cleanup deadline"),
        overwrite: z.boolean().default(false),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await renderProjectToWav(
        params.input_path,
        params.output_path,
        params.timeout_seconds,
        params.overwrite,
      );
      const warnings = result.forcedTermination
        ? ["The helper had to terminate its own editor process after producing valid audio"]
        : [];
      return textResult(
        result,
        params.response_format,
        `Rendered ${result.durationSeconds.toFixed(3)} seconds of verified vocal audio`,
        warnings,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_add_notes",
  {
    title: "Add VOCALOID Notes",
    description: `Add notes to one part and save a new VSQX file or an explicitly approved overwrite.

Existing and new notes are sorted by relative tick, and playTime expands when necessary. The source is never changed when output_path differs. If output_path exists, overwrite=false refuses the operation; overwrite=true first creates a timestamped backup. This tool does not resolve overlaps automatically—validate or inspect the output afterward.`,
    inputSchema: z
      .object({
        input_path: PathSchema,
        output_path: PathSchema,
        track_number: z.number().int().min(0).max(127).default(0),
        part_index: z.number().int().min(0).default(0),
        notes: z.array(NoteSchema).min(1).max(1000),
        overwrite: z.boolean().default(false),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await addNotesToProject(
        params.input_path,
        params.output_path,
        params.track_number,
        params.part_index,
        normalizeNotes(params.notes),
        params.overwrite,
      );
      return textResult(result, params.response_format, `Added ${result.added} notes`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_add_control_points",
  {
    title: "Add VOCALOID Control Points",
    description: `Upsert points on a DYN/BRE/BRI/CLE/GEN/POR/PIT/PBS curve and write a derived VSQX.

DYN shapes loudness; BRE breathiness; BRI brightness; CLE clarity; GEN formant/gender; POR portamento timing; PIT pitch bend; PBS pitch-bend sensitivity in semitones. Curve ranges are enforced: PIT -8192..8191, PBS 0..24, all others 0..127. Approximate pitch offset is PIT/8192*PBS semitones. Prefer a few intentional points around transitions and phrase arcs rather than dense arbitrary curves. V4 curve names are encoded to its single-letter IDs. Duplicate curve/tick pairs are replaced. With replace_range=true, existing points on the chosen curve between the first and last supplied tick are removed before insertion. Existing outputs require overwrite=true and are backed up first.`,
    inputSchema: z
      .object({
        input_path: PathSchema,
        output_path: PathSchema,
        track_number: z.number().int().min(0).max(127).default(0),
        part_index: z.number().int().min(0).default(0),
        curve: CurveSchema,
        points: z.array(ControlPointSchema).min(1).max(5000),
        replace_range: z.boolean().default(false),
        overwrite: z.boolean().default(false),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await addControlPointsToProject(
        params.input_path,
        params.output_path,
        params.track_number,
        params.part_index,
        params.curve,
        params.points,
        params.replace_range,
        params.overwrite,
      );
      return textResult(
        result,
        params.response_format,
        `Added ${result.added} ${result.curve} points`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_create_song_manifest",
  {
    title: "Create Canonical Song Manifest",
    description: `Create the canonical, revisioned source for an agent-composed song.

The manifest retains semantic sections, timeline, harmony, stable IDs, vocal sources, arrangement intent, mix intent, and artifact provenance. VSQX/WAV files are derived later with vocaloid_build_song_manifest. IDs are lowercase and globally unique across the manifest. Create only the song skeleton here; add one vocal part or arrangement track per bounded upsert call.`,
    inputSchema: z
      .object({
        output_path: PathSchema.describe("New .song.json path"),
        song_id: ManifestIdSchema,
        slug: ManifestIdSchema.describe("Filename-safe song slug used in all derived artifact names"),
        title: z.string().min(1).max(256),
        format: z.enum(["vsq3", "vsq4"]).default("vsq3"),
        pre_measure: z.number().int().min(0).max(127).default(1),
        time_signatures: z.array(ManifestTimeSignatureSchema).min(1).max(256)
          .default([{ measure: 0, numerator: 4, denominator: 4 }]),
        tempos: z.array(ManifestTempoSchema).min(1).max(5000)
          .default([{ position: { measure: 0, beat: 0, tick: 0 }, bpm: 120 }]),
        sections: z.array(ManifestSectionSchema).min(1).max(1024)
          .describe("Ordered, non-overlapping semantic song sections"),
        key_changes: z.array(ManifestKeyChangeSchema).max(1024).default([]),
        chord_changes: z.array(ManifestChordChangeSchema).max(20_000).default([]),
        sample_rate: z.union([z.literal(44_100), z.literal(48_000), z.literal(96_000)]).default(44_100),
        accompaniment_gain: z.number().gt(0).max(10).default(0.2),
        reverb: z.boolean().default(true),
        chorus: z.boolean().default(true),
        soundfont_path: PathSchema.optional(),
        overwrite: z.boolean().default(false),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await createSongManifest({
        outputPath: params.output_path,
        songId: params.song_id,
        slug: params.slug,
        title: params.title,
        format: params.format,
        preMeasure: params.pre_measure,
        timeSignatures: params.time_signatures,
        tempos: params.tempos,
        sections: params.sections,
        keyChanges: params.key_changes,
        chordChanges: params.chord_changes,
        sampleRate: params.sample_rate,
        gain: params.accompaniment_gain,
        reverb: params.reverb,
        chorus: params.chorus,
        ...(params.soundfont_path !== undefined ? { soundfontPath: params.soundfont_path } : {}),
        overwrite: params.overwrite,
      });
      return textResult(result, params.response_format, `Created song manifest revision ${result.revision}`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_inspect_song_manifest",
  {
    title: "Inspect Song Manifest",
    description: `Read a canonical .song.json and verify its SHA-256 content hash and semantic references.

Returns the current revision/hash, stable section IDs, vocal/arrangement inventory, and artifact provenance. Always inspect immediately before a mutation and pass its revision as expected_revision.`,
    inputSchema: z.object({ path: PathSchema, response_format: ResponseFormatSchema }).strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ path, response_format }) => {
    try {
      const result = await inspectSongManifest(path);
      return textResult(result, response_format, `Song manifest revision ${result.revision}`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_get_song_section",
  {
    title: "Get One Song Section",
    description: `Fetch one semantic section plus only its intersecting vocal parts, harmony, arrangement patterns, placements, and direct events.

Use this bounded read before revising a verse/chorus instead of resubmitting or rereading the whole song.`,
    inputSchema: z
      .object({
        path: PathSchema,
        section_id: ManifestIdSchema,
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ path, section_id, response_format }) => {
    try {
      const result = await getSongManifestSection(path, section_id);
      return textResult(result, response_format, `Loaded section ${section_id} from revision ${result.revision}`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_upsert_song_section",
  {
    title: "Upsert Song Section",
    description: `Insert or replace exactly one section by stable ID using optimistic revision control.

Unrelated IDs and creative content remain unchanged. Overlapping sections and dangling references are rejected.`,
    inputSchema: ManifestMutationPathSchema.extend({ section: ManifestSectionSchema }).strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await upsertSongManifestSection(
        params.input_path,
        params.output_path,
        params.expected_revision,
        params.section,
        params.overwrite,
      );
      return textResult(result, params.response_format, `Upserted section ${params.section.id}`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_upsert_manifest_vocal_part",
  {
    title: "Upsert Manifest Vocal Part",
    description: `Insert or replace one vocal part and its voice/track metadata by stable ID.

Direct notes and phrase sources can express rapid syllables, rests, tuplets, melisma, note expression, vibrato, and control curves. This bounded operation keeps other parts and tracks intact. The supplied track voice_id must equal voice.id.`,
    inputSchema: ManifestMutationPathSchema.extend({
      voice: ManifestVoiceSchema,
      track: ManifestVocalTrackMetadataSchema,
      part: ManifestVocalPartSchema,
    }).strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await upsertSongManifestVocalPart(
        params.input_path,
        params.output_path,
        params.expected_revision,
        params.voice,
        params.track,
        params.part,
        params.overwrite,
      );
      return textResult(result, params.response_format, `Upserted vocal part ${params.part.id}`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_upsert_manifest_arrangement_track",
  {
    title: "Upsert Manifest Arrangement Track",
    description: `Insert or replace one pitched or drum arrangement track by stable ID.

Use compact reusable patterns and section-tagged placements for long songs. Other tracks remain unchanged, and every pattern/section reference is validated.`,
    inputSchema: ManifestMutationPathSchema.extend({
      track: ManifestArrangementTrackSchema,
    }).strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await upsertSongManifestArrangementTrack(
        params.input_path,
        params.output_path,
        params.expected_revision,
        params.track,
        params.overwrite,
      );
      return textResult(result, params.response_format, `Upserted arrangement track ${params.track.id}`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_transform_song_events",
  {
    title: "Transform Song Events",
    description: `Apply one deterministic transpose, velocity, duration, or tick-shift transform to selected stable event IDs or a bounded semantic scope.

Use event_ids for surgical edits. An empty event_ids list intentionally selects every matching event inside the supplied section/track/part scope. Pattern-relative events cannot be tick-shifted.`,
    inputSchema: ManifestMutationPathSchema.extend({ transform: ManifestTransformSchema }).strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await transformSongManifestEvents(
        params.input_path,
        params.output_path,
        params.expected_revision,
        params.transform,
        params.overwrite,
      );
      return textResult(result, params.response_format, `Transformed ${result.changed} stable events`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_remove_song_objects",
  {
    title: "Remove Song Objects",
    description: `Remove explicitly named sections, vocal parts/tracks, arrangement tracks, or leaf events by stable ID.

The mutation is atomic. It rejects zero matches, every-section removal, dangling section references, and invalid empty phrases/patterns/parts.`,
    inputSchema: ManifestMutationPathSchema.extend({ removal: ManifestRemovalSchema }).strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await removeSongManifestObjects(
        params.input_path,
        params.output_path,
        params.expected_revision,
        params.removal,
        params.overwrite,
      );
      return textResult(result, params.response_format, `Removed ${result.removed} song objects`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_build_song_manifest",
  {
    title: "Build Song Manifest Artifacts",
    description: `Build a verified stereo accompaniment WAV and validated native VSQX from one immutable manifest revision.

Both output paths must be new and should include the song slug. On success the manifest is atomically advanced by one revision and records SHA-256, byte size, source revision, dependencies, and paths for both artifacts. On failure incomplete outputs are removed. This does not render VOCALOID vocals; pass the VSQX to vocaloid_render_wav afterward.`,
    inputSchema: z
      .object({
        manifest_path: PathSchema,
        expected_revision: z.number().int().min(1),
        backing_output_path: PathSchema.describe("New slugged .wav accompaniment path"),
        project_output_path: PathSchema.describe("New slugged .vsqx project path"),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await buildSongManifest({
        manifestPath: params.manifest_path,
        expectedRevision: params.expected_revision,
        backingOutputPath: params.backing_output_path,
        projectOutputPath: params.project_output_path,
      });
      return textResult(
        result,
        params.response_format,
        `Built manifest revision ${result.sourceRevision} into validated WAV and VSQX artifacts`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_render_instrument_stems",
  {
    title: "Render Manifest Instrument Stems",
    description: `Render every selected arrangement track as its own verified stereo WAV and record provenance in the manifest.

The agent must explicitly decide whether each pitched stem preserves its composed pan and whether FluidSynth reverb/chorus are included. false/false produces centered dry material for a later reproducible mix; true/true produces stems closer to the current draft mix. Drum tracks are isolated independently. Existing filenames are refused so a failed batch cannot overwrite prior stems.`,
    inputSchema: z
      .object({
        manifest_path: PathSchema,
        expected_revision: z.number().int().min(1),
        output_directory: PathSchema.describe("Existing writable directory for slugged stem filenames"),
        track_ids: z.array(ManifestIdSchema).min(1).max(32).optional()
          .describe("Optional arrangement track IDs; omitted renders every instrument/drum track"),
        preserve_pan: z.boolean().describe("true preserves composed MIDI pan; false centers pitched stems"),
        include_renderer_effects: z.boolean()
          .describe("true keeps manifest FluidSynth reverb/chorus; false renders dry stems"),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await renderSongManifestInstrumentStems({
        manifestPath: params.manifest_path,
        expectedRevision: params.expected_revision,
        outputDirectory: params.output_directory,
        preservePan: params.preserve_pan,
        includeRendererEffects: params.include_renderer_effects,
        ...(params.track_ids !== undefined ? { trackIds: params.track_ids } : {}),
      });
      return textResult(
        result,
        params.response_format,
        `Rendered ${result.stems.length} isolated instrument stems from composition ${result.sourceCompositionHash.slice(0, 12)}`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_render_vocal_stems",
  {
    title: "Render Manifest Vocal Stems",
    description: `Render selected VOCALOID tracks one-by-one through the original Editor as verified stereo vocal stems.

The source must be a hash-verified VSQX artifact whose composition_hash matches the current manifest. For each render, all other vocal tracks are muted and every backing WAV part is physically removed from a temporary project. The agent explicitly chooses source pan versus center and send-enabled versus dry; optional volume overrides the source vocal fader. Outputs and their profile, source project, SHA-256, dependencies, and composition hash are recorded atomically after the complete batch succeeds.`,
    inputSchema: z
      .object({
        manifest_path: PathSchema,
        expected_revision: z.number().int().min(1),
        project_artifact_id: ManifestIdSchema.describe("VSQX artifact ID returned by manifest inspect/build"),
        output_directory: PathSchema.describe("Existing writable directory for slugged stem filenames"),
        vocal_track_ids: z.array(ManifestIdSchema).min(1).max(16).optional()
          .describe("Optional vocal track IDs; omitted renders every vocal track"),
        center_pan: z.boolean().describe("true centers each stem; false preserves the source track pan"),
        dry: z.boolean().describe("true disables vocal send routing; false preserves source send settings"),
        volume: z.number().int().min(-898).max(600).optional()
          .describe("Optional explicit VOCALOID mixer volume; omitted preserves each source value"),
        timeout_seconds: z.number().int().min(10).max(600).default(300)
          .describe("Per-track original Editor export deadline"),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await renderSongManifestVocalStems({
        manifestPath: params.manifest_path,
        expectedRevision: params.expected_revision,
        projectArtifactId: params.project_artifact_id,
        outputDirectory: params.output_directory,
        centerPan: params.center_pan,
        dry: params.dry,
        ...(params.volume !== undefined ? { volume: params.volume } : {}),
        timeoutSeconds: params.timeout_seconds,
        ...(params.vocal_track_ids !== undefined ? { vocalTrackIds: params.vocal_track_ids } : {}),
      });
      return textResult(
        result,
        params.response_format,
        `Rendered ${result.stems.length} isolated VOCALOID stems from ${result.sourceProjectArtifact}`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_analyze_vocal_stem",
  {
    title: "Analyze Vocal Score Versus Render",
    description: `Compare stable manifest vocal events against an isolated, hash-verified VOCALOID stem.

Returns per-note F0 contours, median/p95 cents error, voiced ratio, energy and voiced onsets, consonant lead, release timing, observed vibrato depth/rate/regularity, phrase timing, and actionable issue codes. Rapid notes are explicitly marked as limited-resolution instead of receiving false precision. The project pre-measure and tempo map are applied automatically; timeline_offset_seconds is an explicit calibration, while the reported global energy offset remains observational. Analysis never auto-quantizes expression. A reproducible .vocal-analysis.json and provenance artifact are written on success.`,
    inputSchema: z
      .object({
        manifest_path: PathSchema,
        expected_revision: z.number().int().min(1),
        stem_artifact_id: ManifestIdSchema.describe("vocal_stem artifact ID from manifest inspect"),
        output_path: PathSchema.describe("New slugged filename ending in .vocal-analysis.json"),
        section_id: ManifestIdSchema.optional(),
        event_ids: z.array(ManifestIdSchema).min(1).max(5000).optional()
          .describe("Optional direct-note or phrase-cell stable IDs; omitted analyzes the selected section/track"),
        timeline_offset_seconds: z.number().min(-10).max(10).default(0)
          .describe("Explicit additional offset after automatic pre-measure/tempo mapping"),
        minimum_pitch_hz: z.number().min(30).max(500).default(60),
        maximum_pitch_hz: z.number().min(200).max(3000).default(1200),
        pitch_tolerance_cents: z.number().min(5).max(600).default(80),
        onset_tolerance_ms: z.number().min(10).max(1000).default(120),
        offset_tolerance_ms: z.number().min(10).max(2000).default(160),
        response_format: ResponseFormatSchema,
      })
      .strict()
      .refine((value) => value.maximum_pitch_hz > value.minimum_pitch_hz, {
        message: "maximum_pitch_hz must exceed minimum_pitch_hz",
      }),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await analyzeSongManifestVocalStem({
        manifestPath: params.manifest_path,
        expectedRevision: params.expected_revision,
        stemArtifactId: params.stem_artifact_id,
        outputPath: params.output_path,
        ...(params.section_id !== undefined ? { sectionId: params.section_id } : {}),
        ...(params.event_ids !== undefined ? { eventIds: params.event_ids } : {}),
        timelineOffsetSeconds: params.timeline_offset_seconds,
        minimumPitchHz: params.minimum_pitch_hz,
        maximumPitchHz: params.maximum_pitch_hz,
        pitchToleranceCents: params.pitch_tolerance_cents,
        onsetToleranceMilliseconds: params.onset_tolerance_ms,
        offsetToleranceMilliseconds: params.offset_tolerance_ms,
      });
      const warnings = [
        ...(result.audio.clippedSampleValues > 0
          ? [`Stem contains ${result.audio.clippedSampleValues} clipped sample values; pitch/timing evidence may be distorted`]
          : []),
        ...(result.summary.issueCounts.error > 0
          ? [`Analysis found ${result.summary.issueCounts.error} error-severity score/render deviations`]
          : []),
      ];
      return textResult(
        result,
        params.response_format,
        `Analyzed ${result.summary.events} score events (${result.summary.eventsWithPitch} with confident F0)`,
        warnings,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("vocaloid-mcp-server running via stdio");
}

main().catch((error: unknown) => {
  console.error("vocaloid-mcp-server failed:", error);
  process.exitCode = 1;
});
