import type { SongManifest } from "../song-manifest.js";
import { harmonicFunctionForChord } from "../theory/chord.js";
import {
  buildSymbolicIndex,
  positionAtTick,
  secondsBetweenTicks,
  type SymbolicIndex,
  type SymbolicVocalEvent,
} from "../theory/events.js";
import { beatStrengthAtTick } from "../theory/rhythm.js";
import { theoryContextAtTick, timelineTick } from "../theory/timeline.js";
import { linkedVocalEvents, semanticFocusEvents } from "./audition.js";
import { optionalSongIntentHash } from "./hash.js";
import {
  CreativeReadinessReportSchema,
  type CreativeReadinessReport,
  type IntentAuditionLayerStatus,
  type IntentDirectionReport,
  type IntentDirectionReviewStatus,
  type IntentReadinessFinding,
  type IntentRealizationEvidence,
} from "./report-types.js";
import { currentTechnicalArtifactIds, resolveIntentReviewCurrentness } from "./review.js";
import {
  compositionIntentCoverage,
  summarizeCompositionIntent,
} from "./summary.js";
import {
  IntentAuditionLayerSchema,
  type PhraseDirection,
} from "./types.js";


export { compositionIntentCoverage, summarizeCompositionIntent };
export type { CompositionIntentCoverage } from "./summary.js";

const AUDITION_LAYERS = IntentAuditionLayerSchema.options;

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function uniqueIds(values: readonly string[], maximum = 256): string[] {
  return [...new Set(values)].sort().slice(0, maximum);
}

function trend(
  first: number,
  second: number,
  absoluteThreshold: number,
  relativeThreshold = 0.12,
): "increase" | "decrease" | "stable" {
  const threshold = Math.max(absoluteThreshold, Math.max(Math.abs(first), Math.abs(second)) * relativeThreshold);
  if (second - first > threshold) return "increase";
  if (first - second > threshold) return "decrease";
  return "stable";
}

function expectedRelation(expected: string, observed: string): IntentRealizationEvidence["relation"] {
  if (observed === "unmeasured" || observed === "insufficient_events" || observed === "unbound") return "unknown";
  if (expected === observed) return "supports";
  if (expected === "decrease" && observed === "resolve") return "supports";
  return "contradicts";
}

function dynamicTrajectory(
  points: readonly { tick: number; value: number }[],
  expected: string,
): { observed: string; peakPositionRatio: number; troughPositionRatio: number; distinctTicks: number } {
  const byTick = new Map<number, number>();
  for (const point of points) byTick.set(point.tick, point.value);
  const ordered = [...byTick.entries()].sort(([left], [right]) => left - right);
  if (ordered.length < 2) {
    return { observed: "unmeasured", peakPositionRatio: -1, troughPositionRatio: -1, distinctTicks: ordered.length };
  }
  const first = ordered[0]![1];
  const last = ordered.at(-1)![1];
  if (expected !== "arch" && expected !== "valley") {
    return {
      observed: trend(first, last, 3),
      peakPositionRatio: -1,
      troughPositionRatio: -1,
      distinctTicks: ordered.length,
    };
  }
  if (ordered.length < 3) {
    return { observed: "unmeasured", peakPositionRatio: -1, troughPositionRatio: -1, distinctTicks: ordered.length };
  }
  const startTick = ordered[0]![0];
  const endTick = ordered.at(-1)![0];
  const span = Math.max(1, endTick - startTick);
  const peak = ordered.reduce((selected, candidate) => candidate[1] > selected[1] ? candidate : selected);
  const trough = ordered.reduce((selected, candidate) => candidate[1] < selected[1] ? candidate : selected);
  const peakPositionRatio = (peak[0] - startTick) / span;
  const troughPositionRatio = (trough[0] - startTick) / span;
  const threshold = Math.max(3, Math.max(Math.abs(first), Math.abs(last)) * 0.06);
  const observed = peak[0] !== startTick && peak[0] !== endTick
    && peak[1] >= Math.max(first, last) + threshold
    ? "arch"
    : trough[0] !== startTick && trough[0] !== endTick
      && trough[1] <= Math.min(first, last) - threshold
      ? "valley"
      : trend(first, last, 3);
  return { observed, peakPositionRatio, troughPositionRatio, distinctTicks: ordered.length };
}

