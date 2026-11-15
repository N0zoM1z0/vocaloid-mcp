import { z } from "zod";

import { CompositionIntentSchema, IntentFidelityReviewBasisSchema } from "../intent/types.js";
import { PhraseGrammarBlueprintSchema } from "../phrase-grammar.js";
import { CompositionGuidanceSchema } from "../theory/types.js";

export const MANIFEST_SCHEMA = "vocaloid-song-manifest/v1" as const;
export const IdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,95}$/u)
  .describe("Stable lowercase ID; preserve it across unrelated revisions");
const GestureIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,47}$/u)
  .describe("Stable gesture ID, limited to 48 characters so compiled curve IDs remain valid");

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

export const ManifestVibratoSchema = z
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
    grammar_blueprint: PhraseGrammarBlueprintSchema.optional()
      .describe("Optional agent-selected phrase grammar plan; does not generate or rewrite notes"),
    linguistic_source: z
      .object({
        language: z.literal("ja"),
        text: z.string().min(1).max(10_000),
        reading: z.string().min(1).max(20_000),
        normalized_reading: z.string().min(1).max(20_000),
        affricate_mode: z.enum(["position", "affricate", "fricative"]),
        g_mode: z.enum(["plosive", "nasal_between_vowels"]),
        sokuon_strategy: z.enum(["not_needed", "rest", "attach_next"]),
      })
      .strict()
      .optional(),
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

const ArticulationGestureSchema = z
  .object({
    id: GestureIdSchema,
    type: z.literal("articulation"),
    event_ids: z.array(IdSchema).min(1).max(5000),
    accent: z.number().int().min(0).max(100).optional(),
    decay: z.number().int().min(0).max(100).optional(),
    opening: z.number().int().min(0).max(127).optional(),
    consonant_velocity: z.number().int().min(0).max(127).optional(),
    bend_depth: z.number().int().min(0).max(100).optional(),
    bend_length: z.number().int().min(0).max(100).optional(),
    rise_portamento: z.boolean().optional(),
    fall_portamento: z.boolean().optional(),
  })
  .strict()
  .refine((gesture) => Object.keys(gesture).some((key) => !["id", "type", "event_ids"].includes(key)), {
    message: "articulation needs at least one expression parameter",
  });

const VibratoGestureSchema = z
  .object({
    id: GestureIdSchema,
    type: z.literal("vibrato"),
    event_ids: z.array(IdSchema).min(1).max(5000),
    vibrato_type: z.number().int().min(1).max(16),
    length_percent: z.number().int().min(1).max(100),
    depth_start: z.number().int().min(0).max(127).default(32),
    depth_peak: z.number().int().min(0).max(127).default(64),
    depth_end: z.number().int().min(0).max(127).default(48),
    rate_start: z.number().int().min(0).max(127).default(48),
    rate_end: z.number().int().min(0).max(127).default(56),
  })
  .strict();

const PitchScoopGestureSchema = z
  .object({
    id: GestureIdSchema,
    type: z.literal("pitch_scoop"),
    event_ids: z.array(IdSchema).min(1).max(5000),
    direction: z.enum(["up_into", "down_into", "fall_away", "rise_away"]),
    depth_cents: z.number().int().min(1).max(2400),
    duration_percent: z.number().int().min(1).max(100),
    pitch_bend_sensitivity: z.number().int().min(1).max(24),
  })
  .strict()
  .refine((gesture) => gesture.depth_cents <= gesture.pitch_bend_sensitivity * 100, {
    message: "depth_cents must fit inside pitch_bend_sensitivity",
  });

const DynamicsArcGestureSchema = z
  .object({
    id: GestureIdSchema,
    type: z.literal("dynamics_arc"),
    event_ids: z.array(IdSchema).min(1).max(5000),
    start_value: z.number().int().min(0).max(127),
    peak_value: z.number().int().min(0).max(127),
    end_value: z.number().int().min(0).max(127),
    peak_position: z.number().min(0).max(1).default(0.5),
  })
  .strict();

