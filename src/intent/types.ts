import { z } from "zod";


export const IntentStableIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,95}$/u)
  .describe("Stable lowercase composition-intent ID");

export const IntentFingerprintSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u)
  .describe("SHA-256 fingerprint");

const ShortIntentTextSchema = z.string().min(1).max(1000);
const LongIntentTextSchema = z.string().min(1).max(2000);

const UniqueIntentIdListSchema = z
  .array(IntentStableIdSchema)
  .min(1)
  .max(256)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", message: "Intent object ID lists must not contain duplicates" });
    }
  });

export const SongCreativeIntentSchema = z
  .object({
    premise: LongIntentTextSchema,
    narrator_stance: ShortIntentTextSchema.optional(),
    addressee: ShortIntentTextSchema.optional(),
    central_tension: LongIntentTextSchema,
    state_at_start: ShortIntentTextSchema,
    intended_destination: ShortIntentTextSchema,
    listener_after: ShortIntentTextSchema.optional(),
    creative_invariants: z.array(z.string().min(1).max(500)).max(16).optional(),
  })
  .strict()
  .superRefine((intent, context) => {
    if (intent.creative_invariants
      && new Set(intent.creative_invariants).size !== intent.creative_invariants.length) {
      context.addIssue({
        code: "custom",
        path: ["creative_invariants"],
        message: "creative_invariants must not contain duplicates",
      });
    }
  });

export const SectionCreativeIntentSchema = z
  .object({
    id: IntentStableIdSchema,
    section_id: IntentStableIdSchema,
    dramatic_function: LongIntentTextSchema,
    state_before: ShortIntentTextSchema,
    intended_transition: LongIntentTextSchema,
    state_after: ShortIntentTextSchema,
    contrast_with_previous: ShortIntentTextSchema.optional(),
    inherited_delivery: ShortIntentTextSchema.optional(),
  })
  .strict();

export const PhraseLyricAnchorSchema = z
  .object({
    text: z.string().min(1).max(1000).optional(),
    lyric_unit_ids: UniqueIntentIdListSchema.optional(),
  })
  .strict()
  .refine((anchor) => anchor.text !== undefined || anchor.lyric_unit_ids !== undefined, {
    message: "A lyric anchor requires text or lyric_unit_ids",
  });

export const PhraseRealizationHypothesisSchema = z
  .object({
    summary: LongIntentTextSchema,
    melody: ShortIntentTextSchema.optional(),
    rhythm: ShortIntentTextSchema.optional(),
    harmony: ShortIntentTextSchema.optional(),
    register: ShortIntentTextSchema.optional(),
    dynamics: ShortIntentTextSchema.optional(),
    tuning: ShortIntentTextSchema.optional(),
    arrangement_space: ShortIntentTextSchema.optional(),
    expected_evidence: z.array(z.string().min(1).max(500)).max(16).optional(),
  })
  .strict();

export const PhraseRealizationLinksSchema = z
  .object({
    vocal_phrase_ids: UniqueIntentIdListSchema.optional(),
    lyric_unit_ids: UniqueIntentIdListSchema.optional(),
    event_ids: UniqueIntentIdListSchema.optional(),
    semantic_focus_object_ids: UniqueIntentIdListSchema.optional(),
    tuning_gesture_ids: UniqueIntentIdListSchema.optional(),
    chord_ids: UniqueIntentIdListSchema.optional(),
    track_ids: UniqueIntentIdListSchema.optional(),
  })
  .strict()
  .refine((links) => Object.values(links).some((values) => values !== undefined && values.length > 0), {
    message: "realization_links requires at least one linked object",
  });

