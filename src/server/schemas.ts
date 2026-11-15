import { z } from "zod";

import {
  CreativeDecisionCurrentnessSchema,
  CreativeDecisionInputSchema,
  CreativeDecisionPhaseSchema,
  CreativeJournalDeliverableInputSchema,
} from "../creative-journal.js";
import {
  CompositionIntentSchema,
  IntentAuditionLayerSchema,
  IntentFidelityReviewBasisSchema,
  IntentHypothesisFamilySchema,
  PhraseDirectionSchema,
  PhraseRealizationLinksSchema,
  SectionCreativeIntentSchema,
} from "../intent/types.js";
import { PhraseGrammarBlueprintSchema, PhraseGrammarCategorySchema } from "../phrase-grammar.js";
import {
  ManifestArrangementTrackSchema,
  ManifestEffectChainSchema,
  ManifestGrooveSchema,
  ManifestRemovalSchema,
  ManifestSectionDynamicsSchema,
  ManifestSectionSchema,
  ManifestTimelineUpdateSchema,
  ManifestTimeSignatureSchema,
  ManifestTransformSchema,
  ManifestTuningGestureSchema,
  ManifestVocalPartSchema,
  ManifestVocalPhraseSchema,
  ManifestVocalTrackMetadataSchema,
  ManifestVoiceSchema,
} from "../song-manifest.js";
import { TheoryProposalKindSchema } from "../theory/proposals.js";
import { CompositionGuidanceSchema, TheoryExceptionSchema } from "../theory/types.js";
import { PathSchema, ResponseFormatSchema } from "./results.js";

const ReadinessGateOutputSchema = z.object({
  ready: z.boolean(),
  blockers: z.array(z.string()),
}).strict();

const WorkflowReadinessOutputSchema = z.object({
  score: ReadinessGateOutputSchema,
  build: ReadinessGateOutputSchema,
  render: ReadinessGateOutputSchema,
  mix: ReadinessGateOutputSchema,
  delivery: ReadinessGateOutputSchema,
}).strict();

const PreflightIssueOutputSchema = z.object({
  origin: z.enum(["workflow", "theory"]),
  code: z.string(),
  severity: z.enum(["error", "warning", "info"]),
  domain: z.string(),
  message: z.string(),
  objectIds: z.array(z.string()),
  suggestedAction: z.string(),
  ruleVersion: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  targetFingerprint: z.string().optional(),
}).passthrough();

const TheoryPreflightSummaryOutputSchema = z.object({
  schema: z.literal("vocaloid-theory-report/v1"),
  rulesetId: z.string(),
  rulesetHash: z.string(),
  coverage: z.record(z.string(), z.number()),
  summary: z.object({
    errors: z.number().int(),
    warnings: z.number().int(),
    info: z.number().int(),
  }).strict(),
}).passthrough();

const CreativePreflightSummaryOutputSchema = z.object({
  schema: z.literal("vocaloid-creative-readiness/v1"),
  intentHash: z.string().nullable(),
  compositionHash: z.string(),
  status: z.enum(["missing_intent", "incomplete", "awaiting_listening", "revision_requested", "ready"]),
  coverage: z.record(z.string(), z.number()),
  findings: z.array(z.object({
    code: z.string(),
    severity: z.enum(["warning", "info"]),
    message: z.string(),
    objectIds: z.array(z.string()),
    phraseDirectionId: z.string().optional(),
  }).strict()),
}).passthrough();

const ReleasePolicyOutputSchema = z.object({
  enabled: z.boolean(),
  ready: z.boolean(),
  blockers: z.array(z.string()),
}).passthrough();

