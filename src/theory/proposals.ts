import { createHash } from "node:crypto";

import { z } from "zod";

import {
  ManifestTransformSchema,
  type SongManifest,
} from "../song-manifest.js";
import { musicalPositionToTick } from "../vsqx.js";
import { analyzeManifestTheory } from "./analyze.js";
import { buildSymbolicIndex, secondsBetweenTicks, type SymbolicArrangementEvent, type SymbolicIndex, type SymbolicVocalEvent } from "./events.js";
import { normalizePitchClass } from "./pitch.js";
import { theoryContextAtTick } from "./timeline.js";
import type { TheoryIssue, TheoryReport } from "./types.js";


const StableIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/u);
const FingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const IssueCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,95}$/u);
const ScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const TheoryProposalKindSchema = z.enum([
  "voicing",
  "harmony",
  "repair",
  "diatonic_transpose",
  "breath",
]);

export const TheoryProposalOptionsSchema = z
  .object({
    maxCandidates: z.number().int().min(3).max(8).default(6),
    kinds: z.array(TheoryProposalKindSchema).max(5).default([]),
    issueCodes: z.array(IssueCodeSchema).max(64).default([]),
    objectIds: z.array(StableIdSchema).max(256).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    for (const [field, values] of [
      ["kinds", value.kinds],
      ["issueCodes", value.issueCodes],
      ["objectIds", value.objectIds],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", path: [field], message: `${field} must not contain duplicates` });
      }
    }
  });

const TheoryProposalChangeSchema = z
  .object({
    objectId: StableIdSchema,
    field: z.string().regex(/^[a-z][a-z0-9._-]{0,95}$/u),
    before: ScalarSchema,
    after: ScalarSchema,
    delta: z.number().optional(),
  })
  .strict();

const TheoryMetricPredictionSchema = z
  .object({
    metricId: z.string().regex(/^[a-z][a-z0-9._-]{1,95}$/u),
    direction: z.enum(["increase", "decrease", "change"]),
    rationale: z.string().min(1).max(500),
  })
  .strict();

const TheoryProposalDeltaSchema = z
  .object({
    basis: z.literal("deterministic_symbolic_projection"),
    predictedResolvedIssueCodes: z.array(IssueCodeSchema).max(16),
    predictedIntroducedIssueCodes: z.array(IssueCodeSchema).max(16),
    mustRecheckIssueCodes: z.array(IssueCodeSchema).max(32),
    metricPredictions: z.array(TheoryMetricPredictionSchema).max(16),
    confidence: z.number().min(0).max(1),
    verification: z.literal("vocaloid_edit_song_dry_run"),
  })
  .strict();

const CommonApplyFields = {
  tool: z.literal("vocaloid_edit_song"),
  requiredDryRun: z.literal(true),
  expectedRevision: z.number().int().min(1),
  compositionHash: FingerprintSchema,
};

const TheoryProposalApplySchema = z.discriminatedUnion("strategy", [
  z
    .object({
      strategy: z.literal("transform_events"),
      ...CommonApplyFields,
      action: z.literal("transform_events"),
      transform: ManifestTransformSchema,
    })
    .strict(),
  z
    .object({
      strategy: z.literal("rebuild_object"),
      ...CommonApplyFields,
      action: z.enum(["upsert_vocal_phrase", "upsert_vocal_part", "upsert_arrangement", "replace_timeline"]),
      targetObjectIds: z.array(StableIdSchema).min(1).max(256),
      requiredChanges: z.array(TheoryProposalChangeSchema).min(1).max(32),
    })
    .strict(),
]);

const TheoryProposalListeningCheckSchema = z
  .object({
    required: z.literal(true),
    questionSource: z.enum(["composition_intent", "proposal_diagnostic"]),
    question: z.string().min(1).max(2000),
    preserveQuestionAcrossGroup: z.literal(true),
    phraseDirectionId: StableIdSchema.optional(),
    listeningQuestionId: StableIdSchema.optional(),
    phrasePurpose: z.string().min(1).max(2000).optional(),
  })
  .strict();

export const TheoryProposalCandidateSchema = z
  .object({
    id: StableIdSchema,
    kind: TheoryProposalKindSchema,
    hypothesis: z
      .object({
        groupId: StableIdSchema,
        variant: z.enum(["A", "B", "C"]),
      })
      .strict(),
    sourceIssue: z
      .object({
        code: IssueCodeSchema,
        severity: z.enum(["error", "warning", "info"]),
        targetFingerprint: FingerprintSchema,
        objectIds: z.array(StableIdSchema).max(256),
      })
      .strict(),
    title: z.string().min(1).max(256),
    rationale: z.string().min(1).max(2000),
    changes: z.array(TheoryProposalChangeSchema).min(1).max(32),
    predictedDelta: TheoryProposalDeltaSchema,
    apply: TheoryProposalApplySchema,
    listeningCheck: TheoryProposalListeningCheckSchema,
  })
  .strict();