const OpeningArcGestureSchema = z
  .object({
    id: GestureIdSchema,
    type: z.literal("opening_arc"),
    event_ids: z.array(IdSchema).min(1).max(5000),
    start_value: z.number().int().min(0).max(127),
    peak_value: z.number().int().min(0).max(127),
    end_value: z.number().int().min(0).max(127),
    peak_position: z.number().min(0).max(1).default(0.5),
  })
  .strict();

const TimbreArcGestureSchema = z
  .object({
    id: GestureIdSchema,
    type: z.literal("timbre_arc"),
    event_ids: z.array(IdSchema).min(1).max(5000),
    curve: z.enum(["BRE", "BRI", "CLE", "GEN", "POR"]),
    start_value: z.number().int().min(0).max(127),
    peak_value: z.number().int().min(0).max(127),
    end_value: z.number().int().min(0).max(127),
    peak_position: z.number().min(0).max(1).default(0.5),
  })
  .strict();

export const ManifestTuningGestureSchema = z.discriminatedUnion("type", [
  ArticulationGestureSchema,
  VibratoGestureSchema,
  PitchScoopGestureSchema,
  DynamicsArcGestureSchema,
  OpeningArcGestureSchema,
  TimbreArcGestureSchema,
]);

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
    tuning_gestures: z.array(ManifestTuningGestureSchema).max(256).optional(),
    materialized_tuning_gesture_ids: z.array(GestureIdSchema).max(256).optional(),
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

const GainEffectSchema = z.object({
  id: IdSchema,
  type: z.literal("gain"),
  enabled: z.boolean().default(true),
  parameters: z.object({ gain_db: z.number().min(-60).max(24) }).strict(),
}).strict();

const PanEffectSchema = z.object({
  id: IdSchema,
  type: z.literal("pan"),
  enabled: z.boolean().default(true),
  parameters: z.object({ pan: z.number().min(-1).max(1) }).strict(),
}).strict();

const HighpassEffectSchema = z.object({
  id: IdSchema,
  type: z.literal("highpass"),
  enabled: z.boolean().default(true),
  parameters: z.object({
    frequency_hz: z.number().min(20).max(20_000),
    q: z.number().min(0.1).max(20).default(0.707),
    poles: z.union([z.literal(1), z.literal(2)]).default(2),
  }).strict(),
}).strict();

const LowpassEffectSchema = z.object({
  id: IdSchema,
  type: z.literal("lowpass"),
  enabled: z.boolean().default(true),
  parameters: z.object({
    frequency_hz: z.number().min(20).max(20_000),
    q: z.number().min(0.1).max(20).default(0.707),
    poles: z.union([z.literal(1), z.literal(2)]).default(2),
  }).strict(),
}).strict();

const EqualizerEffectSchema = z.object({
  id: IdSchema,
  type: z.literal("equalizer"),
  enabled: z.boolean().default(true),
  parameters: z.object({
    frequency_hz: z.number().min(20).max(20_000),
    q: z.number().min(0.1).max(50),
    gain_db: z.number().min(-24).max(24),
    mix: z.number().min(0).max(1).default(1),
  }).strict(),
}).strict();

const CompressorEffectSchema = z.object({
  id: IdSchema,
  type: z.literal("compressor"),
  enabled: z.boolean().default(true),
  parameters: z.object({
    threshold_db: z.number().min(-60).max(0),
    ratio: z.number().min(1).max(20),
    attack_ms: z.number().min(0.01).max(2000),
    release_ms: z.number().min(0.01).max(9000),
    makeup_db: z.number().min(0).max(24).default(0),
    knee: z.number().min(1).max(8).default(2.82843),
    detection: z.enum(["peak", "rms"]).default("rms"),
    mix: z.number().min(0).max(1).default(1),
  }).strict(),
}).strict();

