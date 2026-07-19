import { createHash } from "node:crypto";

import { z } from "zod";

import { buildAnchorAuditionPlan } from "../intent/audition.js";
import { currentTechnicalArtifactIds } from "../intent/review.js";
import {
  PhraseDirectionSchema,
  SectionCreativeIntentSchema,
  SongCreativeIntentSchema,
  type PhraseDirection,
} from "../intent/types.js";
import { loadSongManifest, type SongManifest } from "../song-manifest.js";
import { preflightSongManifest, type SongPreflightResult } from "../song-preflight.js";


const StableIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/u);
const FingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);

export const IntentFirstBenchmarkSpecSchema = z.object({
  schema: z.literal("vocaloid-intent-first-benchmark-spec/v1"),
  benchmark_id: StableIdSchema,
  version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/u),
  seed: z.string().min(1).max(128),
  manifest: z.object({
    song_id: StableIdSchema,
    slug: StableIdSchema,
    title: z.string().min(1).max(256),
    section_ids: z.array(StableIdSchema).min(1).max(16),
  }).strict(),
  voice: z.object({
    name: z.string().min(1).max(128),
    component_id: z.string().regex(/^[A-Z0-9]{16}$/u),
  }).strict(),
  fixed_intent: z.object({
    song: SongCreativeIntentSchema,
    section: SectionCreativeIntentSchema,
    anchor: PhraseDirectionSchema.omit({
      realization_hypothesis: true,
      realization_links: true,
    }).extend({ importance: z.literal("anchor") }).strict(),
  }).strict(),
  lyrics: z.array(z.object({
    id: StableIdSchema,
    surface_text: z.string().min(1).max(1000),
    reading: z.string().min(1).max(1000),
    role: z.enum(["lead_in", "anchor", "release"]),
  }).strict()).min(1).max(16),
  isolation: z.object({
    mcp_profile: z.literal("production"),
    corpus_access: z.literal("forbidden"),
    style_profile_access: z.literal("forbidden"),
    reference_track_access: z.literal("forbidden"),
    shell_access: z.literal("forbidden"),
    network_access: z.literal("forbidden"),
  }).strict(),
  acceptance: z.object({
    minimum_anchor_phrases: z.number().int().min(1).max(3),
    maximum_anchor_phrases: z.number().int().min(1).max(3),
    required_audition_layers: z.tuple([
      z.literal("lead_solo"),
      z.literal("lead_harmony"),
      z.literal("minimal_band"),
    ]),
    minimum_audition_seconds: z.number().min(20).max(30),
    maximum_audition_seconds: z.number().min(20).max(30),
    required_review_severities: z.array(z.enum(["warning", "info"])).max(2),
    require_single_question_ab: z.literal(true),
    require_human_keep_for_gate_2a: z.literal(true),
  }).strict(),
}).strict().superRefine((spec, context) => {
  if (new Set(spec.manifest.section_ids).size !== spec.manifest.section_ids.length) {
    context.addIssue({
      code: "custom",
      path: ["manifest", "section_ids"],
      message: "Benchmark section_ids must not contain duplicates",
    });
  }
  if (new Set(spec.lyrics.map((lyric) => lyric.id)).size !== spec.lyrics.length) {
    context.addIssue({
      code: "custom",
      path: ["lyrics"],
      message: "Benchmark lyric IDs must not contain duplicates",
    });
  }
  for (const role of ["lead_in", "anchor", "release"] as const) {
    if (spec.lyrics.filter((lyric) => lyric.role === role).length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["lyrics"],
        message: `Benchmark requires exactly one ${role} lyric segment`,
      });
    }
  }
  if (new Set(spec.acceptance.required_review_severities).size
    !== spec.acceptance.required_review_severities.length) {
    context.addIssue({
      code: "custom",
      path: ["acceptance", "required_review_severities"],
      message: "required_review_severities must not contain duplicates",
    });
  }
  if (spec.acceptance.maximum_anchor_phrases < spec.acceptance.minimum_anchor_phrases) {
    context.addIssue({
      code: "custom",
      path: ["acceptance", "maximum_anchor_phrases"],
      message: "maximum_anchor_phrases must be at least minimum_anchor_phrases",
    });
  }
  if (spec.acceptance.maximum_audition_seconds < spec.acceptance.minimum_audition_seconds) {
    context.addIssue({
      code: "custom",
      path: ["acceptance", "maximum_audition_seconds"],
      message: "maximum_audition_seconds must be at least minimum_audition_seconds",
    });
  }
  if (!spec.manifest.section_ids.includes(spec.fixed_intent.section.section_id)) {
    context.addIssue({
      code: "custom",
      path: ["fixed_intent", "section", "section_id"],
      message: "Fixed section intent must target one benchmark manifest section",
    });
  }
  if (spec.fixed_intent.anchor.section_id !== spec.fixed_intent.section.section_id) {
    context.addIssue({
      code: "custom",
      path: ["fixed_intent", "anchor", "section_id"],
      message: "Fixed anchor and section intent must target the same section",
    });
  }
});

export type IntentFirstBenchmarkSpec = z.infer<typeof IntentFirstBenchmarkSpecSchema>;