function melodyShape(events: readonly SymbolicVocalEvent[]): string {
  if (events.length < 2) return "insufficient_events";
  const first = events[0]!.noteNumber;
  const last = events.at(-1)!.noteNumber;
  if (events.length >= 3) {
    let middleMaximum = Number.NEGATIVE_INFINITY;
    let middleMinimum = Number.POSITIVE_INFINITY;
    for (const event of events.slice(1, -1)) {
      middleMaximum = Math.max(middleMaximum, event.noteNumber);
      middleMinimum = Math.min(middleMinimum, event.noteNumber);
    }
    if (middleMaximum >= Math.max(first, last) + 2) return "arch";
    if (middleMinimum <= Math.min(first, last) - 2) return "valley";
  }
  if (last - first >= 2) return "rising";
  if (first - last >= 2) return "falling";
  return "stable";
}

function splitEvents(events: readonly SymbolicVocalEvent[]): {
  first: SymbolicVocalEvent[];
  second: SymbolicVocalEvent[];
  middleTick: number;
} | null {
  if (events.length < 2) return null;
  const startTick = events[0]!.startTick;
  const endTick = Math.max(...events.map((event) => event.endTick));
  const middleTick = startTick + (endTick - startTick) / 2;
  const first = events.filter((event) => event.startTick < middleTick);
  const second = events.filter((event) => event.startTick >= middleTick);
  return first.length > 0 && second.length > 0 ? { first, second, middleTick } : null;
}

function eventRange(events: readonly SymbolicVocalEvent[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    minimum = Math.min(minimum, event.noteNumber);
    maximum = Math.max(maximum, event.noteNumber);
  }
  return events.length > 0 ? maximum - minimum : 0;
}

function meanDurationSeconds(index: SymbolicIndex, events: readonly SymbolicVocalEvent[]): number {
  if (events.length === 0) return 0;
  return events.reduce(
    (sum, event) => sum + secondsBetweenTicks(index, event.startTick, event.endTick),
    0,
  ) / events.length;
}

function observationEvidence(
  dimension: IntentRealizationEvidence["dimension"],
  feature: string,
  expected: string | number | boolean,
  observed: string | number | boolean,
  relation: IntentRealizationEvidence["relation"],
  objectIds: readonly string[],
  details: IntentRealizationEvidence["details"] = {},
  confidence = 1,
): IntentRealizationEvidence {
  return {
    dimension,
    feature,
    expected,
    observed,
    relation,
    confidence,
    evidenceLevel: "symbolic_exact",
    objectIds: uniqueIds(objectIds),
    details,
  };
}

function dynamicsValues(
  manifest: SongManifest,
  events: readonly SymbolicVocalEvent[],
  direction: PhraseDirection,
): Array<{ tick: number; value: number; id: string }> {
  if (events.length === 0) return [];
  const startTick = events[0]!.startTick;
  const endTick = Math.max(...events.map((event) => event.endTick));
  const partIds = new Set(events.map((event) => event.partId));
  const gestureIds = new Set(direction.realization_links?.tuning_gesture_ids ?? []);
  const selected: Array<{ tick: number; value: number; id: string }> = [];
  for (const track of manifest.vocal_tracks) for (const part of track.parts) {
    if (!partIds.has(part.id)) continue;
    for (const curve of part.control_curves) {
      if (curve.curve !== "DYN") continue;
      for (const point of curve.points) {
        const tick = timelineTick(manifest, point.position);
        if (tick >= startTick && tick <= endTick) selected.push({ tick, value: point.value, id: point.id });
      }
    }
    for (const gesture of part.tuning_gestures ?? []) {
      if (gesture.type !== "dynamics_arc" || !gestureIds.has(gesture.id)) continue;
      selected.push(
        { tick: startTick, value: gesture.start_value, id: gesture.id },
        { tick: endTick, value: gesture.end_value, id: gesture.id },
      );
    }
  }
  return selected.sort((left, right) => left.tick - right.tick || left.id.localeCompare(right.id));
}

