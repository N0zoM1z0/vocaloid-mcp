#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import type { ResponseFormat } from "./types.js";
import { renderProjectToWav } from "./render.js";
import { discoverVoices } from "./voices.js";
import {
  addControlPointsToProject,
  addNotesToProject,
  createProject,
  createSong,
  inspectProject,
  listControlPoints,
  listNotes,
  updateNoteExpressionsInProject,
  validateProject,
} from "./vsqx.js";


const server = new McpServer(
  { name: "vocaloid-mcp-server", version: "0.2.0" },
  {
    instructions: `Use this server to compose and iteratively tune native VOCALOID projects. Start with vocaloid_list_voices. For a long-form original song, design the form, tempo/meter map, lead, doubles, harmony, lyrics, voice-appropriate phonemes, note expressions, selective vibrato, sparse musical control curves, and optional real WAV accompaniment, then call vocaloid_create_song. It creates a multi-track/multi-part VSQX from nothing using zero-based measure/beat/tick positions. Use vocaloid_create_project only for a simple single-part draft; its note/control ticks are relative to that part. Validate and inspect before vocaloid_render_wav. After analyzing or listening to the Master render, use note-expression and replace-range control edits for local revisions. Prefer new output paths; explicit overwrites create backups. Native WAV parts make a complete lead/harmony/backing render possible, but this server does not yet generate instrumental stems or make perceptual mix/master decisions, so report that boundary accurately.`,
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

const SongPartSchema = z
  .object({
    name: z.string().min(1).max(256),
    comment: z.string().max(256).optional(),
    start: MusicalPositionSchema.describe("Inclusive absolute song position"),
    end: MusicalPositionSchema.describe("Exclusive absolute song position"),
    notes: z.array(PositionedNoteSchema).max(5000).default([]),
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
        pan: z.number().int().min(0).max(127).default(64),
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
  "vocaloid_create_song",
  {
    title: "Create Structured VOCALOID Song",
    description: `Create a complete multi-track, multi-part V3/V4 VSQX song from nothing using musical positions.

Use this for long-form composition, lead/double/harmony/countermelody vocal tracks, named sections, tempo changes, meter changes, and real mono/stereo WAV backing or stems. Positions are zero-based measure/beat/tick coordinates after the count-in; the server converts them to VSQX project and part-relative ticks. Each track is monophonic and may contain many non-overlapping parts; use separate tracks for simultaneous harmony. Notes and control curves use absolute song positions, so agents can revise arrangements without manually calculating part offsets. Every track has an explicit installed voice and mixer settings. Audio headers are verified and their playTime is calculated across the tempo map. Call vocaloid_list_voices first. The project is written atomically and does not copy any source VSQX.`,
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
              notes: normalizePositionedNotes(part.notes),
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

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("vocaloid-mcp-server running via stdio");
}

main().catch((error: unknown) => {
  console.error("vocaloid-mcp-server failed:", error);
  process.exitCode = 1;
});