export const TheoryProposalReportSchema = z
  .object({
    schema: z.literal("vocaloid-theory-proposals/v1"),
    manifestRevision: z.number().int().min(1),
    compositionHash: FingerprintSchema,
    rulesetId: z.string().min(1).max(128),
    rulesetHash: FingerprintSchema,
    request: TheoryProposalOptionsSchema,
    constraints: z
      .object({
        readOnly: z.literal(true),
        corpusAndStyleAccess: z.literal("forbidden"),
        applyRequiresDryRun: z.literal(true),
        maxCandidatesPerIssue: z.literal(3),
        maxCandidatesPerPhraseDirection: z.literal(3),
        subjectiveSelection: z.literal("listening_review_required"),
      })
      .strict(),
    summary: z
      .object({
        candidateCount: z.number().int().min(0).max(8),
        consideredIssueCount: z.number().int().min(0),
        unproposedIssueCount: z.number().int().min(0),
        byKind: z.record(TheoryProposalKindSchema, z.number().int().min(0)),
      })
      .strict(),
    candidates: z.array(TheoryProposalCandidateSchema).max(8),
    unproposedIssues: z
      .array(z.object({
        code: IssueCodeSchema,
        targetFingerprint: FingerprintSchema,
        reason: z.enum(["no_bounded_edit", "filtered_kind", "candidate_budget"]),
      }).strict())
      .max(256),
  })
  .strict();

export type TheoryProposalKind = z.infer<typeof TheoryProposalKindSchema>;
export type TheoryProposalOptions = z.infer<typeof TheoryProposalOptionsSchema>;
export type TheoryProposalOptionsInput = z.input<typeof TheoryProposalOptionsSchema>;
export type TheoryProposalCandidate = z.infer<typeof TheoryProposalCandidateSchema>;
export type TheoryProposalReport = z.infer<typeof TheoryProposalReportSchema>;

type ProposalChange = z.infer<typeof TheoryProposalChangeSchema>;
type ProposalApply = z.infer<typeof TheoryProposalApplySchema>;
type MetricPrediction = z.infer<typeof TheoryMetricPredictionSchema>;

interface VocalLocation {
  event: SymbolicVocalEvent;
  target: "vocal_notes" | "vocal_phrase_cells";
  source: SongManifest["vocal_tracks"][number]["parts"][number]["notes"][number]
    | SongManifest["vocal_tracks"][number]["parts"][number]["phrases"][number]["cells"][number];
  phraseId?: string;
}

interface DraftCandidate {
  kind: TheoryProposalKind;
  issue: TheoryIssue;
  title: string;
  rationale: string;
  changes: ProposalChange[];
  predictedResolvedIssueCodes: string[];
  predictedIntroducedIssueCodes: string[];
  mustRecheckIssueCodes: string[];
  metricPredictions: MetricPrediction[];
  confidence: number;
  apply: ProposalApply;
}

const KIND_ORDER: Readonly<Record<TheoryProposalKind, number>> = {
  voicing: 0,
  harmony: 1,
  repair: 2,
  diatonic_transpose: 3,
  breath: 4,
};

const COMMON_PITCH_RECHECKS = [
  "LARGE_LEAP_UNBALANCED",
  "STRONG_BEAT_OUT_OF_SCALE",
  "SUSTAINED_NON_CHORD_TONE_UNRESOLVED",
  "VOCAL_TESSITURA_STRAIN",
  "VOCAL_HARMONY_MINOR_SECOND",
  "VOICE_CROSSING",
  "VOICE_SPACING_EXTREME",
] as const;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function vocalLocations(manifest: SongManifest, index: SymbolicIndex): Map<string, VocalLocation> {
  const symbolicById = new Map(index.vocalEvents.map((event) => [event.id, event]));
  const locations = new Map<string, VocalLocation>();
  for (const track of manifest.vocal_tracks) for (const part of track.parts) {
    for (const note of part.notes) {
      const event = symbolicById.get(note.id);
      if (event) locations.set(note.id, { event, target: "vocal_notes", source: note });
    }
    for (const phrase of part.phrases) for (const cell of phrase.cells) {
      const event = symbolicById.get(cell.id);
      if (event) locations.set(cell.id, {
        event,
        target: "vocal_phrase_cells",
        source: cell,
        phraseId: phrase.id,
      });
    }
  }
  return locations;
}

function transformApply(
  manifest: SongManifest,
  transformInput: z.input<typeof ManifestTransformSchema>,
): ProposalApply {
  return {
    strategy: "transform_events",
    tool: "vocaloid_edit_song",
    action: "transform_events",
    requiredDryRun: true,
    expectedRevision: manifest.revision,
    compositionHash: manifest.composition_hash,
    transform: ManifestTransformSchema.parse(transformInput),
  };
}

function rebuildApply(
  manifest: SongManifest,
  action: "upsert_vocal_phrase" | "upsert_vocal_part" | "upsert_arrangement" | "replace_timeline",
  targetObjectIds: string[],
  requiredChanges: ProposalChange[],
): ProposalApply {
  return {
    strategy: "rebuild_object",
    tool: "vocaloid_edit_song",
    action,
    requiredDryRun: true,
    expectedRevision: manifest.revision,
    compositionHash: manifest.composition_hash,
    targetObjectIds: uniqueSorted(targetObjectIds),
    requiredChanges,
  };
}

function pitchChange(location: VocalLocation, after: number): ProposalChange {
  return {
    objectId: location.event.id,
    field: "note_number",
    before: location.event.noteNumber,
    after,
    delta: after - location.event.noteNumber,
  };
}

function pitchTransform(manifest: SongManifest, location: VocalLocation, after: number): ProposalApply {
  return transformApply(manifest, {
    event_ids: [location.event.id],
    targets: [location.target],
    transpose: after - location.event.noteNumber,
  });
}

