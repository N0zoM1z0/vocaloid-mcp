import { z } from "zod";

import {
  IntentAuditionLayerSchema,
  IntentFingerprintSchema,
  IntentLayerAssessmentSchema,
  IntentStableIdSchema,
} from "./types.js";


const EvidenceValueSchema = z.union([
  z.string().max(2000),
  z.number().finite(),
  z.boolean(),
]);

export const IntentEvidenceRelationSchema = z.enum([
  "supports",
  "contradicts",
  "mixed",
  "unknown",
]);

export const IntentRealizationEvidenceSchema = z
  .object({
    dimension: z.enum([
      "binding",
      "semantic_focus",
      "melody",
      "rhythm",
      "harmony",
      "delivery",
      "arrangement",
      "review",
    ]),
    feature: z.string().regex(/^[a-z][a-z0-9._-]{1,95}$/u),
    expected: EvidenceValueSchema,
    observed: EvidenceValueSchema,
    relation: IntentEvidenceRelationSchema,
    confidence: z.number().min(0).max(1),
    evidenceLevel: z.enum(["symbolic_exact", "human_verified", "agent_verified"]),
    objectIds: z.array(IntentStableIdSchema).max(256),
    details: z.record(z.string().min(1).max(64), EvidenceValueSchema).default({}),
  })
  .strict();

export const IntentDirectionReviewStatusSchema = z
  .object({
    state: z.enum(["missing", "stale", "current_keep", "current_reject", "current_revise"]),
    reviewNoteId: IntentStableIdSchema.optional(),
    authorType: z.enum(["human", "agent"]).optional(),
    outcome: z.enum(["keep", "reject", "revise"]).optional(),
    layerAssessment: IntentLayerAssessmentSchema.optional(),
    humanConfirmed: z.boolean(),
    staleReasons: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,95}$/u)).max(32),
  })
  .strict();

export const IntentAuditionLayerStatusSchema = z
  .object({
    layer: IntentAuditionLayerSchema,
    state: z.enum(["missing", "stale", "current"]),
    artifactIds: z.array(IntentStableIdSchema).max(64),
    currentArtifactIds: z.array(IntentStableIdSchema).max(64),
    durationSeconds: z.array(z.number().min(0).max(3600)).max(64),
  })
  .strict();

const IntentPositionSchema = z
  .object({
    measure: z.number().int().min(0).max(100_000),
    beat: z.number().int().min(0).max(31),
    tick: z.number().int().min(0).max(1919),
  })
  .strict();

export const IntentDirectionReportSchema = z
  .object({
    phraseDirectionId: IntentStableIdSchema,
    sectionId: IntentStableIdSchema,
    importance: z.enum(["anchor", "supporting", "transition"]),
    inheritedFrom: z.array(IntentStableIdSchema).min(1).max(3),
    listeningQuestionId: IntentStableIdSchema,
    binding: z
      .object({
        bound: z.boolean(),
        semanticFocusBound: z.boolean(),
        linkedObjectIds: z.array(IntentStableIdSchema).max(256),
        linkedVocalEventIds: z.array(IntentStableIdSchema).max(20_000),
        startPosition: IntentPositionSchema.optional(),
        endPosition: IntentPositionSchema.optional(),
        durationSeconds: z.number().min(0).max(86_400).optional(),
      })
      .strict(),
    evidence: z.array(IntentRealizationEvidenceSchema).max(128),
    review: IntentDirectionReviewStatusSchema,
    auditionLayers: z.array(IntentAuditionLayerStatusSchema).length(5),
  })
  .strict();

export const IntentReadinessFindingSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,95}$/u),
    severity: z.enum(["warning", "info"]),
    message: z.string().min(1).max(2000),
    objectIds: z.array(IntentStableIdSchema).max(256),
    phraseDirectionId: IntentStableIdSchema.optional(),
  })
  .strict();

export const CreativeReadinessReportSchema = z
  .object({
    schema: z.literal("vocaloid-creative-readiness/v1"),
    manifestRevision: z.number().int().min(1),
    intentHash: IntentFingerprintSchema.nullable(),
    compositionHash: IntentFingerprintSchema,
    status: z.enum([
      "missing_intent",
      "incomplete",
      "awaiting_listening",
      "revision_requested",
      "ready",
    ]),
    coverage: z
      .object({
        song: z.number().min(0).max(1),
        sections: z.number().min(0).max(1),
        anchorPhrases: z.number().min(0).max(1),
        realizationLinks: z.number().min(0).max(1),
        semanticFocus: z.number().min(0).max(1),
        currentReviews: z.number().min(0).max(1),
        currentAuditionLadders: z.number().min(0).max(1),
      })
      .strict(),
    counts: z
      .object({
        sections: z.number().int().min(0),
        sectionIntents: z.number().int().min(0),
        phraseDirections: z.number().int().min(0),
        anchorPhrases: z.number().int().min(0),
        boundAnchorPhrases: z.number().int().min(0),
        semanticFocusBoundAnchors: z.number().int().min(0),
        currentKeepReviews: z.number().int().min(0),
        humanConfirmedAnchors: z.number().int().min(0),
        currentRequiredLadders: z.number().int().min(0),
      })
      .strict(),
    directions: z.array(IntentDirectionReportSchema).max(10_000),
    findings: z.array(IntentReadinessFindingSchema).max(20_000),
  })
  .strict();

export type IntentEvidenceRelation = z.infer<typeof IntentEvidenceRelationSchema>;
export type IntentRealizationEvidence = z.infer<typeof IntentRealizationEvidenceSchema>;
export type IntentDirectionReviewStatus = z.infer<typeof IntentDirectionReviewStatusSchema>;
export type IntentAuditionLayerStatus = z.infer<typeof IntentAuditionLayerStatusSchema>;
export type IntentDirectionReport = z.infer<typeof IntentDirectionReportSchema>;
export type IntentReadinessFinding = z.infer<typeof IntentReadinessFindingSchema>;
export type CreativeReadinessReport = z.infer<typeof CreativeReadinessReportSchema>;