const TheoryProposalSummaryOutputSchema = z.object({
  schema: z.literal("vocaloid-theory-proposals/v1"),
  constraints: z.object({
    corpusAndStyleAccess: z.literal("forbidden"),
    applyRequiresDryRun: z.literal(true),
  }).passthrough(),
  summary: z.object({
    candidateCount: z.number().int(),
    unproposedIssueCount: z.number().int(),
  }).passthrough(),
  candidates: z.array(z.object({
    id: z.string(),
    kind: TheoryProposalKindSchema,
    sourceIssue: z.object({ code: z.string(), targetFingerprint: z.string() }).passthrough(),
    title: z.string(),
    predictedDelta: z.object({
      verification: z.literal("vocaloid_edit_song_dry_run"),
    }).passthrough(),
    apply: z.object({
      tool: z.literal("vocaloid_edit_song"),
      action: z.string(),
      requiredDryRun: z.literal(true),
    }).passthrough(),
    listeningCheck: z.object({
      required: z.literal(true),
      question: z.string(),
      preserveQuestionAcrossGroup: z.literal(true),
    }).passthrough(),
  }).passthrough()),
  unproposedIssues: z.array(z.object({
    code: z.string(),
    targetFingerprint: z.string(),
    reason: z.enum(["no_bounded_edit", "filtered_kind", "candidate_budget"]),
  }).strict()),
}).passthrough();

export const PreflightDataOutputSchema = z.object({
  path: z.string(),
  revision: z.number().int(),
  compositionHash: z.string(),
  mixHash: z.string(),
  songEndTick: z.number().int(),
  counts: z.object({
    sections: z.number().int(),
    vocalTracks: z.number().int(),
    vocalParts: z.number().int(),
    vocalEvents: z.number().int(),
    arrangementTracks: z.number().int(),
    artifacts: z.number().int(),
    errors: z.number().int(),
    warnings: z.number().int(),
    infos: z.number().int(),
    theoryIssues: z.number().int(),
    creativeFindings: z.number().int(),
  }).strict(),
  readiness: WorkflowReadinessOutputSchema,
  theory: TheoryPreflightSummaryOutputSchema,
  theoryProposals: TheoryProposalSummaryOutputSchema.optional(),
  creativeReadiness: CreativePreflightSummaryOutputSchema,
  releasePolicy: ReleasePolicyOutputSchema,
  checkedArtifactIds: z.array(z.string()),
  issues: z.array(PreflightIssueOutputSchema),
}).strict();

const ArtifactOutputSchema = z.object({
  id: z.string(),
  role: z.string(),
  path: z.string(),
  sha256: z.string(),
  source_revision: z.number().int(),
  source_composition_hash: z.string(),
  dependencies: z.array(z.string()),
}).passthrough();

export const ManifestWriteOutputSchema = z.object({
  path: z.string(),
  backupPath: z.string().optional(),
  revision: z.number().int(),
  compositionHash: z.string(),
  mixHash: z.string(),
  contentHash: z.string(),
  parentHash: z.string().optional(),
  bytes: z.number().int(),
}).strict();

export const JapaneseAlignmentDataOutputSchema = z.object({
  phrase: z.object({
    id: z.string(),
    allocation: z.enum(["sequential", "explicit"]),
    lyrics: z.array(z.object({ id: z.string(), lyric: z.string(), phonemes: z.string() }).passthrough()),
    cells: z.array(z.object({ id: z.string(), rest: z.boolean() }).passthrough()),
    linguistic_source: z.object({
      text: z.string(),
      reading: z.string(),
      normalized_reading: z.string(),
    }).passthrough(),
  }).passthrough(),
  g2p: z.object({
    fallback_count: z.number().int(),
    warnings: z.array(z.string()),
  }).passthrough(),
  alignment: z.object({
    lyric_units: z.number().int(),
    voiced_slots: z.number().int(),
    rest_slots: z.number().int(),
    continuations: z.number().int(),
  }).passthrough(),
  warnings: z.array(z.string()),
}).strict();

export const AudioQualityDataOutputSchema = z.object({
  path: z.string(),
  bytes: z.number().int(),
  audioFormat: z.enum(["pcm", "ieee_float"]),
  channels: z.number().int(),
  sampleRate: z.number().int(),
  bitsPerSample: z.number().int(),
  durationSeconds: z.number(),
  peakDbfs: z.number().nullable(),
  rmsDbfs: z.number().nullable(),
  clippedSampleValues: z.number().int(),
  stereoBalanceDb: z.number().nullable(),
  silent: z.boolean(),
  integratedLufs: z.number(),
  loudnessRangeLu: z.number(),
  truePeakDbfs: z.number(),
  targetLufs: z.number(),
  targetTruePeakDbfs: z.number(),
  loudnessDeltaLu: z.number(),
  sampleClipping: z.boolean(),
  truePeakExceeded: z.boolean(),
  channelImbalance: z.boolean(),
  recommendations: z.array(z.string()),
}).passthrough();

