import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  copyFile,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import { z } from "zod";

import {
  renderAccompaniment,
  type AccompanimentTrackInput,
  type DrumHitInput,
  type DrumPatternInput,
  type DrumPatternPlacementInput,
} from "./accompaniment.js";
import { resolveReadablePath, resolveWritablePath } from "./paths.js";
import { compileVocalPhrase, rhythmValueTicks, type VocalPhraseInput } from "./vocal-phrase.js";
import {
  createSong,
  musicalPositionToTick,
  musicalTickToPosition,
  validateProject,
  type MusicalPosition,
  type PositionedNoteInput,
  type SongPartInput,
  type SongTimeSignatureInput,
  type SongTrackInput,
} from "./vsqx.js";
import type { CurveName, NoteInput, VibratoInput, VsqxFormat } from "./types.js";


const MANIFEST_SCHEMA = "vocaloid-song-manifest/v1" as const;
const MAX_MANIFEST_BYTES = 20 * 1024 * 1024;
const IdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,95}$/u)
  .describe("Stable lowercase ID; preserve it across unrelated revisions");

export const ManifestPositionSchema = z
  .object({
    measure: z.number().int().min(0).max(100_000),
    beat: z.number().int().min(0).max(31),
    tick: z.number().int().min(0).max(1919).default(0),
  })
  .strict();

export const ManifestTimeSignatureSchema = z
  .object({
    measure: z.number().int().min(0).max(100_000),
    numerator: z.number().int().min(1).max(32),
    denominator: z.union([
      z.literal(1), z.literal(2), z.literal(4), z.literal(8),
      z.literal(16), z.literal(32),
    ]),
  })
  .strict();

export const ManifestTempoSchema = z
  .object({ position: ManifestPositionSchema, bpm: z.number().min(20).max(400) })
  .strict();

export const ManifestSectionSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1).max(256),
    kind: z.enum([
      "intro", "verse", "pre_chorus", "chorus", "post_chorus", "interlude",
      "bridge", "breakdown", "solo", "outro", "custom",
    ]),
    start: ManifestPositionSchema,
    end: ManifestPositionSchema,
    energy: z.number().min(0).max(1).default(0.5),
    description: z.string().max(2000).default(""),
  })
  .strict();

export const ManifestKeyChangeSchema = z
  .object({
    id: IdSchema,
    position: ManifestPositionSchema,
    tonic: z.string().min(1).max(16),
    mode: z.string().min(1).max(32),
  })
  .strict();

export const ManifestChordChangeSchema = z
  .object({
    id: IdSchema,
    position: ManifestPositionSchema,
    symbol: z.string().min(1).max(64),
    duration_ticks: z.number().int().min(1).max(2_147_483_647),
  })
  .strict();

const ManifestVibratoPointSchema = z
  .object({ position: z.number().int().min(0).max(65_536), value: z.number().int().min(0).max(127) })
  .strict();

const ManifestVibratoSchema = z
  .object({
    type: z.number().int().min(0).max(16),
    length: z.number().int().min(0).max(100),
    depth: z.array(ManifestVibratoPointSchema).max(128).default([]),
    rate: z.array(ManifestVibratoPointSchema).max(128).default([]),
  })
  .strict();

export const ManifestVocalNoteSchema = z
  .object({
    id: IdSchema,
    position: ManifestPositionSchema,
    duration: z.number().int().min(1).max(2_147_483_647),
    note_number: z.number().int().min(0).max(127),
    lyric: z.string().min(1).max(32),
    phonemes: z.string().min(1).max(32),
    phoneme_locked: z.boolean().default(true),
    velocity: z.number().int().min(0).max(127).default(64),
    style: z.record(z.string().min(1).max(32), z.number().int()).default({}),
    vibrato: ManifestVibratoSchema.optional(),
  })
  .strict();

const ManifestRhythmValueSchema = z
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
      .optional(),
  })
  .strict();

const ManifestLyricUnitSchema = z
  .object({
    id: IdSchema,
    lyric: z.string().min(1).max(32),
    phonemes: z.string().min(1).max(32),
    phoneme_locked: z.boolean().default(true),
  })
  .strict();

const ManifestRhythmCellSchema = z
  .object({
    id: IdSchema,
    duration: z.union([z.number().int().min(1), ManifestRhythmValueSchema]),
    rest: z.boolean().default(false),
    note_number: z.number().int().min(0).max(127).optional(),
    lyric_index: z.number().int().min(0).optional(),
    lyric: z.string().min(1).max(32).optional(),
    phonemes: z.string().min(1).max(32).optional(),
    phoneme_locked: z.boolean().optional(),
    gate_percent: z.number().int().min(1).max(100).default(100),
    velocity: z.number().int().min(0).max(127).default(64),
    style: z.record(z.string().min(1).max(32), z.number().int()).default({}),
    vibrato: ManifestVibratoSchema.optional(),
  })
  .strict();

export const ManifestVocalPhraseSchema = z
  .object({
    id: IdSchema,
    start: ManifestPositionSchema,
    allocation: z.enum(["sequential", "explicit"]).default("sequential"),
    lyrics: z.array(ManifestLyricUnitSchema).min(1).max(5000),
    cells: z.array(ManifestRhythmCellSchema).min(1).max(20_000),
  })
  .strict();

const ManifestCurvePointSchema = z
  .object({ id: IdSchema, position: ManifestPositionSchema, value: z.number().int() })
  .strict();

const ManifestCurveSchema = z
  .object({
    id: IdSchema,
    curve: z.enum(["DYN", "BRE", "BRI", "CLE", "GEN", "POR", "PIT", "PBS"]),
    points: z.array(ManifestCurvePointSchema).min(1).max(10_000),
  })
  .strict();

export const ManifestVocalPartSchema = z
  .object({
    id: IdSchema,
    section_id: IdSchema.optional(),
    name: z.string().min(1).max(256),
    comment: z.string().max(1000).default(""),
    start: ManifestPositionSchema,
    end: ManifestPositionSchema,
    notes: z.array(ManifestVocalNoteSchema).max(10_000).default([]),
    phrases: z.array(ManifestVocalPhraseSchema).max(512).default([]),
    control_curves: z.array(ManifestCurveSchema).max(8).default([]),
  })
  .strict()
  .refine((part) => part.notes.length > 0 || part.phrases.length > 0, {
    message: "A vocal part needs direct notes or phrase sources",
  });

export const ManifestVoiceSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1).max(256),
    component_id: z.string().length(16),
    bank_select: z.number().int().min(0).max(127).default(0),
    program_change: z.number().int().min(0).max(127).default(0),
    parameters: z.record(z.string().min(1).max(32), z.number().int()).default({}),
  })
  .strict();

export const ManifestVocalTrackMetadataSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1).max(256),
    comment: z.string().max(1000).default(""),
    voice_id: IdSchema,
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
      .default({
        volume: 0,
        pan: 64,
        mute: false,
        solo: false,
        send_level: -898,
        send_enabled: false,
      }),
  })
  .strict();

const ManifestVocalTrackSchema = ManifestVocalTrackMetadataSchema.extend({
  parts: z.array(ManifestVocalPartSchema).max(512).default([]),
}).strict();

const ManifestInstrumentNoteSchema = z
  .object({
    id: IdSchema,
    position: ManifestPositionSchema,
    duration: z.number().int().min(1),
    note_number: z.number().int().min(0).max(127),
    velocity: z.number().int().min(1).max(127).default(88),
  })
  .strict();

const ManifestPatternNoteSchema = z
  .object({
    id: IdSchema,
    offset: ManifestPositionSchema,
    duration: z.number().int().min(1),
    note_number: z.number().int().min(0).max(127),
    velocity: z.number().int().min(1).max(127).default(88),
  })
  .strict();