function harmonicTensionObservation(
  index: SymbolicIndex,
  direction: PhraseDirection,
  startTick: number,
  endTick: number,
): { observed: string; values: number[]; objectIds: string[] } {
  const linkedChordIds = new Set(direction.realization_links?.chord_ids ?? []);
  const chords = index.timeline.chords.filter((chord) => chord.endTick > startTick && chord.startTick < endTick
    && (linkedChordIds.size === 0 || linkedChordIds.has(chord.id)));
  const scored = chords.flatMap((chord) => {
    const parsedChord = chord.value.parsed;
    const scale = theoryContextAtTick(index.timeline, chord.startTick).key?.value.parsed;
    if (!parsedChord?.exact || !scale) return [];
    const harmonicFunction = harmonicFunctionForChord(parsedChord, scale);
    const value = harmonicFunction === "tonic"
      ? 0
      : harmonicFunction === "predominant"
        ? 0.5
        : harmonicFunction === "dominant"
          ? 1
          : 0.75;
    return [{ value, id: chord.id }];
  });
  if (scored.length < 2) {
    return { observed: "unmeasured", values: scored.map((entry) => entry.value), objectIds: scored.map((entry) => entry.id) };
  }
  const values = scored.map((entry) => entry.value);
  const last = values.at(-1)!;
  const earlierMaximum = Math.max(...values.slice(0, -1));
  const observed = last <= 0.25 && earlierMaximum >= 0.75
    ? "resolve"
    : last >= 0.75 && trend(values[0]!, last, 0.2) !== "decrease"
      ? "withhold"
      : trend(values[0]!, last, 0.2);
  return { observed, values, objectIds: scored.map((entry) => entry.id) };
}