export const ManifestSummaryDataOutputSchema = z.object({
  path: z.string(),
  revision: z.number().int(),
  compositionHash: z.string(),
  mixHash: z.string(),
  contentHash: z.string(),
  slug: z.string(),
  title: z.string(),
  sections: z.array(z.object({ id: z.string(), kind: z.string() }).passthrough()),
  vocalTracks: z.array(z.object({ id: z.string(), name: z.string(), voiceId: z.string() }).passthrough()),
  arrangementTracks: z.array(z.object({ id: z.string(), kind: z.string() }).passthrough()),
  artifacts: z.array(z.object({
    id: z.string(),
    role: z.string(),
    path: z.string(),
    sourceRevision: z.number().int(),
    sourceCompositionHash: z.string(),
    sha256: z.string(),
    dependencies: z.array(z.string()),
    metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    currentComposition: z.boolean(),
    currentMix: z.boolean(),
  }).strict()),
}).passthrough();

export const ManifestSectionDataOutputSchema = z.object({
  revision: z.number().int(),
  contentHash: z.string(),
  section: z.object({ id: z.string(), name: z.string(), kind: z.string() }).passthrough(),
  vocalTracks: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()),
  arrangementTracks: z.array(z.object({ id: z.string(), name: z.string(), kind: z.string() }).passthrough()),
}).passthrough();

export const ManifestBuildDataOutputSchema = z.object({
  sourceRevision: z.number().int(),
  manifestRevision: z.number().int(),
  backing: z.object({ path: z.string(), channels: z.number().int(), silent: z.boolean(), sha256: z.string() }).passthrough(),
  project: z.object({ outputPath: z.string(), sha256: z.string() }).passthrough(),
  validation: z.object({ valid: z.boolean() }).passthrough(),
  artifacts: z.array(ArtifactOutputSchema),
}).passthrough();

export const StemRenderDataOutputSchema = z.object({
  sourceCompositionHash: z.string(),
  manifestRevision: z.number().int(),
  stems: z.array(z.object({
    trackId: z.string(),
    path: z.string(),
    channels: z.number().int(),
    sha256: z.string(),
  }).passthrough()),
  artifacts: z.array(ArtifactOutputSchema),
}).passthrough();

export const VocalAnalysisDataOutputSchema = z.object({
  schema: z.literal("vocaloid-score-render-analysis/v1"),
  sourceStemArtifact: z.string(),
  vocalTrackId: z.string(),
  summary: z.object({
    events: z.number().int(),
    eventsWithPitch: z.number().int(),
  }).passthrough(),
  outputPath: z.string(),
  artifact: ArtifactOutputSchema,
  manifestRevision: z.number().int(),
}).passthrough();

export const StemMixDataOutputSchema = z.object({
  sourceMixHash: z.string(),
  manifestRevision: z.number().int(),
  outputPath: z.string(),
  outputSha256: z.string(),
  inputs: z.array(z.object({ artifactId: z.string(), trackId: z.string(), sha256: z.string() }).passthrough()),
  quality: z.object({ integratedLufs: z.number(), truePeakDbfs: z.number(), clippedSampleValues: z.number().int(), channels: z.number().int() }).passthrough(),
  artifact: ArtifactOutputSchema,
}).passthrough();

export const ManifestMasterDataOutputSchema = z.object({
  sourceRevision: z.number().int(),
  sourceCompositionHash: z.string(),
  manifestRevision: z.number().int(),
  manifestContentHash: z.string(),
  projectArtifactId: z.string(),
  preflight: WorkflowReadinessOutputSchema,
  render: z.object({
    outputPath: z.string(),
    durationSeconds: z.number(),
    channels: z.number().int(),
    clippedSampleValues: z.number().int(),
    stereoBalanceDb: z.number().nullable(),
    editorSha256: z.string(),
    knownEditorFingerprint: z.boolean(),
    eventVerificationSeen: z.boolean(),
    preSendAdjusted: z.boolean(),
  }).passthrough(),
  artifact: ArtifactOutputSchema,
}).strict();