const DeesserEffectSchema = z.object({
  id: IdSchema,
  type: z.literal("deesser"),
  enabled: z.boolean().default(true),
  parameters: z.object({
    intensity: z.number().min(0).max(1),
    max_deessing: z.number().min(0).max(1).default(0.5),
    frequency_focus: z.number().min(0).max(1).default(0.5),
  }).strict(),
}).strict();

const ReverbEffectSchema = z.object({
  id: IdSchema,
  type: z.literal("reverb"),
  enabled: z.boolean().default(true),
  parameters: z.object({
    in_gain: z.number().min(0).max(1).default(0.8),
    out_gain: z.number().min(0).max(1).default(0.7),
    delay_ms: z.number().min(10).max(1000),
    decay: z.number().min(0).max(0.9),
  }).strict(),
}).strict();

const DelayEffectSchema = z.object({
  id: IdSchema,
  type: z.literal("delay"),
  enabled: z.boolean().default(true),
  parameters: z.object({
    in_gain: z.number().min(0).max(1).default(0.8),
    out_gain: z.number().min(0).max(1).default(0.7),
    delay_ms: z.number().min(1).max(5000),
    decay: z.number().min(0).max(0.9),
  }).strict(),
}).strict();

const LimiterEffectSchema = z.object({
  id: IdSchema,
  type: z.literal("limiter"),
  enabled: z.boolean().default(true),
  parameters: z.object({
    limit_db: z.number().min(-24).max(-0.01),
    attack_ms: z.number().min(0.1).max(80).default(5),
    release_ms: z.number().min(1).max(8000).default(50),
  }).strict(),
}).strict();

export const ManifestEffectSchema = z.discriminatedUnion("type", [
  GainEffectSchema,
  PanEffectSchema,
  HighpassEffectSchema,
  LowpassEffectSchema,
  EqualizerEffectSchema,
  CompressorEffectSchema,
  DeesserEffectSchema,
  ReverbEffectSchema,
  DelayEffectSchema,
  LimiterEffectSchema,
]);

export const ManifestEffectChainSchema = z
  .object({
    id: IdSchema,
    target_id: IdSchema,
    effects: z.array(ManifestEffectSchema).max(64).default([]),
  })
  .strict();

export const ManifestSectionDynamicsSchema = z
  .object({
    id: IdSchema,
    section_id: IdSchema,
    target_id: IdSchema,
    gain_db: z.number().min(-60).max(24).default(0),
    ramp_ms: z.number().int().min(0).max(5000).default(100),
  })
  .strict();

