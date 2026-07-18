import { z } from "zod";

import type { SongManifest } from "../song-manifest.js";
import { buildSymbolicIndex, positionAtTick, secondsAtTick, type SymbolicVocalEvent } from "../theory/events.js";
import { songIntentHash } from "./hash.js";
import {
  IntentAuditionLayerSchema,
  IntentFingerprintSchema,
  IntentStableIdSchema,
  type IntentAuditionLayer,
  type PhraseDirection,
} from "./types.js";


const AnchorPassageSchema = z
  .object({
    sectionId: IntentStableIdSchema,
    coreStartTick: z.number().int().min(0),
    coreEndTick: z.number().int().min(1),
    startTick: z.number().int().min(0),
    endTick: z.number().int().min(1),
    startPosition: z.object({
      measure: z.number().int().min(0),
      beat: z.number().int().min(0),
      tick: z.number().int().min(0),
    }).strict(),
    endPosition: z.object({
      measure: z.number().int().min(0),
      beat: z.number().int().min(0),
      tick: z.number().int().min(0),
    }).strict(),
    startSeconds: z.number().min(0),
    endSeconds: z.number().gt(0),
    durationSeconds: z.number().gt(0).max(3600),
    targetDurationSeconds: z.number().min(20).max(30),
    targetDurationMet: z.boolean(),
  })
  .strict();

const AnchorAuditionStageSchema = z
  .object({
    layer: IntentAuditionLayerSchema,
    order: z.number().int().min(1).max(5),
    requiredForFirstClosure: z.boolean(),
    listeningFocus: z.string().min(1).max(1000),
  })
  .strict();

export const AnchorAuditionPlanSchema = z
  .object({
    schema: z.literal("vocaloid-anchor-audition-plan/v1"),
    manifestRevision: z.number().int().min(1),
    compositionHash: IntentFingerprintSchema,
    intentHash: IntentFingerprintSchema,
    phraseDirectionId: IntentStableIdSchema,
    listeningQuestionId: IntentStableIdSchema,
    listeningQuestion: z.string().min(1).max(2000),
    passage: AnchorPassageSchema,
    stages: z.array(AnchorAuditionStageSchema).length(5),
  })
  .strict();

export type AnchorAuditionPlan = z.infer<typeof AnchorAuditionPlanSchema>;

export function linkedVocalEvents(
  direction: PhraseDirection,
  events: readonly SymbolicVocalEvent[],
): SymbolicVocalEvent[] {
  const links = direction.realization_links;
  if (!links) return [];
  const eventIds = new Set(links.event_ids ?? []);
  const phraseIds = new Set(links.vocal_phrase_ids ?? []);
  const lyricUnitIds = new Set(links.lyric_unit_ids ?? []);
  return events.filter((event) => eventIds.has(event.id)
    || (event.phraseId !== undefined && phraseIds.has(event.phraseId))
    || (event.lyricUnitId !== undefined && lyricUnitIds.has(event.lyricUnitId)));
}

export function semanticFocusEvents(
  direction: PhraseDirection,
  events: readonly SymbolicVocalEvent[],
): SymbolicVocalEvent[] {
  const focusIds = new Set(direction.realization_links?.semantic_focus_object_ids ?? []);
  return events.filter((event) => focusIds.has(event.id)
    || (event.lyricUnitId !== undefined && focusIds.has(event.lyricUnitId)));
}

