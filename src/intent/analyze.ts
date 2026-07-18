import { songIntentHash } from "./hash.js";
import type { CompositionIntent } from "./types.js";


export interface CompositionIntentCoverage {
  song: number;
  sections: number;
  anchorPhrases: number;
  realizationLinks: number;
  sectionCount: number;
  sectionIntentCount: number;
  phraseDirectionCount: number;
  anchorPhraseCount: number;
  linkedPhraseDirectionCount: number;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

export function compositionIntentCoverage(
  intent: CompositionIntent | undefined,
  sectionIds: readonly string[],
): CompositionIntentCoverage {
  if (!intent) {
    return {
      song: 0,
      sections: sectionIds.length === 0 ? 1 : 0,
      anchorPhrases: 0,
      realizationLinks: 0,
      sectionCount: sectionIds.length,
      sectionIntentCount: 0,
      phraseDirectionCount: 0,
      anchorPhraseCount: 0,
      linkedPhraseDirectionCount: 0,
    };
  }
  const targetSections = new Set(sectionIds);
  const sectionIntentCount = intent.sections.filter((entry) => targetSections.has(entry.section_id)).length;
  const anchorPhraseCount = intent.phrase_directions.filter((entry) => entry.importance === "anchor").length;
  const linkedPhraseDirectionCount = intent.phrase_directions.filter(
    (entry) => entry.realization_links !== undefined,
  ).length;
  return {
    song: 1,
    sections: ratio(sectionIntentCount, sectionIds.length),
    anchorPhrases: anchorPhraseCount > 0 ? 1 : 0,
    realizationLinks: ratio(linkedPhraseDirectionCount, intent.phrase_directions.length),
    sectionCount: sectionIds.length,
    sectionIntentCount,
    phraseDirectionCount: intent.phrase_directions.length,
    anchorPhraseCount,
    linkedPhraseDirectionCount,
  };
}

export function summarizeCompositionIntent(
  intent: CompositionIntent | undefined,
  sectionIds: readonly string[],
) {
  if (!intent) return null;
  const sectionSummaries = [...intent.sections]
    .sort((left, right) => left.section_id.localeCompare(right.section_id) || left.id.localeCompare(right.id));
  const directionSummaries = [...intent.phrase_directions]
    .sort((left, right) => Number(right.importance === "anchor") - Number(left.importance === "anchor")
      || left.section_id.localeCompare(right.section_id)
      || left.id.localeCompare(right.id));
  return {
    schema: intent.schema,
    intentHash: songIntentHash(intent),
    song: intent.song,
    coverage: compositionIntentCoverage(intent, sectionIds),
    sections: sectionSummaries
      .slice(0, 128)
      .map((entry) => ({
        id: entry.id,
        sectionId: entry.section_id,
        dramaticFunction: entry.dramatic_function,
        intendedTransition: entry.intended_transition,
      })),
    sectionsTruncated: sectionSummaries.length > 128,
    phraseDirections: directionSummaries
      .slice(0, 64)
      .map((entry) => ({
        id: entry.id,
        sectionId: entry.section_id,
        importance: entry.importance,
        purpose: entry.purpose,
        semanticFocus: entry.semantic_focus,
        deliveryArc: entry.delivery_arc,
        listeningQuestion: entry.listening_question,
        realizationLinked: entry.realization_links !== undefined,
      })),
    phraseDirectionsTruncated: directionSummaries.length > 64,
  };
}