function nearestAllowedPitches(
  current: number,
  pitchClasses: readonly number[],
  options: { maximumDistance?: number; predicate?: (pitch: number) => boolean } = {},
): number[] {
  const maximumDistance = options.maximumDistance ?? 12;
  const candidates: number[] = [];
  for (let delta = -maximumDistance; delta <= maximumDistance; delta += 1) {
    const pitch = current + delta;
    if (delta === 0 || pitch < 0 || pitch > 127) continue;
    if (!pitchClasses.includes(normalizePitchClass(pitch))) continue;
    if (options.predicate && !options.predicate(pitch)) continue;
    candidates.push(pitch);
  }
  return candidates.sort((left, right) => Math.abs(left - current) - Math.abs(right - current)
    || (left - current) - (right - current)
    || left - right);
}

function numberDetail(issue: TheoryIssue, key: string): number | undefined {
  for (const evidence of issue.evidence) {
    const value = evidence.details[key];
    if (typeof value === "number") return value;
  }
  return undefined;
}

function sourceVocalEvents(issue: TheoryIssue, locations: ReadonlyMap<string, VocalLocation>): VocalLocation[] {
  return issue.objectIds.flatMap((id) => {
    const location = locations.get(id);
    return location ? [location] : [];
  }).sort((left, right) => left.event.startTick - right.event.startTick
    || left.event.id.localeCompare(right.event.id));
}

function pitchDraft(
  manifest: SongManifest,
  issue: TheoryIssue,
  location: VocalLocation,
  after: number,
  kind: TheoryProposalKind,
  title: string,
  rationale: string,
  confidence: number,
  metricPredictions: MetricPrediction[],
): DraftCandidate {
  return {
    kind,
    issue,
    title,
    rationale,
    changes: [pitchChange(location, after)],
    predictedResolvedIssueCodes: [issue.code],
    predictedIntroducedIssueCodes: [],
    mustRecheckIssueCodes: uniqueSorted([issue.code, ...COMMON_PITCH_RECHECKS]),
    metricPredictions,
    confidence,
    apply: pitchTransform(manifest, location, after),
  };
}

function harmonyDrafts(
  manifest: SongManifest,
  index: SymbolicIndex,
  issue: TheoryIssue,
  locations: ReadonlyMap<string, VocalLocation>,
): DraftCandidate[] {
  const source = sourceVocalEvents(issue, locations);
  if (source.length === 0) return [];
  const location = source[0]!;
  const context = theoryContextAtTick(index.timeline, location.event.startTick);
  let allowed: readonly number[] | undefined;
  let title = "Move the sustain to a nearby chord tone";
  let rationale = "Tests the smallest chord-tone alternative while preserving onset, lyric, duration, and surrounding orchestration.";
  if (issue.code === "SUSTAINED_NON_CHORD_TONE_UNRESOLVED") {
    allowed = context.chord?.value.parsed?.exact ? context.chord.value.parsed.pitchClasses : undefined;
  } else if (issue.code === "LEADING_TONE_UNRESOLVED") {
    const tonic = context.key?.value.parsed?.tonic.pitchClass;
    allowed = tonic === undefined ? undefined : [tonic];
    title = "Collapse the unresolved leading tone to tonic";
    rationale = "Tests removal of the unresolved tendency tone without inventing a new lyric event or changing the phrase rhythm.";
  } else if (issue.code === "STRONG_BEAT_OUT_OF_SCALE") {
    allowed = context.key?.value.parsed?.pitchClasses;
    title = "Move the accented note to a nearby scale tone";
    rationale = "Tests a scale-consistent pitch on the same strong beat while holding lyric, duration, and phrase timing constant.";
  } else {
    return [];
  }
  if (!allowed || allowed.length === 0) return [];
  return nearestAllowedPitches(location.event.noteNumber, allowed, { maximumDistance: 5 })
    .slice(0, 2)
    .map((after) => pitchDraft(
      manifest,
      issue,
      location,
      after,
      issue.code === "STRONG_BEAT_OUT_OF_SCALE" ? "diatonic_transpose" : "harmony",
      title,
      rationale,
      0.82,
      [{
        metricId: `melody.weighted_mean.${location.event.trackId}`,
        direction: "change",
        rationale: "One bounded pitch changes the duration-weighted melodic center by a small, deterministic amount.",
      }],
    ));
}

function leapRepairDrafts(
  manifest: SongManifest,
  index: SymbolicIndex,
  issue: TheoryIssue,
  locations: ReadonlyMap<string, VocalLocation>,
): DraftCandidate[] {
  if (issue.code !== "LARGE_LEAP_UNBALANCED") return [];
  const source = sourceVocalEvents(issue, locations);
  if (source.length < 2) return [];
  const previous = source[0]!;
  const current = source.at(-1)!;
  const context = theoryContextAtTick(index.timeline, current.event.startTick);
  const pitchClasses = context.key?.value.parsed?.pitchClasses ?? Array.from({ length: 12 }, (_, value) => value);
  const pitches = nearestAllowedPitches(current.event.noteNumber, pitchClasses, {
    maximumDistance: 12,
    predicate: (pitch) => Math.abs(pitch - previous.event.noteNumber) <= 7,
  }).slice(0, 2);
  return pitches.map((after) => pitchDraft(
    manifest,
    issue,
    current,
    after,
    "repair",
    "Fold the arrival into a singable local interval",
    `Moves only ${current.event.id}, reducing the ${Math.abs(current.event.noteNumber - previous.event.noteNumber)}-semitone arrival while preserving its onset and lyric.`,
    0.86,
    [{
      metricId: `melody.range.${current.event.trackId}`,
      direction: "change",
      rationale: "A local register repair may narrow the track range; dry-run reports the exact metric delta.",
    }],
  ));
}