export const ManifestDeliveryDataOutputSchema = z.object({
  sourceRevision: z.number().int(),
  sourceCompositionHash: z.string(),
  manifestRevision: z.number().int(),
  manifestContentHash: z.string(),
  sourceArtifactId: z.string(),
  releasePolicy: ReleasePolicyOutputSchema,
  mastering: z.object({
    outputPath: z.string(),
    sourceClipped: z.boolean(),
    output: z.object({
      integratedLufs: z.number(),
      truePeakDbfs: z.number(),
      sampleClipping: z.boolean(),
      channelImbalance: z.boolean(),
      stereoBalanceDb: z.number().nullable(),
    }).passthrough(),
  }).passthrough(),
  artifact: ArtifactOutputSchema,
}).strict();

const VoiceProbeRecordOutputSchema = z.object({
  componentId: z.string(),
  voiceName: z.string(),
  status: z.enum(["verified", "unavailable", "error"]),
  expiresAt: z.string(),
  hostCacheKey: z.string(),
  reason: z.string(),
}).passthrough();

const RenderHostOutputSchema = z.object({
  editorSha256: z.string(),
  editorVersion: z.string(),
  knownEditorFingerprint: z.boolean(),
  helperSha256: z.string(),
  cacheKey: z.string(),
}).passthrough();

export const VoiceProbeDataOutputSchema = z.object({
  cached: z.boolean(),
  cachePath: z.string(),
  record: VoiceProbeRecordOutputSchema,
  host: RenderHostOutputSchema,
}).passthrough();

export const HostReadinessDataOutputSchema = z.object({
  editorLease: z.object({ requestId: z.string(), ownerAlive: z.boolean() }).passthrough().nullable(),
  verifiedComponentIds: z.array(z.string()),
  voiceRecords: z.array(VoiceProbeRecordOutputSchema),
  host: RenderHostOutputSchema,
}).passthrough();

export const ManifestHistoryDataOutputSchema = z.object({
  action: z.enum(["list", "diff", "restore"]),
  currentRevision: z.number().int().optional(),
  entries: z.array(z.object({ path: z.string(), revision: z.number().int(), contentHash: z.string() }).passthrough()).optional(),
  totalChanges: z.number().int().optional(),
  write: ManifestWriteOutputSchema.optional(),
}).passthrough();

const ReviewNoteOutputSchema = z.object({
  id: z.string(),
  author_type: z.enum(["human", "agent"]),
  observation: z.string(),
  section_id: z.string().optional(),
  object_ids: z.array(z.string()),
  artifact_ids: z.array(z.string()),
  status: z.enum(["open", "resolved"]),
}).passthrough();

export const ReviewSongDataOutputSchema = z.object({
  action: z.enum(["list", "add", "resolve"]),
  path: z.string(),
  revision: z.number().int(),
  contentHash: z.string(),
  notes: z.array(ReviewNoteOutputSchema),
}).strict();

const MutationAnalysisDeltaOutputSchema = z.object({
  introducedIssueCodes: z.array(z.string()),
  resolvedIssueCodes: z.array(z.string()),
  changedMetrics: z.array(z.object({ id: z.string() }).passthrough()),
  changedIntentEvidence: z.array(z.object({
    phraseDirectionId: z.string(),
    dimension: z.string(),
    feature: z.string(),
  }).passthrough()),
  creativeReviewWouldBecomeStale: z.boolean(),
  creativeReviewTransitions: z.array(z.object({
    phraseDirectionId: z.string(),
    before: z.string(),
    after: z.string(),
    staleReasons: z.array(z.string()),
  }).passthrough()),
  creativeStatus: z.object({ before: z.string(), after: z.string() }).strict(),
  staleExceptions: z.array(z.object({ id: z.string(), issue_code: z.string() }).passthrough()),
}).strict();