function phraseEvidence(
  manifest: SongManifest,
  index: SymbolicIndex,
  direction: PhraseDirection,
  events: readonly SymbolicVocalEvent[],
  focusEvents: readonly SymbolicVocalEvent[],
): IntentRealizationEvidence[] {
  const evidence: IntentRealizationEvidence[] = [];
  const links = direction.realization_links;
  const linkedIds = links ? Object.values(links).flatMap((values) => values ?? []) : [];
  evidence.push(observationEvidence(
    "binding",
    "realization.binding",
    "stable score objects",
    events.length > 0 ? `${events.length} linked vocal event(s)` : "unbound",
    events.length > 0 ? "supports" : "unknown",
    linkedIds,
    { linked_vocal_events: events.length },
  ));
  evidence.push(observationEvidence(
    "semantic_focus",
    "semantic_focus.binding",
    direction.semantic_focus,
    focusEvents.length > 0 ? `${focusEvents.length} located focus event(s)` : "unbound",
    focusEvents.length > 0 ? "supports" : "unknown",
    focusEvents.flatMap((event) => [event.id, ...(event.lyricUnitId ? [event.lyricUnitId] : [])]),
    { focus_events: focusEvents.length },
  ));
  if (events.length === 0) return evidence;

  const hypothesis = direction.realization_hypothesis;
  const targets = hypothesis?.symbolic_targets;
  const eventIds = events.map((event) => event.id);
  const split = splitEvents(events);
  const shape = melodyShape(events);
  if (targets?.melody_contour) {
    evidence.push(observationEvidence(
      "melody", "melody.contour", targets.melody_contour, shape,
      expectedRelation(targets.melody_contour, shape), eventIds,
      { first_note: events[0]!.noteNumber, last_note: events.at(-1)!.noteNumber },
    ));
  } else {
    evidence.push(observationEvidence(
      "melody", "melody.observation", hypothesis?.melody ?? "not declared",
      `contour=${shape}; range=${eventRange(events)} semitones`, "unknown", eventIds,
      { contour: shape, range_semitones: eventRange(events) },
    ));
  }
  if (targets?.melody_range) {
    const firstRange = split ? eventRange(split.first) : 0;
    const secondRange = split ? eventRange(split.second) : 0;
    const observed = !split ? "insufficient_events" : secondRange - firstRange >= 2
      ? "expand"
      : firstRange - secondRange >= 2
        ? "contract"
        : "stable";
    evidence.push(observationEvidence(
      "melody", "melody.range_trajectory", targets.melody_range, observed,
      expectedRelation(targets.melody_range, observed), eventIds,
      { first_range: firstRange, second_range: secondRange },
    ));
  }

  const firstDensity = split
    ? split.first.length / Math.max(0.001, secondsBetweenTicks(index, events[0]!.startTick, split.middleTick))
    : 0;
  const secondDensity = split
    ? split.second.length / Math.max(0.001, secondsBetweenTicks(index, split.middleTick, events.at(-1)!.endTick))
    : 0;
  if (targets?.rhythm_density) {
    const observed = split ? trend(firstDensity, secondDensity, 0.25) : "insufficient_events";
    evidence.push(observationEvidence(
      "rhythm", "rhythm.onset_density_trajectory", targets.rhythm_density, observed,
      expectedRelation(targets.rhythm_density, observed), eventIds,
      { first_onsets_per_second: Number(firstDensity.toFixed(4)), second_onsets_per_second: Number(secondDensity.toFixed(4)) },
    ));
  }
  if (targets?.note_duration) {
    const firstDuration = split ? meanDurationSeconds(index, split.first) : 0;
    const secondDuration = split ? meanDurationSeconds(index, split.second) : 0;
    const rawTrend = split ? trend(firstDuration, secondDuration, 0.03) : "insufficient_events";
    const observed = rawTrend === "increase" ? "lengthen" : rawTrend === "decrease" ? "shorten" : rawTrend;
    evidence.push(observationEvidence(
      "rhythm", "rhythm.note_duration_trajectory", targets.note_duration, observed,
      expectedRelation(targets.note_duration, observed), eventIds,
      { first_mean_seconds: Number(firstDuration.toFixed(4)), second_mean_seconds: Number(secondDuration.toFixed(4)) },
    ));
  }
  if (!targets?.rhythm_density && !targets?.note_duration) {
    evidence.push(observationEvidence(
      "rhythm", "rhythm.observation", hypothesis?.rhythm ?? "not declared",
      `first_density=${firstDensity.toFixed(2)}; second_density=${secondDensity.toFixed(2)}`,
      "unknown", eventIds,
      { first_onsets_per_second: Number(firstDensity.toFixed(4)), second_onsets_per_second: Number(secondDensity.toFixed(4)) },
    ));
  }

  const startTick = events[0]!.startTick;
  const endTick = Math.max(...events.map((event) => event.endTick));
  const harmonic = harmonicTensionObservation(index, direction, startTick, endTick);
  if (targets?.harmonic_tension) {
    evidence.push(observationEvidence(
      "harmony", "harmony.tension_trajectory", targets.harmonic_tension, harmonic.observed,
      expectedRelation(targets.harmonic_tension, harmonic.observed), harmonic.objectIds,
      { samples: harmonic.values.length, first_tension: harmonic.values[0] ?? -1, last_tension: harmonic.values.at(-1) ?? -1 },
      harmonic.values.length >= 2 ? 0.85 : 0,
    ));
  } else {
    evidence.push(observationEvidence(
      "harmony", "harmony.observation", hypothesis?.harmony ?? "not declared", harmonic.observed,
      "unknown", harmonic.objectIds, { samples: harmonic.values.length }, harmonic.values.length >= 2 ? 0.85 : 0,
    ));
  }

  const dynamics = dynamicsValues(manifest, events, direction);
  const dynamicsTrajectory = dynamicTrajectory(dynamics, targets?.delivery_dynamics ?? "stable");
  const dynamicsObserved = dynamicsTrajectory.observed;
  if (targets?.delivery_dynamics) {
    evidence.push(observationEvidence(
      "delivery", "delivery.dynamic_trajectory", targets.delivery_dynamics, dynamicsObserved,
      expectedRelation(targets.delivery_dynamics, dynamicsObserved), dynamics.map((entry) => entry.id),
      {
        samples: dynamics.length,
        distinct_ticks: dynamicsTrajectory.distinctTicks,
        start_value: dynamics[0]?.value ?? -1,
        end_value: dynamics.at(-1)?.value ?? -1,
        peak_position_ratio: Number(dynamicsTrajectory.peakPositionRatio.toFixed(6)),
        trough_position_ratio: Number(dynamicsTrajectory.troughPositionRatio.toFixed(6)),
      },
      dynamicsTrajectory.distinctTicks >= (targets.delivery_dynamics === "arch" || targets.delivery_dynamics === "valley" ? 3 : 2) ? 1 : 0,
    ));
  } else {
    evidence.push(observationEvidence(
      "delivery", "delivery.observation", hypothesis?.dynamics ?? hypothesis?.tuning ?? "not declared",
      dynamicsObserved, "unknown", dynamics.map((entry) => entry.id), { dynamic_samples: dynamics.length },
      dynamics.length >= 2 ? 1 : 0,
    ));
  }

  const arrangementFirst = index.arrangementEvents.filter((event) => event.startTick >= startTick
    && event.startTick < (split?.middleTick ?? endTick)).length
    + index.drumEvents.filter((event) => event.startTick >= startTick
      && event.startTick < (split?.middleTick ?? endTick)).length;
  const arrangementSecond = split
    ? index.arrangementEvents.filter((event) => event.startTick >= split.middleTick && event.startTick < endTick).length
      + index.drumEvents.filter((event) => event.startTick >= split.middleTick && event.startTick < endTick).length
    : 0;
  const arrangementObserved = split
    ? trend(arrangementFirst, arrangementSecond, 1)
    : "insufficient_events";
  const arrangementObjectIds = uniqueIds([
    ...(direction.realization_links?.track_ids ?? []),
    ...index.arrangementEvents.filter((event) => event.startTick >= startTick && event.startTick < endTick)
      .map((event) => event.trackId),
    ...index.drumEvents.filter((event) => event.startTick >= startTick && event.startTick < endTick)
      .map((event) => event.trackId),
  ]);
  if (targets?.arrangement_density) {
    evidence.push(observationEvidence(
      "arrangement", "arrangement.density_trajectory", targets.arrangement_density, arrangementObserved,
      expectedRelation(targets.arrangement_density, arrangementObserved), arrangementObjectIds,
      { first_onsets: arrangementFirst, second_onsets: arrangementSecond },
    ));
  } else {
    evidence.push(observationEvidence(
      "arrangement", "arrangement.observation", hypothesis?.arrangement_space ?? "not declared",
      `first_onsets=${arrangementFirst}; second_onsets=${arrangementSecond}`,
      "unknown", arrangementObjectIds, { first_onsets: arrangementFirst, second_onsets: arrangementSecond },
    ));
  }

  if (targets?.semantic_focus_duration_ratio_min !== undefined) {
    const overallDuration = meanDurationSeconds(index, events);
    const focusDuration = meanDurationSeconds(index, focusEvents);
    const observed = focusEvents.length > 0 && overallDuration > 0 ? focusDuration / overallDuration : -1;
    evidence.push(observationEvidence(
      "semantic_focus", "semantic_focus.duration_ratio", targets.semantic_focus_duration_ratio_min,
      observed < 0 ? "unbound" : Number(observed.toFixed(6)),
      observed < 0 ? "unknown" : observed >= targets.semantic_focus_duration_ratio_min ? "supports" : "contradicts",
      focusEvents.map((event) => event.id), { focus_events: focusEvents.length },
    ));
  }
  if (targets?.semantic_focus_beat_strength_min !== undefined) {
    const observed = focusEvents.length > 0
      ? Math.max(...focusEvents.map((event) => beatStrengthAtTick(manifest, event.startTick).strength))
      : -1;
    evidence.push(observationEvidence(
      "semantic_focus", "semantic_focus.beat_strength", targets.semantic_focus_beat_strength_min,
      observed < 0 ? "unbound" : observed,
      observed < 0 ? "unknown" : observed >= targets.semantic_focus_beat_strength_min ? "supports" : "contradicts",
      focusEvents.map((event) => event.id), { focus_events: focusEvents.length },
    ));
  }
  return evidence;
}

