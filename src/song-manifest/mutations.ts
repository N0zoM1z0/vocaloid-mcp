import { createHash } from "node:crypto";
import { z } from "zod";

import { assertCurrentIntentFidelityReviewBasis } from "../intent/review.js";
import {
  CompositionIntentSchema,
  PhraseDirectionSchema,
  PhraseRealizationLinksSchema,
  SectionCreativeIntentSchema,
} from "../intent/types.js";
import { assertTheoryExceptionApplicable } from "../theory/policy.js";
import { CompositionGuidanceSchema, TheoryExceptionSchema } from "../theory/types.js";
import { type CurveName } from "../types.js";
import { rhythmValueTicks } from "../vocal-phrase.js";
import { type MusicalPosition, musicalTickToPosition } from "../vsqx.js";
import { compileManifestPhrase } from "./build.js";
import {
  IdSchema,
  ManifestArrangementTrackSchema,
  ManifestArtifactSchema,
  ManifestEffectChainSchema,
  type ManifestGroove,
  ManifestGrooveSchema,
  ManifestPositionSchema,
  ManifestRemovalSchema,
  type ManifestReviewNote,
  ManifestReviewNoteInputSchema,
  ManifestReviewNoteSchema,
  ManifestSectionDynamicsSchema,
  ManifestSectionSchema,
  ManifestTimelineUpdateSchema,
  ManifestTransformSchema,
  ManifestTuningGestureSchema,
  ManifestVibratoSchema,
  ManifestVocalPartSchema,
  ManifestVocalPhraseSchema,
  ManifestVocalTrackMetadataSchema,
  ManifestVoiceSchema,
  type SongManifest,
} from "./schema.js";
import {
  assertUniqueIds,
  currentMixArtifactIds,
  loadSongManifest,
  mutateManifest,
  positionTick,
} from "./store.js";

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

export async function setSongManifestCompositionIntent(
  inputPath: string,
  outputPath: string,
  expectedRevision: number,
  intentInput: z.input<typeof CompositionIntentSchema>,
  overwrite: boolean,
) {
  const intent = CompositionIntentSchema.parse(intentInput);
  return mutateManifest(inputPath, outputPath, expectedRevision, overwrite, (draft) => {
    draft.composition_intent = intent;
  });
}

async function currentTheoryReportForGuidance(inputPath: string, expectedRevision: number) {
  const loaded = await loadSongManifest(inputPath);
  if (loaded.manifest.revision !== expectedRevision) {
    throw new Error(
      `Stale manifest revision ${expectedRevision}; current revision is ${loaded.manifest.revision} `
      + `(${loaded.manifest.content_hash}). Inspect again before applying policy.`,
    );
  }
  const { analyzeManifestTheory } = await import("../theory/analyze.js");
  return { loaded, report: analyzeManifestTheory(loaded.manifest) };
}

export async function setSongManifestCompositionGuidance(
  inputPath: string,
  outputPath: string,
  expectedRevision: number,
  guidanceInput: z.input<typeof CompositionGuidanceSchema>,
  overwrite: boolean,
) {
  const guidance = CompositionGuidanceSchema.parse(guidanceInput);
  const { report } = await currentTheoryReportForGuidance(inputPath, expectedRevision);
  if (guidance.theory_ruleset_id !== report.rulesetId) {
    throw new Error(
      `Unsupported theory ruleset ${guidance.theory_ruleset_id}; current analyzer is ${report.rulesetId}`,
    );
  }
  const currentIssues = [...report.issues, ...report.ignoredIssues];
  for (const exception of guidance.exceptions) {
    assertTheoryExceptionApplicable(
      exception,
      currentIssues,
      report.rulesetId,
      guidance.theory_ruleset_id,
    );
  }
  return mutateManifest(inputPath, outputPath, expectedRevision, overwrite, (draft) => {
    draft.composition_guidance = {
      ...guidance,
      exceptions: [...guidance.exceptions].sort((left, right) => left.id.localeCompare(right.id)),
    };
  });
}

