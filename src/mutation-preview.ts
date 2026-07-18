import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import { diffManifestSnapshots } from "./manifest-history.js";
import { PROJECT_ROOT } from "./paths.js";
import { loadSongManifest } from "./song-manifest.js";
import { preflightSongManifest } from "./song-preflight.js";
import type { CreativeReadinessReport, IntentRealizationEvidence } from "./intent/report-types.js";
import type { TheoryException, TheoryMetric, TheoryReport } from "./theory/types.js";


export interface TheoryMetricDelta {
  id: string;
  before?: TheoryMetric;
  after?: TheoryMetric;
}

export interface IntentEvidenceDelta {
  phraseDirectionId: string;
  dimension: IntentRealizationEvidence["dimension"];
  feature: string;
  before?: IntentRealizationEvidence;
  after?: IntentRealizationEvidence;
}

export interface CreativeReviewTransition {
  phraseDirectionId: string;
  reviewNoteId?: string;
  before: string;
  after: string;
  staleReasons: string[];
}

export interface MutationAnalysisDelta {
  introducedIssueCodes: string[];
  resolvedIssueCodes: string[];
  changedMetrics: TheoryMetricDelta[];
  changedIntentEvidence: IntentEvidenceDelta[];
  creativeReviewWouldBecomeStale: boolean;
  creativeReviewTransitions: CreativeReviewTransition[];
  creativeStatus: {
    before: CreativeReadinessReport["status"];
    after: CreativeReadinessReport["status"];
  };
  staleExceptions: TheoryException[];
}