function directionReview(
  manifest: SongManifest,
  direction: PhraseDirection,
  currentArtifactIds: ReadonlySet<string>,
): { status: IntentDirectionReviewStatus; evidence?: IntentRealizationEvidence } {
  const notes = (manifest.review_notes ?? [])
    .filter((note) => note.intent_fidelity?.phrase_direction_id === direction.id)
    .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id));
  const context = {
    ...(manifest.composition_intent ? { compositionIntent: manifest.composition_intent } : {}),
    compositionHash: manifest.composition_hash,
    artifacts: manifest.artifacts,
    currentArtifactIds,
  };
  const resolved = notes.map((note) => ({
    note,
    currentness: resolveIntentReviewCurrentness(note.intent_fidelity!, context),
  }));
  const selected = resolved.find((entry) => entry.currentness.current);
  if (!selected) {
    const newest = resolved[0];
    return {
      status: {
        state: newest ? "stale" : "missing",
        humanConfirmed: false,
        staleReasons: newest?.currentness.reasons ?? [],
        ...(newest ? {
          reviewNoteId: newest.note.id,
          authorType: newest.note.author_type,
          outcome: newest.currentness.outcome,
          ...(newest.note.intent_fidelity?.layer_assessment
            ? { layerAssessment: newest.note.intent_fidelity.layer_assessment }
            : {}),
        } : {}),
      },
    };
  }
  const relation = selected.currentness.outcome === "keep"
    ? "supports"
    : selected.currentness.outcome === "reject"
      ? "contradicts"
      : "mixed";
  return {
    status: {
      state: `current_${selected.currentness.outcome}`,
      reviewNoteId: selected.note.id,
      authorType: selected.note.author_type,
      outcome: selected.currentness.outcome,
      ...(selected.note.intent_fidelity?.layer_assessment
        ? { layerAssessment: selected.note.intent_fidelity.layer_assessment }
        : {}),
      humanConfirmed: selected.note.author_type === "human" && selected.currentness.outcome === "keep",
      staleReasons: [],
    },
    evidence: {
      dimension: "review",
      feature: "review.listening_outcome",
      expected: direction.listening_question.question,
      observed: selected.note.observation.slice(0, 2000),
      relation,
      confidence: 1,
      evidenceLevel: selected.note.author_type === "human" ? "human_verified" : "agent_verified",
      objectIds: uniqueIds([direction.id, selected.note.id, ...selected.note.artifact_ids]),
      details: {
        outcome: selected.currentness.outcome,
        author_type: selected.note.author_type,
      },
    },
  };
}