function tessituraDrafts(
  manifest: SongManifest,
  issue: TheoryIssue,
  locations: ReadonlyMap<string, VocalLocation>,
  index: SymbolicIndex,
): DraftCandidate[] {
  if (issue.code !== "VOCAL_TESSITURA_STRAIN") return [];
  const trackId = issue.objectIds.find((id) => index.vocalEventsByTrack.has(id));
  if (!trackId) return [];
  const events = index.vocalEventsByTrack.get(trackId) ?? [];
  if (events.length === 0) return [];
  const outsideRatio = (delta: number): number => {
    const total = events.reduce((sum, event) => sum + event.duration, 0);
    const outside = events.filter((event) => event.noteNumber + delta < 52 || event.noteNumber + delta > 79)
      .reduce((sum, event) => sum + event.duration, 0);
    return total === 0 ? 1 : outside / total;
  };
  const baseline = outsideRatio(0);
  const shifts = [-12, 12]
    .map((delta) => ({ delta, ratio: outsideRatio(delta) }))
    .filter((entry) => entry.ratio < baseline && events.every((event) => event.noteNumber + entry.delta >= 0 && event.noteNumber + entry.delta <= 127))
    .sort((left, right) => left.ratio - right.ratio || left.delta - right.delta)
    .slice(0, 2);
  const firstLocation = events.map((event) => locations.get(event.id)).find((entry) => entry !== undefined);
  if (!firstLocation) return [];
  const targets = uniqueSorted(events.flatMap((event) => {
    const location = locations.get(event.id);
    return location ? [location.target] : [];
  })) as Array<"vocal_notes" | "vocal_phrase_cells">;
  return shifts.map(({ delta, ratio }) => ({
    kind: "diatonic_transpose" as const,
    issue,
    title: `Transpose ${trackId} by ${delta > 0 ? "+" : ""}${delta} semitones`,
    rationale: `Preserves every pitch class and interval while reducing the conservative out-of-tessitura tick ratio from ${(baseline * 100).toFixed(1)}% to ${(ratio * 100).toFixed(1)}%.`,
    changes: [{
      objectId: trackId,
      field: "register_transpose",
      before: 0,
      after: delta,
      delta,
    }],
    predictedResolvedIssueCodes: [issue.code],
    predictedIntroducedIssueCodes: [],
    mustRecheckIssueCodes: uniqueSorted([issue.code, ...COMMON_PITCH_RECHECKS]),
    metricPredictions: [{
      metricId: `melody.weighted_mean.${trackId}`,
      direction: delta > 0 ? "increase" as const : "decrease" as const,
      rationale: "An octave-equivalent register shift moves the weighted mean by exactly the selected semitone delta.",
    }],
    confidence: 0.9,
    apply: transformApply(manifest, {
      vocal_track_id: trackId,
      event_ids: [],
      targets,
      transpose: delta,
    }),
  }));
}

function voiceLeadingDrafts(
  manifest: SongManifest,
  index: SymbolicIndex,
  issue: TheoryIssue,
  locations: ReadonlyMap<string, VocalLocation>,
): DraftCandidate[] {
  const source = sourceVocalEvents(issue, locations);
  if (source.length < 2) return [];
  const lowerTrackId = issue.objectIds[0];
  const upperTrackId = issue.objectIds[1];
  const lowerTrackEvent = source.find((entry) => entry.event.trackId === lowerTrackId) ?? source[0]!;
  const upperTrackEvent = source.find((entry) => entry.event.trackId === upperTrackId
    && entry.event.id !== lowerTrackEvent.event.id) ?? source.find((entry) => entry !== lowerTrackEvent) ?? source[1]!;
  if (issue.code === "VOICE_CROSSING") {
    const octaveCount = Math.max(
      1,
      Math.ceil((lowerTrackEvent.event.noteNumber - upperTrackEvent.event.noteNumber) / 12),
    );
    const octaveDelta = octaveCount * 12;
    const candidates = [
      { location: lowerTrackEvent, after: lowerTrackEvent.event.noteNumber - octaveDelta, label: "lower voice down" },
      { location: upperTrackEvent, after: upperTrackEvent.event.noteNumber + octaveDelta, label: "upper voice up" },
    ].filter((entry) => entry.after >= 0 && entry.after <= 127
      && Math.abs(entry.after - entry.location.event.noteNumber) <= 48);
    return candidates.slice(0, 2).map((entry) => pitchDraft(
      manifest,
      issue,
      entry.location,
      entry.after,
      "voicing",
      `Restore register order: ${entry.label}`,
      "Tests one octave-equivalent redistribution on only one overlapping event; melodic pitch class, lyric, and rhythm remain fixed.",
      0.84,
      [{
        metricId: "voice_leading.crossings",
        direction: "decrease",
        rationale: "The proposed octave redistribution restores the analyzer's expected lower/upper ordering at this overlap.",
      }],
    ));
  }
  if (issue.code === "VOICE_SPACING_EXTREME") {
    const lower = lowerTrackEvent.event.noteNumber <= upperTrackEvent.event.noteNumber
      ? lowerTrackEvent
      : upperTrackEvent;
    const upper = lower === lowerTrackEvent ? upperTrackEvent : lowerTrackEvent;
    const span = upper.event.noteNumber - lower.event.noteNumber;
    const octaveDelta = Math.max(12, Math.ceil((span - 19) / 12) * 12);
    const candidates = [
      { location: lower, after: lower.event.noteNumber + octaveDelta, label: "raise the lower event" },
      { location: upper, after: upper.event.noteNumber - octaveDelta, label: "lower the upper event" },
    ].filter((entry) => entry.after >= 0 && entry.after <= 127
      && Math.abs(entry.after - entry.location.event.noteNumber) <= 48
      && Math.abs((entry.location === lower ? entry.after : lower.event.noteNumber)
        - (entry.location === upper ? entry.after : upper.event.noteNumber))
        <= 19);
    return candidates.slice(0, 2).map((entry) => pitchDraft(
      manifest,
      issue,
      entry.location,
      entry.after,
      "voicing",
      `Reduce vocal spacing: ${entry.label}`,
      "Tests an octave-equivalent spacing alternative while preserving both pitch classes and the phrase rhythm.",
      0.82,
      [{
        metricId: `melody.weighted_mean.${entry.location.event.trackId}`,
        direction: entry.after > entry.location.event.noteNumber ? "increase" : "decrease",
        rationale: "The octave redistribution changes the selected voice's duration-weighted register; dry-run reports the exact amount.",
      }],
    ));
  }
  if (issue.code === "VOCAL_HARMONY_MINOR_SECOND") {
    const fixed = lowerTrackEvent;
    const moving = upperTrackEvent;
    const context = theoryContextAtTick(index.timeline, moving.event.startTick);
    const allowed = context.chord?.value.parsed?.pitchClasses
      ?? context.key?.value.parsed?.pitchClasses
      ?? Array.from({ length: 12 }, (_, value) => value);
    return nearestAllowedPitches(moving.event.noteNumber, allowed, {
      maximumDistance: 5,
      predicate: (pitch) => {
        const intervalClass = Math.abs(pitch - fixed.event.noteNumber) % 12;
        return intervalClass !== 1 && intervalClass !== 11;
      },
    }).slice(0, 2).map((after) => pitchDraft(
      manifest,
      issue,
      moving,
      after,
      "harmony",
      "Replace the minor-second overlap with a nearby harmonic tone",
      `Moves only ${moving.event.id}; onset, lyric, duration, and the other voice remain fixed so the clash can be compared directly.`,
      0.85,
      [{
        metricId: "voice_leading.minor_second_collisions",
        direction: "decrease",
        rationale: "The selected resulting interval is neither minor-second nor major-seventh class.",
      }],
    ));
  }
  return [];
}