export const IntentFirstBenchmarkTraceSchema = z.object({
  schema: z.literal("vocaloid-intent-first-benchmark-trace/v1"),
  benchmark_id: StableIdSchema,
  client: z.string().min(1).max(256),
  profile: z.literal("production"),
  session: z.object({
    id: StableIdSchema,
    producer: z.literal("vocaloid-intent-first-harness"),
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/u),
    started_at: z.string().datetime(),
    completed_at: z.string().datetime(),
  }).strict(),
  client_transcript: z.object({
    format: z.literal("codex-jsonl/v1"),
    sha256: FingerprintSchema,
    bytes: z.number().int().positive(),
    vocaloid_mcp_calls: z.number().int().min(0),
    non_vocaloid_tool_calls: z.number().int().min(0),
    non_vocaloid_item_types: z.array(z.string().min(1).max(128)).max(64),
    trace_tool_calls_matched: z.boolean(),
  }).strict().optional(),
  isolation: z.object({
    fresh_workspace: z.literal(true),
    shell_access: z.literal("forbidden"),
    network_access: z.literal("forbidden"),
    other_mcp_access: z.literal("forbidden"),
    corpus_mounted: z.literal(false),
  }).strict(),
  steps: z.array(z.object({
    sequence: z.number().int().min(1),
    actor: z.enum(["agent", "human", "harness"]),
    operation: z.enum(["tool", "resource"]),
    name: z.string().min(1).max(256),
    action: z.string().min(1).max(128).optional(),
    dry_run: z.boolean().optional(),
    mutation_fingerprint: FingerprintSchema.optional(),
    object_ids: z.array(StableIdSchema).max(256).optional(),
    ok: z.boolean(),
    error_code: z.string().regex(/^[A-Z][A-Z0-9_]{1,95}$/u).optional(),
  }).strict()).max(5000),
}).strict().superRefine((trace, context) => {
  if (Date.parse(trace.session.completed_at) < Date.parse(trace.session.started_at)) {
    context.addIssue({
      code: "custom",
      path: ["session", "completed_at"],
      message: "Trace completion must not precede session start",
    });
  }
  for (let index = 0; index < trace.steps.length; index += 1) {
    const step = trace.steps[index]!;
    if (step.sequence !== index + 1) {
      context.addIssue({
        code: "custom",
        path: ["steps", index, "sequence"],
        message: "Trace sequences must be contiguous and start at 1",
      });
    }
    if (step.actor === "human" && (
      step.operation !== "tool"
      || step.name !== "vocaloid_review_song"
      || step.action !== "add"
      || !step.ok
      || (step.object_ids?.length ?? 0) === 0
    )) {
      context.addIssue({
        code: "custom",
        path: ["steps", index, "actor"],
        message: "A human trace step must be a successful vocaloid_review_song/add with the persisted review-note ID",
      });
    }
    if (step.name === "vocaloid_edit_song" && step.actor !== "agent") {
      context.addIssue({
        code: "custom",
        path: ["steps", index, "actor"],
        message: "Benchmark score edits must be performed by the isolated agent",
      });
    }
    if (step.name === "vocaloid_edit_song" && (
      step.action === undefined
      || step.dry_run === undefined
      || step.mutation_fingerprint === undefined
    )) {
      context.addIssue({
        code: "custom",
        path: ["steps", index],
        message: "Every vocaloid_edit_song trace step requires action, dry_run, and mutation_fingerprint",
      });
    }
    if (step.ok && step.error_code !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["steps", index, "error_code"],
        message: "A successful trace step cannot carry error_code",
      });
    }
  }
});

export type IntentFirstBenchmarkTrace = z.infer<typeof IntentFirstBenchmarkTraceSchema>;

export const IntentFirstBenchmarkCheckSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9._-]{1,95}$/u),
  gate: z.enum(["gate_1", "gate_2", "gate_2a"]),
  status: z.enum(["pass", "fail", "pending"]),
  message: z.string().min(1).max(2000),
  objectIds: z.array(z.string()).max(256),
}).strict();

export const IntentFirstBenchmarkResultSchema = z.object({
  schema: z.literal("vocaloid-intent-first-benchmark-result/v1"),
  benchmarkId: StableIdSchema,
  specVersion: z.string(),
  specHash: FingerprintSchema,
  status: z.enum(["failed", "in_progress", "awaiting_human_listening", "revision_requested", "passed"]),
  manifest: z.object({
    path: z.string(),
    revision: z.number().int().min(1),
    contentHash: FingerprintSchema,
    compositionHash: FingerprintSchema,
    mixHash: FingerprintSchema,
  }).strict(),
  provenance: z.object({
    theoryRulesetId: z.string(),
    theoryRulesetHash: FingerprintSchema,
    intentHash: FingerprintSchema.nullable(),
    tracePresent: z.boolean(),
  }).strict(),
  gates: z.object({
    gate1: z.enum(["pass", "fail", "pending"]),
    gate2: z.enum(["pass", "fail", "pending"]),
    gate2a: z.enum(["pass", "fail", "pending"]),
  }).strict(),
  metrics: z.object({
    invalidToolCalls: z.number().int().min(0),
    structuralTheoryIssues: z.number().int().min(0),
    unresolvedRequiredTheoryIssues: z.number().int().min(0),
    anchors: z.number().int().min(0),
    currentAuditionLadders: z.number().int().min(0),
    currentKeepReviews: z.number().int().min(0),
    humanConfirmedAnchors: z.number().int().min(0),
  }).strict(),
  checks: z.array(IntentFirstBenchmarkCheckSchema).min(1).max(128),
}).strict();