export const PhraseDirectionSchema = z
  .object({
    id: IntentStableIdSchema,
    section_id: IntentStableIdSchema,
    importance: z.enum(["anchor", "supporting", "transition"]),
    lyric_anchor: PhraseLyricAnchorSchema.optional(),
    purpose: LongIntentTextSchema,
    addressed_to: ShortIntentTextSchema.optional(),
    semantic_focus: ShortIntentTextSchema,
    subtext: LongIntentTextSchema.optional(),
    state_before: ShortIntentTextSchema,
    intended_transition: LongIntentTextSchema,
    state_after: ShortIntentTextSchema,
    delivery_arc: LongIntentTextSchema,
    realization_hypothesis: PhraseRealizationHypothesisSchema.optional(),
    listening_question: z
      .object({
        id: IntentStableIdSchema,
        question: LongIntentTextSchema,
      })
      .strict(),
    realization_links: PhraseRealizationLinksSchema.optional(),
  })
  .strict();

export const CompositionIntentSchema = z
  .object({
    schema: z.literal("vocaloid-composition-intent/v1"),
    song: SongCreativeIntentSchema,
    sections: z.array(SectionCreativeIntentSchema).max(1024),
    phrase_directions: z.array(PhraseDirectionSchema).max(10_000),
  })
  .strict()
  .superRefine((intent, context) => {
    const objectIds = new Set<string>();
    const addObjectId = (id: string, path: (string | number)[]): void => {
      if (objectIds.has(id)) {
        context.addIssue({ code: "custom", path, message: `Duplicate composition-intent ID ${id}` });
      }
      objectIds.add(id);
    };
    const sectionTargets = new Set<string>();
    for (const [index, section] of intent.sections.entries()) {
      addObjectId(section.id, ["sections", index, "id"]);
      if (sectionTargets.has(section.section_id)) {
        context.addIssue({
          code: "custom",
          path: ["sections", index, "section_id"],
          message: `More than one section intent targets ${section.section_id}`,
        });
      }
      sectionTargets.add(section.section_id);
    }
    for (const [index, direction] of intent.phrase_directions.entries()) {
      addObjectId(direction.id, ["phrase_directions", index, "id"]);
      addObjectId(direction.listening_question.id, ["phrase_directions", index, "listening_question", "id"]);
    }
  });

export const IntentReviewPolicySchema = z
  .object({
    mode: z.enum(["off", "advisory", "required_for_delivery"]),
    require_song_intent: z.boolean(),
    require_section_intent: z.boolean(),
    minimum_anchor_phrases: z.number().int().min(0).max(32),
    require_current_audition_review: z.boolean(),
  })
  .strict();

export const IntentFidelityReviewBasisSchema = z
  .object({
    review_kind: z.literal("intent_fidelity"),
    phrase_direction_id: IntentStableIdSchema,
    listening_question_id: IntentStableIdSchema,
    intent_hash: IntentFingerprintSchema,
    composition_hash: IntentFingerprintSchema,
    artifact_id: IntentStableIdSchema,
    artifact_sha256: IntentFingerprintSchema,
    comparison_artifact_ids: z.array(IntentStableIdSchema).max(8).optional(),
    outcome: z.enum(["keep", "reject", "revise"]),
  })
  .strict()
  .superRefine((basis, context) => {
    const comparisons = basis.comparison_artifact_ids ?? [];
    if (new Set(comparisons).size !== comparisons.length) {
      context.addIssue({
        code: "custom",
        path: ["comparison_artifact_ids"],
        message: "comparison_artifact_ids must not contain duplicates",
      });
    }
    if (comparisons.includes(basis.artifact_id)) {
      context.addIssue({
        code: "custom",
        path: ["comparison_artifact_ids"],
        message: "The selected artifact cannot also be a comparison artifact",
      });
    }
  });

export type SongCreativeIntent = z.infer<typeof SongCreativeIntentSchema>;
export type SectionCreativeIntent = z.infer<typeof SectionCreativeIntentSchema>;
export type PhraseDirection = z.infer<typeof PhraseDirectionSchema>;
export type PhraseRealizationLinks = z.infer<typeof PhraseRealizationLinksSchema>;
export type CompositionIntent = z.infer<typeof CompositionIntentSchema>;
export type IntentReviewPolicy = z.infer<typeof IntentReviewPolicySchema>;
export type IntentFidelityReviewBasis = z.infer<typeof IntentFidelityReviewBasisSchema>;