function arrangementTransform(
  manifest: SongManifest,
  event: SymbolicArrangementEvent,
  delta: number,
): ProposalApply {
  if (event.placementId) {
    return transformApply(manifest, {
      arrangement_track_id: event.trackId,
      event_ids: [event.placementId],
      targets: ["instrument_placements"],
      transpose: delta,
    });
  }
  return transformApply(manifest, {
    arrangement_track_id: event.trackId,
    event_ids: [event.sourceId],
    targets: ["instrument_notes"],
    transpose: delta,
  });
}

function arrangementDrafts(manifest: SongManifest, index: SymbolicIndex, issue: TheoryIssue): DraftCandidate[] {
  if (!["VOICING_NOTE_OUTSIDE_MIDI", "ARRANGEMENT_RANGE_RISK", "BASS_CONFLICTS_WITH_SLASH_CHORD"].includes(issue.code)) return [];
  const event = index.arrangementEvents.find((candidate) => issue.objectIds.includes(candidate.trackId)
    && issue.objectIds.includes(candidate.sourceId)
    && (!candidate.placementId || issue.objectIds.includes(candidate.placementId)));
  if (!event) return [];
  let delta: number | undefined;
  let kind: TheoryProposalKind = "voicing";
  let title = "Move the arrangement event into the declared range";
  let rationale = "Tests the smallest octave-equivalent register correction at the stable source or placement scope.";
  if (issue.code === "BASS_CONFLICTS_WITH_SLASH_CHORD") {
    const bassPitchClass = numberDetail(issue, "declared_bass_pitch_class");
    if (bassPitchClass === undefined) return [];
    const candidates = nearestAllowedPitches(event.noteNumber, [bassPitchClass], { maximumDistance: 6 });
    delta = candidates[0] === undefined ? undefined : candidates[0] - event.noteNumber;
    kind = "harmony";
    title = "Align the strong-beat bass with the declared slash bass";
    rationale = "Tests the nearest register-preserving slash-bass pitch while holding rhythm, velocity, and chord symbol constant.";
  } else {
    const minimum = issue.code === "VOICING_NOTE_OUTSIDE_MIDI" ? 0 : numberDetail(issue, "minimum");
    const maximum = issue.code === "VOICING_NOTE_OUTSIDE_MIDI" ? 127 : numberDetail(issue, "maximum");
    if (minimum === undefined || maximum === undefined) return [];
    const octaveDeltas = [-48, -36, -24, -12, 12, 24, 36, 48]
      .filter((candidate) => event.noteNumber + candidate >= minimum && event.noteNumber + candidate <= maximum)
      .sort((left, right) => Math.abs(left) - Math.abs(right) || left - right);
    delta = octaveDeltas[0];
  }
  if (delta === undefined || delta === 0) return [];
  const targetId = event.placementId ?? event.sourceId;
  const track = manifest.accompaniment.tracks.find((candidate) => candidate.id === event.trackId);
  const placementTranspose = track?.kind === "pitched" && event.placementId
    ? track.placements.find((placement) => placement.id === event.placementId)?.transpose
    : undefined;
  const before = event.placementId ? placementTranspose : event.noteNumber;
  if (before === undefined) return [];
  return [{
    kind,
    issue,
    title,
    rationale: `${rationale}${event.placementId ? " The placement scope may affect repeated pattern notes, which the required dry-run must expose." : ""}`,
    changes: [{
      objectId: targetId,
      field: event.placementId ? "transpose" : "note_number",
      before,
      after: before + delta,
      delta,
    }],
    predictedResolvedIssueCodes: [issue.code],
    predictedIntroducedIssueCodes: [],
    mustRecheckIssueCodes: uniqueSorted([issue.code, "ARRANGEMENT_RANGE_RISK", "VOICING_NOTE_OUTSIDE_MIDI", "REGISTER_DENSITY_COLLISION"]),
    metricPredictions: [{
      metricId: `arrangement.minimum.${event.trackId}`,
      direction: "change",
      rationale: "Changing a source note or placement register can change the expanded track extrema.",
    }],
    confidence: event.placementId ? 0.72 : 0.88,
    apply: arrangementTransform(manifest, event, delta),
  }];
}