export interface MutationPreviewResult {
  dryRun: true;
  source: {
    path: string;
    revision: number;
    contentHash: string;
    compositionHash: string;
    mixHash: string;
  };
  predicted: {
    revision: number;
    contentHash: string;
    compositionHash: string;
    mixHash: string;
  };
  changes: Awaited<ReturnType<typeof diffManifestSnapshots>>["domains"];
  totalChanges: number;
  readiness: Awaited<ReturnType<typeof preflightSongManifest>>["readiness"];
  issues: Awaited<ReturnType<typeof preflightSongManifest>>["issues"];
  theory: TheoryReport;
  creativeReadiness: CreativeReadinessReport;
  analysisDelta: MutationAnalysisDelta;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function issueIdentity(
  entry: Awaited<ReturnType<typeof preflightSongManifest>>["issues"][number],
): string {
  const target = entry.targetFingerprint
    ?? `${[...entry.objectIds].sort().join(",")}@${entry.position?.measure ?? -1}:${entry.position?.beat ?? -1}:${entry.position?.tick ?? -1}`;
  return `${entry.origin}:${entry.code}:${target}`;
}

function changedMetrics(before: TheoryReport, after: TheoryReport): TheoryMetricDelta[] {
  const beforeById = new Map(before.metrics.map((entry) => [entry.id, entry]));
  const afterById = new Map(after.metrics.map((entry) => [entry.id, entry]));
  return uniqueSorted([...beforeById.keys(), ...afterById.keys()]).flatMap((id) => {
    const previous = beforeById.get(id);
    const next = afterById.get(id);
    if (JSON.stringify(previous) === JSON.stringify(next)) return [];
    return [{ id, ...(previous ? { before: previous } : {}), ...(next ? { after: next } : {}) }];
  });
}

function intentEvidenceByKey(report: CreativeReadinessReport): Map<string, {
  phraseDirectionId: string;
  evidence: IntentRealizationEvidence;
}> {
  const values = new Map<string, { phraseDirectionId: string; evidence: IntentRealizationEvidence }>();
  for (const direction of report.directions) for (const evidence of direction.evidence) {
    const key = `${direction.phraseDirectionId}\u0000${evidence.dimension}\u0000${evidence.feature}`;
    values.set(key, { phraseDirectionId: direction.phraseDirectionId, evidence });
  }
  return values;
}

function changedIntentEvidence(
  before: CreativeReadinessReport,
  after: CreativeReadinessReport,
): IntentEvidenceDelta[] {
  const beforeByKey = intentEvidenceByKey(before);
  const afterByKey = intentEvidenceByKey(after);
  return uniqueSorted([...beforeByKey.keys(), ...afterByKey.keys()]).flatMap((key) => {
    const previous = beforeByKey.get(key);
    const next = afterByKey.get(key);
    if (JSON.stringify(previous?.evidence) === JSON.stringify(next?.evidence)) return [];
    const identity = next ?? previous;
    if (!identity) return [];
    return [{
      phraseDirectionId: identity.phraseDirectionId,
      dimension: identity.evidence.dimension,
      feature: identity.evidence.feature,
      ...(previous ? { before: previous.evidence } : {}),
      ...(next ? { after: next.evidence } : {}),
    }];
  });
}

function creativeReviewTransitions(
  before: CreativeReadinessReport,
  after: CreativeReadinessReport,
): CreativeReviewTransition[] {
  const afterByDirection = new Map(after.directions.map((entry) => [entry.phraseDirectionId, entry]));
  return before.directions.flatMap((previous) => {
    if (!previous.review.state.startsWith("current_")) return [];
    const next = afterByDirection.get(previous.phraseDirectionId);
    if (next?.review.state.startsWith("current_")) return [];
    return [{
      phraseDirectionId: previous.phraseDirectionId,
      ...(previous.review.reviewNoteId ? { reviewNoteId: previous.review.reviewNoteId } : {}),
      before: previous.review.state,
      after: next?.review.state ?? "direction_removed",
      staleReasons: next?.review.staleReasons ?? ["PHRASE_DIRECTION_REMOVED"],
    }];
  }).sort((left, right) => left.phraseDirectionId.localeCompare(right.phraseDirectionId));
}

function analysisDelta(
  before: Awaited<ReturnType<typeof preflightSongManifest>>,
  after: Awaited<ReturnType<typeof preflightSongManifest>>,
): MutationAnalysisDelta {
  const beforeIssues = new Map(before.issues.map((entry) => [issueIdentity(entry), entry]));
  const afterIssues = new Map(after.issues.map((entry) => [issueIdentity(entry), entry]));
  const introduced = [...afterIssues].filter(([identity]) => !beforeIssues.has(identity));
  const resolved = [...beforeIssues].filter(([identity]) => !afterIssues.has(identity));
  const reviewTransitions = creativeReviewTransitions(before.creativeReadiness, after.creativeReadiness);
  return {
    introducedIssueCodes: uniqueSorted(introduced.map(([, entry]) => entry.code)),
    resolvedIssueCodes: uniqueSorted(resolved.map(([, entry]) => entry.code)),
    changedMetrics: changedMetrics(before.theory, after.theory),
    changedIntentEvidence: changedIntentEvidence(before.creativeReadiness, after.creativeReadiness),
    creativeReviewWouldBecomeStale: reviewTransitions.length > 0,
    creativeReviewTransitions: reviewTransitions,
    creativeStatus: {
      before: before.creativeReadiness.status,
      after: after.creativeReadiness.status,
    },
    staleExceptions: after.theory.staleExceptions,
  };
}

export async function previewSongManifestMutation(
  manifestPath: string,
  expectedRevision: number,
  mutateTemporary: (temporaryManifestPath: string) => Promise<unknown>,
): Promise<MutationPreviewResult> {
  const source = await loadSongManifest(manifestPath);
  if (source.manifest.revision !== expectedRevision) {
    throw new Error(
      `Stale manifest revision ${expectedRevision}; current revision is ${source.manifest.revision} `
      + `(${source.manifest.content_hash}). Inspect again before previewing a mutation.`,
    );
  }
  const runtime = join(PROJECT_ROOT, "build/runtime");
  await mkdir(runtime, { recursive: true });
  const temporary = await mkdtemp(join(runtime, ".manifest-dry-run-"));
  const temporaryManifest = join(temporary, "preview.song.json");
  try {
    await copyFile(source.path, temporaryManifest);
    await mutateTemporary(temporaryManifest);
    const [predicted, diff, beforePreflight, preflight] = await Promise.all([
      loadSongManifest(temporaryManifest),
      diffManifestSnapshots(source.path, temporaryManifest),
      preflightSongManifest(source.path, {
        artifactCheck: "none",
        includePerformanceWarnings: true,
      }),
      preflightSongManifest(temporaryManifest, {
        artifactCheck: "none",
        includePerformanceWarnings: true,
      }),
    ]);
    return {
      dryRun: true,
      source: {
        path: source.path,
        revision: source.manifest.revision,
        contentHash: source.manifest.content_hash,
        compositionHash: source.manifest.composition_hash,
        mixHash: source.manifest.mix_hash,
      },
      predicted: {
        revision: predicted.manifest.revision,
        contentHash: predicted.manifest.content_hash,
        compositionHash: predicted.manifest.composition_hash,
        mixHash: predicted.manifest.mix_hash,
      },
      changes: diff.domains,
      totalChanges: diff.totalChanges,
      readiness: preflight.readiness,
      issues: preflight.issues,
      theory: preflight.theory,
      creativeReadiness: preflight.creativeReadiness,
      analysisDelta: analysisDelta(beforePreflight, preflight),
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