export async function upsertSongManifestTheoryException(
  inputPath: string,
  outputPath: string,
  expectedRevision: number,
  exceptionInput: z.input<typeof TheoryExceptionSchema>,
  overwrite: boolean,
) {
  const exception = TheoryExceptionSchema.parse(exceptionInput);
  const { loaded, report } = await currentTheoryReportForGuidance(inputPath, expectedRevision);
  const guidance = loaded.manifest.composition_guidance;
  if (!guidance) {
    throw new Error("Manifest has no composition_guidance; set the theory/review policy before adding an exception");
  }
  assertTheoryExceptionApplicable(
    exception,
    [...report.issues, ...report.ignoredIssues],
    report.rulesetId,
    guidance.theory_ruleset_id,
  );
  return mutateManifest(inputPath, outputPath, expectedRevision, overwrite, (draft) => {
    if (!draft.composition_guidance) {
      throw new Error("Manifest composition_guidance disappeared before exception write");
    }
    const index = draft.composition_guidance.exceptions.findIndex(
      (candidate) => candidate.id === exception.id,
    );
    if (index >= 0) draft.composition_guidance.exceptions[index] = exception;
    else draft.composition_guidance.exceptions.push(exception);
    draft.composition_guidance.exceptions.sort((left, right) => left.id.localeCompare(right.id));
  });
}

export async function upsertSongManifestSectionIntent(
  inputPath: string,
  outputPath: string,
  expectedRevision: number,
  sectionIntentInput: z.input<typeof SectionCreativeIntentSchema>,
  overwrite: boolean,
) {
  const sectionIntent = SectionCreativeIntentSchema.parse(sectionIntentInput);
  return mutateManifest(inputPath, outputPath, expectedRevision, overwrite, (draft) => {
    if (!draft.composition_intent) {
      throw new Error("Manifest has no composition_intent; set the song intent contract first");
    }
    const index = draft.composition_intent.sections.findIndex(
      (candidate) => candidate.id === sectionIntent.id || candidate.section_id === sectionIntent.section_id,
    );
    if (index >= 0) draft.composition_intent.sections[index] = sectionIntent;
    else draft.composition_intent.sections.push(sectionIntent);
    draft.composition_intent.sections.sort(
      (left, right) => left.section_id.localeCompare(right.section_id) || left.id.localeCompare(right.id),
    );
  });
}

export async function upsertSongManifestPhraseDirection(
  inputPath: string,
  outputPath: string,
  expectedRevision: number,
  phraseDirectionInput: z.input<typeof PhraseDirectionSchema>,
  overwrite: boolean,
) {
  const phraseDirection = PhraseDirectionSchema.parse(phraseDirectionInput);
  return mutateManifest(inputPath, outputPath, expectedRevision, overwrite, (draft) => {
    if (!draft.composition_intent) {
      throw new Error("Manifest has no composition_intent; set the song intent contract first");
    }
    const index = draft.composition_intent.phrase_directions.findIndex(
      (candidate) => candidate.id === phraseDirection.id,
    );
    if (index >= 0) draft.composition_intent.phrase_directions[index] = phraseDirection;
    else draft.composition_intent.phrase_directions.push(phraseDirection);
    draft.composition_intent.phrase_directions.sort(
      (left, right) => left.section_id.localeCompare(right.section_id) || left.id.localeCompare(right.id),
    );
  });
}

