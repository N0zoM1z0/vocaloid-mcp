import { optionalSongIntentHash } from "./hash.js";
import type { CompositionIntent, IntentFidelityReviewBasis } from "./types.js";


export type IntentReviewStaleReason =
  | "INTENT_MISSING"
  | "INTENT_HASH_MISMATCH"
  | "COMPOSITION_HASH_MISMATCH"
  | "PHRASE_DIRECTION_MISSING"
  | "LISTENING_QUESTION_MISMATCH"
  | "ARTIFACT_MISSING"
  | "ARTIFACT_DIGEST_MISMATCH"
  | "ARTIFACT_NOT_CURRENT"
  | "COMPARISON_ARTIFACT_MISSING";

export interface IntentReviewArtifact {
  id: string;
  sha256: string;
}

export interface IntentReviewContext {
  compositionIntent?: CompositionIntent;
  compositionHash: string;
  artifacts: readonly IntentReviewArtifact[];
  currentArtifactIds?: ReadonlySet<string>;
}

export interface IntentReviewCurrentness {
  current: boolean;
  accepted: boolean;
  outcome: IntentFidelityReviewBasis["outcome"];
  reasons: IntentReviewStaleReason[];
  currentIntentHash: string | null;
}

export function resolveIntentReviewCurrentness(
  basis: IntentFidelityReviewBasis,
  context: IntentReviewContext,
): IntentReviewCurrentness {
  const reasons: IntentReviewStaleReason[] = [];
  const currentIntentHash = optionalSongIntentHash(context.compositionIntent);
  if (currentIntentHash === null) reasons.push("INTENT_MISSING");
  else if (basis.intent_hash !== currentIntentHash) reasons.push("INTENT_HASH_MISMATCH");
  if (basis.composition_hash !== context.compositionHash) reasons.push("COMPOSITION_HASH_MISMATCH");

  const direction = context.compositionIntent?.phrase_directions.find(
    (candidate) => candidate.id === basis.phrase_direction_id,
  );
  if (!direction) reasons.push("PHRASE_DIRECTION_MISSING");
  else if (direction.listening_question.id !== basis.listening_question_id) {
    reasons.push("LISTENING_QUESTION_MISMATCH");
  }

  const artifacts = new Map(context.artifacts.map((artifact) => [artifact.id, artifact]));
  const selectedArtifact = artifacts.get(basis.artifact_id);
  if (!selectedArtifact) reasons.push("ARTIFACT_MISSING");
  else if (selectedArtifact.sha256 !== basis.artifact_sha256) reasons.push("ARTIFACT_DIGEST_MISMATCH");
  if (selectedArtifact && context.currentArtifactIds
    && !context.currentArtifactIds.has(selectedArtifact.id)) {
    reasons.push("ARTIFACT_NOT_CURRENT");
  }
  if ((basis.comparison_artifact_ids ?? []).some((id) => !artifacts.has(id))) {
    reasons.push("COMPARISON_ARTIFACT_MISSING");
  }

  return {
    current: reasons.length === 0,
    accepted: reasons.length === 0 && basis.outcome === "keep",
    outcome: basis.outcome,
    reasons,
    currentIntentHash,
  };
}

export function assertCurrentIntentFidelityReviewBasis(
  basis: IntentFidelityReviewBasis,
  context: IntentReviewContext,
): void {
  const currentness = resolveIntentReviewCurrentness(basis, context);
  if (!currentness.current) {
    throw new Error(
      `Intent-fidelity review basis is not current: ${currentness.reasons.join(", ")}`,
    );
  }
}