function semanticFocusIds(manifest: SongManifest): Set<string> {
  return new Set(manifest.composition_intent?.phrase_directions.flatMap((direction) =>
    direction.realization_links?.semantic_focus_object_ids ?? []) ?? []);
}

function breathDrafts(
  manifest: SongManifest,
  index: SymbolicIndex,
  issue: TheoryIssue,
  locations: ReadonlyMap<string, VocalLocation>,
): DraftCandidate[] {
  if (issue.code !== "PHRASE_WITHOUT_BREATH") return [];
  const trackId = issue.objectIds.find((id) => index.vocalEventsByTrack.has(id));
  if (!trackId || !issue.position || !issue.endPosition) return [];
  const startTick = musicalPositionToTick(manifest.time_signatures, issue.position);
  const endTick = musicalPositionToTick(manifest.time_signatures, issue.endPosition);
  const events = (index.vocalEventsByTrack.get(trackId) ?? [])
    .filter((event) => event.startTick >= startTick && event.endTick <= endTick);
  if (events.length < 2) return [];
  const focusIds = semanticFocusIds(manifest);
  const midpoint = startTick + (endTick - startTick) * 0.55;
  const boundaries = events.slice(0, -1).flatMap((previous, eventIndex) => {
    const next = events[eventIndex + 1]!;
    const currentGap = next.startTick - previous.endTick;
    const targetDuration = next.startTick - previous.startTick - 120;
    if (currentGap >= 120 || targetDuration < 60 || targetDuration >= previous.duration) return [];
    const location = locations.get(previous.id);
    if (!location) return [];
    return [{
      previous,
      next,
      location,
      targetDuration,
      focusPenalty: focusIds.has(previous.id) || focusIds.has(next.id) ? 1 : 0,
      midpointDistance: Math.abs(next.startTick - midpoint),
    }];
  }).sort((left, right) => left.focusPenalty - right.focusPenalty
    || left.midpointDistance - right.midpointDistance
    || left.next.startTick - right.next.startTick
    || left.previous.id.localeCompare(right.previous.id));
  return boundaries.slice(0, 2).map((boundary) => {
    const { previous, next, location, targetDuration } = boundary;
    const bothRunsWithinThreshold = secondsBetweenTicks(index, startTick, previous.startTick + targetDuration) <= 12
      && secondsBetweenTicks(index, next.startTick, endTick) <= 12;
    const change: ProposalChange = location.target === "vocal_phrase_cells"
      ? {
          objectId: previous.id,
          field: "gate_percent",
          before: "gate_percent" in location.source ? location.source.gate_percent : 100,
          after: Math.max(1, Math.floor((targetDuration / previous.duration)
            * ("gate_percent" in location.source ? location.source.gate_percent : 100))),
        }
      : {
          objectId: previous.id,
          field: "duration",
          before: previous.duration,
          after: targetDuration,
          delta: targetDuration - previous.duration,
        };
    const apply = location.target === "vocal_phrase_cells" && location.phraseId
      ? rebuildApply(manifest, "upsert_vocal_phrase", [previous.trackId, previous.partId, location.phraseId], [change])
      : transformApply(manifest, {
          event_ids: [previous.id],
          targets: [location.target],
          duration_scale: Number((targetDuration / previous.duration).toFixed(9)),
        });
    return {
      kind: "breath" as const,
      issue,
      title: `Create a 120-tick breath before ${next.id}`,
      rationale: `Shortens only ${previous.id}'s sounding gate/end, preserves lyric order and the next onset, and avoids changing the semantic-focus boundary when another option exists.`,
      changes: [change],
      predictedResolvedIssueCodes: bothRunsWithinThreshold ? [issue.code] : [],
      predictedIntroducedIssueCodes: [],
      mustRecheckIssueCodes: uniqueSorted([issue.code, "MORA_DURATION_UNSINGABLE", "CONSONANT_LEAD_TIME_INSUFFICIENT"]),
      metricPredictions: [
        {
          metricId: `vocal.breath_window_count.${trackId}`,
          direction: "increase" as const,
          rationale: "The proposed sounding gap reaches the analyzer's 120-tick breath threshold.",
        },
        {
          metricId: `vocal.longest_continuous_run.${trackId}`,
          direction: "decrease" as const,
          rationale: "The continuous run is split at the selected boundary.",
        },
      ],
      confidence: bothRunsWithinThreshold ? 0.9 : 0.72,
      apply,
    };
  });
}