function auditionLayers(
  manifest: SongManifest,
  direction: PhraseDirection,
  intentHash: string,
  currentArtifactIds: ReadonlySet<string>,
): IntentAuditionLayerStatus[] {
  return AUDITION_LAYERS.map((layer) => {
    const candidates = manifest.artifacts.filter((artifact) => artifact.role === "preview"
      && artifact.metadata.audition_kind === "anchor_passage"
      && artifact.metadata.phrase_direction_id === direction.id
      && artifact.metadata.audition_layer === layer);
    const current = candidates.filter((artifact) => currentArtifactIds.has(artifact.id)
      && artifact.metadata.intent_hash === intentHash
      && artifact.metadata.listening_question_id === direction.listening_question.id);
    return {
      layer,
      state: current.length > 0 ? "current" : candidates.length > 0 ? "stale" : "missing",
      artifactIds: uniqueIds(candidates.map((artifact) => artifact.id), 64),
      currentArtifactIds: uniqueIds(current.map((artifact) => artifact.id), 64),
      durationSeconds: current
        .map((artifact) => artifact.metadata.passage_duration_seconds)
        .filter((duration): duration is number => typeof duration === "number")
        .slice(0, 64),
    };
  });
}

function finding(
  code: string,
  message: string,
  objectIds: readonly string[],
  phraseDirectionId?: string,
  severity: "warning" | "info" = "warning",
): IntentReadinessFinding {
  return {
    code,
    severity,
    message,
    objectIds: uniqueIds(objectIds),
    ...(phraseDirectionId ? { phraseDirectionId } : {}),
  };
}