export async function bindSongManifestPhraseRealization(
  inputPath: string,
  outputPath: string,
  expectedRevision: number,
  phraseDirectionId: string,
  realizationLinksInput: z.input<typeof PhraseRealizationLinksSchema>,
  overwrite: boolean,
) {
  const directionId = IdSchema.parse(phraseDirectionId);
  const realizationLinks = PhraseRealizationLinksSchema.parse(realizationLinksInput);
  return mutateManifest(inputPath, outputPath, expectedRevision, overwrite, (draft) => {
    const direction = draft.composition_intent?.phrase_directions.find(
      (candidate) => candidate.id === directionId,
    );
    if (!direction) throw new Error(`Manifest has no phrase direction ${directionId}`);
    direction.realization_links = realizationLinks;
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
  // This generated provenance may only be asserted by the gesture compiler.
  // A whole-part upsert can declare gestures for later compilation, but cannot
  // claim that their native note/curve expression has already materialized.
  part.materialized_tuning_gesture_ids = [];
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

export async function upsertSongManifestVocalPhrase(
  inputPath: string,
  outputPath: string,
  expectedRevision: number,
  vocalTrackId: string,
  vocalPartId: string,
  phraseInput: z.input<typeof ManifestVocalPhraseSchema>,
  overwrite: boolean,
) {
  const trackId = IdSchema.parse(vocalTrackId);
  const partId = IdSchema.parse(vocalPartId);
  const phrase = ManifestVocalPhraseSchema.parse(phraseInput);
  return mutateManifest(inputPath, outputPath, expectedRevision, overwrite, (draft) => {
    const track = draft.vocal_tracks.find((candidate) => candidate.id === trackId);
    if (!track) throw new Error(`Manifest has no vocal track ${trackId}`);
    const part = track.parts.find((candidate) => candidate.id === partId);
    if (!part) throw new Error(`Vocal track ${trackId} has no part ${partId}`);
    const index = part.phrases.findIndex((candidate) => candidate.id === phrase.id);
    if (index >= 0) part.phrases[index] = phrase;
    else part.phrases.push(phrase);
    part.phrases.sort((left, right) => positionTick(draft, left.start) - positionTick(draft, right.start));
  });
}

interface MutableGestureEvent {
  id: string;
  tick: number;
  duration: number;
  setVelocity(value: number): void;
  setStyle(values: Record<string, number>): void;
  setVibrato(value: z.infer<typeof ManifestVibratoSchema>): void;
}

function gesturePointId(partId: string, gestureId: string, curve: CurveName, tick: number, role: string): string {
  const suffix = createHash("sha256")
    .update(`${partId}\u0000${gestureId}\u0000${curve}\u0000${tick}\u0000${role}`)
    .digest("hex")
    .slice(0, 10);
  return `${gestureId}-${curve.toLowerCase()}-${suffix}`;
}

export async function applySongManifestTuningGestures(
  inputPath: string,
  outputPath: string,
  expectedRevision: number,
  vocalTrackId: string,
  vocalPartId: string,
  gestureInputs: z.input<typeof ManifestTuningGestureSchema>[],
  overwrite: boolean,
  materializeExisting = false,
) {
  const trackId = IdSchema.parse(vocalTrackId);
  const partId = IdSchema.parse(vocalPartId);
  const gestures = z.array(ManifestTuningGestureSchema).min(1).max(256).parse(gestureInputs);
  assertUniqueIds(gestures, "tuning gestures");
  let affectedEvents = 0;
  let styleWrites = 0;
  let velocityWrites = 0;
  let vibratoWrites = 0;
  let curvePointWrites = 0;
  const compiled: Array<{
    gesture_id: string;
    type: z.infer<typeof ManifestTuningGestureSchema>["type"];
    event_ids: string[];
    curves: CurveName[];
  }> = [];
  const result = await mutateManifest(inputPath, outputPath, expectedRevision, overwrite, (draft) => {
    const track = draft.vocal_tracks.find((candidate) => candidate.id === trackId);
    if (!track) throw new Error(`Manifest has no vocal track ${trackId}`);
    const part = track.parts.find((candidate) => candidate.id === partId);
    if (!part) throw new Error(`Vocal track ${trackId} has no part ${partId}`);
    const existingGestureIds = new Set((part.tuning_gestures ?? []).map((gesture) => gesture.id));
    const materializedGestureIds = new Set(part.materialized_tuning_gesture_ids ?? []);
    for (const gesture of gestures) {
      if (existingGestureIds.has(gesture.id)) {
        if (!materializeExisting) {
          throw new Error(
            `Tuning gesture ${gesture.id} already exists in ${partId}; set materialize_existing=true only to compile a declared but unmaterialized gesture`,
          );
        }
        if (materializedGestureIds.has(gesture.id)) {
          throw new Error(
            `Tuning gesture ${gesture.id} is already materialized in ${partId}; use a new gesture ID or replace the whole vocal part intentionally`,
          );
        }
        const declared = part.tuning_gestures?.find((candidate) => candidate.id === gesture.id);
        if (JSON.stringify(declared) !== JSON.stringify(gesture)) {
          throw new Error(
            `Tuning gesture ${gesture.id} differs from its existing declaration; replace the whole vocal part intentionally before compiling a changed gesture`,
          );
        }
      }
    }
    const partStart = positionTick(draft, part.start);
    const partEnd = positionTick(draft, part.end);
    const events = new Map<string, MutableGestureEvent>();
    for (const note of part.notes) {
      events.set(note.id, {
        id: note.id,
        tick: positionTick(draft, note.position),
        duration: note.duration,
        setVelocity: (value) => { note.velocity = value; },
        setStyle: (values) => { note.style = { ...note.style, ...values }; },
        setVibrato: (value) => { note.vibrato = value; },
      });
    }
    for (const phrase of part.phrases) {
      const phraseNotes = compileManifestPhrase(draft, phrase).notes;
      let noteIndex = 0;
      for (const cell of phrase.cells) {
        if (cell.rest) continue;
        const note = phraseNotes[noteIndex++];
        if (!note) throw new Error(`Internal phrase mapping failed for ${phrase.id}/${cell.id}`);
        events.set(cell.id, {
          id: cell.id,
          tick: positionTick(draft, note.position),
          duration: note.duration,
          setVelocity: (value) => { cell.velocity = value; },
          setStyle: (values) => { cell.style = { ...cell.style, ...values }; },
          setVibrato: (value) => { cell.vibrato = value; },
        });
      }
    }

    const resolveEvents = (ids: readonly string[]): MutableGestureEvent[] => {
      const selected = ids.map((id) => {
        const event = events.get(id);
        if (!event) {
          throw new Error(
            `Tuning target ${id} is not a voiced direct-note or phrase-cell event in ${trackId}/${partId}`,
          );
        }
        return event;
      });
      return selected.sort((left, right) => left.tick - right.tick || left.id.localeCompare(right.id));
    };

    const upsertCurvePoints = (
      curveName: CurveName,
      gestureId: string,
      candidates: Array<{ tick: number; value: number; role: string }>,
    ): void => {
      let curve = part.control_curves.find((candidate) => candidate.curve === curveName);
      if (!curve) {
        curve = {
          id: `${gestureId}-${curveName.toLowerCase()}-curve`,
          curve: curveName,
          points: [],
        };
        part.control_curves.push(curve);
      }
      for (const candidate of candidates) {
        if (candidate.tick < partStart || candidate.tick >= partEnd) {
          throw new Error(
            `${gestureId} generated ${curveName} point at tick ${candidate.tick} outside part ${partId}`,
          );
        }
        const existing = curve.points.find((point) => positionTick(draft, point.position) === candidate.tick);
        if (existing) {
          existing.value = candidate.value;
        } else {
          const position = musicalTickToPosition(draft.time_signatures, candidate.tick);
          curve.points.push({
            id: gesturePointId(partId, gestureId, curveName, candidate.tick, candidate.role),
            position: { measure: position.measure, beat: position.beat, tick: position.tick ?? 0 },
            value: candidate.value,
          });
        }
        curvePointWrites++;
      }
      curve.points.sort((left, right) => positionTick(draft, left.position) - positionTick(draft, right.position));
    };

    for (const gesture of gestures) {
      const selected = resolveEvents(gesture.event_ids);
      affectedEvents += selected.length;
      const curves: CurveName[] = [];
      if (gesture.type === "articulation") {
        const style: Record<string, number> = {};
        if (gesture.accent !== undefined) style.accent = gesture.accent;
        if (gesture.decay !== undefined) style.decay = gesture.decay;
        if (gesture.opening !== undefined) style.opening = gesture.opening;
        if (gesture.bend_depth !== undefined) style.bendDep = gesture.bend_depth;
        if (gesture.bend_length !== undefined) style.bendLen = gesture.bend_length;
        if (gesture.rise_portamento !== undefined) style.risePort = gesture.rise_portamento ? 1 : 0;
        if (gesture.fall_portamento !== undefined) style.fallPort = gesture.fall_portamento ? 1 : 0;
        for (const event of selected) {
          if (Object.keys(style).length > 0) event.setStyle(style);
          if (gesture.consonant_velocity !== undefined) event.setVelocity(gesture.consonant_velocity);
        }
        if (Object.keys(style).length > 0) styleWrites += selected.length;
        if (gesture.consonant_velocity !== undefined) velocityWrites += selected.length;
      } else if (gesture.type === "vibrato") {
        const vibrato = {
          type: gesture.vibrato_type,
          length: gesture.length_percent,
          depth: [
            { position: 0, value: gesture.depth_start },
            { position: 32_768, value: gesture.depth_peak },
            { position: 65_536, value: gesture.depth_end },
          ],
          rate: [
            { position: 0, value: gesture.rate_start },
            { position: 65_536, value: gesture.rate_end },
          ],
        };
        for (const event of selected) event.setVibrato(vibrato);
        vibratoWrites += selected.length;
      } else if (gesture.type === "opening_arc") {
        const firstTick = selected[0]!.tick;
        const finalTick = Math.max(...selected.map((event) => event.tick + event.duration - 1));
        const peakTick = firstTick + (finalTick - firstTick) * gesture.peak_position;
        const interpolate = (eventTick: number): number => {
          if (finalTick <= firstTick) return gesture.peak_value;
          if (eventTick <= peakTick) {
            const denominator = Math.max(1, peakTick - firstTick);
            const ratio = Math.max(0, Math.min(1, (eventTick - firstTick) / denominator));
            return Math.round(gesture.start_value + (gesture.peak_value - gesture.start_value) * ratio);
          }
          const denominator = Math.max(1, finalTick - peakTick);
          const ratio = Math.max(0, Math.min(1, (eventTick - peakTick) / denominator));
          return Math.round(gesture.peak_value + (gesture.end_value - gesture.peak_value) * ratio);
        };
        for (const event of selected) event.setStyle({ opening: interpolate(event.tick) });
        styleWrites += selected.length;
      } else if (gesture.type === "pitch_scoop") {
        const normalized = Math.round((gesture.depth_cents / 100 / gesture.pitch_bend_sensitivity) * 8192);
        const depth = Math.min(8191, normalized);
        const sign = gesture.direction === "up_into" || gesture.direction === "fall_away" ? -1 : 1;
        const pitchPoints: Array<{ tick: number; value: number; role: string }> = [];
        const sensitivityPoints: Array<{ tick: number; value: number; role: string }> = [];
        for (const event of selected) {
          if (event.duration < 2) throw new Error(`Pitch gesture ${gesture.id} needs event ${event.id} to last at least 2 ticks`);
          const end = event.tick + event.duration;
          const audibleEnd = end - 1;
          const span = Math.max(1, Math.round(event.duration * gesture.duration_percent / 100));
          sensitivityPoints.push({
            tick: event.tick,
            value: gesture.pitch_bend_sensitivity,
            role: `${event.id}-sensitivity`,
          });
          if (gesture.direction === "up_into" || gesture.direction === "down_into") {
            pitchPoints.push(
              { tick: event.tick, value: sign * depth, role: `${event.id}-start` },
              { tick: Math.min(audibleEnd, event.tick + span), value: 0, role: `${event.id}-settle` },
            );
          } else {
            pitchPoints.push(
              { tick: Math.max(event.tick, end - span), value: 0, role: `${event.id}-depart` },
              { tick: audibleEnd, value: sign * depth, role: `${event.id}-end` },
            );
            if (end < partEnd) pitchPoints.push({ tick: end, value: 0, role: `${event.id}-reset` });
          }
        }
        upsertCurvePoints("PBS", gesture.id, sensitivityPoints);
        upsertCurvePoints("PIT", gesture.id, pitchPoints);
        curves.push("PBS", "PIT");
      } else {
        const curveName: CurveName = gesture.type === "dynamics_arc" ? "DYN" : gesture.curve;
        const firstTick = selected[0]!.tick;
        const finalTick = Math.max(...selected.map((event) => event.tick + event.duration - 1));
        const peakTick = Math.round(firstTick + (finalTick - firstTick) * gesture.peak_position);
        upsertCurvePoints(curveName, gesture.id, [
          { tick: firstTick, value: gesture.start_value, role: "start" },
          { tick: peakTick, value: gesture.peak_value, role: "peak" },
          { tick: finalTick, value: gesture.end_value, role: "end" },
        ]);
        curves.push(curveName);
      }
      compiled.push({
        gesture_id: gesture.id,
        type: gesture.type,
        event_ids: selected.map((event) => event.id),
        curves,
      });
    }
    part.tuning_gestures = [
      ...(part.tuning_gestures ?? []),
      ...gestures.filter((gesture) => !existingGestureIds.has(gesture.id)),
    ];
    part.materialized_tuning_gesture_ids = [
      ...new Set([...(part.materialized_tuning_gesture_ids ?? []), ...gestures.map((gesture) => gesture.id)]),
    ];
  });
  return {
    ...result,
    applied: {
      gestures: gestures.length,
      affected_event_references: affectedEvents,
      style_writes: styleWrites,
      velocity_writes: velocityWrites,
      vibrato_writes: vibratoWrites,
      curve_point_writes: curvePointWrites,
      compiled,
    },
  };
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

export async function upsertSongManifestEffectChain(
  inputPath: string,
  outputPath: string,
  expectedRevision: number,
  chainInput: z.input<typeof ManifestEffectChainSchema>,
  overwrite: boolean,
) {
  const chain = ManifestEffectChainSchema.parse(chainInput);
  return mutateManifest(inputPath, outputPath, expectedRevision, overwrite, (draft) => {
    const byId = draft.mix.effect_chains.findIndex((candidate) => candidate.id === chain.id);
    const byTarget = draft.mix.effect_chains.findIndex((candidate) => candidate.target_id === chain.target_id);
    if (byTarget >= 0 && byTarget !== byId) {
      throw new Error(
        `Mix target ${chain.target_id} already uses effect chain ${draft.mix.effect_chains[byTarget]?.id}`,
      );
    }
    if (byId >= 0) draft.mix.effect_chains[byId] = chain;
    else draft.mix.effect_chains.push(chain);
  });
}

export async function upsertSongManifestSectionDynamic(
  inputPath: string,
  outputPath: string,
  expectedRevision: number,
  dynamicInput: z.input<typeof ManifestSectionDynamicsSchema>,
  overwrite: boolean,
) {
  const dynamic = ManifestSectionDynamicsSchema.parse(dynamicInput);
  return mutateManifest(inputPath, outputPath, expectedRevision, overwrite, (draft) => {
    const byId = draft.mix.section_dynamics.findIndex((candidate) => candidate.id === dynamic.id);
    const byTargetSection = draft.mix.section_dynamics.findIndex((candidate) =>
      candidate.target_id === dynamic.target_id && candidate.section_id === dynamic.section_id);
    if (byTargetSection >= 0 && byTargetSection !== byId) {
      throw new Error(
        `Mix target ${dynamic.target_id} already has section dynamics ${draft.mix.section_dynamics[byTargetSection]?.id} `
        + `for ${dynamic.section_id}`,
      );
    }
    if (byId >= 0) draft.mix.section_dynamics[byId] = dynamic;
    else draft.mix.section_dynamics.push(dynamic);
  });
}

export async function updateSongManifestTimeline(
  inputPath: string,
  outputPath: string,
  expectedRevision: number,
  updateInput: z.input<typeof ManifestTimelineUpdateSchema>,
  overwrite: boolean,
) {
  const update = ManifestTimelineUpdateSchema.parse(updateInput);
  return mutateManifest(inputPath, outputPath, expectedRevision, overwrite, (draft) => {
    if (update.time_signatures) draft.time_signatures = update.time_signatures;
    if (update.tempos) draft.tempos = update.tempos;
    if (update.sections) draft.sections = update.sections;
    if (update.key_changes) draft.harmony.key_changes = update.key_changes;
    if (update.chord_changes) draft.harmony.chord_changes = update.chord_changes;
  });
}

function deterministicUnit(seed: string, id: string, lane: string): number {
  const digest = createHash("sha256").update(`${seed}\0${id}\0${lane}`).digest();
  return digest.readUInt32BE(0) / 0xffff_ffff;
}

function deterministicSigned(seed: string, id: string, lane: string, extent: number): number {
  if (extent === 0) return 0;
  return Math.round((deterministicUnit(seed, id, lane) * 2 - 1) * extent);
}

function grooveTickDelta(
  groove: ManifestGroove,
  id: string,
  absoluteTick: number,
): { swing: number; jitter: number; total: number } {
  const gridIndex = Math.round(absoluteTick / groove.grid_ticks);
  const onGrid = Math.abs(absoluteTick - gridIndex * groove.grid_ticks) <= Math.max(1, groove.grid_ticks / 8);
  const swing = onGrid && Math.abs(gridIndex % 2) === 1
    ? Math.round((2 * groove.grid_ticks * groove.swing_percent) / 100 - groove.grid_ticks)
    : 0;
  const downbeat = absoluteTick % (groove.grid_ticks * 4) === 0;
  const jitter = groove.preserve_downbeats && downbeat
    ? 0
    : deterministicSigned(groove.seed, id, "timing", groove.timing_jitter_ticks);
  return { swing, jitter, total: swing + jitter };
}

export async function applySongManifestGroove(
  inputPath: string,
  outputPath: string,
  expectedRevision: number,
  grooveInput: z.input<typeof ManifestGrooveSchema>,
  overwrite: boolean,
) {
  const groove = ManifestGrooveSchema.parse(grooveInput);
  const selectedTracks = new Set(groove.arrangement_track_ids);
  const selectedEvents = new Set(groove.event_ids);
  const targets = new Set(groove.targets);
  const deltas: Array<{
    event_id: string;
    track_id: string;
    source: "direct" | "pattern";
    timing_ticks: number;
    swing_ticks: number;
    random_timing_ticks: number;
    velocity_delta: number;
    gate_delta_ticks: number;
  }> = [];
  const result = await mutateManifest(inputPath, outputPath, expectedRevision, overwrite, (draft) => {
    const section = groove.section_id
      ? draft.sections.find((candidate) => candidate.id === groove.section_id)
      : undefined;
    if (groove.section_id && !section) throw new Error(`Unknown section ${groove.section_id}`);
    const sectionStart = section ? positionTick(draft, section.start) : null;
    const sectionEnd = section ? positionTick(draft, section.end) : null;
    const songEnd = Math.max(...draft.sections.map((entry) => positionTick(draft, entry.end)));
    const useTrack = (id: string): boolean => selectedTracks.size === 0 || selectedTracks.has(id);
    const useEvent = (id: string, tick: number): boolean =>
      (selectedEvents.size === 0 || selectedEvents.has(id))
      && (sectionStart === null || (tick >= sectionStart && tick < (sectionEnd ?? 0)));
    const apply = (
      trackId: string,
      source: "direct" | "pattern",
      event: { id: string; duration: number; velocity: number },
      eventTick: number,
      setTick: (value: number) => void,
      boundaryTick: number,
      allowGate: boolean,
    ): void => {
      if (!useEvent(event.id, eventTick)) return;
      const timing = grooveTickDelta(groove, event.id, eventTick);
      const shifted = eventTick + timing.total;
      const velocityDelta = deterministicSigned(
        groove.seed,
        event.id,
        "velocity",
        groove.velocity_jitter,
      );
      const gatePercent = deterministicSigned(
        groove.seed,
        event.id,
        "gate",
        groove.gate_jitter_percent,
      );
      const nextDuration = allowGate
        ? Math.max(1, Math.round(event.duration * (1 + gatePercent / 100)))
        : event.duration;
      const gateDelta = nextDuration - event.duration;
      if (shifted < 0 || shifted + nextDuration > boundaryTick) {
        throw new Error(
          `Groove would move ${event.id} outside its ${source === "pattern" ? "pattern" : "song"} boundary; reduce swing/jitter/gate`,
        );
      }
      setTick(shifted);
      event.velocity = Math.max(1, Math.min(127, event.velocity + velocityDelta));
      if (allowGate) event.duration = nextDuration;
      deltas.push({
        event_id: event.id,
        track_id: trackId,
        source,
        timing_ticks: timing.total,
        swing_ticks: timing.swing,
        random_timing_ticks: timing.jitter,
        velocity_delta: velocityDelta,
        gate_delta_ticks: gateDelta,
      });
    };

    for (const track of draft.accompaniment.tracks) {
      if (!useTrack(track.id)) continue;
      if (targets.has("direct_events")) {
        const events = track.kind === "pitched" ? track.notes : track.hits;
        for (const event of events) {
          const eventTick = positionTick(draft, event.position);
          apply(
            track.id,
            "direct",
            event,
            eventTick,
            (value) => {
              const position = musicalTickToPosition(draft.time_signatures, value);
              event.position = { measure: position.measure, beat: position.beat, tick: position.tick ?? 0 };
            },
            songEnd,
            track.kind === "pitched",
          );
        }
      }
      if (targets.has("pattern_events")) {
        if (track.kind === "pitched") {
          for (const pattern of track.patterns) {
            const boundary = positionTick(draft, { measure: pattern.measures, beat: 0, tick: 0 });
            for (const event of pattern.notes) {
              const eventTick = positionTick(draft, event.offset);
              apply(track.id, "pattern", event, eventTick, (value) => {
                const position = musicalTickToPosition(draft.time_signatures, value);
                event.offset = { measure: position.measure, beat: position.beat, tick: position.tick ?? 0 };
              }, boundary, true);
            }
          }
        } else {
          for (const pattern of track.patterns) {
            const boundary = positionTick(draft, { measure: pattern.measures, beat: 0, tick: 0 });
            for (const event of pattern.hits) {
              const eventTick = positionTick(draft, event.offset);
              apply(track.id, "pattern", event, eventTick, (value) => {
                const position = musicalTickToPosition(draft.time_signatures, value);
                event.offset = { measure: position.measure, beat: position.beat, tick: position.tick ?? 0 };
              }, boundary, false);
            }
          }
        }
      }
    }
    if (selectedTracks.size > 0) {
      for (const id of selectedTracks) {
        if (!draft.accompaniment.tracks.some((track) => track.id === id)) {
          throw new Error(`Unknown arrangement track ${id}`);
        }
      }
    }
    if (deltas.length === 0) throw new Error("Groove selection matched zero arrangement events");
  });
  return {
    ...result,
    seed: groove.seed,
    parameters: groove,
    changed: deltas.length,
    deltas,
  };
}

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
    } else if (removal.object_type === "effect_chain") {
      const before = draft.mix.effect_chains.length;
      draft.mix.effect_chains = draft.mix.effect_chains.filter((chain) => !wanted.has(chain.id));
      removed = before - draft.mix.effect_chains.length;
    } else if (removal.object_type === "section_dynamic") {
      const before = draft.mix.section_dynamics.length;
      draft.mix.section_dynamics = draft.mix.section_dynamics.filter((dynamic) => !wanted.has(dynamic.id));
      removed = before - draft.mix.section_dynamics.length;
    } else if (removal.object_type === "theory_exception") {
      const before = draft.composition_guidance?.exceptions.length ?? 0;
      if (draft.composition_guidance) {
        draft.composition_guidance.exceptions = draft.composition_guidance.exceptions.filter(
          (exception) => !wanted.has(exception.id),
        );
      }
      removed = before - (draft.composition_guidance?.exceptions.length ?? 0);
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

export async function addSongManifestReviewNote(
  manifestPath: string,
  expectedRevision: number,
  noteInput: z.input<typeof ManifestReviewNoteInputSchema>,
) {
  const input = ManifestReviewNoteInputSchema.parse(noteInput);
  const note: ManifestReviewNote = ManifestReviewNoteSchema.parse({
    ...input,
    status: "open",
    created_at: new Date().toISOString(),
  });
  const result = await mutateManifest(
    manifestPath,
    manifestPath,
    expectedRevision,
    true,
    (draft) => {
      if ((draft.review_notes ?? []).some((candidate) => candidate.id === note.id)) {
        throw new Error(`Review note ${note.id} already exists; use a new stable ID`);
      }
      if (note.intent_fidelity) {
        assertCurrentIntentFidelityReviewBasis(note.intent_fidelity, {
          ...(draft.composition_intent ? { compositionIntent: draft.composition_intent } : {}),
          compositionHash: draft.composition_hash,
          artifacts: draft.artifacts,
          currentArtifactIds: currentMixArtifactIds(draft),
        });
      }
      draft.review_notes = [...(draft.review_notes ?? []), note];
    },
  );
  return { ...result, note };
}

export async function resolveSongManifestReviewNote(
  manifestPath: string,
  expectedRevision: number,
  noteId: string,
  resolution: string,
) {
  const id = IdSchema.parse(noteId);
  const text = z.string().min(1).max(4000).parse(resolution);
  let resolved: ManifestReviewNote | undefined;
  const result = await mutateManifest(
    manifestPath,
    manifestPath,
    expectedRevision,
    true,
    (draft) => {
      const note = (draft.review_notes ?? []).find((candidate) => candidate.id === id);
      if (!note) throw new Error(`No review note with stable ID ${id}`);
      if (note.status === "resolved") throw new Error(`Review note ${id} is already resolved`);
      note.status = "resolved";
      note.resolved_at = new Date().toISOString();
      note.resolution = text;
      resolved = structuredClone(note);
    },
  );
  return { ...result, note: resolved! };
}
