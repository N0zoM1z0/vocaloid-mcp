import { createHash } from "node:crypto";

import type { SongManifest } from "../song-manifest.js";
import { analyzeArrangement } from "./arrangement.js";
import { buildSymbolicIndex, positionAtTick, type DomainAnalysis, type RawTheoryFinding } from "./events.js";
import { analyzeForm } from "./form.js";
import { analyzeHarmony } from "./harmony.js";
import { analyzeMelody } from "./melody.js";
import { analyzePerformance } from "./performance.js";
import { analyzeRhythm } from "./rhythm.js";
import {
  TheoryReportSchema,
  type CandidateRepair,
  type TheoryIssue,
  type TheoryMetric,
  type TheoryReport,
} from "./types.js";
import { analyzeVoiceLeading } from "./voice-leading.js";


export const THEORY_RULESET_ID = "core/v1";

const RULESET_DESCRIPTOR = {
  id: THEORY_RULESET_ID,
  analyzer: "symbolic-a2a/v1",
  domains: {
    form: "1.0.0",
    harmony: "1.0.0",
    melody: "1.0.0",
    rhythm: "1.0.0",
    voiceLeading: "1.0.0",
    noteAllocation: "1.0.0",
    arrangement: "1.0.0",
    performance: "1.0.0",
  },
} as const;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export const THEORY_RULESET_HASH = fingerprint(RULESET_DESCRIPTOR);

function uniqueObjectIds(values: readonly string[]): string[] {
  return [...new Set(values)].slice(0, 256);
}

function boundedMetricId(id: string): string {
  const normalized = id.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-");
  if (/^[a-z][a-z0-9._-]{1,95}$/u.test(normalized)) return normalized;
  const suffix = fingerprint(id).slice(0, 12);
  const prefix = normalized.replace(/^[^a-z]+/u, "metric-").slice(0, 82).replace(/[._-]+$/u, "");
  return `${prefix}.${suffix}`;
}

function repairForFinding(finding: RawTheoryFinding, targetFingerprint: string): CandidateRepair[] {
  const objectIds = uniqueObjectIds(finding.objectIds);
  if (!finding.suggestion || objectIds.length === 0) return [];
  return [{
    id: `repair-${finding.code.toLowerCase().replaceAll("_", "-").slice(0, 54)}-${targetFingerprint.slice(0, 12)}`,
    kind: finding.repairKind ?? "review",
    summary: finding.suggestion,
    objectIds,
    predictedResolvedCodes: [finding.code],
    predictedIntroducedCodes: [],
  }];
}

function issueFromFinding(manifest: SongManifest, finding: RawTheoryFinding): TheoryIssue {
  const objectIds = uniqueObjectIds(finding.objectIds);
  const targetFingerprint = fingerprint({
    code: finding.code,
    ruleVersion: finding.ruleVersion,
    objectIds,
    startTick: finding.startTick,
    endTick: finding.endTick,
    details: finding.details,
  });
  return {
    code: finding.code,
    ruleVersion: finding.ruleVersion,
    severity: finding.severity,
    confidence: finding.confidence,
    domain: finding.domain,
    message: finding.message,
    objectIds,
    ...(finding.startTick !== undefined ? { position: positionAtTick(manifest, finding.startTick) } : {}),
    ...(finding.endTick !== undefined ? { endPosition: positionAtTick(manifest, finding.endTick) } : {}),
    targetFingerprint,
    evidence: [{
      level: "symbolic_exact",
      source: finding.source,
      confidence: finding.confidence,
      details: finding.details,
    }],
    suggestedRepairs: repairForFinding(finding, targetFingerprint),
  };
}

function findingOrder(left: RawTheoryFinding, right: RawTheoryFinding): number {
  const severityOrder = { error: 0, warning: 1, info: 2 } as const;
  return severityOrder[left.severity] - severityOrder[right.severity]
    || (left.startTick ?? -1) - (right.startTick ?? -1)
    || left.domain.localeCompare(right.domain)
    || left.code.localeCompare(right.code)
    || left.objectIds.join("\u0000").localeCompare(right.objectIds.join("\u0000"));
}