export function analyzeCompositionIntent(manifest: SongManifest): CreativeReadinessReport {
  const intent = manifest.composition_intent;
  const intentHash = optionalSongIntentHash(intent);
  const baseCoverage = compositionIntentCoverage(intent, manifest.sections.map((section) => section.id));
  if (!intent || !intentHash) {
    return CreativeReadinessReportSchema.parse({
      schema: "vocaloid-creative-readiness/v1",
      manifestRevision: manifest.revision,
      intentHash: null,
      compositionHash: manifest.composition_hash,
      status: "missing_intent",
      coverage: {
        song: 0,
        sections: baseCoverage.sections,
        anchorPhrases: 0,
        realizationLinks: 0,
        semanticFocus: 0,
        currentReviews: 0,
        currentAuditionLadders: 0,
      },
      counts: {
        sections: manifest.sections.length,
        sectionIntents: 0,
        phraseDirections: 0,
        anchorPhrases: 0,
        boundAnchorPhrases: 0,
        semanticFocusBoundAnchors: 0,
        currentKeepReviews: 0,
        humanConfirmedAnchors: 0,
        currentRequiredLadders: 0,
      },
      directions: [],
      findings: [finding(
        "COMPOSITION_INTENT_MISSING",
        "No song/section/phrase creative declaration exists; symbolic analysis cannot invent it.",
        manifest.sections.map((section) => section.id),
      )],
    });
  }

  const index = buildSymbolicIndex(manifest);
  const currentArtifactIds = currentTechnicalArtifactIds(
    manifest.artifacts,
    manifest.composition_hash,
    manifest.mix_hash,
  );
  const sectionIntentByTarget = new Map(intent.sections.map((section) => [section.section_id, section]));
  const findings: IntentReadinessFinding[] = [];
  for (const section of manifest.sections) {
    if (!sectionIntentByTarget.has(section.id)) {
      findings.push(finding(
        "SECTION_INTENT_MISSING",
        `Section ${section.id} has no declared dramatic function or transition.`,
        [section.id],
      ));
    }
  }
  const anchors = intent.phrase_directions.filter((direction) => direction.importance === "anchor");
  if (anchors.length === 0) {
    findings.push(finding(
      "ANCHOR_PHRASE_DIRECTION_MISSING",
      "The song has no anchor phrase with one registered listening question.",
      manifest.sections.map((section) => section.id),
    ));
  }

  const directions: IntentDirectionReport[] = intent.phrase_directions.map((direction) => {
    const events = linkedVocalEvents(direction, index.vocalEvents);
    const focus = semanticFocusEvents(direction, events);
    const linkedObjectIds = direction.realization_links
      ? Object.values(direction.realization_links).flatMap((values) => values ?? [])
      : [];
    const evidence = phraseEvidence(manifest, index, direction, events, focus);
    const review = directionReview(manifest, direction, currentArtifactIds);
    if (review.evidence) evidence.push(review.evidence);
    const layers = auditionLayers(manifest, direction, intentHash, currentArtifactIds);
    if (direction.importance === "anchor" && events.length === 0) {
      findings.push(finding(
        "ANCHOR_PHRASE_UNBOUND",
        `Anchor ${direction.id} has no linked vocal event/phrase/lyric realization.`,
        [direction.id],
        direction.id,
      ));
    }
    if (direction.importance === "anchor" && focus.length === 0) {
      findings.push(finding(
        "SEMANTIC_FOCUS_UNBOUND",
        `Anchor ${direction.id} does not locate its semantic focus on a lyric unit or vocal event.`,
        [direction.id],
        direction.id,
      ));
    }
    const contradictions = evidence.filter((entry) => entry.relation === "contradicts"
      && entry.evidenceLevel === "symbolic_exact");
    if (contradictions.length > 0) {
      findings.push(finding(
        "REALIZATION_TRAJECTORY_MISMATCH",
        `${direction.id} contradicts ${contradictions.length} declared symbolic target(s); revise the realization or explicitly revise the hypothesis.`,
        [direction.id, ...contradictions.flatMap((entry) => entry.objectIds)],
        direction.id,
      ));
    }
    if (direction.importance === "anchor" && review.status.state === "missing") {
      findings.push(finding(
        "INTENT_REVIEW_MISSING",
        `Anchor ${direction.id} has no explicit listening outcome for ${direction.listening_question.id}.`,
        [direction.id, direction.listening_question.id],
        direction.id,
      ));
    } else if (direction.importance === "anchor" && review.status.state === "stale") {
      findings.push(finding(
        "INTENT_REVIEW_STALE",
        `Anchor ${direction.id}'s newest listening outcome is stale: ${review.status.staleReasons.join(", ")}.`,
        [direction.id, ...(review.status.reviewNoteId ? [review.status.reviewNoteId] : [])],
        direction.id,
      ));
    }
    if (direction.importance === "anchor") {
      const missingRequired = layers.filter((layer) => ["lead_solo", "lead_harmony", "minimal_band"].includes(layer.layer)
        && layer.state !== "current");
      if (missingRequired.length > 0) {
        findings.push(finding(
          "ANCHOR_AUDITION_LADDER_INCOMPLETE",
          `${direction.id} lacks current ${missingRequired.map((layer) => layer.layer).join(", ")} audition layer(s).`,
          [direction.id, ...missingRequired.flatMap((layer) => layer.artifactIds)],
          direction.id,
          "info",
        ));
      }
      const invalidDurations = layers.flatMap((layer) => layer.durationSeconds).filter((duration) => duration < 20 || duration > 30);
      if (invalidDurations.length > 0) {
        findings.push(finding(
          "ANCHOR_PASSAGE_DURATION_OUTSIDE_TARGET",
          `${direction.id} has current audition material outside the 20–30 second target.`,
          [direction.id],
          direction.id,
          "info",
        ));
      }
    }
    const startTick = events[0]?.startTick;
    const endTick = events.length > 0 ? Math.max(...events.map((event) => event.endTick)) : undefined;
    const inheritedFrom = ["song", ...(sectionIntentByTarget.get(direction.section_id)
      ? [sectionIntentByTarget.get(direction.section_id)!.id]
      : [])];
    return {
      phraseDirectionId: direction.id,
      sectionId: direction.section_id,
      importance: direction.importance,
      inheritedFrom,
      listeningQuestionId: direction.listening_question.id,
      binding: {
        bound: events.length > 0,
        semanticFocusBound: focus.length > 0,
        linkedObjectIds: uniqueIds(linkedObjectIds),
        linkedVocalEventIds: uniqueIds(events.map((event) => event.id), 20_000),
        ...(startTick !== undefined && endTick !== undefined ? {
          startPosition: positionAtTick(manifest, startTick),
          endPosition: positionAtTick(manifest, endTick),
          durationSeconds: Number(secondsBetweenTicks(index, startTick, endTick).toFixed(6)),
        } : {}),
      },
      evidence,
      review: review.status,
      auditionLayers: layers,
    };
  }).sort((left, right) => Number(right.importance === "anchor") - Number(left.importance === "anchor")
    || left.sectionId.localeCompare(right.sectionId)
    || left.phraseDirectionId.localeCompare(right.phraseDirectionId));

  const anchorReports = directions.filter((direction) => direction.importance === "anchor");
  const boundAnchors = anchorReports.filter((direction) => direction.binding.bound).length;
  const focusBoundAnchors = anchorReports.filter((direction) => direction.binding.semanticFocusBound).length;
  const currentReviews = anchorReports.filter((direction) => direction.review.state.startsWith("current_")).length;
  const currentKeepReviews = anchorReports.filter((direction) => direction.review.state === "current_keep").length;
  const humanConfirmedAnchors = anchorReports.filter((direction) => direction.review.humanConfirmed).length;
  const currentRequiredLadders = anchorReports.filter((direction) => direction.auditionLayers
    .filter((layer) => ["lead_solo", "lead_harmony", "minimal_band"].includes(layer.layer))
    .every((layer) => layer.state === "current"
      && layer.durationSeconds.some((duration) => duration >= 20 && duration <= 30))).length;
  const hasTrajectoryMismatch = findings.some((entry) => entry.code === "REALIZATION_TRAJECTORY_MISMATCH");
  const structurallyComplete = baseCoverage.sections === 1
    && anchors.length > 0
    && boundAnchors === anchors.length
    && focusBoundAnchors === anchors.length
    && !hasTrajectoryMismatch;
  const revisionRequested = anchorReports.some((direction) =>
    direction.review.state === "current_reject" || direction.review.state === "current_revise");
  const ready = structurallyComplete
    && currentKeepReviews === anchors.length
    && currentRequiredLadders === anchors.length;
  const status = !structurallyComplete
    ? "incomplete"
    : revisionRequested
      ? "revision_requested"
      : ready
        ? "ready"
        : "awaiting_listening";
  findings.sort((left, right) => left.code.localeCompare(right.code)
    || (left.phraseDirectionId ?? "").localeCompare(right.phraseDirectionId ?? "")
    || left.objectIds.join("\u0000").localeCompare(right.objectIds.join("\u0000")));
  return CreativeReadinessReportSchema.parse({
    schema: "vocaloid-creative-readiness/v1",
    manifestRevision: manifest.revision,
    intentHash,
    compositionHash: manifest.composition_hash,
    status,
    coverage: {
      song: baseCoverage.song,
      sections: baseCoverage.sections,
      anchorPhrases: baseCoverage.anchorPhrases,
      realizationLinks: baseCoverage.realizationLinks,
      semanticFocus: ratio(focusBoundAnchors, anchors.length),
      currentReviews: ratio(currentReviews, anchors.length),
      currentAuditionLadders: ratio(currentRequiredLadders, anchors.length),
    },
    counts: {
      sections: baseCoverage.sectionCount,
      sectionIntents: baseCoverage.sectionIntentCount,
      phraseDirections: baseCoverage.phraseDirectionCount,
      anchorPhrases: anchors.length,
      boundAnchorPhrases: boundAnchors,
      semanticFocusBoundAnchors: focusBoundAnchors,
      currentKeepReviews,
      humanConfirmedAnchors,
      currentRequiredLadders,
    },
    directions,
    findings,
  });
}