function allocationRepairDrafts(
  manifest: SongManifest,
  issue: TheoryIssue,
  locations: ReadonlyMap<string, VocalLocation>,
): DraftCandidate[] {
  if (!["MORA_DURATION_UNSINGABLE", "CONSONANT_LEAD_TIME_INSUFFICIENT"].includes(issue.code)) return [];
  const location = sourceVocalEvents(issue, locations)[0];
  if (!location) return [];
  const scale = 1.5;
  const after = Math.round(location.event.duration * scale);
  const change: ProposalChange = {
    objectId: location.event.id,
    field: "duration",
    before: location.event.duration,
    after,
    delta: after - location.event.duration,
  };
  return [{
    kind: "repair",
    issue,
    title: `Give ${location.event.id} 50% more local duration`,
    rationale: "A single bounded duration hypothesis tests whether consonant/mora identity improves; dry-run must reject any resulting overlap or part-boundary problem.",
    changes: [change],
    predictedResolvedIssueCodes: [],
    predictedIntroducedIssueCodes: [],
    mustRecheckIssueCodes: uniqueSorted([issue.code, "VOCAL_ONSET_DENSITY_RISK", "PHRASE_WITHOUT_BREATH"]),
    metricPredictions: [{
      metricId: `note_allocation.minimum_mora_duration.${location.event.trackId}`,
      direction: "increase",
      rationale: "The target event receives a deterministically longer sounding/step duration.",
    }],
    confidence: 0.65,
    apply: transformApply(manifest, {
      event_ids: [location.event.id],
      targets: [location.target],
      duration_scale: scale,
    }),
  }];
}

function issueDrafts(
  manifest: SongManifest,
  index: SymbolicIndex,
  issue: TheoryIssue,
  locations: ReadonlyMap<string, VocalLocation>,
): DraftCandidate[] {
  return [
    ...arrangementDrafts(manifest, index, issue),
    ...voiceLeadingDrafts(manifest, index, issue, locations),
    ...harmonyDrafts(manifest, index, issue, locations),
    ...leapRepairDrafts(manifest, index, issue, locations),
    ...tessituraDrafts(manifest, issue, locations, index),
    ...breathDrafts(manifest, index, issue, locations),
    ...allocationRepairDrafts(manifest, issue, locations),
  ].sort((left, right) => KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
    || JSON.stringify(left.changes).localeCompare(JSON.stringify(right.changes)))
    .slice(0, 3);
}

function directionForCandidate(manifest: SongManifest, issue: TheoryIssue) {
  if (!manifest.composition_intent) return undefined;
  const issueIds = new Set(issue.objectIds);
  const issueTick = issue.position
    ? musicalPositionToTick(manifest.time_signatures, issue.position)
    : undefined;
  const sectionId = issueTick === undefined
    ? undefined
    : manifest.sections.find((section) => {
        const start = musicalPositionToTick(manifest.time_signatures, section.start);
        const end = musicalPositionToTick(manifest.time_signatures, section.end);
        return issueTick >= start && issueTick < end;
      })?.id;
  const importance = { anchor: 0, supporting: 1, transition: 2 } as const;
  return manifest.composition_intent.phrase_directions.map((direction) => {
    const linked = Object.values(direction.realization_links ?? {}).flatMap((values) => values ?? []);
    const overlap = linked.filter((id) => issueIds.has(id)).length;
    const sectionMatch = sectionId !== undefined && direction.section_id === sectionId ? 1 : 0;
    return { direction, overlap, sectionMatch };
  }).filter((entry) => entry.overlap > 0)
    .sort((left, right) => right.overlap - left.overlap
      || right.sectionMatch - left.sectionMatch
      || importance[left.direction.importance] - importance[right.direction.importance]
      || left.direction.id.localeCompare(right.direction.id))[0]?.direction;
}

function diagnosticQuestion(kind: TheoryProposalKind, issue: TheoryIssue): string {
  if (kind === "breath") return "Does the new breath read as intentional phrasing without breaking the lyric thought or semantic focus?";
  if (kind === "voicing" || kind === "harmony") return "Does this alternative clarify the harmony while preserving the phrase's intended foreground and tension?";
  if (kind === "diatonic_transpose") return "Does the register become more singable without weakening the phrase contour, emphasis, or destination?";
  return `Does this bounded repair address ${issue.code} without weakening what the phrase is trying to say?`;
}

function materializeCandidate(
  manifest: SongManifest,
  draft: DraftCandidate,
  variantIndex: number,
): TheoryProposalCandidate {
  const groupId = `proposal-group-${draft.issue.targetFingerprint.slice(0, 20)}`;
  const id = `proposal-${draft.kind.replaceAll("_", "-")}-${fingerprint({
    compositionHash: manifest.composition_hash,
    issue: draft.issue.targetFingerprint,
    changes: draft.changes,
    apply: draft.apply,
  }).slice(0, 20)}`;
  const direction = directionForCandidate(manifest, draft.issue);
  return TheoryProposalCandidateSchema.parse({
    id,
    kind: draft.kind,
    hypothesis: { groupId, variant: (["A", "B", "C"] as const)[variantIndex]! },
    sourceIssue: {
      code: draft.issue.code,
      severity: draft.issue.severity,
      targetFingerprint: draft.issue.targetFingerprint,
      objectIds: draft.issue.objectIds,
    },
    title: draft.title,
    rationale: draft.rationale,
    changes: draft.changes,
    predictedDelta: {
      basis: "deterministic_symbolic_projection",
      predictedResolvedIssueCodes: uniqueSorted(draft.predictedResolvedIssueCodes),
      predictedIntroducedIssueCodes: uniqueSorted(draft.predictedIntroducedIssueCodes),
      mustRecheckIssueCodes: uniqueSorted(draft.mustRecheckIssueCodes),
      metricPredictions: draft.metricPredictions,
      confidence: draft.confidence,
      verification: "vocaloid_edit_song_dry_run",
    },
    apply: draft.apply,
    listeningCheck: direction ? {
      required: true,
      questionSource: "composition_intent",
      question: direction.listening_question.question,
      preserveQuestionAcrossGroup: true,
      phraseDirectionId: direction.id,
      listeningQuestionId: direction.listening_question.id,
      phrasePurpose: direction.purpose,
    } : {
      required: true,
      questionSource: "proposal_diagnostic",
      question: diagnosticQuestion(draft.kind, draft.issue),
      preserveQuestionAcrossGroup: true,
    },
  });
}

