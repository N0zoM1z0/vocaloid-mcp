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
  | "COMPARISON_ARTIFACT_MISSING"
  | "COMPARISON_ARTIFACT_DIGEST_MISMATCH"
  | "COMPARISON_ARTIFACT_NOT_CURRENT";

export interface IntentReviewArtifact {
  id: string;
  sha256: string;
}

export interface TechnicalArtifact extends IntentReviewArtifact {
  role: string;
  source_composition_hash: string;
  dependencies: readonly string[];
  metadata: Readonly<Record<string, string | number | boolean>>;
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

export function currentTechnicalArtifactIds(
  artifacts: readonly TechnicalArtifact[],
  compositionHash: string,
  mixHash: string,
): ReadonlySet<string> {
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const currentMemo = new Map<string, boolean>();
  const resolve = (artifact: TechnicalArtifact, visiting = new Set<string>()): boolean => {
    const memoized = currentMemo.get(artifact.id);
    if (memoized !== undefined) return memoized;
    if (artifact.source_composition_hash !== compositionHash || visiting.has(artifact.id)) return false;
    const next = new Set(visiting).add(artifact.id);
    let current = artifact.role !== "mix" || artifact.metadata.source_mix_hash === mixHash;
    if (artifact.role === "delivery") {
      current = artifact.dependencies.length > 0 && artifact.dependencies.every((dependency) => {
        const source = artifactsById.get(dependency);
        return source !== undefined && resolve(source, next);
      });
    } else if (current) {
      current = artifact.dependencies
        .map((dependency) => artifactsById.get(dependency))
        .filter((dependency) => dependency !== undefined)
        .every((dependency) => resolve(dependency, next));
    }
    currentMemo.set(artifact.id, current);
    return current;
  };
  return new Set(artifacts.filter((artifact) => resolve(artifact)).map((artifact) => artifact.id));
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
  const comparisonArtifacts = basis.comparison_artifacts
    ?? (basis.comparison_artifact_ids ?? []).map((artifact_id) => ({ artifact_id }));
  if (comparisonArtifacts.some((comparison) => !artifacts.has(comparison.artifact_id))) {
    reasons.push("COMPARISON_ARTIFACT_MISSING");
  }
  if (comparisonArtifacts.some((comparison) => {
    const artifact = artifacts.get(comparison.artifact_id);
    return artifact !== undefined
      && "artifact_sha256" in comparison
      && artifact.sha256 !== comparison.artifact_sha256;
  })) {
    reasons.push("COMPARISON_ARTIFACT_DIGEST_MISMATCH");
  }
  if (context.currentArtifactIds && comparisonArtifacts.some((comparison) => {
    const artifact = artifacts.get(comparison.artifact_id);
    return artifact !== undefined && !context.currentArtifactIds!.has(artifact.id);
  })) {
    reasons.push("COMPARISON_ARTIFACT_NOT_CURRENT");
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