const ManifestInstrumentPatternSchema = z
  .object({
    id: IdSchema,
    measures: z.number().int().min(1).max(256),
    notes: z.array(ManifestPatternNoteSchema).min(1).max(20_000),
  })
  .strict();

const ManifestInstrumentPlacementSchema = z
  .object({
    id: IdSchema,
    pattern_id: IdSchema,
    section_id: IdSchema.optional(),
    start: ManifestPositionSchema,
    repeats: z.number().int().min(1).max(1024).default(1),
    transpose: z.number().int().min(-48).max(48).default(0),
    velocity_scale: z.number().gt(0).max(4).default(1),
  })
  .strict();

const ManifestDrumHitSchema = z
  .object({
    id: IdSchema,
    position: ManifestPositionSchema,
    note_number: z.number().int().min(0).max(127),
    velocity: z.number().int().min(1).max(127).default(96),
    duration: z.number().int().min(1).default(60),
  })
  .strict();

const ManifestDrumPatternHitSchema = z
  .object({
    id: IdSchema,
    offset: ManifestPositionSchema,
    note_number: z.number().int().min(0).max(127),
    velocity: z.number().int().min(1).max(127).default(96),
    duration: z.number().int().min(1).default(60),
  })
  .strict();

const ManifestDrumPatternSchema = z
  .object({
    id: IdSchema,
    measures: z.number().int().min(1).max(256),
    hits: z.array(ManifestDrumPatternHitSchema).min(1).max(50_000),
  })
  .strict();

const ManifestDrumPlacementSchema = z
  .object({
    id: IdSchema,
    pattern_id: IdSchema,
    section_id: IdSchema.optional(),
    start: ManifestPositionSchema,
    repeats: z.number().int().min(1).max(1024).default(1),
    velocity_scale: z.number().gt(0).max(4).default(1),
  })
  .strict();

const ManifestPitchedTrackSchema = z
  .object({
    kind: z.literal("pitched"),
    id: IdSchema,
    name: z.string().min(1).max(255),
    bank_msb: z.number().int().min(0).max(127).default(0),
    bank_lsb: z.number().int().min(0).max(127).default(0),
    program: z.number().int().min(0).max(127),
    volume: z.number().int().min(0).max(127).default(100),
    pan: z.number().int().min(0).max(127).default(64),
    notes: z.array(ManifestInstrumentNoteSchema).max(20_000).default([]),
    patterns: z.array(ManifestInstrumentPatternSchema).max(256).default([]),
    placements: z.array(ManifestInstrumentPlacementSchema).max(5000).default([]),
  })
  .strict();

const ManifestDrumTrackSchema = z
  .object({
    kind: z.literal("drums"),
    id: IdSchema,
    name: z.string().min(1).max(255),
    hits: z.array(ManifestDrumHitSchema).max(50_000).default([]),
    patterns: z.array(ManifestDrumPatternSchema).max(256).default([]),
    placements: z.array(ManifestDrumPlacementSchema).max(5000).default([]),
  })
  .strict();

export const ManifestArrangementTrackSchema = z.discriminatedUnion("kind", [
  ManifestPitchedTrackSchema,
  ManifestDrumTrackSchema,
]);

const ManifestEffectSchema = z
  .object({
    id: IdSchema,
    type: z.enum(["gain", "pan", "highpass", "lowpass", "equalizer", "compressor", "deesser", "reverb", "delay", "limiter"]),
    enabled: z.boolean().default(true),
    parameters: z.record(z.string().min(1).max(64), z.number()).default({}),
  })
  .strict();

const ManifestEffectChainSchema = z
  .object({
    id: IdSchema,
    target_id: IdSchema,
    effects: z.array(ManifestEffectSchema).max(64).default([]),
  })
  .strict();

const ManifestSectionDynamicsSchema = z
  .object({
    id: IdSchema,
    section_id: IdSchema,
    target_id: IdSchema,
    gain_db: z.number().min(-60).max(24).default(0),
  })
  .strict();

export const ManifestArtifactSchema = z
  .object({
    id: IdSchema,
    role: z.enum(["backing", "vsqx", "vocal_stem", "instrument_stem", "mix", "master", "analysis", "delivery"]),
    path: z.string().min(1).max(4096),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    bytes: z.number().int().min(0),
    source_revision: z.number().int().min(1),
    source_composition_hash: z.string().regex(/^[a-f0-9]{64}$/u),
    dependencies: z.array(IdSchema).max(256).default([]),
    metadata: z
      .record(z.string().min(1).max(64), z.union([z.string(), z.number(), z.boolean()]))
      .default({}),
    created_at: z.string().datetime(),
  })
  .strict();

export const SongManifestSchema = z
  .object({
    schema: z.literal(MANIFEST_SCHEMA),
    revision: z.number().int().min(1),
    composition_hash: z.string().regex(/^[a-f0-9]{64}$/u),
    content_hash: z.string().regex(/^[a-f0-9]{64}$/u),
    parent_hash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
    song_id: IdSchema,
    slug: IdSchema,
    title: z.string().min(1).max(256),
    format: z.enum(["vsq3", "vsq4"]),
    pre_measure: z.number().int().min(0).max(127),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    time_signatures: z.array(ManifestTimeSignatureSchema).min(1).max(256),
    tempos: z.array(ManifestTempoSchema).min(1).max(5000),
    sections: z.array(ManifestSectionSchema).min(1).max(1024),
    harmony: z
      .object({
        key_changes: z.array(ManifestKeyChangeSchema).max(1024).default([]),
        chord_changes: z.array(ManifestChordChangeSchema).max(20_000).default([]),
      })
      .strict(),
    voices: z.array(ManifestVoiceSchema).max(128),
    vocal_tracks: z.array(ManifestVocalTrackSchema).max(16),
    accompaniment: z
      .object({
        sample_rate: z.union([z.literal(44_100), z.literal(48_000), z.literal(96_000)]),
        gain: z.number().gt(0).max(10),
        reverb: z.boolean(),
        chorus: z.boolean(),
        soundfont_path: z.string().min(1).max(4096).optional(),
        tracks: z.array(ManifestArrangementTrackSchema).max(32),
      })
      .strict(),
    mix: z
      .object({
        effect_chains: z.array(ManifestEffectChainSchema).max(256),
        section_dynamics: z.array(ManifestSectionDynamicsSchema).max(5000),
      })
      .strict(),
    artifacts: z.array(ManifestArtifactSchema).max(10_000),
  })
  .strict();

export type SongManifest = z.infer<typeof SongManifestSchema>;
export type ManifestSection = z.infer<typeof ManifestSectionSchema>;
export type ManifestVoice = z.infer<typeof ManifestVoiceSchema>;
export type ManifestVocalTrackMetadata = z.infer<typeof ManifestVocalTrackMetadataSchema>;
export type ManifestVocalPart = z.infer<typeof ManifestVocalPartSchema>;
export type ManifestArrangementTrack = z.infer<typeof ManifestArrangementTrackSchema>;
export type ManifestArtifact = z.infer<typeof ManifestArtifactSchema>;

export interface CreateSongManifestOptions {
  outputPath: string;
  songId: string;
  slug: string;
  title: string;
  format: VsqxFormat;
  preMeasure: number;
  timeSignatures: z.input<typeof ManifestTimeSignatureSchema>[];
  tempos: z.input<typeof ManifestTempoSchema>[];
  sections: z.input<typeof ManifestSectionSchema>[];
  keyChanges?: z.input<typeof ManifestKeyChangeSchema>[];
  chordChanges?: z.input<typeof ManifestChordChangeSchema>[];
  sampleRate: 44_100 | 48_000 | 96_000;
  gain: number;
  reverb: boolean;
  chorus: boolean;
  soundfontPath?: string;
  overwrite: boolean;
}