const MutationPreviewDataOutputSchema = z.object({
  dryRun: z.literal(true),
  source: z.object({ path: z.string(), revision: z.number().int(), contentHash: z.string() }).passthrough(),
  predicted: z.object({ revision: z.number().int(), contentHash: z.string() }).passthrough(),
  totalChanges: z.number().int(),
  readiness: WorkflowReadinessOutputSchema,
  theory: TheoryPreflightSummaryOutputSchema,
  creativeReadiness: CreativePreflightSummaryOutputSchema,
  releasePolicy: ReleasePolicyOutputSchema,
  analysisDelta: MutationAnalysisDeltaOutputSchema,
}).passthrough();

export const GrooveDeltaOutputSchema = z.object({
  event_id: z.string(),
  track_id: z.string(),
  source: z.enum(["direct", "pattern"]),
  timing_ticks: z.number().int(),
  swing_ticks: z.number().int(),
  random_timing_ticks: z.number().int(),
  velocity_delta: z.number().int(),
  gate_delta_ticks: z.number().int(),
}).strict();

export const AudioReviewDataOutputSchema = z.object({
  action: z.enum(["section_preview", "compare_ab", "anchor_preview", "compare_anchor_ab"]),
  manifestRevision: z.number().int(),
  sectionId: z.string(),
  phraseDirectionId: z.string().optional(),
  listeningQuestionId: z.string().optional(),
  auditionLayer: z.string().optional(),
  hypothesisFamily: z.string().optional(),
  outputPath: z.string().optional(),
  artifact: ArtifactOutputSchema.optional(),
  A: z.object({ sourceArtifactId: z.string(), outputPath: z.string(), gainDb: z.number() }).passthrough().optional(),
  B: z.object({ sourceArtifactId: z.string(), outputPath: z.string(), gainDb: z.number() }).passthrough().optional(),
}).passthrough();

export const ImportVsqxDataOutputSchema = z.object({
  manifestPath: z.string(),
  manifestRevision: z.number().int(),
  compositionHash: z.string(),
  imported: z.object({ tracks: z.number().int(), parts: z.number().int(), notes: z.number().int() }).passthrough(),
  warnings: z.array(z.string()),
  sourceArtifact: ArtifactOutputSchema,
}).passthrough();

const CreativeJournalActionSchema = z.enum(["record", "record_if_absent", "list", "report", "publish"]);

export const CreativeJournalDataOutputSchema = z.object({
  action: CreativeJournalActionSchema,
}).passthrough();

export const PhraseGrammarDataOutputSchema = z.object({
  action: z.enum(["catalog", "validate_blueprint", "analyze_manifest"]),
}).passthrough();

export const PhraseGrammarInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("catalog"),
    category: PhraseGrammarCategorySchema.optional(),
    bundle_id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/u).optional(),
    query: z.string().min(1).max(200).optional(),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(30),
    response_format: ResponseFormatSchema,
  }).strict(),
  z.object({
    action: z.literal("validate_blueprint"),
    blueprint: PhraseGrammarBlueprintSchema,
    response_format: ResponseFormatSchema,
  }).strict(),
  z.object({
    action: z.literal("analyze_manifest"),
    manifest_path: PathSchema,
    track_id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/u).optional(),
    maximum_pair_examples: z.number().int().min(0).max(50).default(12),
    response_format: ResponseFormatSchema,
  }).strict(),
]);

const PhraseGrammarActionSchema = z.enum(["catalog", "validate_blueprint", "analyze_manifest"]);

// Keep tools/list compact and make each strict action contract available only
// when it is needed. Runtime parsing still uses PhraseGrammarInputSchema.
export const PhraseGrammarToolInputSchema = z.object({
  action: PhraseGrammarActionSchema,
  payload: z.record(z.string(), z.unknown()).superRefine((payload, context) => {
    for (const reserved of ["action", "response_format"]) {
      if (Object.hasOwn(payload, reserved)) {
        context.addIssue({ code: "custom", path: [reserved], message: `${reserved} belongs in the tool envelope` });
      }
    }
  }).describe("Strict payload: vocaloid://phrase-grammar-contract/{action}"),
  response_format: ResponseFormatSchema,
}).strict();

export const PHRASE_GRAMMAR_ACTION_NAMES = PhraseGrammarActionSchema.options;

