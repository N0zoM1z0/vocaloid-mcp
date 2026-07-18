import { z } from "zod";


const StableObjectIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,95}$/u)
  .describe("Stable manifest object ID");

const RulesetIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._/-]{0,127}$/u)
  .describe("Versioned deterministic theory ruleset ID");

const IssueCodeSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{1,95}$/u)
  .describe("Stable uppercase theory issue code");

const FingerprintSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u)
  .describe("SHA-256 fingerprint of the exact issue target state");

export const TheoryEvidenceLevelSchema = z.enum([
  "symbolic_exact",
  "audio_measured",
  "audio_estimated",
  "human_verified",
]);

export const TheorySeveritySchema = z.enum(["error", "warning", "info"]);

export const TheoryDomainSchema = z.enum([
  "form",
  "timeline",
  "key",
  "harmony",
  "melody",
  "rhythm",
  "vocal",
  "note_allocation",
  "voice_leading",
  "arrangement",
  "performance",
  "policy",
]);

export const TheoryPositionSchema = z
  .object({
    measure: z.number().int().min(0).max(100_000),
    beat: z.number().int().min(0).max(31),
    tick: z.number().int().min(0).max(1919),
  })
  .strict();

const EvidencePrimitiveSchema = z.union([z.string(), z.number(), z.boolean()]);

export const TheoryEvidenceSchema = z
  .object({
    level: TheoryEvidenceLevelSchema,
    source: z.string().min(1).max(256),
    confidence: z.number().min(0).max(1),
    details: z.record(z.string().min(1).max(64), EvidencePrimitiveSchema),
  })
  .strict();

export const CandidateRepairSchema = z
  .object({
    id: StableObjectIdSchema,
    kind: z.enum([
      "pitch",
      "rhythm",
      "harmony",
      "voicing",
      "breath",
      "arrangement",
      "review",
    ]),
    summary: z.string().min(1).max(1000),
    objectIds: z.array(StableObjectIdSchema).min(1).max(256),
    predictedResolvedCodes: z.array(IssueCodeSchema).max(128),
    predictedIntroducedCodes: z.array(IssueCodeSchema).max(128),
  })
  .strict();

export const TheoryIssueSchema = z
  .object({
    code: IssueCodeSchema,
    ruleVersion: z.string().min(1).max(64),
    severity: TheorySeveritySchema,
    confidence: z.number().min(0).max(1),
    domain: TheoryDomainSchema,
    message: z.string().min(1).max(2000),
    objectIds: z.array(StableObjectIdSchema).max(256),
    position: TheoryPositionSchema.optional(),
    endPosition: TheoryPositionSchema.optional(),
    targetFingerprint: FingerprintSchema,
    evidence: z.array(TheoryEvidenceSchema).min(1).max(64),
    suggestedRepairs: z.array(CandidateRepairSchema).max(8),
  })
  .strict();

export const TheoryMetricSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9._-]{1,95}$/u),
    domain: TheoryDomainSchema,
    value: EvidencePrimitiveSchema,
    unit: z.string().min(1).max(64),
    objectIds: z.array(StableObjectIdSchema).max(256),
    evidenceLevel: TheoryEvidenceLevelSchema,
  })
  .strict();

export const TheoryStrictnessSchema = z.enum(["permissive", "balanced", "strict"]);

export const HarmonicLanguageSchema = z.enum([
  "tonal",
  "modal",
  "pitch_set",
  "atonal",
  "custom",
]);

export const TheoryPolicySchema = z
  .object({
    rulesetId: RulesetIdSchema,
    strictness: TheoryStrictnessSchema,
    harmonicLanguage: HarmonicLanguageSchema,
    requiredReviewSeverities: z.array(z.enum(["warning", "info"])).max(2),
  })
  .strict();

export const TheoryExceptionSchema = z
  .object({
    id: StableObjectIdSchema,
    issue_code: IssueCodeSchema,
    object_ids: z.array(StableObjectIdSchema).min(1).max(256),
    target_fingerprint: FingerprintSchema,
    rationale: z.string().min(1).max(2000),
    author_type: z.enum(["human", "agent"]),
    created_at: z.string().datetime(),
  })
  .strict();

export const StyleProfilePinSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9._/-]{0,127}$/u),
    version: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}$/u),
    pinned_at: z.string().datetime(),
  })
  .strict();

export const CompositionGuidanceSchema = z
  .object({
    theory_ruleset_id: RulesetIdSchema,
    strictness: TheoryStrictnessSchema,
    harmonic_language: HarmonicLanguageSchema,
    required_review_severities: z.array(z.enum(["warning", "info"])).max(2),
    style_profile: StyleProfilePinSchema.optional(),
    exceptions: z.array(TheoryExceptionSchema).max(10_000),
  })
  .strict()
  .superRefine((guidance, context) => {
    if (new Set(guidance.required_review_severities).size !== guidance.required_review_severities.length) {
      context.addIssue({
        code: "custom",
        path: ["required_review_severities"],
        message: "required_review_severities must not contain duplicates",
      });
    }
    const exceptionIds = new Set<string>();
    for (const [index, exception] of guidance.exceptions.entries()) {
      if (exceptionIds.has(exception.id)) {
        context.addIssue({
          code: "custom",
          path: ["exceptions", index, "id"],
          message: `Duplicate theory exception ID ${exception.id}`,
        });
      }
      exceptionIds.add(exception.id);
      if (new Set(exception.object_ids).size !== exception.object_ids.length) {
        context.addIssue({
          code: "custom",
          path: ["exceptions", index, "object_ids"],
          message: `Theory exception ${exception.id} repeats an object ID`,
        });
      }
    }
  });

export const TheoryReportSchema = z
  .object({
    schema: z.literal("vocaloid-theory-report/v1"),
    rulesetId: RulesetIdSchema,
    rulesetHash: FingerprintSchema,
    manifestRevision: z.number().int().min(1),
    compositionHash: FingerprintSchema,
    scope: z
      .object({
        kind: z.enum(["whole", "section", "track", "part"]),
        objectId: StableObjectIdSchema.optional(),
      })
      .strict(),
    coverage: z.record(z.string().min(1).max(64), z.number().min(0).max(1)),
    summary: z
      .object({
        errors: z.number().int().min(0),
        warnings: z.number().int().min(0),
        info: z.number().int().min(0),
      })
      .strict(),
    metrics: z.array(TheoryMetricSchema).max(20_000),
    issues: z.array(TheoryIssueSchema).max(20_000),
    ignoredIssues: z.array(TheoryIssueSchema).max(20_000),
    staleExceptions: z.array(TheoryExceptionSchema).max(10_000),
  })
  .strict();

export type TheoryEvidenceLevel = z.infer<typeof TheoryEvidenceLevelSchema>;
export type TheorySeverity = z.infer<typeof TheorySeveritySchema>;
export type TheoryDomain = z.infer<typeof TheoryDomainSchema>;
export type TheoryEvidence = z.infer<typeof TheoryEvidenceSchema>;
export type CandidateRepair = z.infer<typeof CandidateRepairSchema>;
export type TheoryIssue = z.infer<typeof TheoryIssueSchema>;
export type TheoryMetric = z.infer<typeof TheoryMetricSchema>;
export type TheoryPolicy = z.infer<typeof TheoryPolicySchema>;
export type TheoryException = z.infer<typeof TheoryExceptionSchema>;
export type CompositionGuidance = z.infer<typeof CompositionGuidanceSchema>;
export type TheoryReport = z.infer<typeof TheoryReportSchema>;