function coverageFor(manifest: SongManifest, analyses: readonly DomainAnalysis[], chordCoverage: number): Record<string, number> {
  const hasVocal = manifest.vocal_tracks.some((track) => track.parts.length > 0);
  const hasArrangement = manifest.accompaniment.tracks.length > 0;
  return {
    form: manifest.sections.length > 0 ? 1 : 0,
    timeline: manifest.time_signatures.length > 0 && manifest.tempos.length > 0 ? 1 : 0,
    key: manifest.harmony.key_changes.length > 0 ? 1 : 0,
    harmony: chordCoverage,
    melody: hasVocal ? 1 : 0,
    rhythm: hasVocal || hasArrangement ? 1 : 0,
    note_allocation: manifest.vocal_tracks.some((track) =>
      track.parts.some((part) => part.phrases.length > 0)) ? 1 : hasVocal ? 0.5 : 0,
    voice_leading: manifest.vocal_tracks.length >= 2 ? 1 : hasVocal ? 0.5 : 0,
    arrangement: hasArrangement ? 1 : 0,
    performance: hasVocal ? 1 : 0,
    analyzed_domains: analyses.length > 0 ? 1 : 0,
  };
}

export function analyzeManifestTheory(manifest: SongManifest): TheoryReport {
  const index = buildSymbolicIndex(manifest);
  const analyses = [
    analyzeForm(manifest, index),
    analyzeHarmony(manifest, index),
    analyzeMelody(manifest, index),
    analyzeRhythm(manifest, index),
    analyzeVoiceLeading(index),
    analyzePerformance(manifest, index),
    analyzeArrangement(manifest, index),
  ];
  const rawFindings = analyses.flatMap((analysis) => analysis.findings).sort(findingOrder);
  const issuesByFingerprint = new Map<string, TheoryIssue>();
  for (const finding of rawFindings) {
    const issue = issueFromFinding(manifest, finding);
    if (!issuesByFingerprint.has(issue.targetFingerprint)) issuesByFingerprint.set(issue.targetFingerprint, issue);
    if (issuesByFingerprint.size >= 20_000) break;
  }
  const issues = [...issuesByFingerprint.values()];

  const metricsById = new Map<string, TheoryMetric>();
  for (const metric of analyses.flatMap((analysis) => analysis.metrics)) {
    const id = boundedMetricId(metric.id);
    const candidate: TheoryMetric = {
      id,
      domain: metric.domain,
      value: metric.value,
      unit: metric.unit,
      objectIds: uniqueObjectIds(metric.objectIds),
      evidenceLevel: "symbolic_exact",
    };
    const existing = metricsById.get(id);
    if (!existing || JSON.stringify(candidate) < JSON.stringify(existing)) metricsById.set(id, candidate);
    if (metricsById.size >= 20_000) break;
  }
  const metrics = [...metricsById.values()].sort((left, right) => left.id.localeCompare(right.id));
  const chordCoverage = metrics.find((metric) => metric.id === "harmony.chord_coverage")?.value;
  const report = {
    schema: "vocaloid-theory-report/v1" as const,
    rulesetId: THEORY_RULESET_ID,
    rulesetHash: THEORY_RULESET_HASH,
    manifestRevision: manifest.revision,
    compositionHash: manifest.composition_hash,
    scope: { kind: "whole" as const },
    coverage: coverageFor(manifest, analyses, typeof chordCoverage === "number" ? chordCoverage : 0),
    summary: {
      errors: issues.filter((issue) => issue.severity === "error").length,
      warnings: issues.filter((issue) => issue.severity === "warning").length,
      info: issues.filter((issue) => issue.severity === "info").length,
    },
    metrics,
    issues,
    ignoredIssues: [],
    staleExceptions: [],
  };
  return TheoryReportSchema.parse(report);
}