export const CreativeJournalActionRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("record"),
    manifest_path: PathSchema,
    expected_revision: z.number().int().min(1),
    decision: CreativeDecisionInputSchema,
    dry_run: z.boolean().default(false),
    response_format: ResponseFormatSchema,
  }).strict(),
  z.object({
    action: z.literal("record_if_absent"),
    manifest_path: PathSchema,
    expected_revision: z.number().int().min(1),
    decision: CreativeDecisionInputSchema,
    dry_run: z.boolean().default(false),
    response_format: ResponseFormatSchema,
  }).strict(),
  z.object({
    action: z.literal("list"),
    manifest_path: PathSchema,
    phases: z.array(CreativeDecisionPhaseSchema).min(1).max(15).optional(),
    currentness: CreativeDecisionCurrentnessSchema.optional(),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(20),
    response_format: ResponseFormatSchema,
  }).strict(),
  z.object({
    action: z.literal("report"),
    manifest_path: PathSchema,
    output_path: PathSchema.optional(),
    overwrite: z.boolean().default(false),
    response_format: ResponseFormatSchema,
  }).strict(),
  z.object({
    action: z.literal("publish"),
    manifest_path: PathSchema,
    expected_revision: z.number().int().min(1),
    output_directory: PathSchema,
    deliverables: z.array(CreativeJournalDeliverableInputSchema).min(2).max(32),
    overwrite: z.boolean().default(false),
    response_format: ResponseFormatSchema,
  }).strict(),
]);

export const CreativeJournalInputSchema = z.object({
  action: CreativeJournalActionSchema,
  payload: z.record(z.string(), z.unknown()).superRefine((payload, context) => {
    for (const reserved of ["action", "response_format"]) {
      if (Object.hasOwn(payload, reserved)) {
        context.addIssue({ code: "custom", path: [reserved], message: `${reserved} belongs in the tool envelope` });
      }
    }
  }).describe("See vocaloid://creative-journal-contract/{action}"),
  response_format: ResponseFormatSchema,
}).strict();

export const CREATIVE_JOURNAL_ACTION_NAMES = CreativeJournalActionSchema.options;

export const EditMutationActionSchema = z.enum([
  "set_composition_intent",
  "set_composition_guidance",
  "upsert_theory_exception",
  "upsert_section_intent",
  "upsert_phrase_direction",
  "bind_phrase_realization",
  "replace_timeline",
  "upsert_section",
  "upsert_vocal_part",
  "upsert_vocal_phrase",
  "apply_tuning",
  "upsert_arrangement",
  "apply_groove",
  "upsert_effect_chain",
  "upsert_section_dynamic",
  "transform_events",
  "remove_objects",
]);

export const EditSongDataOutputSchema = z.object({
  kind: z.enum(["tempo_curve", "mutation_preview", "mutation_applied"]),
  action: z.enum(["expand_tempo_curve", ...EditMutationActionSchema.options]),
  preview: MutationPreviewDataOutputSchema.optional(),
  write: ManifestWriteOutputSchema.optional(),
  totalChanges: z.number().int().optional(),
  readiness: WorkflowReadinessOutputSchema.optional(),
  evidence: z.object({ changedCount: z.number().int(), objectIds: z.array(z.string()) }).passthrough().optional(),
}).passthrough();

const MusicalPositionSchema = z
  .object({
    measure: z.number().int().min(0).max(100_000).describe("Zero-based song measure"),
    beat: z
      .number()
      .int()
      .min(0)
      .max(31)
      .describe("Zero-based beat in the active time signature denominator"),
    tick: z.number().int().min(0).max(1919).default(0).describe("Tick offset within the beat"),
  })
  .strict();

export const ManifestIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,95}$/u)
  .describe("Stable unique lowercase ID");

const ManifestMutationPathSchema = z
  .object({
    input_path: PathSchema.describe("Readable canonical .song.json manifest"),
    output_path: PathSchema.describe(
      "Destination .song.json; may equal input_path only with overwrite=true, which creates a backup",
    ),
    expected_revision: z.number().int().min(1).describe("Revision returned by the latest inspect/mutation"),
    overwrite: z.boolean().default(false),
    dry_run: z.boolean().default(false)
      .describe("Validate and return predicted music-aware diff/hashes/readiness without mutating the canonical manifest"),
    response_format: ResponseFormatSchema,
  })
  .strict();