export type IntentFirstBenchmarkResult = z.infer<typeof IntentFirstBenchmarkResultSchema>;

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

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function intentFirstMutationFingerprint(
  action: string,
  payload: Readonly<Record<string, unknown>>,
): string {
  const { dry_run: _dryRun, ...writeEquivalentPayload } = payload;
  return hash({ action, payload: writeEquivalentPayload });
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function fixedAnchor(direction: PhraseDirection) {
  const {
    realization_hypothesis: _hypothesis,
    realization_links: _links,
    ...fixed
  } = direction;
  return fixed;
}

type Check = z.infer<typeof IntentFirstBenchmarkCheckSchema>;

function check(
  id: string,
  gate: Check["gate"],
  status: Check["status"],
  message: string,
  objectIds: string[] = [],
): Check {
  return IntentFirstBenchmarkCheckSchema.parse({ id, gate, status, message, objectIds });
}

function gateStatus(checks: readonly Check[], gate: Check["gate"]): "pass" | "fail" | "pending" {
  const selected = checks.filter((entry) => entry.gate === gate);
  if (selected.some((entry) => entry.status === "fail")) return "fail";
  if (selected.some((entry) => entry.status === "pending")) return "pending";
  return "pass";
}

const SCORE_ACTIONS = new Set([
  "replace_timeline",
  "upsert_section",
  "upsert_vocal_part",
  "upsert_vocal_phrase",
  "apply_tuning",
  "upsert_arrangement",
  "apply_groove",
  "transform_events",
  "remove_objects",
]);

const PRODUCTION_TOOLS = new Set([
  "vocaloid_host_readiness",
  "vocaloid_probe_voice",
  "vocaloid_align_japanese_phrase",
  "vocaloid_create_song_manifest",
  "vocaloid_import_vsqx_manifest",
  "vocaloid_edit_song",
  "vocaloid_inspect_song_manifest",
  "vocaloid_preflight_song",
  "vocaloid_get_song_section",
  "vocaloid_build_song_manifest",
  "vocaloid_render_instrument_stems",
  "vocaloid_render_vocal_stems",
  "vocaloid_analyze_vocal_stem",
  "vocaloid_render_stem_mix",
  "vocaloid_render_manifest_master",
  "vocaloid_master_manifest_delivery",
  "vocaloid_review_audio",
  "vocaloid_review_song",
  "vocaloid_manifest_history",
  "vocaloid_analyze_wav",
]);

function tracedToolArtifacts(
  trace: IntentFirstBenchmarkTrace | undefined,
  name: string,
  action?: string,
): Set<string> {
  return new Set((trace?.steps ?? []).filter((step) =>
    step.operation === "tool"
    && step.ok
    && step.name === name
    && (action === undefined || step.action === action))
    .flatMap((step) => step.object_ids ?? []));
}

function traceChecks(spec: IntentFirstBenchmarkSpec, trace: IntentFirstBenchmarkTrace | undefined): Check[] {
  if (!trace) {
    return [check(
      "isolation.trace",
      "gate_2",
      "fail",
      "No isolated production-MCP trace was supplied; manifest state alone cannot prove the composition process boundary.",
    )];
  }
  const checks: Check[] = [];
  const isolationMatches = trace.benchmark_id === spec.benchmark_id
    && trace.profile === spec.isolation.mcp_profile
    && trace.isolation.fresh_workspace
    && trace.isolation.shell_access === spec.isolation.shell_access
    && trace.isolation.network_access === spec.isolation.network_access
    && trace.isolation.other_mcp_access === "forbidden"
    && !trace.isolation.corpus_mounted;
  checks.push(check(
    "isolation.environment",
    "gate_2",
    isolationMatches ? "pass" : "fail",
    isolationMatches
      ? "Trace records a fresh production-MCP-only workspace with no shell, network, other MCP, or corpus mount."
      : "Trace isolation does not match the benchmark contract.",
  ));

  const agentToolCalls = trace.steps.filter((step) => step.actor === "agent"
    && step.operation === "tool").length;
  const transcriptClean = trace.client_transcript !== undefined
    && trace.client_transcript.non_vocaloid_tool_calls === 0
    && trace.client_transcript.non_vocaloid_item_types.length === 0
    && trace.client_transcript.trace_tool_calls_matched
    && trace.client_transcript.vocaloid_mcp_calls >= agentToolCalls;
  checks.push(check(
    "isolation.client_transcript",
    "gate_2",
    transcriptClean ? "pass" : "fail",
    transcriptClean
      ? `Fail-closed Codex JSONL audit found ${trace.client_transcript!.vocaloid_mcp_calls} VOCALOID MCP call(s) and no other tool execution.`
      : "A finalized Codex JSONL audit is missing, incomplete, or records non-VOCALOID tool execution.",
  ));

  const prohibited = trace.steps.filter((step) =>
    /(?:vocaloid:\/\/styles(?:\/|\s|$)|corpus|nearest[_ -]?reference|reference[_ -]?track|style[_ -]?profile)/iu
      .test(`${step.name} ${step.action ?? ""}`));
  checks.push(check(
    "isolation.no_corpus_style_reference",
    "gate_2",
    prohibited.length === 0 ? "pass" : "fail",
    prohibited.length === 0
      ? "Trace contains no corpus, style-profile, or reference-track access."
      : `Trace contains ${prohibited.length} prohibited corpus/style/reference operation(s).`,
  ));

  const outsideProduction = trace.steps.filter((step) =>
    step.operation === "tool" && !PRODUCTION_TOOLS.has(step.name));
  checks.push(check(
    "isolation.production_surface_only",
    "gate_2",
    outsideProduction.length === 0 ? "pass" : "fail",
    outsideProduction.length === 0
      ? "Every recorded tool call belongs to the 20-tool production MCP profile."
      : `${outsideProduction.length} tool call(s) fall outside the production MCP profile.`,
  ));

  const successfulWrites = trace.steps.filter((step) => step.operation === "tool"
    && step.actor === "agent"
    && step.name === "vocaloid_edit_song" && step.ok && step.dry_run === false);
  const missingDryRuns = successfulWrites.filter((write) => !write.mutation_fingerprint
    || !trace.steps.some((candidate) => candidate.sequence < write.sequence
      && candidate.operation === "tool"
      && candidate.actor === "agent"
      && candidate.name === "vocaloid_edit_song"
      && candidate.ok
      && candidate.dry_run === true
      && candidate.mutation_fingerprint === write.mutation_fingerprint));
  checks.push(check(
    "workflow.dry_run_before_write",
    "gate_2",
    successfulWrites.length > 0 && missingDryRuns.length === 0 ? "pass" : "fail",
    successfulWrites.length === 0
      ? "Trace contains no successful bounded edit write."
      : missingDryRuns.length === 0
        ? `All ${successfulWrites.length} bounded edit write(s) have an earlier matching dry-run.`
        : `${missingDryRuns.length} bounded edit write(s) lack an earlier matching dry-run fingerprint.`,
  ));

  const intentWrite = successfulWrites.find((step) => step.action === "set_composition_intent");
  const firstScoreWrite = successfulWrites.find((step) => SCORE_ACTIONS.has(step.action ?? ""));
  const intentFirst = intentWrite !== undefined
    && (firstScoreWrite === undefined || intentWrite.sequence < firstScoreWrite.sequence);
  checks.push(check(
    "workflow.intent_before_score",
    "gate_2",
    intentFirst ? "pass" : "fail",
    intentFirst
      ? "The fixed song/section/phrase intent was written before the first score or arrangement mutation."
      : "Trace does not prove that composition intent preceded score/arrangement mutation.",
  ));
  return checks;
}

function phraseSources(manifest: SongManifest): Array<{ text: string; reading: string }> {
  return manifest.vocal_tracks.flatMap((track) => track.parts.flatMap((part) =>
    part.phrases.flatMap((phrase) => phrase.linguistic_source
      ? [{
        text: phrase.linguistic_source.text,
        reading: phrase.linguistic_source.reading,
      }]
      : [])));
}

function benchmarkChecks(
  manifest: SongManifest,
  spec: IntentFirstBenchmarkSpec,
  preflight: SongPreflightResult,
  trace: IntentFirstBenchmarkTrace | undefined,
): Check[] {
  const checks = traceChecks(spec, trace);
  const intent = manifest.composition_intent;
  const identityMatches = manifest.song_id === spec.manifest.song_id
    && manifest.slug === spec.manifest.slug
    && manifest.title === spec.manifest.title
    && equal(manifest.sections.map((section) => section.id), spec.manifest.section_ids);
  checks.push(check(
    "contract.fixed_manifest",
    "gate_1",
    identityMatches ? "pass" : "fail",
    identityMatches ? "Manifest identity and section scope match the fixed benchmark." : "Manifest identity/sections diverge from the fixed benchmark.",
    manifest.sections.map((section) => section.id),
  ));

  const sectionIntent = intent?.sections.find((entry) => entry.id === spec.fixed_intent.section.id);
  const anchor = intent?.phrase_directions.find((entry) => entry.id === spec.fixed_intent.anchor.id);
  const fixedIntentMatches = intent !== undefined
    && equal(intent.song, spec.fixed_intent.song)
    && equal(sectionIntent, spec.fixed_intent.section)
    && anchor !== undefined
    && equal(fixedAnchor(anchor), spec.fixed_intent.anchor);
  checks.push(check(
    "contract.fixed_intent_question",
    "gate_1",
    fixedIntentMatches ? "pass" : "fail",
    fixedIntentMatches
      ? "Song, section, anchor purpose, semantic focus, transition, delivery arc, and listening question match the fixed brief."
      : "Canonical intent does not preserve the fixed benchmark brief/question exactly.",
    anchor ? [anchor.id, anchor.listening_question.id] : [],
  ));

  const sources = phraseSources(manifest);
  const missingLyrics = spec.lyrics.filter((lyric) => !sources.some((source) =>
    source.text === lyric.surface_text && source.reading === lyric.reading));
  checks.push(check(
    "contract.lyric_reading_provenance",
    "gate_1",
    missingLyrics.length === 0 ? "pass" : "fail",
    missingLyrics.length === 0
      ? "Every fixed lyric segment preserves separate surface text and explicit Japanese reading provenance."
      : `${missingLyrics.length} fixed lyric segment(s) are absent from phrase linguistic_source provenance.`,
  ));

  const voicePresent = manifest.voices.some((voice) =>
    voice.component_id === spec.voice.component_id && voice.name === spec.voice.name);
  checks.push(check(
    "contract.voice_identity",
    "gate_1",
    voicePresent ? "pass" : "fail",
    voicePresent
      ? `Manifest uses fixed ${spec.voice.name}/${spec.voice.component_id} identity.`
      : `Manifest does not contain fixed ${spec.voice.name}/${spec.voice.component_id} identity.`,
  ));

  const styleFree = manifest.composition_guidance?.style_profile === undefined;
  checks.push(check(
    "isolation.no_style_pin",
    "gate_2",
    styleFree ? "pass" : "fail",
    styleFree ? "Composition guidance has no style profile pin." : "Benchmark manifest contains a forbidden style profile pin.",
  ));

  const anchors = preflight.creativeReadiness.directions.filter((direction) => direction.importance === "anchor");
  const anchorCountInRange = anchors.length >= spec.acceptance.minimum_anchor_phrases
    && anchors.length <= spec.acceptance.maximum_anchor_phrases;
  checks.push(check(
    "intent.anchor_coverage",
    "gate_2",
    preflight.creativeReadiness.coverage.sections === 1 && anchorCountInRange ? "pass" : "fail",
    `Section intent coverage is ${preflight.creativeReadiness.coverage.sections.toFixed(3)} with ${anchors.length} anchor phrase(s).`,
    anchors.map((entry) => entry.phraseDirectionId),
  ));

  const anchorReport = anchors.find((entry) => entry.phraseDirectionId === spec.fixed_intent.anchor.id);
  const anchorBound = anchorReport?.binding.bound === true && anchorReport.binding.semanticFocusBound;
  checks.push(check(
    "intent.anchor_realization_binding",
    "gate_2",
    anchorBound ? "pass" : "fail",
    anchorBound
      ? "The fixed anchor and semantic focus are bound to current stable vocal realization objects."
      : "The fixed anchor or semantic focus is not bound to current vocal objects.",
    anchorReport?.binding.linkedObjectIds ?? [],
  ));

  let passageReady = false;
  let passageMessage = "The fixed anchor cannot form a bounded audition passage.";
  try {
    const plan = buildAnchorAuditionPlan(manifest, spec.fixed_intent.anchor.id, 25);
    passageReady = plan.passage.targetDurationMet
      && plan.passage.durationSeconds >= spec.acceptance.minimum_audition_seconds
      && plan.passage.durationSeconds <= spec.acceptance.maximum_audition_seconds;
    passageMessage = passageReady
      ? `The fixed anchor resolves to a ${plan.passage.durationSeconds.toFixed(3)} second passage inside its section.`
      : `The fixed anchor passage is ${plan.passage.durationSeconds.toFixed(3)} seconds, outside the accepted window.`;
  } catch (error) {
    passageMessage = `Cannot build the fixed anchor passage: ${error instanceof Error ? error.message : String(error)}`;
  }
  checks.push(check(
    "score.anchor_passage_duration",
    "gate_2",
    passageReady ? "pass" : "fail",
    passageMessage,
    [spec.fixed_intent.anchor.id, spec.fixed_intent.section.section_id],
  ));

  const pitchedTracks = manifest.accompaniment.tracks.filter((track) => track.kind === "pitched");
  const bassTracks = pitchedTracks.filter((track) => {
    const pitches = [
      ...track.notes.map((note) => note.note_number),
      ...track.patterns.flatMap((pattern) => pattern.notes.map((note) => note.note_number)),
    ];
    return (track.program >= 32 && track.program <= 39)
      || (/bass/iu.test(track.name) && pitches.some((pitch) => pitch <= 52));
  });
  const harmonicTracks = pitchedTracks.filter((track) => !bassTracks.some((bass) => bass.id === track.id));
  const drumTracks = manifest.accompaniment.tracks.filter((track) => track.kind === "drums"
    && (track.hits.length > 0 || track.placements.length > 0));
  const minimalBandReady = bassTracks.length > 0 && harmonicTracks.length > 0 && drumTracks.length > 0;
  checks.push(check(
    "score.minimal_band_roles",
    "gate_2",
    minimalBandReady ? "pass" : "fail",
    minimalBandReady
      ? "The score contains distinct bass, drums, and core harmonic-instrument roles."
      : "The score must contain distinct bass, drums, and core harmonic-instrument roles before minimal-band audition.",
    [...bassTracks, ...harmonicTracks, ...drumTracks].map((track) => track.id),
  ));

  const voicedTracks = manifest.vocal_tracks.filter((track) => track.parts.some((part) =>
    part.notes.length > 0 || part.phrases.length > 0));
  checks.push(check(
    "score.lead_harmony_roles",
    "gate_2",
    voicedTracks.length >= 2 ? "pass" : "fail",
    voicedTracks.length >= 2
      ? "The score contains separate lead and harmony vocal realizations."
      : "A lead_harmony audition requires a second explicit vocal realization, not only a preview label.",
    voicedTracks.map((track) => track.id),
  ));

  const structuralIssues = preflight.theory.issues.filter((issue) => issue.severity === "error");
  checks.push(check(
    "theory.structural_readiness",
    "gate_1",
    preflight.readiness.build.ready && structuralIssues.length === 0 ? "pass" : "fail",
    preflight.readiness.build.ready
      ? "Shared theory/build preflight has no structural blocker."
      : `Build is blocked by ${preflight.readiness.build.blockers.join(", ")}.`,
    structuralIssues.flatMap((issue) => issue.objectIds).slice(0, 256),
  ));

  const requiredSeverities = manifest.composition_guidance?.required_review_severities ?? [];
  const warningPolicyMatches = equal(requiredSeverities, spec.acceptance.required_review_severities);
  const unresolvedRequired = preflight.releasePolicy.unresolvedTheoryIssues;
  const warningReady = warningPolicyMatches
    && unresolvedRequired.length === 0
    && preflight.theory.staleExceptions.length === 0;
  checks.push(check(
    "theory.required_warning_disposition",
    "gate_2",
    warningReady ? "pass" : "fail",
    warningReady
      ? "All policy-required theory findings are repaired or covered by current exact exceptions."
      : `${unresolvedRequired.length} required finding(s) remain or the benchmark warning policy does not match.`,
    unresolvedRequired.flatMap((issue) => issue.objectIds).slice(0, 256),
  ));

  const currentIds = currentTechnicalArtifactIds(
    manifest.artifacts,
    manifest.composition_hash,
    manifest.mix_hash,
  );
  const currentArtifacts = manifest.artifacts.filter((artifact) => currentIds.has(artifact.id));
  const currentVsqx = currentArtifacts.filter((artifact) => artifact.role === "vsqx");
  const tracedVsqx = tracedToolArtifacts(trace, "vocaloid_build_song_manifest");
  const currentVsqxTraced = currentVsqx.some((artifact) => tracedVsqx.has(artifact.id));
  const scoreStatus: Check["status"] = currentVsqxTraced
    ? "pass"
    : currentVsqx.length > 0 ? "fail" : "pending";
  checks.push(check(
    "artifact.current_score",
    "gate_2",
    scoreStatus,
    currentVsqxTraced
      ? "A current native VSQX is linked to a successful isolated-session build step."
      : currentVsqx.length > 0
        ? "A current VSQX exists, but the isolated trace has no matching successful build step."
        : "A current native VSQX artifact is still required.",
    currentVsqx.map((artifact) => artifact.id),
  ));

  const artifactIntegrityErrors = preflight.issues.filter((issue) =>
    issue.domain === "artifact" && issue.severity === "error");
  checks.push(check(
    "artifact.current_integrity",
    "gate_2",
    artifactIntegrityErrors.length === 0 ? "pass" : "fail",
    artifactIntegrityErrors.length === 0
      ? `All ${preflight.checkedArtifactIds.length} current artifact file(s) passed dependency, digest, and readability checks.`
      : `${artifactIntegrityErrors.length} current artifact integrity error(s) remain.`,
    artifactIntegrityErrors.flatMap((issue) => issue.objectIds).slice(0, 256),
  ));

  const requiredLayers = new Set(spec.acceptance.required_audition_layers);
  const layerStates = anchorReport?.auditionLayers.filter((layer) => requiredLayers.has(
    layer.layer as (typeof spec.acceptance.required_audition_layers)[number],
  )) ?? [];
  const ladderCurrent = layerStates.length === requiredLayers.size && layerStates.every((layer) =>
    layer.state === "current"
    && layer.durationSeconds.some((duration) => duration >= spec.acceptance.minimum_audition_seconds
      && duration <= spec.acceptance.maximum_audition_seconds));
  const tracedPreviews = tracedToolArtifacts(trace, "vocaloid_review_audio", "anchor_preview");
  const ladderTraced = ladderCurrent && layerStates.every((layer) =>
    layer.currentArtifactIds.some((artifactId) => tracedPreviews.has(artifactId)));
  const ladderStatus: Check["status"] = ladderCurrent && ladderTraced
    ? "pass"
    : ladderCurrent ? "fail" : "pending";
  checks.push(check(
    "artifact.anchor_audition_ladder",
    "gate_2a",
    ladderStatus,
    ladderCurrent && ladderTraced
      ? "Current lead_solo, lead_harmony, and minimal_band auditions meet the duration and trace requirements."
      : ladderCurrent
        ? "The manifest has a current audition ladder, but the isolated trace does not account for every required preview."
        : "The current 20–30 second anchor audition ladder is incomplete.",
    layerStates.flatMap((layer) => layer.currentArtifactIds),
  ));

  const pairGroups = new Map<string, Array<(typeof manifest.artifacts)[number]>>();
  for (const artifact of manifest.artifacts.filter((entry) => currentIds.has(entry.id)
    && entry.role === "preview"
    && entry.metadata.comparison_kind === "single_question_ab"
    && entry.metadata.phrase_direction_id === spec.fixed_intent.anchor.id
    && entry.metadata.listening_question_id === spec.fixed_intent.anchor.listening_question.id)) {
    const pairId = String(artifact.metadata.pair_id ?? "");
    const artifacts = pairGroups.get(pairId) ?? [];
    artifacts.push(artifact);
    pairGroups.set(pairId, artifacts);
  }
  const validAbPair = [...pairGroups.entries()].map(([pairId, artifacts]) => {
    const sides = new Set(artifacts.map((artifact) => artifact.metadata.side));
    const families = new Set(artifacts.map((artifact) => artifact.metadata.hypothesis_family));
    const targetLufs = new Set(artifacts.map((artifact) => artifact.metadata.target_lufs));
    const sourceArtifacts = new Set(artifacts.map((artifact) => artifact.metadata.source_artifact));
    const valid = pairId.length > 0
      && sides.has("A") && sides.has("B")
      && families.size === 1 && !families.has(undefined)
      && targetLufs.size === 1 && !targetLufs.has(undefined)
      && sourceArtifacts.size >= 2 && !sourceArtifacts.has(undefined)
      && artifacts.every((artifact) =>
        artifact.metadata.renderer === "ffmpeg-anchor-loudness-match"
        && artifact.metadata.intent_hash === preflight.creativeReadiness.intentHash
        && typeof artifact.metadata.passage_duration_seconds === "number"
        && artifact.metadata.passage_duration_seconds >= spec.acceptance.minimum_audition_seconds
        && artifact.metadata.passage_duration_seconds <= spec.acceptance.maximum_audition_seconds);
    return valid ? artifacts : undefined;
  }).find((artifacts) => artifacts !== undefined);
  const hasAb = validAbPair !== undefined;
  const tracedAb = tracedToolArtifacts(trace, "vocaloid_review_audio", "compare_anchor_ab");
  const abTraced = validAbPair?.every((artifact) => tracedAb.has(artifact.id)) ?? false;
  const abStatus: Check["status"] = hasAb && abTraced ? "pass" : hasAb ? "fail" : "pending";
  checks.push(check(
    "review.single_question_ab",
    "gate_2a",
    abStatus,
    hasAb && abTraced
      ? "A traced current loudness-matched A/B pair preserves the fixed anchor question and one hypothesis family."
      : hasAb
        ? "A current A/B pair exists, but its isolated compare step is absent from the trace."
        : "A current single-question A/B pair is still required.",
    validAbPair?.map((artifact) => artifact.id) ?? [],
  ));

  const currentKeep = anchorReport?.review.state === "current_keep";
  const revisionRequested = anchorReport?.review.state === "current_reject"
    || anchorReport?.review.state === "current_revise";
  checks.push(check(
    "review.current_keep",
    "gate_2a",
    currentKeep ? "pass" : "pending",
    currentKeep
      ? "The fixed anchor has an explicit current keep decision bound to intent/composition/artifact hashes."
      : revisionRequested
        ? "The current listener requested rejection/revision; compose another bounded hypothesis."
        : "No current keep decision exists; analyzers cannot create one.",
    anchorReport?.review.reviewNoteId ? [anchorReport.review.reviewNoteId] : [],
  ));

  const reviewNoteId = anchorReport?.review.reviewNoteId;
  const manifestHumanKeep = anchorReport?.review.state === "current_keep" && anchorReport.review.humanConfirmed;
  const humanAttestation = reviewNoteId === undefined ? undefined : trace?.steps.find((step) =>
    step.actor === "human"
    && step.operation === "tool"
    && step.name === "vocaloid_review_song"
    && step.action === "add"
    && step.ok
    && step.object_ids?.includes(reviewNoteId));
  const humanKeep = manifestHumanKeep && humanAttestation !== undefined;
  const humanKeepStatus: Check["status"] = humanKeep
    ? "pass"
    : manifestHumanKeep ? "fail" : "pending";
  checks.push(check(
    "review.human_keep",
    "gate_2a",
    humanKeepStatus,
    humanKeep
      ? "A trusted harness step records that a human explicitly confirmed the current 20–30 second anchor moment."
      : manifestHumanKeep
        ? "The manifest labels the keep as human, but the isolated harness trace has no matching human review step."
        : "Gate 2A remains pending until a human explicitly confirms a current anchor moment.",
    reviewNoteId ? [reviewNoteId] : [],
  ));

  const nonListeningReleaseBlockers = preflight.releasePolicy.blockers.filter((code) => ![
    "CURRENT_INTENT_KEEP_REVIEW_REQUIRED",
    "CURRENT_ANCHOR_AUDITION_LADDER_REQUIRED",
    "INTENT_REVISION_REQUESTED",
  ].includes(code));
  const releaseStatus: Check["status"] = preflight.releasePolicy.ready
    ? "pass"
    : nonListeningReleaseBlockers.length === 0 ? "pending" : "fail";
  checks.push(check(
    "release.policy",
    "gate_2",
    releaseStatus,
    preflight.releasePolicy.ready
      ? "The explicit theory/intent release policy is ready."
      : `Release policy blockers: ${preflight.releasePolicy.blockers.join(", ")}.`,
  ));

  const currentDeliveries = manifest.artifacts.filter((artifact) => currentIds.has(artifact.id)
    && artifact.role === "delivery");
  const provenanceDelivery = currentDeliveries.find((artifact) =>
    artifact.metadata.release_policy_enabled === true
    && artifact.metadata.release_policy_ready === true
    && artifact.metadata.theory_ruleset_id === manifest.composition_guidance?.theory_ruleset_id);
  const deliveryStep = provenanceDelivery === undefined ? undefined : trace?.steps.find((step) =>
    step.actor === "agent"
    && step.operation === "tool"
    && step.name === "vocaloid_master_manifest_delivery"
    && step.ok
    && step.object_ids?.includes(provenanceDelivery.id));
  const deliveryValid = provenanceDelivery !== undefined
    && deliveryStep !== undefined
    && humanAttestation !== undefined
    && deliveryStep.sequence > humanAttestation.sequence;
  const deliveryStatus: Check["status"] = deliveryValid
    ? "pass"
    : currentDeliveries.length > 0 ? "fail" : "pending";
  checks.push(check(
    "delivery.current",
    "gate_2",
    deliveryStatus,
    deliveryValid
      ? "A current release-policy-marked delivery was created after the matching human keep step."
      : currentDeliveries.length > 0
        ? "A current delivery exists without complete release metadata or without a matching post-listening harness step."
        : "Final delivery remains pending; it must not be fabricated before release policy and human listening are ready.",
    currentDeliveries.map((artifact) => artifact.id),
  ));
  return checks;
}

export async function evaluateIntentFirstBenchmark(
  manifestPath: string,
  specInput: unknown,
  traceInput?: unknown,
): Promise<IntentFirstBenchmarkResult> {
  const spec = IntentFirstBenchmarkSpecSchema.parse(specInput);
  const trace = traceInput === undefined ? undefined : IntentFirstBenchmarkTraceSchema.parse(traceInput);
  const loaded = await loadSongManifest(manifestPath);
  const preflight = await preflightSongManifest(loaded.path, {
    artifactCheck: "current",
    includePerformanceWarnings: true,
  });
  const checks = benchmarkChecks(loaded.manifest, spec, preflight, trace);
  const gate1 = gateStatus(checks, "gate_1");
  const gate2 = gateStatus(checks, "gate_2");
  const gate2a = gateStatus(checks, "gate_2a");
  const revisionRequested = preflight.creativeReadiness.status === "revision_requested";
  const status = gate1 === "fail" || gate2 === "fail" || gate2a === "fail"
    ? "failed"
    : revisionRequested
      ? "revision_requested"
      : gate1 === "pass" && gate2 === "pass" && gate2a === "pass"
        ? "passed"
        : gate1 === "pass" && gate2a === "pending"
          && preflight.creativeReadiness.counts.currentRequiredLadders
            >= spec.acceptance.minimum_anchor_phrases
          ? "awaiting_human_listening"
          : "in_progress";
  return IntentFirstBenchmarkResultSchema.parse({
    schema: "vocaloid-intent-first-benchmark-result/v1",
    benchmarkId: spec.benchmark_id,
    specVersion: spec.version,
    specHash: hash(spec),
    status,
    manifest: {
      path: loaded.path,
      revision: loaded.manifest.revision,
      contentHash: loaded.manifest.content_hash,
      compositionHash: loaded.manifest.composition_hash,
      mixHash: loaded.manifest.mix_hash,
    },
    provenance: {
      theoryRulesetId: preflight.theory.rulesetId,
      theoryRulesetHash: preflight.theory.rulesetHash,
      intentHash: preflight.creativeReadiness.intentHash,
      tracePresent: trace !== undefined,
    },
    gates: { gate1, gate2, gate2a },
    metrics: {
      invalidToolCalls: trace?.steps.filter((step) => !step.ok).length ?? 0,
      structuralTheoryIssues: preflight.theory.issues.filter((issue) => issue.severity === "error").length,
      unresolvedRequiredTheoryIssues: preflight.releasePolicy.unresolvedTheoryIssues.length,
      anchors: preflight.creativeReadiness.counts.anchorPhrases,
      currentAuditionLadders: preflight.creativeReadiness.counts.currentRequiredLadders,
      currentKeepReviews: preflight.creativeReadiness.counts.currentKeepReviews,
      humanConfirmedAnchors: preflight.creativeReadiness.counts.humanConfirmedAnchors,
    },
    checks,
  });
}
