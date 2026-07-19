import { createHash } from "node:crypto";

import { z } from "zod";

import type { CreativeReadinessReport } from "../intent/report-types.js";
import { theoryRuleDefinition } from "./rules.js";
import type {
  CompositionGuidance,
  TheoryException,
  TheoryIssue,
  TheoryReport,
} from "./types.js";


export type TheoryExceptionStaleReason =
  | "RULESET_MISMATCH"
  | "ISSUE_NOT_CURRENT"
  | "OBJECT_IDS_MISMATCH"
  | "TARGET_FINGERPRINT_MISMATCH"
  | "STRUCTURAL_ERROR_NOT_EXCEPTABLE"
  | "DUPLICATE_EXCEPTION_TARGET";

export interface TheoryExceptionMatch {
  current: boolean;
  issue?: TheoryIssue;
  reason?: TheoryExceptionStaleReason;
}

export interface AppliedTheoryPolicy {
  issues: TheoryIssue[];
  ignoredIssues: TheoryIssue[];
  staleExceptions: TheoryException[];
  staleReasons: Array<{
    exceptionId: string;
    reason: TheoryExceptionStaleReason;
  }>;
}

export const ReleasePolicyGateSchema = z
  .object({
    enabled: z.boolean(),
    ready: z.boolean(),
    blockers: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,95}$/u)).max(20_000),
    requiredReviewSeverities: z.array(z.enum(["warning", "info"])).max(2),
    unresolvedTheoryIssues: z.array(z.object({
      code: z.string().regex(/^[A-Z][A-Z0-9_]{1,95}$/u),
      severity: z.enum(["warning", "info"]),
      targetFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
      objectIds: z.array(z.string()).max(256),
    }).strict()).max(20_000),
    staleExceptionIds: z.array(z.string()).max(10_000),
    intent: z.object({
      mode: z.enum(["off", "advisory", "required_for_delivery"]),
      required: z.boolean(),
      status: z.enum(["missing_intent", "incomplete", "awaiting_listening", "revision_requested", "ready"]),
      blockers: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,95}$/u)).max(32),
    }).strict(),
  })
  .strict();

export type ReleasePolicyGate = z.infer<typeof ReleasePolicyGateSchema>;

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

function sameObjectIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function issueOrder(left: TheoryIssue, right: TheoryIssue): number {
  const severityOrder = { error: 0, warning: 1, info: 2 } as const;
  return severityOrder[left.severity] - severityOrder[right.severity]
    || (left.position?.measure ?? -1) - (right.position?.measure ?? -1)
    || (left.position?.beat ?? -1) - (right.position?.beat ?? -1)
    || (left.position?.tick ?? -1) - (right.position?.tick ?? -1)
    || left.domain.localeCompare(right.domain)
    || left.code.localeCompare(right.code)
    || left.objectIds.join("\u0000").localeCompare(right.objectIds.join("\u0000"));
}

export function matchTheoryException(
  exception: TheoryException,
  issues: readonly TheoryIssue[],
  reportRulesetId: string,
  guidanceRulesetId: string,
): TheoryExceptionMatch {
  if (reportRulesetId !== guidanceRulesetId) return { current: false, reason: "RULESET_MISMATCH" };
  const sameCode = issues.filter((issue) => issue.code === exception.issue_code);
  if (sameCode.length === 0) return { current: false, reason: "ISSUE_NOT_CURRENT" };
  const sameObjects = sameCode.filter((issue) => sameObjectIds(issue.objectIds, exception.object_ids));
  if (sameObjects.length === 0) return { current: false, reason: "OBJECT_IDS_MISMATCH" };
  const exact = sameObjects.find((issue) => issue.targetFingerprint === exception.target_fingerprint);
  if (!exact) return { current: false, reason: "TARGET_FINGERPRINT_MISMATCH" };
  const definition = theoryRuleDefinition(exact.code);
  if (definition.structural && exact.severity === "error") {
    return { current: false, issue: exact, reason: "STRUCTURAL_ERROR_NOT_EXCEPTABLE" };
  }
  return { current: true, issue: exact };
}

export function assertTheoryExceptionApplicable(
  exception: TheoryException,
  issues: readonly TheoryIssue[],
  reportRulesetId: string,
  guidanceRulesetId: string,
): TheoryIssue {
  const match = matchTheoryException(exception, issues, reportRulesetId, guidanceRulesetId);
  if (match.current && match.issue) return match.issue;
  throw new Error(
    `Theory exception ${exception.id} cannot be applied to ${exception.issue_code}: ${match.reason ?? "UNKNOWN"}. `
    + "Inspect the current theory report and copy its exact code, object IDs, and target fingerprint; structural errors cannot be excepted.",
  );
}

function staleIssue(exception: TheoryException, reason: TheoryExceptionStaleReason): TheoryIssue {
  const definition = theoryRuleDefinition("THEORY_EXCEPTION_STALE");
  const objectIds = [exception.id, ...exception.object_ids].slice(0, 256);
  const targetFingerprint = fingerprint({ exception, reason });
  return {
    code: "THEORY_EXCEPTION_STALE",
    ruleVersion: definition.version,
    severity: "error",
    confidence: 1,
    domain: definition.domain,
    message: `Theory exception ${exception.id} is stale or forbidden (${reason}); it no longer suppresses ${exception.issue_code}.`,
    objectIds,
    targetFingerprint,
    evidence: [{
      level: "symbolic_exact",
      source: "composition_guidance exception matcher",
      confidence: 1,
      details: {
        exception_id: exception.id,
        issue_code: exception.issue_code,
        reason,
        target_objects: exception.object_ids.length,
      },
    }],
    suggestedRepairs: [{
      id: `repair-theory-exception-stale-${targetFingerprint.slice(0, 16)}`,
      kind: "review",
      summary: "Remove the stale exception, repair the current issue, or create a new exception only from the current exact issue fingerprint after listening review.",
      objectIds,
      predictedResolvedCodes: [definition.code],
      predictedIntroducedCodes: [],
    }],
  };
}