export const EditSongActionRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("expand_tempo_curve"),
    time_signatures: z.array(ManifestTimeSignatureSchema).min(1).max(256),
    start: MusicalPositionSchema,
    end: MusicalPositionSchema,
    start_bpm: z.number().min(20).max(400),
    end_bpm: z.number().min(20).max(400),
    steps: z.number().int().min(2).max(256).default(8),
    curve: z.enum(["linear", "ease_in_out", "exponential"]).default("ease_in_out"),
    response_format: ResponseFormatSchema,
  }).strict(),
  ManifestMutationPathSchema.extend({
    action: z.literal("set_composition_intent"),
    composition_intent: CompositionIntentSchema,
  }).strict(),
  ManifestMutationPathSchema.extend({
    action: z.literal("set_composition_guidance"),
    composition_guidance: CompositionGuidanceSchema,
  }).strict(),
  ManifestMutationPathSchema.extend({
    action: z.literal("upsert_theory_exception"),
    theory_exception: TheoryExceptionSchema,
  }).strict(),
  ManifestMutationPathSchema.extend({
    action: z.literal("upsert_section_intent"),
    section_intent: SectionCreativeIntentSchema,
  }).strict(),
  ManifestMutationPathSchema.extend({
    action: z.literal("upsert_phrase_direction"),
    phrase_direction: PhraseDirectionSchema,
  }).strict(),
  ManifestMutationPathSchema.extend({
    action: z.literal("bind_phrase_realization"),
    phrase_direction_id: ManifestIdSchema,
    realization_links: PhraseRealizationLinksSchema,
  }).strict(),
  ManifestMutationPathSchema.extend({ action: z.literal("replace_timeline"), update: ManifestTimelineUpdateSchema }).strict(),
  ManifestMutationPathSchema.extend({ action: z.literal("upsert_section"), section: ManifestSectionSchema }).strict(),
  ManifestMutationPathSchema.extend({
    action: z.literal("upsert_vocal_part"),
    voice: ManifestVoiceSchema,
    track: ManifestVocalTrackMetadataSchema,
    part: ManifestVocalPartSchema,
  }).strict(),
  ManifestMutationPathSchema.extend({
    action: z.literal("upsert_vocal_phrase"),
    vocal_track_id: ManifestIdSchema,
    vocal_part_id: ManifestIdSchema,
    phrase: ManifestVocalPhraseSchema,
  }).strict(),
  ManifestMutationPathSchema.extend({
    action: z.literal("apply_tuning"),
    vocal_track_id: ManifestIdSchema,
    vocal_part_id: ManifestIdSchema,
    gestures: z.array(ManifestTuningGestureSchema).min(1).max(256),
    materialize_existing: z.boolean().default(false)
      .describe("Compile matching declarations that exist but lack compiler provenance; never replaces already materialized gestures"),
  }).strict(),
  ManifestMutationPathSchema.extend({ action: z.literal("upsert_arrangement"), track: ManifestArrangementTrackSchema }).strict(),
  ManifestMutationPathSchema.extend({ action: z.literal("apply_groove"), groove: ManifestGrooveSchema }).strict(),
  ManifestMutationPathSchema.extend({ action: z.literal("upsert_effect_chain"), effect_chain: ManifestEffectChainSchema }).strict(),
  ManifestMutationPathSchema.extend({ action: z.literal("upsert_section_dynamic"), section_dynamic: ManifestSectionDynamicsSchema }).strict(),
  ManifestMutationPathSchema.extend({ action: z.literal("transform_events"), transform: ManifestTransformSchema }).strict(),
  ManifestMutationPathSchema.extend({ action: z.literal("remove_objects"), removal: ManifestRemovalSchema }).strict(),
]);