interface ManifestWriteResult {
  path: string;
  backupPath?: string;
  revision: number;
  compositionHash: string;
  contentHash: string;
  parentHash?: string;
  bytes: number;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key, entry]) => key !== "content_hash" && entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function songManifestHash(manifest: Omit<SongManifest, "content_hash"> | SongManifest): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(manifest))).digest("hex");
}

type HashlessSongManifest = Omit<SongManifest, "content_hash" | "composition_hash">;

export function songCompositionHash(manifest: HashlessSongManifest | SongManifest): string {
  const creativeState = {
    schema: manifest.schema,
    song_id: manifest.song_id,
    slug: manifest.slug,
    title: manifest.title,
    format: manifest.format,
    pre_measure: manifest.pre_measure,
    time_signatures: manifest.time_signatures,
    tempos: manifest.tempos,
    sections: manifest.sections,
    harmony: manifest.harmony,
    voices: manifest.voices,
    vocal_tracks: manifest.vocal_tracks,
    accompaniment: manifest.accompaniment,
    mix: manifest.mix,
  };
  return createHash("sha256").update(JSON.stringify(canonicalize(creativeState))).digest("hex");
}

function positionTick(manifest: Pick<SongManifest, "time_signatures">, position: MusicalPosition): number {
  return musicalPositionToTick(manifest.time_signatures, position);
}

function assertUniqueIds(values: readonly { id: string }[], name: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) throw new Error(`${name} contains duplicate stable ID ${value.id}`);
    seen.add(value.id);
  }
}

function assertGloballyUniqueStableIds(manifest: SongManifest): void {
  const seen = new Map<string, string>();
  const add = (id: string, location: string): void => {
    const previous = seen.get(id);
    if (previous) {
      throw new Error(`Stable ID ${id} is ambiguous: used by ${previous} and ${location}`);
    }
    seen.set(id, location);
  };
  for (const section of manifest.sections) add(section.id, `section ${section.name}`);
  for (const event of manifest.harmony.key_changes) add(event.id, `key change at measure ${event.position.measure}`);
  for (const event of manifest.harmony.chord_changes) add(event.id, `chord ${event.symbol}`);
  for (const voice of manifest.voices) add(voice.id, `voice ${voice.name}`);
  for (const track of manifest.vocal_tracks) {
    add(track.id, `vocal track ${track.name}`);
    for (const part of track.parts) {
      add(part.id, `vocal part ${track.id}/${part.name}`);
      for (const note of part.notes) add(note.id, `vocal note in ${part.id}`);
      for (const phrase of part.phrases) {
        add(phrase.id, `vocal phrase in ${part.id}`);
        for (const lyric of phrase.lyrics) add(lyric.id, `lyric unit in ${phrase.id}`);
        for (const cell of phrase.cells) add(cell.id, `rhythm cell in ${phrase.id}`);
      }
      for (const curve of part.control_curves) {
        add(curve.id, `${curve.curve} curve in ${part.id}`);
        for (const point of curve.points) add(point.id, `${curve.curve} point in ${curve.id}`);
      }
    }
  }
  for (const track of manifest.accompaniment.tracks) {
    add(track.id, `arrangement track ${track.name}`);
    if (track.kind === "pitched") {
      for (const note of track.notes) add(note.id, `instrument note in ${track.id}`);
      for (const pattern of track.patterns) {
        add(pattern.id, `instrument pattern in ${track.id}`);
        for (const note of pattern.notes) add(note.id, `instrument pattern note in ${pattern.id}`);
      }
    } else {
      for (const hit of track.hits) add(hit.id, `drum hit in ${track.id}`);
      for (const pattern of track.patterns) {
        add(pattern.id, `drum pattern in ${track.id}`);
        for (const hit of pattern.hits) add(hit.id, `drum pattern hit in ${pattern.id}`);
      }
    }
    for (const placement of track.placements) add(placement.id, `placement in ${track.id}`);
  }
  for (const chain of manifest.mix.effect_chains) {
    add(chain.id, `effect chain for ${chain.target_id}`);
    for (const effect of chain.effects) add(effect.id, `effect in ${chain.id}`);
  }
  for (const dynamic of manifest.mix.section_dynamics) add(dynamic.id, `section dynamic for ${dynamic.target_id}`);
  for (const artifact of manifest.artifacts) add(artifact.id, `artifact ${artifact.role}`);
}

function validateManifestSemantics(manifest: SongManifest): void {
  if (manifest.time_signatures[0]?.measure !== 0) {
    throw new Error("time_signatures must begin at measure 0");
  }
  for (let index = 1; index < manifest.time_signatures.length; index += 1) {
    if ((manifest.time_signatures[index]?.measure ?? 0) <= (manifest.time_signatures[index - 1]?.measure ?? 0)) {
      throw new Error("time_signatures must be strictly ordered by measure");
    }
  }
  const tempoTicks = manifest.tempos.map((tempo) => positionTick(manifest, tempo.position));
  if (tempoTicks[0] !== 0) throw new Error("tempos must begin at song position 0:0:0");
  for (let index = 1; index < tempoTicks.length; index += 1) {
    if ((tempoTicks[index] ?? 0) <= (tempoTicks[index - 1] ?? 0)) {
      throw new Error("tempos must be strictly ordered by musical position");
    }
  }
  assertUniqueIds(manifest.sections, "sections");
  const orderedSections = [...manifest.sections].sort(
    (left, right) => positionTick(manifest, left.start) - positionTick(manifest, right.start),
  );
  for (const [index, section] of orderedSections.entries()) {
    const start = positionTick(manifest, section.start);
    const end = positionTick(manifest, section.end);
    if (end <= start) throw new Error(`Section ${section.id} end must follow start`);
    const previous = orderedSections[index - 1];
    if (previous && positionTick(manifest, previous.end) > start) {
      throw new Error(`Sections ${previous.id} and ${section.id} overlap`);
    }
  }
  const sectionIds = new Set(manifest.sections.map((section) => section.id));
  assertUniqueIds(manifest.voices, "voices");
  assertUniqueIds(manifest.vocal_tracks, "vocal_tracks");
  const voiceIds = new Set(manifest.voices.map((voice) => voice.id));
  for (const track of manifest.vocal_tracks) {
    if (!voiceIds.has(track.voice_id)) {
      throw new Error(`Vocal track ${track.id} references unknown voice ${track.voice_id}`);
    }
    if (track.parts.length === 0) {
      throw new Error(`Vocal track ${track.id} needs at least one part`);
    }
    assertUniqueIds(track.parts, `vocal track ${track.id} parts`);
    for (const part of track.parts) {
      if (part.section_id && !sectionIds.has(part.section_id)) {
        throw new Error(`Vocal part ${part.id} references unknown section ${part.section_id}`);
      }
      const partStart = positionTick(manifest, part.start);
      const partEnd = positionTick(manifest, part.end);
      if (partEnd <= partStart) throw new Error(`Vocal part ${part.id} end must follow start`);
      assertUniqueIds(part.notes, `vocal part ${part.id} notes`);
      assertUniqueIds(part.phrases, `vocal part ${part.id} phrases`);
      assertUniqueIds(part.control_curves, `vocal part ${part.id} curves`);
      for (const note of part.notes) {
        const tick = positionTick(manifest, note.position);
        if (tick < partStart || tick + note.duration > partEnd) {
          throw new Error(`Vocal note ${note.id} lies outside part ${part.id}`);
        }
      }
      for (const phrase of part.phrases) {
        const compiled = compileManifestPhrase(manifest, phrase);
        if (compiled.startTick < partStart || compiled.endTick > partEnd) {
          throw new Error(`Vocal phrase ${phrase.id} lies outside part ${part.id}`);
        }
      }
    }
  }
  assertUniqueIds(manifest.accompaniment.tracks, "accompaniment tracks");
  for (const track of manifest.accompaniment.tracks) {
    if (track.kind === "pitched") {
      if (track.notes.length === 0 && track.placements.length === 0) {
        throw new Error(`Pitched arrangement track ${track.id} needs direct notes or pattern placements`);
      }
      assertUniqueIds(track.notes, `arrangement track ${track.id} notes`);
      assertUniqueIds(track.patterns, `arrangement track ${track.id} patterns`);
      assertUniqueIds(track.placements, `arrangement track ${track.id} placements`);
      const patterns = new Set(track.patterns.map((pattern) => pattern.id));
      for (const placement of track.placements) {
        if (!patterns.has(placement.pattern_id)) {
          throw new Error(`Placement ${placement.id} references unknown pattern ${placement.pattern_id}`);
        }
        if (placement.section_id && !sectionIds.has(placement.section_id)) {
          throw new Error(`Placement ${placement.id} references unknown section ${placement.section_id}`);
        }
      }
    } else {
      if (track.hits.length === 0 && track.placements.length === 0) {
        throw new Error(`Drum arrangement track ${track.id} needs direct hits or pattern placements`);
      }
      assertUniqueIds(track.hits, `drum track ${track.id} hits`);
      assertUniqueIds(track.patterns, `drum track ${track.id} patterns`);
      assertUniqueIds(track.placements, `drum track ${track.id} placements`);
      const patterns = new Set(track.patterns.map((pattern) => pattern.id));
      for (const placement of track.placements) {
        if (!patterns.has(placement.pattern_id)) {
          throw new Error(`Drum placement ${placement.id} references unknown pattern ${placement.pattern_id}`);
        }
        if (placement.section_id && !sectionIds.has(placement.section_id)) {
          throw new Error(`Drum placement ${placement.id} references unknown section ${placement.section_id}`);
        }
      }
    }
  }
  assertUniqueIds(manifest.artifacts, "artifacts");
  assertGloballyUniqueStableIds(manifest);
}