export function applyTheoryExceptions(
  issues: readonly TheoryIssue[],
  guidance: CompositionGuidance | undefined,
  reportRulesetId: string,
): AppliedTheoryPolicy {
  if (!guidance || guidance.exceptions.length === 0) {
    return { issues: [...issues], ignoredIssues: [], staleExceptions: [], staleReasons: [] };
  }
  const ignoredFingerprints = new Set<string>();
  const staleExceptions: TheoryException[] = [];
  const staleReasons: AppliedTheoryPolicy["staleReasons"] = [];
  const staleIssues: TheoryIssue[] = [];
  for (const exception of [...guidance.exceptions].sort((left, right) => left.id.localeCompare(right.id))) {
    const match = matchTheoryException(
      exception,
      issues,
      reportRulesetId,
      guidance.theory_ruleset_id,
    );
    let reason = match.reason;
    if (match.current && match.issue && ignoredFingerprints.has(match.issue.targetFingerprint)) {
      reason = "DUPLICATE_EXCEPTION_TARGET";
    }
    if (match.current && match.issue && !reason) {
      ignoredFingerprints.add(match.issue.targetFingerprint);
      continue;
    }
    const selectedReason = reason ?? "ISSUE_NOT_CURRENT";
    staleExceptions.push(exception);
    staleReasons.push({ exceptionId: exception.id, reason: selectedReason });
    staleIssues.push(staleIssue(exception, selectedReason));
  }
  const ignoredIssues = issues.filter((issue) => ignoredFingerprints.has(issue.targetFingerprint)).sort(issueOrder);
  const activeIssues = issues.filter((issue) => !ignoredFingerprints.has(issue.targetFingerprint));
  return {
    issues: [...activeIssues, ...staleIssues].sort(issueOrder),
    ignoredIssues,
    staleExceptions,
    staleReasons,
  };
}

export function evaluateReleasePolicy(
  guidance: CompositionGuidance | undefined,
  theory: TheoryReport,
  creative: CreativeReadinessReport,
): ReleasePolicyGate {
  const requiredReviewSeverities = guidance?.required_review_severities ?? [];
  const requiredSeveritySet = new Set(requiredReviewSeverities);
  const unresolvedTheoryIssues = theory.issues
    .filter((issue): issue is TheoryIssue & { severity: "warning" | "info" } =>
      (issue.severity === "warning" || issue.severity === "info")
      && requiredSeveritySet.has(issue.severity))
    .map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      targetFingerprint: issue.targetFingerprint,
      objectIds: issue.objectIds,
    }));
  const staleExceptionIds = theory.staleExceptions.map((exception) => exception.id).sort();
  const intentPolicy = guidance?.intent_review_policy;
  const intentMode = intentPolicy?.mode ?? "off";
  const intentBlockers: string[] = [];
  if (intentPolicy?.mode === "required_for_delivery") {
    if (intentPolicy.require_song_intent && creative.intentHash === null) {
      intentBlockers.push("COMPOSITION_INTENT_REQUIRED");
    }
    if (intentPolicy.require_section_intent && creative.coverage.sections < 1) {
      intentBlockers.push("SECTION_INTENT_REQUIRED");
    }
    if (creative.counts.anchorPhrases < intentPolicy.minimum_anchor_phrases) {
      intentBlockers.push("ANCHOR_PHRASE_MINIMUM_NOT_MET");
    }
    if (intentPolicy.require_current_audition_review) {
      const requiredAnchors = Math.max(
        1,
        intentPolicy.minimum_anchor_phrases,
        creative.counts.anchorPhrases,
      );
      if (creative.counts.currentKeepReviews < requiredAnchors) {
        intentBlockers.push("CURRENT_INTENT_KEEP_REVIEW_REQUIRED");
      }
      if (creative.counts.currentRequiredLadders < requiredAnchors) {
        intentBlockers.push("CURRENT_ANCHOR_AUDITION_LADDER_REQUIRED");
      }
      if (creative.status === "revision_requested") {
        intentBlockers.push("INTENT_REVISION_REQUESTED");
      }
    }
  }
  const blockers = [...new Set([
    ...unresolvedTheoryIssues.map((issue) => issue.code),
    ...(staleExceptionIds.length > 0 ? ["THEORY_EXCEPTION_STALE"] : []),
    ...intentBlockers,
  ])].sort();
  return ReleasePolicyGateSchema.parse({
    enabled: guidance !== undefined,
    ready: blockers.length === 0,
    blockers,
    requiredReviewSeverities,
    unresolvedTheoryIssues,
    staleExceptionIds,
    intent: {
      mode: intentMode,
      required: intentMode === "required_for_delivery",
      status: creative.status,
      blockers: [...new Set(intentBlockers)].sort(),
    },
  });
}