// The complete action union is available on demand as an MCP resource. Keeping
// this small envelope in tools/list avoids injecting ~60 KB of mutually
// exclusive payload schemas into every agent turn while runtime parsing remains
// action-specific, strict, and fully bounded.
export const EditSongInputSchema = z.object({
  action: z.enum(["expand_tempo_curve", ...EditMutationActionSchema.options]),
  payload: z.record(z.string(), z.json()).superRefine((payload, context) => {
    for (const reserved of ["action", "response_format"]) {
      if (Object.hasOwn(payload, reserved)) {
        context.addIssue({ code: "custom", path: [reserved], message: `${reserved} belongs in the tool envelope` });
      }
    }
  }).describe("Strict action payload; read vocaloid://edit-song-contract for the selected action schema"),
  response_format: ResponseFormatSchema,
}).strict();

export const EDIT_SONG_ACTION_NAMES = ["expand_tempo_curve", ...EditMutationActionSchema.options] as const;

export const AudioReviewInputSchema = z.object({
  action: z.enum(["section_preview", "compare_ab", "anchor_preview", "compare_anchor_ab"]),
  manifest_path: PathSchema,
  expected_revision: z.number().int().min(1),
  source_artifact_id: ManifestIdSchema.optional(),
  section_id: ManifestIdSchema.optional(),
  artifact_a_id: ManifestIdSchema.optional(),
  artifact_b_id: ManifestIdSchema.optional(),
  phrase_direction_id: ManifestIdSchema.optional(),
  audition_layer: IntentAuditionLayerSchema.optional(),
  hypothesis_family: IntentHypothesisFamilySchema.optional(),
  output_path: PathSchema.optional(),
  output_a_path: PathSchema.optional(),
  output_b_path: PathSchema.optional(),
  handle_before_seconds: z.number().min(0).max(15).default(1),
  handle_after_seconds: z.number().min(0).max(15).default(2),
  target_duration_seconds: z.number().min(20).max(30).default(25),
  reference_lufs: z.number().min(-36).max(-5).default(-16),
  match_lufs: z.number().min(-36).max(-8).optional(),
  reference_true_peak_dbfs: z.number().min(-12).max(0).default(-1),
  response_format: ResponseFormatSchema,
}).strict().superRefine((input, context) => {
  const requiredByAction: Record<typeof input.action, readonly (keyof typeof input)[]> = {
    section_preview: ["source_artifact_id", "section_id", "output_path"],
    compare_ab: ["artifact_a_id", "artifact_b_id", "section_id", "output_a_path", "output_b_path"],
    anchor_preview: ["source_artifact_id", "phrase_direction_id", "audition_layer", "output_path"],
    compare_anchor_ab: [
      "artifact_a_id", "artifact_b_id", "phrase_direction_id", "audition_layer",
      "hypothesis_family", "output_a_path", "output_b_path",
    ],
  };
  for (const field of requiredByAction[input.action]) {
    if (input[field] === undefined) {
      context.addIssue({ code: "custom", path: [field], message: `${field} is required for ${input.action}` });
    }
  }
});

export const ReviewSongInputSchema = z.object({
  action: z.enum(["list", "add", "resolve"]),
  manifest_path: PathSchema,
  status: z.enum(["open", "resolved", "all"]).default("open"),
  section_id: ManifestIdSchema.optional(),
  expected_revision: z.number().int().min(1).optional(),
  note: z.object({
    id: ManifestIdSchema,
    author_type: z.enum(["human", "agent"]),
    author_name: z.string().min(1).max(128),
    observation: z.string().min(1).max(4000),
    section_id: ManifestIdSchema.optional(),
    object_ids: z.array(ManifestIdSchema).max(256).default([]),
    artifact_ids: z.array(ManifestIdSchema).max(64).default([]),
    position: MusicalPositionSchema.optional(),
    intent_fidelity: IntentFidelityReviewBasisSchema.optional(),
  }).strict().optional(),
  note_id: ManifestIdSchema.optional(),
  resolution: z.string().min(1).max(4000).optional(),
  response_format: ResponseFormatSchema,
}).strict().superRefine((input, context) => {
  const required = input.action === "add"
    ? ["expected_revision", "note"] as const
    : input.action === "resolve"
      ? ["expected_revision", "note_id", "resolution"] as const
      : [];
  for (const field of required) {
    if (input[field] === undefined) {
      context.addIssue({ code: "custom", path: [field], message: `${field} is required for ${input.action}` });
    }
  }
});