function tickAtSeconds(
  index: ReturnType<typeof buildSymbolicIndex>,
  targetSeconds: number,
): number {
  const segments = index.tempoSegments;
  let low = 0;
  let high = segments.length - 1;
  let selected = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const segment = segments[middle]!;
    if (segment.startSeconds <= targetSeconds) {
      selected = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  const segment = segments[selected];
  if (!segment) return 0;
  return Math.max(
    segment.startTick,
    Math.round(segment.startTick + ((targetSeconds - segment.startSeconds) * 480 * segment.bpm) / 60),
  );
}

export function buildAnchorAuditionPlan(
  manifest: SongManifest,
  phraseDirectionId: string,
  targetDurationSeconds = 25,
): AnchorAuditionPlan {
  const intent = manifest.composition_intent;
  if (!intent) throw new Error("ANCHOR_INTENT_MISSING: the manifest has no composition_intent");
  const direction = intent.phrase_directions.find((candidate) => candidate.id === phraseDirectionId);
  if (!direction) throw new Error(`ANCHOR_DIRECTION_MISSING: no phrase direction ${phraseDirectionId}`);
  if (direction.importance !== "anchor") {
    throw new Error(`ANCHOR_DIRECTION_REQUIRED: ${phraseDirectionId} is ${direction.importance}`);
  }
  if (!Number.isFinite(targetDurationSeconds) || targetDurationSeconds < 20 || targetDurationSeconds > 30) {
    throw new Error("targetDurationSeconds must be in 20..30");
  }
  const index = buildSymbolicIndex(manifest);
  const section = index.timeline.sections.find((candidate) => candidate.id === direction.section_id);
  if (!section) throw new Error(`ANCHOR_SECTION_MISSING: no section ${direction.section_id}`);
  const events = linkedVocalEvents(direction, index.vocalEvents);
  if (events.length === 0) {
    throw new Error(`ANCHOR_PHRASE_UNBOUND: ${phraseDirectionId} has no linked vocal events`);
  }
  const coreStartTick = Math.min(...events.map((event) => event.startTick));
  const coreEndTick = Math.max(...events.map((event) => event.endTick));
  const sectionStartSeconds = secondsAtTick(index, section.startTick);
  const sectionEndSeconds = secondsAtTick(index, section.endTick);
  const coreStartSeconds = secondsAtTick(index, coreStartTick);
  const coreEndSeconds = secondsAtTick(index, coreEndTick);
  const sectionDurationSeconds = sectionEndSeconds - sectionStartSeconds;
  const desiredDuration = Math.min(targetDurationSeconds, sectionDurationSeconds);
  const coreMiddleSeconds = (coreStartSeconds + coreEndSeconds) / 2;
  let startSeconds = coreMiddleSeconds - desiredDuration / 2;
  startSeconds = Math.max(sectionStartSeconds, Math.min(startSeconds, sectionEndSeconds - desiredDuration));
  let endSeconds = startSeconds + desiredDuration;
  if (coreStartSeconds < startSeconds) startSeconds = coreStartSeconds;
  if (coreEndSeconds > endSeconds) endSeconds = coreEndSeconds;
  startSeconds = Math.max(sectionStartSeconds, startSeconds);
  endSeconds = Math.min(sectionEndSeconds, endSeconds);
  const startTick = Math.min(coreStartTick, tickAtSeconds(index, startSeconds));
  const endTick = Math.max(coreEndTick, tickAtSeconds(index, endSeconds));
  const actualStartSeconds = secondsAtTick(index, startTick);
  const actualEndSeconds = secondsAtTick(index, endTick);
  const durationSeconds = actualEndSeconds - actualStartSeconds;
  const stages: Array<{
    layer: IntentAuditionLayer;
    order: number;
    requiredForFirstClosure: boolean;
    listeningFocus: string;
  }> = [
    {
      layer: "lead_solo",
      order: 1,
      requiredForFirstClosure: true,
      listeningFocus: "Does the isolated lead form one complete utterance with a clear semantic focus and release?",
    },
    {
      layer: "lead_harmony",
      order: 2,
      requiredForFirstClosure: true,
      listeningFocus: "Does harmony add a distinct function without obscuring the lead or its words?",
    },
    {
      layer: "minimal_band",
      order: 3,
      requiredForFirstClosure: true,
      listeningFocus: "Do bass, drums, and one harmonic instrument strengthen the phrase direction while leaving vocal space?",
    },
    {
      layer: "full_layers",
      order: 4,
      requiredForFirstClosure: false,
      listeningFocus: "Does each additional layer create an audible benefit; would muting it cause no loss?",
    },
    {
      layer: "timbre_mix",
      order: 5,
      requiredForFirstClosure: false,
      listeningFocus: "After the composition works, do timbre and mix changes clarify rather than redefine the phrase?",
    },
  ];
  return AnchorAuditionPlanSchema.parse({
    schema: "vocaloid-anchor-audition-plan/v1",
    manifestRevision: manifest.revision,
    compositionHash: manifest.composition_hash,
    intentHash: songIntentHash(intent),
    phraseDirectionId: direction.id,
    listeningQuestionId: direction.listening_question.id,
    listeningQuestion: direction.listening_question.question,
    passage: {
      sectionId: direction.section_id,
      coreStartTick,
      coreEndTick,
      startTick,
      endTick,
      startPosition: positionAtTick(manifest, startTick),
      endPosition: positionAtTick(manifest, endTick),
      startSeconds: Number(actualStartSeconds.toFixed(6)),
      endSeconds: Number(actualEndSeconds.toFixed(6)),
      durationSeconds: Number(durationSeconds.toFixed(6)),
      targetDurationSeconds,
      targetDurationMet: durationSeconds >= 20 && durationSeconds <= 30,
    },
    stages,
  });
}