/**
 * Generate bounded, deterministic, read-only repair hypotheses from the shared
 * symbolic report. This function never calls a mutation API and has no access
 * to corpus/profile data. The returned action patches are intentionally
 * revision/hash-bound and may only be evaluated through edit-song dry-run.
 */
export function proposeTheoryRepairs(
  manifest: SongManifest,
  optionsInput: z.input<typeof TheoryProposalOptionsSchema> = {},
  existingReport?: TheoryReport,
): TheoryProposalReport {
  const options = TheoryProposalOptionsSchema.parse(optionsInput);
  const report = existingReport ?? analyzeManifestTheory(manifest);
  if (report.manifestRevision !== manifest.revision || report.compositionHash !== manifest.composition_hash) {
    throw new Error("Theory proposal source report does not match the manifest revision/composition hash");
  }
  const index = buildSymbolicIndex(manifest);
  const locations = vocalLocations(manifest, index);
  const requestedKinds = new Set(options.kinds);
  const requestedCodes = new Set(options.issueCodes);
  const requestedObjects = new Set(options.objectIds);
  const considered = report.issues.filter((issue) =>
    (requestedCodes.size === 0 || requestedCodes.has(issue.code))
    && (requestedObjects.size === 0 || issue.objectIds.some((id) => requestedObjects.has(id))));
  const candidates: TheoryProposalCandidate[] = [];
  const unproposedIssues: TheoryProposalReport["unproposedIssues"] = [];
  const candidatesByPhraseDirection = new Map<string, number>();
  const budgetSkippedIssues = new Set<string>();

  for (const issue of considered) {
    const allDrafts = issueDrafts(manifest, index, issue, locations);
    const drafts = requestedKinds.size === 0
      ? allDrafts
      : allDrafts.filter((draft) => requestedKinds.has(draft.kind));
    if (drafts.length === 0) {
      unproposedIssues.push({
        code: issue.code,
        targetFingerprint: issue.targetFingerprint,
        reason: allDrafts.length > 0 ? "filtered_kind" : "no_bounded_edit",
      });
      continue;
    }
    for (const [variantIndex, draft] of drafts.entries()) {
      if (candidates.length >= options.maxCandidates) break;
      const candidate = materializeCandidate(manifest, draft, variantIndex);
      const phraseDirectionId = candidate.listeningCheck.phraseDirectionId;
      if (phraseDirectionId && (candidatesByPhraseDirection.get(phraseDirectionId) ?? 0) >= 3) {
        budgetSkippedIssues.add(issue.targetFingerprint);
        continue;
      }
      candidates.push(candidate);
      if (phraseDirectionId) {
        candidatesByPhraseDirection.set(
          phraseDirectionId,
          (candidatesByPhraseDirection.get(phraseDirectionId) ?? 0) + 1,
        );
      }
    }
    if (candidates.length >= options.maxCandidates) break;
  }

  const represented = new Set(candidates.map((candidate) => candidate.sourceIssue.targetFingerprint));
  if (candidates.length >= options.maxCandidates) {
    for (const issue of considered) if (!represented.has(issue.targetFingerprint)) {
      budgetSkippedIssues.add(issue.targetFingerprint);
    }
  }
  for (const issue of considered) if (budgetSkippedIssues.has(issue.targetFingerprint)
    && !represented.has(issue.targetFingerprint)
    && !unproposedIssues.some((entry) => entry.targetFingerprint === issue.targetFingerprint)) {
      unproposedIssues.push({
        code: issue.code,
        targetFingerprint: issue.targetFingerprint,
        reason: "candidate_budget",
      });
  }

  const byKind = Object.fromEntries(TheoryProposalKindSchema.options.map((kind) => [
    kind,
    candidates.filter((candidate) => candidate.kind === kind).length,
  ])) as Record<TheoryProposalKind, number>;
  return TheoryProposalReportSchema.parse({
    schema: "vocaloid-theory-proposals/v1",
    manifestRevision: manifest.revision,
    compositionHash: manifest.composition_hash,
    rulesetId: report.rulesetId,
    rulesetHash: report.rulesetHash,
    request: options,
    constraints: {
      readOnly: true,
      corpusAndStyleAccess: "forbidden",
      applyRequiresDryRun: true,
      maxCandidatesPerIssue: 3,
      maxCandidatesPerPhraseDirection: 3,
      subjectiveSelection: "listening_review_required",
    },
    summary: {
      candidateCount: candidates.length,
      consideredIssueCount: considered.length,
      unproposedIssueCount: unproposedIssues.length,
      byKind,
    },
    candidates,
    unproposedIssues: unproposedIssues.slice(0, 256),
  });
}