function withHash(candidate: HashlessSongManifest): SongManifest {
  const composition_hash = songCompositionHash(candidate);
  const content_hash = songManifestHash({ ...candidate, composition_hash });
  const manifest = SongManifestSchema.parse({ ...candidate, composition_hash, content_hash });
  validateManifestSemantics(manifest);
  return manifest;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function persistManifest(
  manifest: SongManifest,
  requestedPath: string,
  overwrite: boolean,
): Promise<ManifestWriteResult> {
  const path = await resolveWritablePath(requestedPath);
  if (!path.endsWith(".song.json")) throw new Error(`Manifest path must end in .song.json: ${path}`);
  const outputExists = await exists(path);
  if (outputExists && !overwrite) {
    throw new Error(`Manifest already exists: ${path}. Use a new revision path or set overwrite=true.`);
  }
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_MANIFEST_BYTES) {
    throw new Error(`Manifest exceeds ${MAX_MANIFEST_BYTES} byte safety limit`);
  }
  let backupPath: string | undefined;
  if (outputExists) {
    backupPath = `${path}.bak-${new Date().toISOString().replaceAll(":", "-")}`;
    await copyFile(path, backupPath);
  }
  const temporary = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${Date.now()}`);
  try {
    await writeFile(temporary, serialized, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return {
    path,
    ...(backupPath ? { backupPath } : {}),
    revision: manifest.revision,
    compositionHash: manifest.composition_hash,
    contentHash: manifest.content_hash,
    ...(manifest.parent_hash ? { parentHash: manifest.parent_hash } : {}),
    bytes: Buffer.byteLength(serialized),
  };
}

export async function loadSongManifest(inputPath: string): Promise<{ path: string; manifest: SongManifest }> {
  const path = await resolveReadablePath(inputPath);
  const info = await stat(path);
  if (info.size > MAX_MANIFEST_BYTES) throw new Error(`Manifest exceeds ${MAX_MANIFEST_BYTES} byte safety limit`);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid song manifest JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const manifest = SongManifestSchema.parse(raw);
  const actualComposition = songCompositionHash(manifest);
  if (actualComposition !== manifest.composition_hash) {
    throw new Error(
      `Song manifest composition hash mismatch: stored ${manifest.composition_hash}, actual ${actualComposition}. `
      + "Creative state or provenance may have been edited outside the MCP.",
    );
  }
  const actual = songManifestHash(manifest);
  if (actual !== manifest.content_hash) {
    throw new Error(
      `Song manifest content hash mismatch: stored ${manifest.content_hash}, actual ${actual}. `
      + "The file may have been edited outside the MCP; inspect or restore a known revision before writing.",
    );
  }
  validateManifestSemantics(manifest);
  return { path, manifest };
}

export async function createSongManifest(options: CreateSongManifestOptions): Promise<ManifestWriteResult> {
  const now = new Date().toISOString();
  const candidate = {
    schema: MANIFEST_SCHEMA,
    revision: 1,
    song_id: options.songId,
    slug: options.slug,
    title: options.title,
    format: options.format,
    pre_measure: options.preMeasure,
    created_at: now,
    updated_at: now,
    time_signatures: z.array(ManifestTimeSignatureSchema).parse(options.timeSignatures),
    tempos: z.array(ManifestTempoSchema).parse(options.tempos),
    sections: z.array(ManifestSectionSchema).parse(options.sections),
    harmony: {
      key_changes: z.array(ManifestKeyChangeSchema).parse(options.keyChanges ?? []),
      chord_changes: z.array(ManifestChordChangeSchema).parse(options.chordChanges ?? []),
    },
    voices: [],
    vocal_tracks: [],
    accompaniment: {
      sample_rate: options.sampleRate,
      gain: options.gain,
      reverb: options.reverb,
      chorus: options.chorus,
      ...(options.soundfontPath ? { soundfont_path: options.soundfontPath } : {}),
      tracks: [],
    },
    mix: { effect_chains: [], section_dynamics: [] },
    artifacts: [],
  } satisfies HashlessSongManifest;
  return persistManifest(withHash(candidate), options.outputPath, options.overwrite);
}

function manifestSummary(path: string, manifest: SongManifest) {
  return {
    path,
    schema: manifest.schema,
    revision: manifest.revision,
    compositionHash: manifest.composition_hash,
    contentHash: manifest.content_hash,
    parentHash: manifest.parent_hash ?? null,
    songId: manifest.song_id,
    slug: manifest.slug,
    title: manifest.title,
    format: manifest.format,
    sections: manifest.sections.map((section) => ({
      id: section.id,
      name: section.name,
      kind: section.kind,
      start: section.start,
      end: section.end,
      energy: section.energy,
    })),
    tempoChanges: manifest.tempos.length,
    meterChanges: manifest.time_signatures.length,
    voices: manifest.voices.map((voice) => ({ id: voice.id, name: voice.name, componentId: voice.component_id })),
    vocalTracks: manifest.vocal_tracks.map((track) => ({
      id: track.id,
      name: track.name,
      voiceId: track.voice_id,
      parts: track.parts.length,
      notes: track.parts.reduce((sum, part) => sum + part.notes.length, 0),
      phrases: track.parts.reduce((sum, part) => sum + part.phrases.length, 0),
    })),
    arrangementTracks: manifest.accompaniment.tracks.map((track) => ({
      id: track.id,
      name: track.name,
      kind: track.kind,
      directEvents: track.kind === "pitched" ? track.notes.length : track.hits.length,
      patterns: track.patterns.length,
      placements: track.placements.length,
    })),
    artifacts: manifest.artifacts.map((artifact) => ({
      id: artifact.id,
      role: artifact.role,
      path: artifact.path,
      sourceRevision: artifact.source_revision,
      sha256: artifact.sha256,
    })),
  };
}

export async function inspectSongManifest(inputPath: string) {
  const { path, manifest } = await loadSongManifest(inputPath);
  return manifestSummary(path, manifest);
}

export async function getSongManifestSection(inputPath: string, sectionId: string) {
  const { path, manifest } = await loadSongManifest(inputPath);
  const section = manifest.sections.find((candidate) => candidate.id === sectionId);
  if (!section) throw new Error(`No section with stable ID ${sectionId}`);
  const start = positionTick(manifest, section.start);
  const end = positionTick(manifest, section.end);
  const vocalTracks = manifest.vocal_tracks
    .map((track) => ({
      id: track.id,
      name: track.name,
      voiceId: track.voice_id,
      mixer: track.mixer,
      parts: track.parts.filter((part) =>
        part.section_id === sectionId
        || (positionTick(manifest, part.start) < end && positionTick(manifest, part.end) > start)),
    }))
    .filter((track) => track.parts.length > 0);
  const arrangementTracks = manifest.accompaniment.tracks.map((track) => {
    const placements = track.placements.filter((placement) =>
      placement.section_id === sectionId
      || (positionTick(manifest, placement.start) >= start && positionTick(manifest, placement.start) < end));
    const patternIds = new Set(placements.map((placement) => placement.pattern_id));
    const direct = track.kind === "pitched"
      ? { notes: track.notes.filter((note) => {
          const tick = positionTick(manifest, note.position);
          return tick >= start && tick < end;
        }) }
      : { hits: track.hits.filter((hit) => {
          const tick = positionTick(manifest, hit.position);
          return tick >= start && tick < end;
        }) };
    return {
      id: track.id,
      name: track.name,
      kind: track.kind,
      ...direct,
      patterns: track.patterns.filter((pattern) => patternIds.has(pattern.id)),
      placements,
    };
  }).filter((track) => track.placements.length > 0 || ("notes" in track ? track.notes.length > 0 : track.hits.length > 0));
  return {
    path,
    revision: manifest.revision,
    contentHash: manifest.content_hash,
    section,
    harmony: {
      key_changes: manifest.harmony.key_changes.filter((event) => {
        const tick = positionTick(manifest, event.position);
        return tick >= start && tick < end;
      }),
      chord_changes: manifest.harmony.chord_changes.filter((event) => {
        const tick = positionTick(manifest, event.position);
        return tick >= start && tick < end;
      }),
    },
    vocalTracks,
    arrangementTracks,
  };
}

type ManifestUpdater = (draft: SongManifest) => void;

async function mutateManifest(
  inputPath: string,
  outputPath: string,
  expectedRevision: number,
  overwrite: boolean,
  updater: ManifestUpdater,
): Promise<{ write: ManifestWriteResult; summary: ReturnType<typeof manifestSummary> }> {
  const loaded = await loadSongManifest(inputPath);
  if (loaded.manifest.revision !== expectedRevision) {
    throw new Error(
      `Stale manifest revision ${expectedRevision}; current revision is ${loaded.manifest.revision} `
      + `(${loaded.manifest.content_hash}). Inspect again before applying a mutation.`,
    );
  }
  const draft = structuredClone(loaded.manifest);
  updater(draft);
  const parentHash = loaded.manifest.content_hash;
  const {
    content_hash: _oldHash,
    composition_hash: _oldCompositionHash,
    parent_hash: _oldParent,
    ...withoutHashes
  } = draft;
  const candidate = {
    ...withoutHashes,
    revision: loaded.manifest.revision + 1,
    parent_hash: parentHash,
    updated_at: new Date().toISOString(),
  } satisfies HashlessSongManifest;
  const manifest = withHash(candidate);
  const write = await persistManifest(manifest, outputPath, overwrite);
  return { write, summary: manifestSummary(write.path, manifest) };
}

export async function upsertSongManifestSection(
  inputPath: string,
  outputPath: string,
  expectedRevision: number,
  sectionInput: z.input<typeof ManifestSectionSchema>,
  overwrite: boolean,
) {
  const section = ManifestSectionSchema.parse(sectionInput);
  return mutateManifest(inputPath, outputPath, expectedRevision, overwrite, (draft) => {
    const index = draft.sections.findIndex((candidate) => candidate.id === section.id);
    if (index >= 0) draft.sections[index] = section;
    else draft.sections.push(section);
    draft.sections.sort((left, right) => positionTick(draft, left.start) - positionTick(draft, right.start));
  });
}

export async function upsertSongManifestVocalPart(
  inputPath: string,
  outputPath: string,
  expectedRevision: number,
  voiceInput: z.input<typeof ManifestVoiceSchema>,
  trackInput: z.input<typeof ManifestVocalTrackMetadataSchema>,
  partInput: z.input<typeof ManifestVocalPartSchema>,
  overwrite: boolean,
) {
  const voice = ManifestVoiceSchema.parse(voiceInput);
  const track = ManifestVocalTrackMetadataSchema.parse(trackInput);
  const part = ManifestVocalPartSchema.parse(partInput);
  if (track.voice_id !== voice.id) {
    throw new Error(`Track ${track.id} voice_id ${track.voice_id} does not match supplied voice ${voice.id}`);
  }
  return mutateManifest(inputPath, outputPath, expectedRevision, overwrite, (draft) => {
    const voiceIndex = draft.voices.findIndex((candidate) => candidate.id === voice.id);
    if (voiceIndex >= 0) draft.voices[voiceIndex] = voice;
    else draft.voices.push(voice);
    const trackIndex = draft.vocal_tracks.findIndex((candidate) => candidate.id === track.id);
    if (trackIndex < 0) {
      draft.vocal_tracks.push({ ...track, parts: [part] });
      return;
    }
    const existing = draft.vocal_tracks[trackIndex];
    if (!existing) throw new Error(`Internal manifest error locating vocal track ${track.id}`);
    const partIndex = existing.parts.findIndex((candidate) => candidate.id === part.id);
    const parts = [...existing.parts];
    if (partIndex >= 0) parts[partIndex] = part;
    else parts.push(part);
    parts.sort((left, right) => positionTick(draft, left.start) - positionTick(draft, right.start));
    draft.vocal_tracks[trackIndex] = { ...track, parts };
  });
}

export async function upsertSongManifestArrangementTrack(
  inputPath: string,
  outputPath: string,
  expectedRevision: number,
  trackInput: z.input<typeof ManifestArrangementTrackSchema>,
  overwrite: boolean,
) {
  const track = ManifestArrangementTrackSchema.parse(trackInput);
  return mutateManifest(inputPath, outputPath, expectedRevision, overwrite, (draft) => {
    const index = draft.accompaniment.tracks.findIndex((candidate) => candidate.id === track.id);
    if (index >= 0) draft.accompaniment.tracks[index] = track;
    else draft.accompaniment.tracks.push(track);
  });
}

export const ManifestTransformSchema = z
  .object({
    section_id: IdSchema.optional(),
    vocal_track_id: IdSchema.optional(),
    vocal_part_id: IdSchema.optional(),
    arrangement_track_id: IdSchema.optional(),
    event_ids: z.array(IdSchema).max(20_000).default([]),
    targets: z
      .array(z.enum([
        "vocal_notes", "vocal_phrase_cells", "instrument_notes",
        "instrument_pattern_notes", "instrument_placements",
        "drum_hits", "drum_pattern_hits", "drum_placements",
      ]))
      .min(1),
    transpose: z.number().int().min(-48).max(48).default(0),
    velocity_scale: z.number().gt(0).max(4).default(1),
    duration_scale: z.number().gt(0).max(8).default(1),
    shift_ticks: z.number().int().min(-1_000_000).max(1_000_000).default(0),
  })
  .strict()
  .refine(
    (value) => value.transpose !== 0 || value.velocity_scale !== 1
      || value.duration_scale !== 1 || value.shift_ticks !== 0,
    { message: "Transform must change transpose, velocity_scale, duration_scale, or shift_ticks" },
  );

export type ManifestTransform = z.infer<typeof ManifestTransformSchema>;

function shiftedPosition(
  manifest: SongManifest,
  position: MusicalPosition,
  delta: number,
): z.infer<typeof ManifestPositionSchema> {
  const tick = positionTick(manifest, position) + delta;
  if (tick < 0) throw new Error(`Transform shift would move an event before song start (${tick} ticks)`);
  const shifted = musicalTickToPosition(manifest.time_signatures, tick);
  return { measure: shifted.measure, beat: shifted.beat, tick: shifted.tick ?? 0 };
}

function selectedById(id: string, selected: Set<string>): boolean {
  return selected.size === 0 || selected.has(id);
}

function scaledVelocity(value: number, scale: number): number {
  return Math.max(1, Math.min(127, Math.round(value * scale)));
}

function scaledDuration(value: number, scale: number): number {
  return Math.max(1, Math.round(value * scale));
}

export async function transformSongManifestEvents(
  inputPath: string,
  outputPath: string,
  expectedRevision: number,
  transformInput: z.input<typeof ManifestTransformSchema>,
  overwrite: boolean,
) {
  const transform = ManifestTransformSchema.parse(transformInput);
  let changed = 0;
  const selected = new Set(transform.event_ids);
  const targets = new Set(transform.targets);
  const result = await mutateManifest(inputPath, outputPath, expectedRevision, overwrite, (draft) => {
    const section = transform.section_id
      ? draft.sections.find((candidate) => candidate.id === transform.section_id)
      : undefined;
    if (transform.section_id && !section) throw new Error(`Unknown section ${transform.section_id}`);
    const sectionStart = section ? positionTick(draft, section.start) : null;
    const sectionEnd = section ? positionTick(draft, section.end) : null;
    const inSection = (position: MusicalPosition): boolean => {
      if (sectionStart === null || sectionEnd === null) return true;
      const tick = positionTick(draft, position);
      return tick >= sectionStart && tick < sectionEnd;
    };
    for (const track of draft.vocal_tracks) {
      if (transform.vocal_track_id && track.id !== transform.vocal_track_id) continue;
      for (const part of track.parts) {
        if (transform.vocal_part_id && part.id !== transform.vocal_part_id) continue;
        if (transform.section_id && part.section_id !== transform.section_id
          && !(positionTick(draft, part.start) < (sectionEnd ?? 0)
            && positionTick(draft, part.end) > (sectionStart ?? 0))) continue;
        if (targets.has("vocal_notes")) {
          for (const note of part.notes) {
            if (!selectedById(note.id, selected) || !inSection(note.position)) continue;
            note.note_number += transform.transpose;
            note.velocity = scaledVelocity(note.velocity, transform.velocity_scale);
            note.duration = scaledDuration(note.duration, transform.duration_scale);
            if (transform.shift_ticks !== 0) note.position = shiftedPosition(draft, note.position, transform.shift_ticks);
            changed++;
          }
        }
        if (targets.has("vocal_phrase_cells")) {
          for (const phrase of part.phrases) {
            if (transform.shift_ticks !== 0 && inSection(phrase.start)
              && (selected.size === 0 || phrase.cells.some((cell) => selected.has(cell.id)))) {
              phrase.start = shiftedPosition(draft, phrase.start, transform.shift_ticks);
            }
            for (const cell of phrase.cells) {
              if (!selectedById(cell.id, selected) || cell.rest || cell.note_number === undefined) continue;
              cell.note_number += transform.transpose;
              cell.velocity = scaledVelocity(cell.velocity, transform.velocity_scale);
              const ticks = rhythmValueTicks(typeof cell.duration === "number"
                ? cell.duration
                : {
                    denominator: cell.duration.denominator,
                    dots: cell.duration.dots,
                    ...(cell.duration.tuplet
                      ? { tuplet: { played: cell.duration.tuplet.played, inTimeOf: cell.duration.tuplet.in_time_of } }
                      : {}),
                  });
              cell.duration = scaledDuration(ticks, transform.duration_scale);
              changed++;
            }
          }
        }
      }
    }
    for (const track of draft.accompaniment.tracks) {
      if (transform.arrangement_track_id && track.id !== transform.arrangement_track_id) continue;
      if (track.kind === "pitched") {
        if (targets.has("instrument_notes")) {
          for (const note of track.notes) {
            if (!selectedById(note.id, selected) || !inSection(note.position)) continue;
            note.note_number += transform.transpose;
            note.velocity = scaledVelocity(note.velocity, transform.velocity_scale);
            note.duration = scaledDuration(note.duration, transform.duration_scale);
            if (transform.shift_ticks !== 0) note.position = shiftedPosition(draft, note.position, transform.shift_ticks);
            changed++;
          }
        }
        if (targets.has("instrument_pattern_notes")) {
          if (transform.shift_ticks !== 0) throw new Error("shift_ticks is not supported for pattern-relative notes");
          for (const pattern of track.patterns) for (const note of pattern.notes) {
            if (!selectedById(note.id, selected)) continue;
            note.note_number += transform.transpose;
            note.velocity = scaledVelocity(note.velocity, transform.velocity_scale);
            note.duration = scaledDuration(note.duration, transform.duration_scale);
            changed++;
          }
        }
        if (targets.has("instrument_placements")) {
          for (const placement of track.placements) {
            if (!selectedById(placement.id, selected)
              || (transform.section_id && placement.section_id !== transform.section_id)) continue;
            placement.transpose += transform.transpose;
            placement.velocity_scale *= transform.velocity_scale;
            if (transform.shift_ticks !== 0) placement.start = shiftedPosition(draft, placement.start, transform.shift_ticks);
            changed++;
          }
        }
      } else {
        if (targets.has("drum_hits")) {
          for (const hit of track.hits) {
            if (!selectedById(hit.id, selected) || !inSection(hit.position)) continue;
            hit.velocity = scaledVelocity(hit.velocity, transform.velocity_scale);
            hit.duration = scaledDuration(hit.duration, transform.duration_scale);
            if (transform.shift_ticks !== 0) hit.position = shiftedPosition(draft, hit.position, transform.shift_ticks);
            changed++;
          }
        }
        if (targets.has("drum_pattern_hits")) {
          if (transform.shift_ticks !== 0) throw new Error("shift_ticks is not supported for pattern-relative drum hits");
          for (const pattern of track.patterns) for (const hit of pattern.hits) {
            if (!selectedById(hit.id, selected)) continue;
            hit.velocity = scaledVelocity(hit.velocity, transform.velocity_scale);
            hit.duration = scaledDuration(hit.duration, transform.duration_scale);
            changed++;
          }
        }
        if (targets.has("drum_placements")) {
          for (const placement of track.placements) {
            if (!selectedById(placement.id, selected)
              || (transform.section_id && placement.section_id !== transform.section_id)) continue;
            placement.velocity_scale *= transform.velocity_scale;
            if (transform.shift_ticks !== 0) placement.start = shiftedPosition(draft, placement.start, transform.shift_ticks);
            changed++;
          }
        }
      }
    }
    if (changed === 0) {
      throw new Error("Transform matched zero events; inspect stable IDs and semantic scope before retrying");
    }
  });
  return { ...result, changed };
}

export const ManifestRemovalSchema = z
  .object({
    object_type: z.enum(["section", "vocal_part", "vocal_track", "arrangement_track", "event"]),
    object_ids: z.array(IdSchema).min(1).max(20_000),
  })
  .strict();

export async function removeSongManifestObjects(
  inputPath: string,
  outputPath: string,
  expectedRevision: number,
  removalInput: z.input<typeof ManifestRemovalSchema>,
  overwrite: boolean,
) {
  const removal = ManifestRemovalSchema.parse(removalInput);
  const wanted = new Set(removal.object_ids);
  let removed = 0;
  const result = await mutateManifest(inputPath, outputPath, expectedRevision, overwrite, (draft) => {
    if (removal.object_type === "section") {
      for (const id of wanted) {
        const referenced = draft.vocal_tracks.some((track) => track.parts.some((part) => part.section_id === id))
          || draft.accompaniment.tracks.some((track) => track.placements.some((placement) => placement.section_id === id))
          || draft.mix.section_dynamics.some((entry) => entry.section_id === id);
        if (referenced) throw new Error(`Cannot remove section ${id}: parts, placements, or mix automation still reference it`);
      }
      const before = draft.sections.length;
      draft.sections = draft.sections.filter((section) => !wanted.has(section.id));
      removed = before - draft.sections.length;
      if (draft.sections.length === 0) throw new Error("Cannot remove every section from a manifest");
    } else if (removal.object_type === "vocal_track") {
      const before = draft.vocal_tracks.length;
      draft.vocal_tracks = draft.vocal_tracks.filter((track) => !wanted.has(track.id));
      removed = before - draft.vocal_tracks.length;
    } else if (removal.object_type === "vocal_part") {
      for (const track of draft.vocal_tracks) {
        const before = track.parts.length;
        track.parts = track.parts.filter((part) => !wanted.has(part.id));
        removed += before - track.parts.length;
      }
    } else if (removal.object_type === "arrangement_track") {
      const before = draft.accompaniment.tracks.length;
      draft.accompaniment.tracks = draft.accompaniment.tracks.filter((track) => !wanted.has(track.id));
      removed = before - draft.accompaniment.tracks.length;
    } else {
      for (const track of draft.vocal_tracks) for (const part of track.parts) {
        const beforeNotes = part.notes.length;
        part.notes = part.notes.filter((note) => !wanted.has(note.id));
        removed += beforeNotes - part.notes.length;
        for (const phrase of part.phrases) {
          const beforeCells = phrase.cells.length;
          phrase.cells = phrase.cells.filter((cell) => !wanted.has(cell.id));
          removed += beforeCells - phrase.cells.length;
        }
        for (const curve of part.control_curves) {
          const beforePoints = curve.points.length;
          curve.points = curve.points.filter((point) => !wanted.has(point.id));
          removed += beforePoints - curve.points.length;
        }
      }
      for (const track of draft.accompaniment.tracks) {
        if (track.kind === "pitched") {
          const beforeNotes = track.notes.length;
          track.notes = track.notes.filter((note) => !wanted.has(note.id));
          removed += beforeNotes - track.notes.length;
          for (const pattern of track.patterns) {
            const before = pattern.notes.length;
            pattern.notes = pattern.notes.filter((note) => !wanted.has(note.id));
            removed += before - pattern.notes.length;
          }
          const beforePlacements = track.placements.length;
          track.placements = track.placements.filter((placement) => !wanted.has(placement.id));
          removed += beforePlacements - track.placements.length;
        } else {
          const beforeHits = track.hits.length;
          track.hits = track.hits.filter((hit) => !wanted.has(hit.id));
          removed += beforeHits - track.hits.length;
          for (const pattern of track.patterns) {
            const before = pattern.hits.length;
            pattern.hits = pattern.hits.filter((hit) => !wanted.has(hit.id));
            removed += before - pattern.hits.length;
          }
          const beforePlacements = track.placements.length;
          track.placements = track.placements.filter((placement) => !wanted.has(placement.id));
          removed += beforePlacements - track.placements.length;
        }
      }
    }
    if (removed === 0) throw new Error(`Removal matched zero ${removal.object_type} objects`);
  });
  return { ...result, removed };
}

export async function recordSongManifestArtifacts(
  manifestPath: string,
  expectedRevision: number,
  expectedCompositionHash: string,
  artifactsInput: z.input<typeof ManifestArtifactSchema>[],
) {
  const artifacts = z.array(ManifestArtifactSchema).min(1).max(512).parse(artifactsInput);
  for (const artifact of artifacts) {
    if (artifact.source_composition_hash !== expectedCompositionHash) {
      throw new Error(
        `Artifact ${artifact.id} source_composition_hash does not match requested composition ${expectedCompositionHash}`,
      );
    }
  }
  return mutateManifest(
    manifestPath,
    manifestPath,
    expectedRevision,
    true,
    (draft) => {
      if (draft.composition_hash !== expectedCompositionHash) {
        throw new Error(
          `Composition changed before artifact commit: expected ${expectedCompositionHash}, current ${draft.composition_hash}`,
        );
      }
      for (const artifact of artifacts) {
        const index = draft.artifacts.findIndex((candidate) => candidate.id === artifact.id);
        if (index >= 0) draft.artifacts[index] = artifact;
        else draft.artifacts.push(artifact);
      }
    },
  );
}

function compileManifestPhrase(
  manifest: Pick<SongManifest, "time_signatures">,
  phrase: z.infer<typeof ManifestVocalPhraseSchema>,
) {
  const normalized: VocalPhraseInput = {
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
              ? { tuplet: { played: cell.duration.tuplet.played, inTimeOf: cell.duration.tuplet.in_time_of } }
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
      ...(Object.keys(cell.style).length > 0 ? { style: cell.style } : {}),
      ...(cell.vibrato
        ? {
            vibrato: {
              type: cell.vibrato.type,
              length: cell.vibrato.length,
              ...(cell.vibrato.depth.length > 0 ? { depth: cell.vibrato.depth } : {}),
              ...(cell.vibrato.rate.length > 0 ? { rate: cell.vibrato.rate } : {}),
            },
          }
        : {}),
    })),
  };
  return compileVocalPhrase(manifest.time_signatures, normalized);
}

function manifestNote(note: z.infer<typeof ManifestVocalNoteSchema>): PositionedNoteInput {
  return {
    position: note.position,
    duration: note.duration,
    noteNumber: note.note_number,
    lyric: note.lyric,
    phonemes: note.phonemes,
    phonemeLocked: note.phoneme_locked,
    velocity: note.velocity,
    ...(Object.keys(note.style).length > 0 ? { style: note.style } : {}),
    ...(note.vibrato
      ? {
          vibrato: {
            type: note.vibrato.type,
            length: note.vibrato.length,
            ...(note.vibrato.depth.length > 0 ? { depth: note.vibrato.depth } : {}),
            ...(note.vibrato.rate.length > 0 ? { rate: note.vibrato.rate } : {}),
          } satisfies VibratoInput,
        }
      : {}),
  };
}

function buildVocalTracks(manifest: SongManifest): SongTrackInput[] {
  const voices = new Map(manifest.voices.map((voice) => [voice.id, voice]));
  return manifest.vocal_tracks.map((track) => {
    const voice = voices.get(track.voice_id);
    if (!voice) throw new Error(`Unknown voice ${track.voice_id}`);
    const parts: SongPartInput[] = track.parts.map((part) => {
      const notes = [
        ...part.notes.map(manifestNote),
        ...part.phrases.flatMap((phrase) => compileManifestPhrase(manifest, phrase).notes),
      ];
      const controls = Object.fromEntries(
        part.control_curves.map((curve) => [
          curve.curve,
          curve.points.map((point) => ({ position: point.position, value: point.value })),
        ]),
      ) as NonNullable<SongPartInput["controlCurves"]>;
      return {
        name: part.name,
        ...(part.comment ? { comment: part.comment } : {}),
        start: part.start,
        end: part.end,
        notes,
        ...(Object.keys(controls).length > 0 ? { controlCurves: controls } : {}),
      };
    });
    return {
      name: track.name,
      ...(track.comment ? { comment: track.comment } : {}),
      voice: { name: voice.name, componentId: voice.component_id },
      bankSelect: voice.bank_select,
      programChange: voice.program_change,
      mixer: {
        volume: track.mixer.volume,
        pan: track.mixer.pan,
        mute: track.mixer.mute,
        solo: track.mixer.solo,
        sendLevel: track.mixer.send_level,
        sendEnabled: track.mixer.send_enabled,
      },
      parts,
    };
  });
}

function buildArrangement(manifest: SongManifest): {
  tracks: AccompanimentTrackInput[];
  drums: DrumHitInput[];
  drumPatterns: DrumPatternInput[];
  drumPlacements: DrumPatternPlacementInput[];
} {
  const tracks: AccompanimentTrackInput[] = [];
  const drums: DrumHitInput[] = [];
  const drumPatterns: DrumPatternInput[] = [];
  const drumPlacements: DrumPatternPlacementInput[] = [];
  for (const track of manifest.accompaniment.tracks) {
    if (track.kind === "pitched") {
      tracks.push({
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
      });
    } else {
      drums.push(...track.hits.map((hit) => ({
        position: hit.position,
        noteNumber: hit.note_number,
        velocity: hit.velocity,
        duration: hit.duration,
      })));
      const patternPrefix = `${track.id}--`;
      drumPatterns.push(...track.patterns.map((pattern) => ({
        id: `${patternPrefix}${pattern.id}`,
        measures: pattern.measures,
        hits: pattern.hits.map((hit) => ({
          offset: hit.offset,
          noteNumber: hit.note_number,
          velocity: hit.velocity,
          duration: hit.duration,
        })),
      })));
      drumPlacements.push(...track.placements.map((placement) => ({
        patternId: `${patternPrefix}${placement.pattern_id}`,
        start: placement.start,
        repeats: placement.repeats,
        velocityScale: placement.velocity_scale,
      })));
    }
  }
  return { tracks, drums, drumPatterns, drumPlacements };
}

export async function fileSha256(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return { sha256: hash.digest("hex"), bytes: (await stat(path)).size };
}

export interface BuildSongManifestOptions {
  manifestPath: string;
  expectedRevision: number;
  backingOutputPath: string;
  projectOutputPath: string;
}

export async function buildSongManifest(options: BuildSongManifestOptions) {
  const loaded = await loadSongManifest(options.manifestPath);
  const manifest = loaded.manifest;
  if (manifest.revision !== options.expectedRevision) {
    throw new Error(`Stale manifest revision ${options.expectedRevision}; current revision is ${manifest.revision}`);
  }
  if (manifest.vocal_tracks.length === 0) throw new Error("Manifest has no vocal tracks");
  if (manifest.accompaniment.tracks.filter((track) => track.kind === "pitched").length === 0) {
    throw new Error("Manifest needs at least one pitched accompaniment track for the current renderer");
  }
  const backingPath = await resolveWritablePath(options.backingOutputPath);
  const projectPath = await resolveWritablePath(options.projectOutputPath);
  if (extname(backingPath).toLowerCase() !== ".wav") throw new Error("backingOutputPath must end in .wav");
  if (extname(projectPath).toLowerCase() !== ".vsqx") {
    throw new Error("projectOutputPath must end in .vsqx");
  }
  if (await exists(backingPath)) throw new Error(`Backing output already exists: ${backingPath}`);
  if (await exists(projectPath)) throw new Error(`Project output already exists: ${projectPath}`);
  const end = [...manifest.sections]
    .sort((left, right) => positionTick(manifest, right.end) - positionTick(manifest, left.end))[0]?.end;
  if (!end) throw new Error("Manifest has no song end");
  const arrangement = buildArrangement(manifest);
  let backingCreated = false;
  let projectCreated = false;
  try {
    const backing = await renderAccompaniment({
      outputPath: backingPath,
      timeSignatures: manifest.time_signatures,
      tempos: manifest.tempos,
      end,
      tracks: arrangement.tracks,
      drums: arrangement.drums,
      drumPatterns: arrangement.drumPatterns,
      drumPlacements: arrangement.drumPlacements,
      sampleRate: manifest.accompaniment.sample_rate,
      gain: manifest.accompaniment.gain,
      reverb: manifest.accompaniment.reverb,
      chorus: manifest.accompaniment.chorus,
      ...(manifest.accompaniment.soundfont_path
        ? { soundfontPath: manifest.accompaniment.soundfont_path }
        : {}),
      overwrite: false,
    });
    backingCreated = true;
    const project = await createSong({
      outputPath: projectPath,
      format: manifest.format,
      sequenceName: manifest.title,
      preMeasure: manifest.pre_measure,
      timeSignatures: manifest.time_signatures,
      tempos: manifest.tempos,
      tracks: buildVocalTracks(manifest),
      audioParts: [{
        name: `${manifest.title} Backing`,
        comment: `Built from ${manifest.slug} manifest revision ${manifest.revision}`,
        kind: "stereo",
        filePath: backingPath,
        start: { measure: 0, beat: 0, tick: 0 },
      }],
      overwrite: false,
    });
    projectCreated = true;
    const validation = await validateProject(projectPath);
    if (!validation.valid) {
      throw new Error(`Built project failed validation: ${validation.diagnostics.join("; ")}`);
    }
    const [backingDigest, projectDigest] = await Promise.all([
      fileSha256(backingPath),
      fileSha256(projectPath),
    ]);
    const now = new Date().toISOString();
    const artifactInputs: SongManifest["artifacts"] = [
      {
        id: `backing-r${manifest.revision}`,
        role: "backing",
        path: backingPath,
        ...backingDigest,
        source_revision: manifest.revision,
        source_composition_hash: manifest.composition_hash,
        dependencies: [],
        metadata: {
          renderer: "fluidsynth",
          sample_rate: manifest.accompaniment.sample_rate,
          reverb: manifest.accompaniment.reverb,
          chorus: manifest.accompaniment.chorus,
        },
        created_at: now,
      },
      {
        id: `vsqx-r${manifest.revision}`,
        role: "vsqx",
        path: projectPath,
        ...projectDigest,
        source_revision: manifest.revision,
        source_composition_hash: manifest.composition_hash,
        dependencies: [`backing-r${manifest.revision}`],
        metadata: { format: manifest.format },
        created_at: now,
      },
    ];
    const mutation = await mutateManifest(
      loaded.path,
      loaded.path,
      manifest.revision,
      true,
      (draft) => {
        for (const artifact of artifactInputs) {
          const index = draft.artifacts.findIndex((candidate) => candidate.id === artifact.id);
          if (index >= 0) draft.artifacts[index] = artifact;
          else draft.artifacts.push(artifact);
        }
      },
    );
    return {
      sourceRevision: manifest.revision,
      manifestRevision: mutation.write.revision,
      manifestContentHash: mutation.write.contentHash,
      backing: { ...backing, sha256: backingDigest.sha256 },
      project: { ...project, sha256: projectDigest.sha256 },
      validation,
      artifacts: artifactInputs,
    };
  } catch (error) {
    if (projectCreated) await unlink(projectPath).catch(() => undefined);
    if (backingCreated) await unlink(backingPath).catch(() => undefined);
    throw error;
  }
}