export const ManifestArtifactSchema = z
  .object({
    id: IdSchema,
    role: z.enum(["backing", "vsqx", "vocal_stem", "instrument_stem", "mix", "master", "analysis", "preview", "delivery"]),
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

export const ManifestReviewNoteSchema = z
  .object({
    id: IdSchema,
    author_type: z.enum(["human", "agent"]),
    author_name: z.string().min(1).max(128),
    observation: z.string().min(1).max(4000),
    section_id: IdSchema.optional(),
    object_ids: z.array(IdSchema).max(256).default([]),
    artifact_ids: z.array(IdSchema).max(64).default([]),
    position: ManifestPositionSchema.optional(),
    intent_fidelity: IntentFidelityReviewBasisSchema.optional(),
    status: z.enum(["open", "resolved"]).default("open"),
    created_at: z.string().datetime(),
    resolved_at: z.string().datetime().optional(),
    resolution: z.string().min(1).max(4000).optional(),
  })
  .strict()
  .refine((note) => note.status === "resolved" ? note.resolved_at !== undefined : true, {
    message: "Resolved review notes require resolved_at",
  });

export const ManifestReviewNoteInputSchema = z
  .object({
    id: IdSchema,
    author_type: z.enum(["human", "agent"]),
    author_name: z.string().min(1).max(128),
    observation: z.string().min(1).max(4000),
    section_id: IdSchema.optional(),
    object_ids: z.array(IdSchema).max(256).default([]),
    artifact_ids: z.array(IdSchema).max(64).default([]),
    position: ManifestPositionSchema.optional(),
    intent_fidelity: IntentFidelityReviewBasisSchema.optional(),
  })
  .strict();

export const SongManifestSchema = z
  .object({
    schema: z.literal(MANIFEST_SCHEMA),
    revision: z.number().int().min(1),
    composition_hash: z.string().regex(/^[a-f0-9]{64}$/u),
    mix_hash: z.string().regex(/^[a-f0-9]{64}$/u),
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
    composition_intent: CompositionIntentSchema.optional(),
    composition_guidance: CompositionGuidanceSchema.optional(),
    artifacts: z.array(ManifestArtifactSchema).max(10_000),
    review_notes: z.array(ManifestReviewNoteSchema).max(10_000).optional(),
  })
  .strict();

export type SongManifest = z.infer<typeof SongManifestSchema>;
export type ManifestSection = z.infer<typeof ManifestSectionSchema>;
export type ManifestVoice = z.infer<typeof ManifestVoiceSchema>;
export type ManifestVocalTrackMetadata = z.infer<typeof ManifestVocalTrackMetadataSchema>;
export type ManifestVocalPart = z.infer<typeof ManifestVocalPartSchema>;
export type ManifestArrangementTrack = z.infer<typeof ManifestArrangementTrackSchema>;
export type ManifestArtifact = z.infer<typeof ManifestArtifactSchema>;
export type ManifestReviewNote = z.infer<typeof ManifestReviewNoteSchema>;
export type ManifestEffectChain = z.infer<typeof ManifestEffectChainSchema>;
export type ManifestSectionDynamic = z.infer<typeof ManifestSectionDynamicsSchema>;
export type ManifestCompositionGuidance = z.infer<typeof CompositionGuidanceSchema>;
export type ManifestCompositionIntent = z.infer<typeof CompositionIntentSchema>;

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

export const ManifestGrooveSchema = z
  .object({
    seed: z.string().min(1).max(256),
    arrangement_track_ids: z.array(IdSchema).max(32).default([]),
    section_id: IdSchema.optional(),
    event_ids: z.array(IdSchema).max(50_000).default([]),
    targets: z.array(z.enum(["direct_events", "pattern_events"])).min(1),
    grid_ticks: z.number().int().min(30).max(1920).default(120),
    swing_percent: z.number().min(50).max(75).default(50),
    timing_jitter_ticks: z.number().int().min(0).max(120).default(0),
    velocity_jitter: z.number().int().min(0).max(32).default(0),
    gate_jitter_percent: z.number().int().min(0).max(30).default(0),
    preserve_downbeats: z.boolean().default(true),
  })
  .strict()
  .refine(
    (value) => value.swing_percent !== 50 || value.timing_jitter_ticks !== 0
      || value.velocity_jitter !== 0 || value.gate_jitter_percent !== 0,
    { message: "Groove must change swing, timing, velocity, or gate" },
  )
  .refine(
    (value) => !value.section_id || !value.targets.includes("pattern_events"),
    { message: "section_id cannot scope reusable pattern_events; select explicit event_ids or direct_events" },
  );

export type ManifestGroove = z.infer<typeof ManifestGrooveSchema>;

export const ManifestTimelineUpdateSchema = z
  .object({
    time_signatures: z.array(ManifestTimeSignatureSchema).min(1).max(256).optional(),
    tempos: z.array(ManifestTempoSchema).min(1).max(5000).optional(),
    sections: z.array(ManifestSectionSchema).min(1).max(1024).optional(),
    key_changes: z.array(ManifestKeyChangeSchema).max(1024).optional(),
    chord_changes: z.array(ManifestChordChangeSchema).max(20_000).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Timeline update must replace at least one domain",
  });

export const ManifestRemovalSchema = z
  .object({
    object_type: z.enum([
      "section", "vocal_part", "vocal_track", "arrangement_track", "event",
      "effect_chain", "section_dynamic", "theory_exception",
    ]),
    object_ids: z.array(IdSchema).min(1).max(20_000),
  })
  .strict();
