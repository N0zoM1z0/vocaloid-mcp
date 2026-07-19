#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import type { ResponseFormat } from "./types.js";
import { renderAccompaniment } from "./accompaniment.js";
import {
  compareSongAnchorPassageArtifacts,
  compareSongSectionArtifacts,
  renderSongAnchorPassagePreview,
  renderSongSectionPreview,
} from "./audio-review.js";
import { analyzeAudioQuality, masterWav } from "./audio-quality.js";
import { FROM_ZERO_AGENT_EXAMPLE } from "./agent-examples.js";
import {
  CreativeDecisionCurrentnessSchema,
  CreativeDecisionInputSchema,
  CreativeDecisionPhaseSchema,
  CreativeJournalDeliverableInputSchema,
  listCreativeDecisions,
  publishCreativeRecordPackage,
  recordCreativeDecision,
  writeCreativeJournalReport,
} from "./creative-journal.js";
import {
  masterSongManifestDelivery,
  renderSongManifestMaster,
} from "./delivery.js";
import { EditorBusyError, inspectEditorLease } from "./editor-lease.js";
import { listGeneralMidi } from "./gm.js";
import { importVsqxToSongManifest } from "./importer.js";
import {
  CompositionIntentSchema,
  IntentAuditionLayerSchema,
  IntentFidelityReviewBasisSchema,
  IntentHypothesisFamilySchema,
  PhraseDirectionSchema,
  PhraseRealizationLinksSchema,
  SectionCreativeIntentSchema,
} from "./intent/types.js";
import { diffManifestSnapshots, listManifestHistory } from "./manifest-history.js";
import { resolveReadablePath } from "./paths.js";
import { analyzeManifestPhraseGrammar } from "./phrase-grammar-analysis.js";
import {
  PHRASE_GRAMMAR_BUNDLES,
  PhraseGrammarBlueprintSchema,
  PhraseGrammarCategorySchema,
  listPhraseGrammar,
  phraseGrammarIndex,
  validatePhraseGrammarBlueprint,
} from "./phrase-grammar.js";
import { previewSongManifestMutation } from "./mutation-preview.js";
import { compileVocalPhrase, type VocalPhraseInput } from "./vocal-phrase.js";
import {
  alignJapanesePhrase,
  JapaneseG2PInputSchema,
  JapanesePhraseAlignmentInputSchema,
  japaneseG2P,
} from "./japanese.js";
import { renderProjectToWav } from "./render.js";
import { preflightSongManifest } from "./song-preflight.js";
import {
  applySongManifestTuningGestures,
  applySongManifestGroove,
  addSongManifestReviewNote,
  bindSongManifestPhraseRealization,
  buildSongManifest,
  createSongManifest,
  getSongManifestSection,
  inspectSongManifest,
  loadSongManifest,
  ManifestArrangementTrackSchema,
  ManifestChordChangeSchema,
  ManifestEffectChainSchema,
  ManifestGrooveSchema,
  ManifestKeyChangeSchema,
  ManifestRemovalSchema,
  ManifestSectionSchema,
  ManifestSectionDynamicsSchema,
  ManifestTempoSchema,
  ManifestTimelineUpdateSchema,
  ManifestTimeSignatureSchema,
  ManifestTransformSchema,
  ManifestTuningGestureSchema,
  ManifestVocalPhraseSchema,
  ManifestVocalPartSchema,
  ManifestVocalTrackMetadataSchema,
  ManifestVoiceSchema,
  removeSongManifestObjects,
  resolveSongManifestReviewNote,
  restoreSongManifestSnapshot,
  setSongManifestCompositionGuidance,
  setSongManifestCompositionIntent,
  transformSongManifestEvents,
  updateSongManifestTimeline,
  upsertSongManifestArrangementTrack,
  upsertSongManifestEffectChain,
  upsertSongManifestSectionDynamic,
  upsertSongManifestSection,
  upsertSongManifestSectionIntent,
  upsertSongManifestPhraseDirection,
  upsertSongManifestTheoryException,
  upsertSongManifestVocalPhrase,
  upsertSongManifestVocalPart,
} from "./song-manifest.js";
import { renderSongManifestStemMix } from "./stem-mix.js";
import { TheoryProposalKindSchema } from "./theory/proposals.js";
import { CompositionGuidanceSchema, TheoryExceptionSchema } from "./theory/types.js";
import {
  getStylePalette,
  IA_ROCKS_COMPONENT_ID,
  STYLE_PALETTES,
  stylePaletteSummaries,
} from "./style-palettes.js";
import { expandTempoCurve } from "./tempo.js";
import {
  renderSongManifestInstrumentStems,
  renderSongManifestVocalStems,
} from "./stems.js";
import { discoverVoices } from "./voices.js";
import {
  probeVoice,
  readVoiceReadiness,
  verifiedVoiceComponentIds,
} from "./voice-readiness.js";
import { analyzeSongManifestVocalStem } from "./vocal-analysis.js";
import {
  addControlPointsToProject,
  addNotesToProject,
  createProject,
  createSong,
  inspectProjectMixer,
  inspectProject,
  listControlPoints,
  listNotes,
  updateNoteExpressionsInProject,
  updateProjectMixer,
  validateProject,
} from "./vsqx.js";

type McpProfile = "production" | "full" | "legacy-vsqx";

const PRODUCTION_TOOL_NAMES = new Set([
  "vocaloid_host_readiness",
  "vocaloid_probe_voice",
  "vocaloid_align_japanese_phrase",
  "vocaloid_phrase_grammar",
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
  "vocaloid_creative_journal",
  "vocaloid_analyze_wav",
] as const);

const LEGACY_VSQX_TOOL_NAMES = new Set([
  "vocaloid_list_voices",
  "vocaloid_inspect_project",
  "vocaloid_inspect_mixer",
  "vocaloid_update_mixer",
  "vocaloid_validate_project",
  "vocaloid_list_notes",
  "vocaloid_list_control_points",
  "vocaloid_japanese_g2p",
  "vocaloid_align_japanese_phrase",
  "vocaloid_compile_vocal_phrase",
  "vocaloid_create_song",
  "vocaloid_create_project",
  "vocaloid_update_note_expressions",
  "vocaloid_render_wav",
  "vocaloid_add_notes",
  "vocaloid_add_control_points",
] as const);

function resolveMcpProfile(value = process.env.VOCALOID_MCP_PROFILE): McpProfile {
  const profile = value?.trim() || "production";
  if (profile === "production" || profile === "full" || profile === "legacy-vsqx") {
    return profile;
  }
  throw new Error(
    `Unsupported VOCALOID_MCP_PROFILE=${JSON.stringify(profile)}; use production, full, or legacy-vsqx`,
  );
}

const MCP_PROFILE = resolveMcpProfile();


const server = new McpServer(
  { name: "vocaloid-mcp-server", version: "1.0.0" },
  {
    instructions: `Profile: ${MCP_PROFILE}. Compose from a revisioned canonical song manifest. Read vocaloid://capabilities, vocaloid://composition-intent-contract, vocaloid://music-theory-policy, vocaloid://phrase-grammar, and vocaloid://creative-decision-journal first; read the on-demand action contract before each compact envelope tool. Declare what the song, section, and 1–3 anchor phrases are trying to say; then establish form, meter/tempo, key/harmony/bass, an agent-selected phrase-grammar blueprint, melody, Japanese note allocation, isolated IA delivery, harmony, and minimal/full arrangement. Phrase grammar is an unordered style/genre choice vocabulary, not automatic melody generation: never expand a bundle as a template. Compose concrete pitch, scale-degree, onset, and duration material yourself from intent, lyric prosody, harmony, and form; then validate selected components, materialize them in notes/rests/allocation, and run phrase-grammar analysis before delivery. Production agents never query the local song library; offline library work may only add human-reviewed, non-reconstructive DSL components. Append concise evidence-bound decisions with vocaloid_creative_journal after each stage; do not store raw hidden chain-of-thought. Use vocaloid_edit_song with dry_run before bounded writes, then preflight, build, render, review, and master. Set composition guidance explicitly when final delivery must require theory-warning disposition or current intent review; exceptions must copy an exact current issue fingerprint and become structural errors when their targets change. When preflight returns bounded proposals, treat them only as revision-bound A/B hypotheses: keep one listening question fixed, run the candidate through vocaloid_edit_song dry_run, inspect the actual theory/intent delta, and audition before a separate write. Close one 20–30 second anchor passage through lead_solo → lead_harmony → minimal_band before treating full-song rendering as creative progress; one loudness-matched A/B answers one registered listening question and only an explicit human/agent listening note may write keep/reject/revise. Compare premaster and final delivery at equal loudness whenever mastering reports transparency-review risk. Japanese kanji require an explicit kana reading: preserve supplied lyric text separately, align morae to stable rhythm cells, repeat mora indices for melisma, and choose small-っ timing explicitly. Preserve stable IDs and pass expected_revision on every write. Use IA_ROCKS component ${IA_ROCKS_COMPONENT_ID} unless the user requests another verified voice; BLRGDDR4M3WM2LC6 is IA, not IA_ROCKS. Artifacts must match manifest hashes; native gesture materialization and an actual non-silent Editor render are separate evidence. Publish a hash-bound creative-record package with the final song and VSQX. VOCALOID pan is 0=left, 64=center, 127=right. The bundled GM SoundFont is draft quality and does not prove authentic acoustic articulation.`,
  },
);

server.registerResource(
  "vocaloid-style-palette-index",
  "vocaloid://styles",
  {
    title: "VOCALOID Production Style Palettes",
    description: "Compact index of agent-facing composition, IA_ROCKS performance, arrangement, groove, mix, and renderer-boundary guidance.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(stylePaletteSummaries(), null, 2) }],
  }),
);

for (const palette of STYLE_PALETTES) {
  server.registerResource(
    `vocaloid-style-${palette.id}`,
    palette.uri,
    {
      title: palette.title,
      description: palette.description,
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(getStylePalette(palette.id), null, 2),
      }],
    }),
  );
}

server.registerResource(
  "vocaloid-phrase-grammar",
  "vocaloid://phrase-grammar",
  {
    title: "Deterministic vocal phrase grammar DSL",
    description: "Versioned role, entry, contour, rhythm, motion, cadence, development, allocation, articulation, space, and IA/genre bundle vocabulary for agent-selected phrase plans.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(phraseGrammarIndex(), null, 2) }],
  }),
);

server.registerResource(
  "vocaloid-phrase-grammar-bundle",
  new ResourceTemplate("vocaloid://phrase-grammar/bundle/{id}", {
    list: undefined,
    complete: { id: () => PHRASE_GRAMMAR_BUNDLES.map((bundle) => bundle.id) },
  }),
  {
    title: "One vocal phrase grammar bundle",
    description: "A bounded IA/genre/delivery component palette. Bundles offer choices and variation axes; they do not generate notes.",
    mimeType: "application/json",
  },
  async (uri, variables) => {
    const requested = variables.id;
    const id = Array.isArray(requested) ? requested[0] : requested;
    const bundle = PHRASE_GRAMMAR_BUNDLES.find((candidate) => candidate.id === id);
    if (!bundle) throw new Error(`Unknown phrase-grammar bundle ${String(id)}`);
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(bundle, null, 2) }] };
  },
);

server.registerResource(
  "vocaloid-composition-intent-contract",
  "vocaloid://composition-intent-contract",
  {
    title: "Composition intent and anchor-listening contract",
    description: "Intent hierarchy, hash/review binding, symbolic evidence limits, and the 20–30 second anchor-passage discipline.",
    mimeType: "text/markdown; charset=utf-8",
  },
  async (uri) => {
    const path = await resolveReadablePath("notes/composition-intent-contract.md");
    return {
      contents: [{ uri: uri.href, mimeType: "text/markdown; charset=utf-8", text: await readFile(path, "utf8") }],
    };
  },
);

server.registerResource(
  "vocaloid-music-theory-policy",
  "vocaloid://music-theory-policy",
  {
    title: "Core music-theory policy",
    description: "Deterministic symbolic evidence, severity, exception, anti-copy, and corpus/style boundaries.",
    mimeType: "text/markdown; charset=utf-8",
  },
  async (uri) => {
    const path = await resolveReadablePath("notes/music-theory-policy.md");
    return {
      contents: [{ uri: uri.href, mimeType: "text/markdown; charset=utf-8", text: await readFile(path, "utf8") }],
    };
  },
);

server.registerResource(
  "vocaloid-edit-song-contract",
  "vocaloid://edit-song-contract",
  {
    title: "Strict vocaloid_edit_song action contract",
    description: "On-demand action-specific JSON Schema for the compact production mutation envelope.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: "application/json",
      text: JSON.stringify({
        schema: "vocaloid-edit-song-contract/v1",
        invocation: {
          action: "Select one action from the schema discriminator",
          payload: "Place every action-specific field except action/response_format here",
          response_format: "markdown or json",
        },
        actions: ["expand_tempo_curve", ...EditMutationActionSchema.options].map((action) => ({
          action,
          schema_uri: `vocaloid://edit-song-contract/${action}`,
        })),
      }, null, 2),
    }],
  }),
);

server.registerResource(
  "vocaloid-creative-journal-contract",
  "vocaloid://creative-journal-contract",
  {
    title: "Strict creative decision journal action contract",
    description: "On-demand action-specific JSON Schema for recording, reading, reporting, and publishing creative decisions.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: "application/json",
      text: JSON.stringify({
        schema: "vocaloid-creative-journal-contract/v1",
        invocation: {
          action: "Select one action from the schema discriminator",
          payload: "Place every action-specific field except action/response_format here",
          response_format: "markdown or json",
        },
        actions: CREATIVE_JOURNAL_ACTION_NAMES.map((action) => ({
          action,
          schema_uri: `vocaloid://creative-journal-contract/${action}`,
        })),
      }, null, 2),
    }],
  }),
);

server.registerResource(
  "vocaloid-creative-decision-journal",
  "vocaloid://creative-decision-journal",
  {
    title: "Creative decision journal policy",
    description: "The auditable intent → theory → note allocation → IA delivery → arrangement record, freshness, and publication policy.",
    mimeType: "text/markdown; charset=utf-8",
  },
  async (uri) => {
    const path = await resolveReadablePath("notes/creative-decision-journal.md");
    return {
      contents: [{ uri: uri.href, mimeType: "text/markdown; charset=utf-8", text: await readFile(path, "utf8") }],
    };
  },
);

server.registerResource(
  "hanairo-biyori-lyrics",
  "vocaloid://lyrics/hanairo-biyori",
  {
    title: "花色日和 — authoritative supplied lyrics",
    description: "User-supplied lyric authority for the wa-rock-hanairo evaluation; preserve verbatim and add readings/phonemes as separate provenance.",
    mimeType: "text/plain; charset=utf-8",
  },
  async (uri) => {
    const path = await resolveReadablePath("artifacts/evals/[Lyrics] Hanairo Biyori.txt");
    return {
      contents: [{ uri: uri.href, mimeType: "text/plain; charset=utf-8", text: await readFile(path, "utf8") }],
    };
  },
);

server.registerResource(
  "vocaloid-capabilities",
  "vocaloid://capabilities",
  {
    title: "VOCALOID MCP capability map",
    description: "The active tool profile, production workflow, renderer boundaries, and low-friction agent usage contract.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: "application/json",
      text: JSON.stringify({
        profile: MCP_PROFILE,
        profiles: {
          production: "Default high-level manifest composition, validation, rendering, review, and delivery surface",
          full: "All production, granular manifest, audio utility, and raw VSQX tools for development and regression testing",
          "legacy-vsqx": "Low-level direct VSQX inspection and mutation for recovery or reverse-engineering",
        },
        canonical_workflow: [
          "Read the composition-intent contract, core theory policy, phrase-grammar DSL, and any authoritative lyric resource",
          "Check host readiness and cached IA_ROCKS availability",
          "Create or import a canonical manifest",
          "Declare song/section intent plus 1-3 anchor phrase purposes, semantic focuses, transitions, delivery arcs, and single listening questions",
          "Append a concise hash-bound journal decision after intent, each theory stage, note allocation, IA delivery, and arrangement",
          "Select and validate phrase-grammar components for each phrase role, then establish lead melody and Japanese note allocation without runtime corpus access",
          "Align explicit Japanese readings; preserve original lyric provenance",
          "Use vocaloid_edit_song dry_run=true, then apply with the returned current revision",
          "Run vocaloid_preflight_song; when repair hypotheses are useful, request 3-8 theory-only proposals and hold each group's listening question constant",
          "Run vocaloid_phrase_grammar analyze_manifest and disposition phrase entry/motion/contour/rhythm concentration before delivery",
          "Set composition guidance when release must require exact theory-warning disposition and/or current anchor intent review",
          "Evaluate a selected proposal through vocaloid_edit_song dry_run and inspect actual theory/intent deltas before a separate write",
          "Repeat preflight until the requested readiness gate passes",
          "Build VSQX/backing and render either stems or a manifest master",
          "Render a 20-30 second lead_solo, lead_harmony, and minimal_band anchor ladder",
          "Run one-question loudness-matched A/B and attach an explicit digest-bound keep/reject/revise review",
          "Master only after the separate releasePolicy is ready; when transparency risk is reported, compare premaster and delivery at equal loudness before publishing",
          "Publish the complete journal/report/manifest package bound to the final song and VSQX artifacts",
        ],
        examples: ["vocaloid://examples/from-zero"],
        contracts: {
          edit_song: "vocaloid://edit-song-contract",
          composition_intent: "vocaloid://composition-intent-contract",
          music_theory: "vocaloid://music-theory-policy",
          phrase_grammar: "vocaloid://phrase-grammar",
          creative_journal: "vocaloid://creative-journal-contract",
        },
        agent_contract: {
          canonical_source: "*.song.json manifest",
          concurrency: "optimistic expected_revision plus a host-wide VOCALOID Editor render lease",
          mutation: "read the edit contract, send one bounded action payload, and dry-run for predicted theory/intent deltas before writing",
          provenance: "composition_hash, mix_hash, file SHA-256, dependency hashes, Editor/helper fingerprints",
          lyrics: "original surface text, explicit kana reading, alignment, and V3 phonemes remain distinct evidence",
          creative_judgement: "symbolic/audio metrics locate evidence; only an explicit listening author records keep/reject/revise",
          creative_record: "append-only hash chain with stable-object/artifact/hash bindings; stale decisions remain visible and final packages require complete current core coverage",
          proposals: "read-only revision/hash-bound A/B/C hypotheses; no corpus/profile access, no direct write, mandatory edit dry-run and listening check",
          release_policy: "optional/backward-compatible; required warnings need exact current exceptions, required intent review blocks only final delivery",
          phrase_grammar: "unordered style/genre option vocabulary with melody_material=absent; the agent composes final notes from intent/prosody/harmony/form and optional blueprints are analyzed without generating notes",
          library_boundary: "production agents cannot query the local song library; offline analysis may only curate human-reviewed, non-reconstructive DSL components",
        },
        renderer_boundaries: {
          vocal: "Original VOCALOID3 Editor with a verified IA_ROCKS voice probe",
          accompaniment: "FluidSynth plus GeneralUser/FluidR3-style GM SoundFont is a composition draft renderer",
          authentic_instruments: "Use external sampled/VST or recorded renderers for idiomatic shamisen, koto, shakuhachi, guitar, and orchestral articulation",
        },
      }, null, 2),
    }],
  }),
);

server.registerResource(
  "vocaloid-example-from-zero",
  "vocaloid://examples/from-zero",
  {
    title: "From-zero production-profile call example",
    description: "Exact minimal payload shapes for Japanese alignment, previewed IA_ROCKS vocal insertion, arrangement insertion, and preflight.",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: "application/json",
      text: JSON.stringify(FROM_ZERO_AGENT_EXAMPLE, null, 2),
    }],
  }),
);

const ResponseFormatSchema = z
  .enum(["markdown", "json"])
  .default("markdown");
const PathSchema = z
  .string()
  .min(1)
  .max(4096)
  .describe("Absolute path, or a path relative to the vocaloid-mcp-server project root");
const CurveSchema = z.enum(["DYN", "BRE", "BRI", "CLE", "GEN", "POR", "PIT", "PBS"]);
const ToolOutputSchema = z.object({
  ok: z.boolean(),
  data: z.unknown(),
  warnings: z.array(z.string()),
});

function typedToolOutputSchema<T extends z.ZodType>(data: T) {
  return z.object({
    ok: z.boolean(),
    data: data.nullable(),
    warnings: z.array(z.string()),
  }).strict();
}

const WorkflowErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  suggested_action: z.string(),
}).strict();

function workflowOutputSchema<T extends z.ZodType>(data: T) {
  // MCP output schemas must have an object root. The SDK intentionally ignores a
  // root discriminated union, which would make typed workflow results disappear
  // from tools/list even though runtime validation still succeeded locally.
  return z.object({
    ok: z.boolean(),
    data: data.optional(),
    error: WorkflowErrorSchema.optional(),
    warnings: z.array(z.string()),
  }).strict();
}

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

const PreflightDataOutputSchema = z.object({
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

const ManifestWriteOutputSchema = z.object({
  path: z.string(),
  backupPath: z.string().optional(),
  revision: z.number().int(),
  compositionHash: z.string(),
  mixHash: z.string(),
  contentHash: z.string(),
  parentHash: z.string().optional(),
  bytes: z.number().int(),
}).strict();

const JapaneseAlignmentDataOutputSchema = z.object({
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

const AudioQualityDataOutputSchema = z.object({
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

const ManifestSummaryDataOutputSchema = z.object({
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

const ManifestSectionDataOutputSchema = z.object({
  revision: z.number().int(),
  contentHash: z.string(),
  section: z.object({ id: z.string(), name: z.string(), kind: z.string() }).passthrough(),
  vocalTracks: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()),
  arrangementTracks: z.array(z.object({ id: z.string(), name: z.string(), kind: z.string() }).passthrough()),
}).passthrough();

const ManifestBuildDataOutputSchema = z.object({
  sourceRevision: z.number().int(),
  manifestRevision: z.number().int(),
  backing: z.object({ path: z.string(), channels: z.number().int(), silent: z.boolean(), sha256: z.string() }).passthrough(),
  project: z.object({ outputPath: z.string(), sha256: z.string() }).passthrough(),
  validation: z.object({ valid: z.boolean() }).passthrough(),
  artifacts: z.array(ArtifactOutputSchema),
}).passthrough();

const StemRenderDataOutputSchema = z.object({
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

const VocalAnalysisDataOutputSchema = z.object({
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

const StemMixDataOutputSchema = z.object({
  sourceMixHash: z.string(),
  manifestRevision: z.number().int(),
  outputPath: z.string(),
  outputSha256: z.string(),
  inputs: z.array(z.object({ artifactId: z.string(), trackId: z.string(), sha256: z.string() }).passthrough()),
  quality: z.object({ integratedLufs: z.number(), truePeakDbfs: z.number(), clippedSampleValues: z.number().int(), channels: z.number().int() }).passthrough(),
  artifact: ArtifactOutputSchema,
}).passthrough();

const ManifestMasterDataOutputSchema = z.object({
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

const ManifestDeliveryDataOutputSchema = z.object({
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

const VoiceProbeDataOutputSchema = z.object({
  cached: z.boolean(),
  cachePath: z.string(),
  record: VoiceProbeRecordOutputSchema,
  host: RenderHostOutputSchema,
}).passthrough();

const HostReadinessDataOutputSchema = z.object({
  editorLease: z.object({ requestId: z.string(), ownerAlive: z.boolean() }).passthrough().nullable(),
  verifiedComponentIds: z.array(z.string()),
  voiceRecords: z.array(VoiceProbeRecordOutputSchema),
  host: RenderHostOutputSchema,
}).passthrough();

const ManifestHistoryDataOutputSchema = z.object({
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

const ReviewSongDataOutputSchema = z.object({
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

const GrooveDeltaOutputSchema = z.object({
  event_id: z.string(),
  track_id: z.string(),
  source: z.enum(["direct", "pattern"]),
  timing_ticks: z.number().int(),
  swing_ticks: z.number().int(),
  random_timing_ticks: z.number().int(),
  velocity_delta: z.number().int(),
  gate_delta_ticks: z.number().int(),
}).strict();

const GrooveDataOutputSchema = z.union([
  MutationPreviewDataOutputSchema,
  z.object({
    dryRun: z.literal(false),
    write: z.object({ path: z.string(), revision: z.number().int(), compositionHash: z.string(), mixHash: z.string(), contentHash: z.string() }).passthrough(),
    seed: z.string(),
    changed: z.number().int(),
    deltas: z.array(GrooveDeltaOutputSchema),
  }).passthrough(),
]);

const SongTimelineDataOutputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("expand_tempo_curve"),
    curve: z.enum(["linear", "ease_in_out", "exponential"]),
    startTick: z.number().int(),
    endTick: z.number().int(),
    durationTicks: z.number().int(),
    steps: z.number().int(),
    events: z.array(z.object({
      position: z.object({ measure: z.number().int(), beat: z.number().int(), tick: z.number().int() }).strict(),
      bpm: z.number(),
      tick: z.number().int(),
    }).strict()),
  }).strict(),
  z.object({ action: z.literal("replace"), dryRun: z.literal(true), preview: MutationPreviewDataOutputSchema }).strict(),
  z.object({
    action: z.literal("replace"),
    dryRun: z.literal(false),
    write: z.object({ path: z.string(), revision: z.number().int(), compositionHash: z.string(), mixHash: z.string(), contentHash: z.string() }).passthrough(),
    summary: z.object({ revision: z.number().int(), contentHash: z.string() }).passthrough(),
  }).strict(),
]);

const AudioReviewDataOutputSchema = z.object({
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

const ImportVsqxDataOutputSchema = z.object({
  manifestPath: z.string(),
  manifestRevision: z.number().int(),
  compositionHash: z.string(),
  imported: z.object({ tracks: z.number().int(), parts: z.number().int(), notes: z.number().int() }).passthrough(),
  warnings: z.array(z.string()),
  sourceArtifact: ArtifactOutputSchema,
}).passthrough();

const CreativeJournalActionSchema = z.enum(["record", "list", "report", "publish"]);

const CreativeJournalDataOutputSchema = z.object({
  action: CreativeJournalActionSchema,
}).passthrough();

const PhraseGrammarDataOutputSchema = z.object({
  action: z.enum(["catalog", "validate_blueprint", "analyze_manifest"]),
}).passthrough();

const PhraseGrammarInputSchema = z.discriminatedUnion("action", [
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
const PhraseGrammarToolInputSchema = z.object({
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

const PHRASE_GRAMMAR_ACTION_NAMES = PhraseGrammarActionSchema.options;

server.registerResource(
  "vocaloid-phrase-grammar-action-contract",
  new ResourceTemplate("vocaloid://phrase-grammar-contract/{action}", {
    list: undefined,
    complete: { action: () => [...PHRASE_GRAMMAR_ACTION_NAMES] },
  }),
  {
    title: "One vocaloid_phrase_grammar action payload schema",
    description: "Strict on-demand JSON Schema for one phrase-grammar action.",
    mimeType: "application/json",
  },
  async (uri, variables) => {
    const requested = variables.action;
    const action = Array.isArray(requested) ? requested[0] : requested;
    if (!action || !PHRASE_GRAMMAR_ACTION_NAMES.includes(action as (typeof PHRASE_GRAMMAR_ACTION_NAMES)[number])) {
      throw new Error(`Unknown vocaloid_phrase_grammar contract action ${String(action)}`);
    }
    const option = PhraseGrammarInputSchema.options.find(
      (candidate) => candidate.shape.action.value === action,
    );
    if (!option) throw new Error(`Missing vocaloid_phrase_grammar contract for ${action}`);
    const payloadSchema = structuredClone(z.toJSONSchema(option, { target: "draft-7", io: "input" })) as {
      properties?: Record<string, unknown>;
      required?: string[];
      [key: string]: unknown;
    };
    if (payloadSchema.properties) {
      delete payloadSchema.properties.action;
      delete payloadSchema.properties.response_format;
    }
    if (payloadSchema.required) {
      payloadSchema.required = payloadSchema.required.filter(
        (field) => field !== "action" && field !== "response_format",
      );
    }
    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(payloadSchema, null, 2),
      }],
    };
  },
);

const CreativeJournalActionRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("record"),
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

const CreativeJournalInputSchema = z.object({
  action: CreativeJournalActionSchema,
  payload: z.record(z.string(), z.unknown()).superRefine((payload, context) => {
    for (const reserved of ["action", "response_format"]) {
      if (Object.hasOwn(payload, reserved)) {
        context.addIssue({ code: "custom", path: [reserved], message: `${reserved} belongs in the tool envelope` });
      }
    }
  }).describe("Payload schema: vocaloid://creative-journal-contract/{action}"),
  response_format: ResponseFormatSchema,
}).strict();

const CREATIVE_JOURNAL_ACTION_NAMES = CreativeJournalActionSchema.options;

server.registerResource(
  "vocaloid-creative-journal-action-contract",
  new ResourceTemplate("vocaloid://creative-journal-contract/{action}", {
    list: undefined,
    complete: { action: () => [...CREATIVE_JOURNAL_ACTION_NAMES] },
  }),
  {
    title: "One vocaloid_creative_journal action payload schema",
    description: "Strict on-demand JSON Schema for one compact journal payload.",
    mimeType: "application/json",
  },
  async (uri, variables) => {
    const requested = variables.action;
    const action = Array.isArray(requested) ? requested[0] : requested;
    if (!action || !CREATIVE_JOURNAL_ACTION_NAMES.includes(
      action as (typeof CREATIVE_JOURNAL_ACTION_NAMES)[number],
    )) {
      throw new Error(`Unknown vocaloid_creative_journal contract action ${String(action)}`);
    }
    const option = CreativeJournalActionRequestSchema.options.find(
      (candidate) => candidate.shape.action.value === action,
    );
    if (!option) throw new Error(`Missing vocaloid_creative_journal contract for ${action}`);
    const payloadSchema = structuredClone(z.toJSONSchema(option, { target: "draft-7", io: "input" })) as {
      properties?: Record<string, unknown>;
      required?: string[];
      [key: string]: unknown;
    };
    if (payloadSchema.properties) {
      delete payloadSchema.properties.action;
      delete payloadSchema.properties.response_format;
    }
    if (payloadSchema.required) {
      payloadSchema.required = payloadSchema.required.filter(
        (field) => field !== "action" && field !== "response_format",
      );
    }
    return {
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(payloadSchema, null, 2) }],
    };
  },
);

const EditMutationActionSchema = z.enum([
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

const ChangeDomainsOutputSchema = z.record(z.string(), z.object({
  added: z.array(z.string()),
  removed: z.array(z.string()),
  modified: z.array(z.string()),
  changes: z.number().int(),
}).strict());

const EditSongDataOutputSchema = z.object({
  kind: z.enum(["tempo_curve", "mutation_preview", "mutation_applied"]),
  action: z.enum(["expand_tempo_curve", ...EditMutationActionSchema.options]),
  preview: MutationPreviewDataOutputSchema.optional(),
  write: ManifestWriteOutputSchema.optional(),
  totalChanges: z.number().int().optional(),
  readiness: WorkflowReadinessOutputSchema.optional(),
  evidence: z.object({ changedCount: z.number().int(), objectIds: z.array(z.string()) }).passthrough().optional(),
}).passthrough();

const NormalizedVibratoPointSchema = z
  .object({
    position: z
      .number()
      .int()
      .min(0)
      .max(65_536)
      .describe("Position across the entire note: 0 is the start and 65536 is the end"),
    value: z.number().int().min(0).max(127).describe("Vibrato depth or rate value"),
  })
  .strict();

const VibratoSchema = z
  .object({
    type: z
      .number()
      .int()
      .min(0)
      .max(16)
      .describe(
        "Built-in vibrato: 0 off, 1-4 normal, 5-8 extreme, 9-12 fast, 13-16 slight",
      ),
    length: z
      .number()
      .int()
      .min(0)
      .max(100)
      .describe("Percentage of the note occupied by vibrato, counted backward from note end"),
    depth: z.array(NormalizedVibratoPointSchema).max(128).optional(),
    rate: z.array(NormalizedVibratoPointSchema).max(128).optional(),
  })
  .strict();

const NoteSchema = z
  .object({
    tick: z.number().int().min(0).describe("Note start tick relative to the musical part"),
    duration: z.number().int().min(1).describe("Note duration in ticks"),
    note_number: z.number().int().min(0).max(127).describe("MIDI note number; 60 is middle C"),
    lyric: z.string().max(32).describe("Displayed lyric, such as 'あ'"),
    phonemes: z
      .string()
      .max(32)
      .optional()
      .describe(
        "Raw VOCALOID phoneme symbols (for example 'a', 'k a', or Japanese flap '4 a'); do not invent a token-count prefix",
      ),
    phoneme_locked: z.boolean().default(false).describe("Lock explicit phonemes in the editor"),
    velocity: z.number().int().min(0).max(127).default(64),
    style: z
      .record(z.string().min(1).max(32), z.number().int())
      .optional()
      .describe("Optional VSQX note-style values, for example accent, decay, or opening"),
    vibrato: VibratoSchema.optional().describe(
      "Optional note vibrato with editable normalized depth/rate envelopes",
    ),
  })
  .strict();

const ControlPointSchema = z
  .object({
    tick: z.number().int().min(0).describe("Control point tick relative to the musical part"),
    value: z.number().int().describe("Curve value; range is checked for the selected curve"),
  })
  .strict();

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

const PositionedNoteSchema = NoteSchema.omit({ tick: true })
  .extend({
    position: MusicalPositionSchema.describe("Absolute musical position in the song"),
  })
  .strict();

const PositionedControlPointSchema = z
  .object({
    position: MusicalPositionSchema.describe("Absolute musical position in the song"),
    value: z.number().int().describe("Curve value; range is checked for the selected curve"),
  })
  .strict();

const SongCurveSchema = z
  .object({
    curve: CurveSchema,
    points: z.array(PositionedControlPointSchema).min(1).max(10_000),
  })
  .strict();

const RhythmValueSchema = z
  .object({
    denominator: z.union([
      z.literal(1), z.literal(2), z.literal(4), z.literal(8),
      z.literal(16), z.literal(32), z.literal(64),
    ]),
    dots: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
    tuplet: z
      .object({
        played: z.number().int().min(2).max(16),
        in_time_of: z.number().int().min(1).max(16),
      })
      .strict()
      .optional()
      .describe("For triplet eighths use denominator=8, played=3, in_time_of=2"),
  })
  .strict();

const VocalLyricUnitSchema = z
  .object({
    lyric: z.string().min(1).max(32),
    phonemes: z.string().min(1).max(32),
    phoneme_locked: z.boolean().default(false),
  })
  .strict();

const VocalRhythmCellSchema = z
  .object({
    duration: z
      .union([z.number().int().min(1), RhythmValueSchema])
      .describe("Explicit ticks or a whole/half/quarter/8th/16th/32nd/64th dotted/tuplet value"),
    rest: z.boolean().default(false),
    note_number: z.number().int().min(0).max(127).optional(),
    lyric_index: z.number().int().min(0).optional(),
    lyric: z.string().min(1).max(32).optional(),
    phonemes: z.string().min(1).max(32).optional(),
    phoneme_locked: z.boolean().optional(),
    gate_percent: z.number().int().min(1).max(100).default(100),
    velocity: z.number().int().min(0).max(127).default(64),
    style: z.record(z.string().min(1).max(32), z.number().int()).optional(),
    vibrato: VibratoSchema.optional(),
  })
  .strict();

const VocalPhraseSchema = z
  .object({
    start: MusicalPositionSchema,
    allocation: z
      .enum(["sequential", "explicit"])
      .default("sequential")
      .describe(
        "Sequential consumes one lyric per note; explicit uses lyric_index so one lyric may span several notes with automatic '-' continuations",
      ),
    lyrics: z.array(VocalLyricUnitSchema).min(1).max(5000),
    cells: z.array(VocalRhythmCellSchema).min(1).max(20_000),
  })
  .strict();

const SongPartSchema = z
  .object({
    name: z.string().min(1).max(256),
    comment: z.string().max(256).optional(),
    start: MusicalPositionSchema.describe("Inclusive absolute song position"),
    end: MusicalPositionSchema.describe("Exclusive absolute song position"),
    notes: z.array(PositionedNoteSchema).max(5000).default([]),
    phrases: z
      .array(VocalPhraseSchema)
      .max(256)
      .default([])
      .describe(
        "Phrase-level lyric/rhythm input supporting rests, syncopation, 1/64 values, tuplets, rapid syllables, and melisma",
      ),
    control_curves: z.array(SongCurveSchema).max(8).default([]),
  })
  .strict();

const SongTrackSchema = z
  .object({
    name: z.string().min(1).max(256),
    comment: z.string().max(256).optional(),
    voice: z
      .object({
        name: z.string().min(1).max(256),
        component_id: z.string().length(16),
      })
      .strict(),
    bank_select: z.number().int().min(0).max(127).default(0),
    program_change: z.number().int().min(0).max(127).default(0),
    mixer: z
      .object({
        volume: z.number().int().min(-898).max(600).default(0),
        pan: z
          .number()
          .int()
          .min(0)
          .max(127)
          .default(64)
          .describe("VOCALOID pan: 0=hard left, 64=center, 127=hard right"),
        mute: z.boolean().default(false),
        solo: z.boolean().default(false),
        send_level: z.number().int().min(-898).max(0).default(-898),
        send_enabled: z.boolean().default(false),
      })
      .strict()
      .optional(),
    parts: z.array(SongPartSchema).min(1).max(256),
  })
  .strict();

const SongAudioPartSchema = z
  .object({
    name: z.string().min(1).max(256),
    comment: z.string().max(256).optional(),
    kind: z
      .enum(["mono", "stereo"])
      .describe("Must match the WAV channel count; mono uses 1 channel and stereo uses 2"),
    file_path: PathSchema.describe("Existing 16-bit PCM WAV accompaniment or stem"),
    start: MusicalPositionSchema.describe("Absolute song position where audio playback begins"),
  })
  .strict();

const AccompanimentNoteSchema = z
  .object({
    position: MusicalPositionSchema,
    duration: z.number().int().min(1).describe("Duration in ticks; 480 is one quarter note"),
    note_number: z.number().int().min(0).max(127),
    velocity: z.number().int().min(1).max(127).default(88),
  })
  .strict();

const AccompanimentPatternNoteSchema = z
  .object({
    offset: MusicalPositionSchema.describe("Measure/beat/tick offset within the pattern"),
    duration: z.number().int().min(1),
    note_number: z.number().int().min(0).max(127),
    velocity: z.number().int().min(1).max(127).default(88),
  })
  .strict();

const AccompanimentPatternSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
    measures: z.number().int().min(1).max(256),
    notes: z.array(AccompanimentPatternNoteSchema).min(1).max(20_000),
  })
  .strict();

const AccompanimentPlacementSchema = z
  .object({
    pattern_id: z.string().min(1).max(64),
    start: MusicalPositionSchema.describe("Measure-aligned placement start"),
    repeats: z.number().int().min(1).max(1024).default(1),
    transpose: z.number().int().min(-48).max(48).default(0),
    velocity_scale: z.number().gt(0).max(4).default(1),
  })
  .strict();

const AccompanimentTrackSchema = z
  .object({
    name: z.string().min(1).max(255),
    program: z
      .number()
      .int()
      .min(0)
      .max(127)
      .describe("Zero-based General MIDI program: 0 acoustic piano, 24 nylon guitar, 33 finger bass"),
    bank_msb: z.number().int().min(0).max(127).default(0),
    bank_lsb: z.number().int().min(0).max(127).default(0),
    volume: z.number().int().min(0).max(127).default(100),
    pan: z
      .number()
      .int()
      .min(0)
      .max(127)
      .default(64)
      .describe("MIDI pan: 0=hard left, 64=center, 127=hard right"),
    notes: z.array(AccompanimentNoteSchema).max(20_000).default([]),
    patterns: z.array(AccompanimentPatternSchema).max(256).default([]),
    placements: z.array(AccompanimentPlacementSchema).max(5000).default([]),
  })
  .strict()
  .refine((track) => track.notes.length > 0 || track.placements.length > 0, {
    message: "Each accompaniment track needs direct notes or pattern placements",
  });

const DrumHitSchema = z
  .object({
    position: MusicalPositionSchema,
    note_number: z
      .number()
      .int()
      .min(0)
      .max(127)
      .describe("General MIDI percussion note on channel 10; e.g. 36 kick, 38 snare, 42 closed hi-hat"),
    velocity: z.number().int().min(1).max(127).default(96),
    duration: z.number().int().min(1).default(60),
  })
  .strict();

const DrumPatternHitSchema = z
  .object({
    offset: MusicalPositionSchema,
    note_number: z.number().int().min(0).max(127),
    velocity: z.number().int().min(1).max(127).default(96),
    duration: z.number().int().min(1).default(60),
  })
  .strict();

const DrumPatternSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
    measures: z.number().int().min(1).max(256),
    hits: z.array(DrumPatternHitSchema).min(1).max(50_000),
  })
  .strict();

const DrumPlacementSchema = z
  .object({
    pattern_id: z.string().min(1).max(64),
    start: MusicalPositionSchema.describe("Measure-aligned placement start"),
    repeats: z.number().int().min(1).max(1024).default(1),
    velocity_scale: z.number().gt(0).max(4).default(1),
  })
  .strict();

const ManifestIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,95}$/u)
  .describe("Globally unique stable lowercase ID; preserve it across unrelated revisions");

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

const EditSongActionRequestSchema = z.discriminatedUnion("action", [
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
const EditSongInputSchema = z.object({
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

const EDIT_SONG_ACTION_NAMES = ["expand_tempo_curve", ...EditMutationActionSchema.options] as const;

server.registerResource(
  "vocaloid-edit-song-action-contract",
  new ResourceTemplate("vocaloid://edit-song-contract/{action}", {
    list: undefined,
    complete: { action: () => [...EDIT_SONG_ACTION_NAMES] },
  }),
  {
    title: "One vocaloid_edit_song action payload schema",
    description: "Strict on-demand JSON Schema for one compact mutation payload.",
    mimeType: "application/json",
  },
  async (uri, variables) => {
    const requested = variables.action;
    const action = Array.isArray(requested) ? requested[0] : requested;
    if (!action || !EDIT_SONG_ACTION_NAMES.includes(action as (typeof EDIT_SONG_ACTION_NAMES)[number])) {
      throw new Error(`Unknown vocaloid_edit_song contract action ${String(action)}`);
    }
    const option = EditSongActionRequestSchema.options.find(
      (candidate) => candidate.shape.action.value === action,
    );
    if (!option) throw new Error(`Missing vocaloid_edit_song contract for ${action}`);
    const payloadSchema = structuredClone(z.toJSONSchema(option, { target: "draft-7", io: "input" })) as {
      properties?: Record<string, unknown>;
      required?: string[];
      [key: string]: unknown;
    };
    if (payloadSchema.properties) {
      delete payloadSchema.properties.action;
      delete payloadSchema.properties.response_format;
    }
    if (payloadSchema.required) {
      payloadSchema.required = payloadSchema.required.filter(
        (field) => field !== "action" && field !== "response_format",
      );
    }
    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({
          schema: "vocaloid-edit-song-action/v1",
          action,
          invocation: { action, payload: "Validate against payloadSchema", response_format: "markdown or json" },
          payloadSchema,
        }, null, 2),
      }],
    };
  },
);

type ToolOutput = z.infer<typeof ToolOutputSchema>;

function textResult(
  data: unknown,
  responseFormat: ResponseFormat,
  summary: string,
  warnings: string[] = [],
) {
  const output: ToolOutput = { ok: true, data, warnings };
  const text =
    responseFormat === "json"
      ? JSON.stringify(output, null, 2)
      : [`## ${summary}`, "", "```json", JSON.stringify(data, null, 2), "```", ...(
          warnings.length > 0 ? ["", `Warnings: ${warnings.join("; ")}`] : []
        )].join("\n");
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: output,
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const output: ToolOutput = { ok: false, data: null, warnings: [message] };
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    structuredContent: output,
  };
}

function workflowResult<T>(
  data: T,
  responseFormat: ResponseFormat,
  summary: string,
  warnings: string[] = [],
) {
  const output = { ok: true as const, data, warnings };
  const text = responseFormat === "json"
    ? JSON.stringify(output, null, 2)
    : [
        `## ${summary}`,
        "",
        "```json",
        JSON.stringify(data, null, 2),
        "```",
        ...(warnings.length > 0 ? ["", `Warnings: ${warnings.join("; ")}`] : []),
      ].join("\n");
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: output,
  };
}

function workflowError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  let code = "WORKFLOW_FAILED";
  let retryable = false;
  let suggestedAction = "Inspect the diagnostic, correct the named input or host boundary, then retry once.";
  if (error instanceof EditorBusyError) {
    code = error.code;
    retryable = true;
    suggestedAction = `Wait for request ${error.owner.requestId} to finish or cancel that request; do not launch another Editor.`;
  } else if (error instanceof Error && error.name === "AbortError") {
    code = "CANCELLED";
    suggestedAction = "No retry is required; issue a new bounded request only if the render is still wanted.";
  } else if (/stale manifest revision/iu.test(message)) {
    code = "STALE_REVISION";
    retryable = true;
    suggestedAction = "Inspect the manifest again and retry using its current revision after reconciling intervening changes.";
  } else if (/already exists/iu.test(message)) {
    code = "OUTPUT_EXISTS";
    suggestedAction = "Choose a new song/revision-bearing immutable output filename.";
  } else if (/fingerprint|version\/hash mismatch/iu.test(message)) {
    code = "UNVERIFIED_EDITOR_BUILD";
    suggestedAction = "Verify this exact Editor build/localization before explicitly opting into unknown-build automation.";
  } else if (/preflight/iu.test(message)) {
    code = "PREFLIGHT_BLOCKED";
    retryable = true;
    suggestedAction = "Call vocaloid_preflight_song, repair every error-level issue in the named scope, then retry.";
  } else if (/sha-256|digest|content hash|composition hash/iu.test(message)) {
    code = "PROVENANCE_MISMATCH";
    suggestedAction = "Do not use the changed artifact; restore it or build a new immutable artifact from the current manifest.";
  }
  const output = {
    ok: false as const,
    error: { code, message, retryable, suggested_action: suggestedAction },
    warnings: [] as string[],
  };
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error [${code}]: ${message}\nNext: ${suggestedAction}` }],
    structuredContent: output,
  };
}

interface AppliedMutationShape {
  write: {
    path: string;
    backupPath?: string;
    revision: number;
    compositionHash: string;
    mixHash: string;
    contentHash: string;
    parentHash?: string;
    bytes: number;
  };
}

async function normalizedAppliedEdit(
  action: z.infer<typeof EditMutationActionSchema>,
  inputPath: string,
  result: AppliedMutationShape,
  evidence: {
    changedCount: number;
    objectIds: string[];
    grooveDeltas?: z.infer<typeof GrooveDeltaOutputSchema>[];
    compiledGestures?: Array<{ gesture_id: string; type: string; event_ids: string[]; curves: string[] }>;
  },
) {
  const priorPath = result.write.backupPath ?? inputPath;
  const [diff, preflight] = await Promise.all([
    diffManifestSnapshots(priorPath, result.write.path),
    preflightSongManifest(result.write.path, {
      artifactCheck: "none",
      includePerformanceWarnings: true,
    }),
  ]);
  return {
    kind: "mutation_applied" as const,
    action,
    write: result.write,
    changes: diff.domains,
    totalChanges: diff.totalChanges,
    readiness: preflight.readiness,
    evidence,
  };
}

function normalizeNotes(notes: z.infer<typeof NoteSchema>[]) {
  return notes.map((note) => ({
    tick: note.tick,
    duration: note.duration,
    noteNumber: note.note_number,
    lyric: note.lyric,
    ...(note.phonemes !== undefined ? { phonemes: note.phonemes } : {}),
    phonemeLocked: note.phoneme_locked,
    velocity: note.velocity,
    ...(note.style !== undefined ? { style: note.style } : {}),
    ...(note.vibrato !== undefined
      ? {
          vibrato: {
            type: note.vibrato.type,
            length: note.vibrato.length,
            ...(note.vibrato.depth !== undefined ? { depth: note.vibrato.depth } : {}),
            ...(note.vibrato.rate !== undefined ? { rate: note.vibrato.rate } : {}),
          },
        }
      : {}),
  }));
}

function normalizePositionedNotes(notes: z.infer<typeof PositionedNoteSchema>[]) {
  return notes.map((note) => {
    const normalized = normalizeNotes([{ ...note, tick: 0 }])[0]!;
    const { tick: _tick, ...withoutTick } = normalized;
    return { ...withoutTick, position: note.position };
  });
}

function normalizeVocalPhrase(
  phrase: z.infer<typeof VocalPhraseSchema>,
): VocalPhraseInput {
  return {
    start: phrase.start,
    allocation: phrase.allocation,
    lyrics: phrase.lyrics.map((lyric) => ({
      lyric: lyric.lyric,
      phonemes: lyric.phonemes,
      phonemeLocked: lyric.phoneme_locked,
    })),
    cells: phrase.cells.map((cell) => ({
      duration: typeof cell.duration === "number"
        ? cell.duration
        : {
            denominator: cell.duration.denominator,
            dots: cell.duration.dots,
            ...(cell.duration.tuplet
              ? {
                  tuplet: {
                    played: cell.duration.tuplet.played,
                    inTimeOf: cell.duration.tuplet.in_time_of,
                  },
                }
              : {}),
          },
      rest: cell.rest,
      ...(cell.note_number !== undefined ? { noteNumber: cell.note_number } : {}),
      ...(cell.lyric_index !== undefined ? { lyricIndex: cell.lyric_index } : {}),
      ...(cell.lyric !== undefined ? { lyric: cell.lyric } : {}),
      ...(cell.phonemes !== undefined ? { phonemes: cell.phonemes } : {}),
      ...(cell.phoneme_locked !== undefined ? { phonemeLocked: cell.phoneme_locked } : {}),
      gatePercent: cell.gate_percent,
      velocity: cell.velocity,
      ...(cell.style !== undefined ? { style: cell.style } : {}),
      ...(cell.vibrato !== undefined
        ? {
            vibrato: {
              type: cell.vibrato.type,
              length: cell.vibrato.length,
              ...(cell.vibrato.depth !== undefined ? { depth: cell.vibrato.depth } : {}),
              ...(cell.vibrato.rate !== undefined ? { rate: cell.vibrato.rate } : {}),
            },
          }
        : {}),
    })),
  };
}

const NoteExpressionSchema = z
  .object({
    accent: z.number().int().min(0).max(100).optional(),
    decay: z.number().int().min(0).max(100).optional(),
    opening: z.number().int().min(0).max(127).optional(),
    bend_depth: z.number().int().min(0).max(100).optional(),
    bend_length: z.number().int().min(0).max(100).optional(),
    rise_portamento: z.boolean().optional(),
    fall_portamento: z.boolean().optional(),
  })
  .strict();

const VibratoUpdateSchema = z
  .object({
    type: z.number().int().min(0).max(16).optional(),
    length: z.number().int().min(0).max(100).optional(),
    depth: z.array(NormalizedVibratoPointSchema).max(128).optional(),
    rate: z.array(NormalizedVibratoPointSchema).max(128).optional(),
  })
  .strict();

const NoteExpressionUpdateSchema = z
  .object({
    note_index: z
      .number()
      .int()
      .min(0)
      .describe("Stable note index returned by vocaloid_list_notes"),
    velocity: z.number().int().min(0).max(127).optional(),
    lyric: z.string().max(32).optional(),
    phonemes: z
      .string()
      .max(32)
      .optional()
      .describe("Raw VOCALOID phoneme symbols, such as 'a', 'k a', or Japanese '4 a'"),
    phoneme_locked: z.boolean().optional(),
    expression: NoteExpressionSchema.optional(),
    vibrato: VibratoUpdateSchema.optional(),
  })
  .strict();

function normalizeNoteExpressionUpdates(
  updates: z.infer<typeof NoteExpressionUpdateSchema>[],
) {
  return updates.map((update) => {
    const expression = update.expression;
    const style: Record<string, number> = {};
    if (expression?.accent !== undefined) style.accent = expression.accent;
    if (expression?.decay !== undefined) style.decay = expression.decay;
    if (expression?.opening !== undefined) style.opening = expression.opening;
    if (expression?.bend_depth !== undefined) style.bendDep = expression.bend_depth;
    if (expression?.bend_length !== undefined) style.bendLen = expression.bend_length;
    if (expression?.rise_portamento !== undefined) {
      style.risePort = expression.rise_portamento ? 1 : 0;
    }
    if (expression?.fall_portamento !== undefined) {
      style.fallPort = expression.fall_portamento ? 1 : 0;
    }
    return {
      noteIndex: update.note_index,
      ...(update.velocity !== undefined ? { velocity: update.velocity } : {}),
      ...(update.lyric !== undefined ? { lyric: update.lyric } : {}),
      ...(update.phonemes !== undefined ? { phonemes: update.phonemes } : {}),
      ...(update.phoneme_locked !== undefined
        ? { phonemeLocked: update.phoneme_locked }
        : {}),
      ...(Object.keys(style).length > 0 ? { style } : {}),
      ...(update.vibrato !== undefined
        ? {
            vibrato: {
              ...(update.vibrato.type !== undefined ? { type: update.vibrato.type } : {}),
              ...(update.vibrato.length !== undefined
                ? { length: update.vibrato.length }
                : {}),
              ...(update.vibrato.depth !== undefined
                ? { depth: update.vibrato.depth }
                : {}),
              ...(update.vibrato.rate !== undefined ? { rate: update.vibrato.rate } : {}),
            },
          }
        : {}),
    };
  });
}

server.registerTool(
  "vocaloid_list_voices",
  {
    title: "List Local VOCALOID Voice Metadata",
    description: `Discover locally present V3/V4 voice metadata from VVD files.

Use this before creating a project so the component ID and voice name match local voicebank metadata. The default search root is /mnt/d/Vocaloid/VoiceDB. This tool only reads small VVD metadata files; it does not read DDB audio databases or prove that Windows Editor registration/licensing is currently available. A render remains the authoritative synthesis check, and the exporter refuses a silent substitution when Editor reports that the selected singer is unavailable.

Returns voice name, 16-character component ID, voice format version, source path, default timbre parameters, and an explicit metadata-only availability boundary.`,
    inputSchema: z
      .object({
        directories: z
          .array(z.string().min(1).max(4096))
          .max(10)
          .optional()
          .describe("Optional allowed voice database roots"),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ directories, response_format }) => {
    try {
      const voices = await discoverVoices(directories);
      return textResult(
        {
          total: voices.length,
          discovery: "vvd_metadata",
          editor_availability: "unverified_until_render",
          voices,
        },
        response_format,
        `Found metadata for ${voices.length} VOCALOID voice${voices.length === 1 ? "" : "s"}`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_host_readiness",
  {
    title: "Inspect VOCALOID Host Readiness",
    description: "Read the Editor/helper fingerprint, host render lease, and verified voice cache without launching VOCALOID.",
    inputSchema: z.object({
      include_expired_voice_records: z.boolean().default(false)
        .describe("Include expired historical records for diagnosis; they never count as verified"),
      allow_unknown_editor: z.boolean().default(false)
        .describe("Allow fingerprint inspection of an unknown build; this does not authorize a render"),
      response_format: ResponseFormatSchema,
    }).strict(),
    outputSchema: workflowOutputSchema(HostReadinessDataOutputSchema),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const [readiness, editorLease] = await Promise.all([
        readVoiceReadiness(params.allow_unknown_editor, params.include_expired_voice_records),
        inspectEditorLease(),
      ]);
      return workflowResult(
        {
          editorLease,
          voiceCachePath: readiness.path,
          verifiedComponentIds: readiness.verifiedComponentIds,
          voiceRecords: readiness.records,
          host: readiness.host,
        },
        params.response_format,
        `${readiness.verifiedComponentIds.length} voice(s) verified for Editor ${readiness.host.editorVersion}`,
      );
    } catch (error) {
      return workflowError(error);
    }
  },
);

server.registerTool(
  "vocaloid_probe_voice",
  {
    title: "Probe Voice in Original Editor",
    description: "Verify one local voice with a bounded temporary render in the original Editor; cache the result by voice and host fingerprint.",
    inputSchema: z.object({
      component_id: z.string().length(16).describe("Exact 16-character VVD component ID"),
      force: z.boolean().default(false).describe("Ignore a non-expired matching cache entry"),
      timeout_seconds: z.number().int().min(30).max(180).default(120),
      allow_unknown_editor: z.boolean().default(false)
        .describe("Explicit opt-in for a manually verified but not yet allow-listed Editor fingerprint"),
      response_format: ResponseFormatSchema,
    }).strict(),
    outputSchema: workflowOutputSchema(VoiceProbeDataOutputSchema),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params, extra) => {
    try {
      const progressToken = extra._meta?.progressToken;
      const result = await probeVoice({
        componentId: params.component_id,
        force: params.force,
        timeoutSeconds: params.timeout_seconds,
        allowUnknownEditor: params.allow_unknown_editor,
        runtime: {
          requestId: String(extra.requestId),
          signal: extra.signal,
          allowUnknownEditor: params.allow_unknown_editor,
          ...(progressToken !== undefined
            ? {
                progress: async (update) => extra.sendNotification({
                  method: "notifications/progress",
                  params: {
                    progressToken,
                    progress: update.progress,
                    total: update.total,
                    message: `${update.stage}: ${update.message}`,
                  },
                }),
              }
            : {}),
        },
      });
      const warnings = result.record.status === "verified" ? [] : [result.record.reason];
      return workflowResult(
        result,
        params.response_format,
        `${result.record.voiceName} availability is ${result.record.status}${result.cached ? " (cached)" : ""}`,
        warnings,
      );
    } catch (error) {
      return workflowError(error);
    }
  },
);

server.registerTool(
  "vocaloid_list_instruments",
  {
    title: "List Accompaniment Instruments",
    description: `List zero-based General MIDI programs and channel-10 percussion note numbers for vocaloid_render_accompaniment.

Use search to find an instrument family or name, such as piano, guitar, bass, strings, pad, kick, snare, or hi-hat. An empty search returns all 128 programs and the standard percussion map.`,
    inputSchema: z
      .object({
        search: z.string().max(128).optional(),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ search, response_format }) => {
    try {
      const result = listGeneralMidi(search);
      return textResult(
        result,
        response_format,
        `Found ${result.programs.length} programs and ${result.drums.length} percussion sounds`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_inspect_project",
  {
    title: "Inspect VOCALOID Project",
    description: `Summarize a V3 or V4 VSQX project without modifying it.

Returns format/version, voices, tempo and time signatures, track/part layout, note and control-point counts, and structural diagnostics such as overlaps or notes beyond a part's playTime. Use vocaloid_list_notes or vocaloid_list_control_points for paginated event detail.`,
    inputSchema: z
      .object({ path: PathSchema, response_format: ResponseFormatSchema })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ path, response_format }) => {
    try {
      const summary = await inspectProject(path);
      return textResult(
        summary,
        response_format,
        `${summary.sequenceName || "Untitled"}: ${summary.tracks.length} vocal tracks`,
        summary.diagnostics,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_inspect_mixer",
  {
    title: "Inspect VOCALOID Vocal Mixer",
    description: `Read every vocal mixer unit in a V3/V4 VSQX without modifying it.

Returns track names/numbers, volume, pan, mute/solo, send routing, and an interpreted pan position. VOCALOID pan is not a signed value: 0=hard left, 64=center, 127=hard right. Use this before render and compare it with vocaloid_analyze_wav per-channel measurements so intentional stereo placement is distinguishable from an accidental one-sided mix.`,
    inputSchema: z
      .object({ path: PathSchema, response_format: ResponseFormatSchema })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ path, response_format }) => {
    try {
      const result = await inspectProjectMixer(path);
      return textResult(
        result,
        response_format,
        `Inspected ${result.vocalUnits.length} vocal mixer units`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_update_mixer",
  {
    title: "Update VOCALOID Vocal Mixer",
    description: `Atomically revise vocal-track mixer placement and write a derived V3/V4 VSQX.

Each update targets a VSQX track_number and may change volume, pan, mute/solo, or send routing while preserving every unspecified field. Pan uses the native 0..127 scale: 0=hard left, 64=center, 127=hard right. This tool does not force a centered mix; it gives the agent explicit artistic control. Call vocaloid_inspect_mixer before and after, validate the derived project, render to a new versioned mix path, then use vocaloid_analyze_wav to verify actual channel balance. Existing output requires overwrite=true and receives a timestamped backup.`,
    inputSchema: z
      .object({
        input_path: PathSchema,
        output_path: PathSchema,
        updates: z
          .array(
            z
              .object({
                track_number: z.number().int().min(0).max(127),
                volume: z.number().int().min(-898).max(600).optional(),
                pan: z
                  .number()
                  .int()
                  .min(0)
                  .max(127)
                  .optional()
                  .describe("0=hard left, 64=center, 127=hard right"),
                mute: z.boolean().optional(),
                solo: z.boolean().optional(),
                send_level: z.number().int().min(-898).max(0).optional(),
                send_enabled: z.boolean().optional(),
              })
              .strict(),
          )
          .min(1)
          .max(128),
        overwrite: z.boolean().default(false),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await updateProjectMixer(
        params.input_path,
        params.output_path,
        params.updates.map((update) => ({
          trackNumber: update.track_number,
          ...(update.volume !== undefined ? { volume: update.volume } : {}),
          ...(update.pan !== undefined ? { pan: update.pan } : {}),
          ...(update.mute !== undefined ? { mute: update.mute } : {}),
          ...(update.solo !== undefined ? { solo: update.solo } : {}),
          ...(update.send_level !== undefined ? { sendLevel: update.send_level } : {}),
          ...(update.send_enabled !== undefined ? { sendEnabled: update.send_enabled } : {}),
        })),
        params.overwrite,
      );
      return textResult(
        result,
        params.response_format,
        `Updated mixer for tracks ${result.updatedTrackNumbers.join(", ")}`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_validate_project",
  {
    title: "Validate VOCALOID Project",
    description: `Validate a V3 or V4 VSQX project using structural checks and xmllint/XSD when the matching schema is available.

The local defaults are /mnt/d/Vocaloid/Vocaloid3FE/vsq3.xsd and vsq4.xsd. Pass schema_path only to use another trusted schema. This tool does not modify the project.`,
    inputSchema: z
      .object({
        path: PathSchema,
        schema_path: PathSchema.optional(),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ path, schema_path, response_format }) => {
    try {
      const result = await validateProject(path, schema_path);
      return textResult(
        result,
        response_format,
        result.valid ? `Valid ${result.format} project` : `Invalid ${result.format} project`,
        result.diagnostics,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_list_notes",
  {
    title: "List VOCALOID Notes",
    description: `List notes from one VSQX musical part with filtering and pagination.

track_number is the VSQX track number, not its array index. part_index is zero-based. start_tick/end_tick and returned note ticks are relative to the part; partStart gives its absolute project tick. Filtering includes notes that overlap the requested half-open range.`,
    inputSchema: z
      .object({
        path: PathSchema,
        track_number: z.number().int().min(0).max(127).default(0),
        part_index: z.number().int().min(0).default(0),
        start_tick: z.number().int().min(0).optional(),
        end_tick: z.number().int().min(1).optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(50),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      if (
        params.start_tick !== undefined &&
        params.end_tick !== undefined &&
        params.end_tick <= params.start_tick
      ) {
        throw new Error("end_tick must be greater than start_tick");
      }
      const result = await listNotes(
        params.path,
        params.track_number,
        params.part_index,
        params.start_tick,
        params.end_tick,
        params.offset,
        params.limit,
      );
      return textResult(
        result,
        params.response_format,
        `${result.page.count} of ${result.page.total} notes`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_list_control_points",
  {
    title: "List VOCALOID Control Points",
    description: `List DYN/BRE/BRI/CLE/GEN/POR/PIT/PBS points from one VSQX part.

Ticks are relative to the part. V4's single-letter curve IDs are normalized to the familiar V3 names. Omit curve to list every master control curve. Results are filtered to [start_tick, end_tick) and paginated.`,
    inputSchema: z
      .object({
        path: PathSchema,
        track_number: z.number().int().min(0).max(127).default(0),
        part_index: z.number().int().min(0).default(0),
        curve: CurveSchema.optional(),
        start_tick: z.number().int().min(0).optional(),
        end_tick: z.number().int().min(1).optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(200).default(100),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      if (
        params.start_tick !== undefined &&
        params.end_tick !== undefined &&
        params.end_tick <= params.start_tick
      ) {
        throw new Error("end_tick must be greater than start_tick");
      }
      const result = await listControlPoints(
        params.path,
        params.track_number,
        params.part_index,
        params.curve,
        params.start_tick,
        params.end_tick,
        params.offset,
        params.limit,
      );
      return textResult(
        result,
        params.response_format,
        `${result.page.count} of ${result.page.total} control points`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_render_accompaniment",
  {
    title: "Render Instrumental Accompaniment",
    description: `Compose and render a real 16-bit PCM stereo WAV accompaniment from structured instrumental notes and drum hits.

This is an audio renderer, not a MIDI deliverable: a temporary Standard MIDI File is used only inside the bounded FluidSynth process and is deleted afterward. Tracks use SoundFont bank MSB/LSB plus program, volume/pan, and absolute zero-based measure/beat/tick positions. Reusable per-track and drum patterns can be placed, repeated, transposed, and velocity-scaled across 3-4 minute arrangements, making different intro/verse/pre/chorus/bridge grooves concise. Tempo and meter changes use the same coordinate system as vocaloid_create_song. The verified non-silent WAV can be passed directly as a stereo audio_part, then vocaloid_render_wav exports the combined vocal/harmony/backing Master. The bundled GM SoundFont is suitable for drafts and includes Shamisen, Koto, Shakuhachi, Taiko, and Taisho Koto; soundfont_path can select a better compatible SF2 within an allowed read root.`,
    inputSchema: z
      .object({
        output_path: PathSchema,
        time_signatures: z
          .array(
            z
              .object({
                measure: z.number().int().min(0).max(100_000),
                numerator: z.number().int().min(1).max(32),
                denominator: z.union([
                  z.literal(1),
                  z.literal(2),
                  z.literal(4),
                  z.literal(8),
                  z.literal(16),
                  z.literal(32),
                ]),
              })
              .strict(),
          )
          .min(1)
          .max(256)
          .default([{ measure: 0, numerator: 4, denominator: 4 }]),
        tempos: z
          .array(
            z.object({ position: MusicalPositionSchema, bpm: z.number().min(20).max(400) }).strict(),
          )
          .min(1)
          .max(5000)
          .default([{ position: { measure: 0, beat: 0, tick: 0 }, bpm: 120 }]),
        end: MusicalPositionSchema.describe("Exclusive song end; all notes and drum hits must end before it"),
        tracks: z.array(AccompanimentTrackSchema).min(1).max(15),
        drums: z.array(DrumHitSchema).max(50_000).default([]),
        drum_patterns: z.array(DrumPatternSchema).max(256).default([]),
        drum_placements: z.array(DrumPlacementSchema).max(5000).default([]),
        sample_rate: z.union([z.literal(44_100), z.literal(48_000), z.literal(96_000)]).default(44_100),
        gain: z.number().gt(0).max(10).default(0.2),
        reverb: z.boolean().default(true),
        chorus: z.boolean().default(true),
        soundfont_path: PathSchema.optional(),
        overwrite: z.boolean().default(false),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await renderAccompaniment({
        outputPath: params.output_path,
        timeSignatures: params.time_signatures,
        tempos: params.tempos,
        end: params.end,
        tracks: params.tracks.map((track) => ({
          name: track.name,
          program: track.program,
          bankMsb: track.bank_msb,
          bankLsb: track.bank_lsb,
          volume: track.volume,
          pan: track.pan,
          notes: track.notes.map((note) => ({
            position: note.position,
            duration: note.duration,
            noteNumber: note.note_number,
            velocity: note.velocity,
          })),
          patterns: track.patterns.map((pattern) => ({
            id: pattern.id,
            measures: pattern.measures,
            notes: pattern.notes.map((note) => ({
              offset: note.offset,
              duration: note.duration,
              noteNumber: note.note_number,
              velocity: note.velocity,
            })),
          })),
          placements: track.placements.map((placement) => ({
            patternId: placement.pattern_id,
            start: placement.start,
            repeats: placement.repeats,
            transpose: placement.transpose,
            velocityScale: placement.velocity_scale,
          })),
        })),
        drums: params.drums.map((hit) => ({
          position: hit.position,
          noteNumber: hit.note_number,
          velocity: hit.velocity,
          duration: hit.duration,
        })),
        drumPatterns: params.drum_patterns.map((pattern) => ({
          id: pattern.id,
          measures: pattern.measures,
          hits: pattern.hits.map((hit) => ({
            offset: hit.offset,
            noteNumber: hit.note_number,
            velocity: hit.velocity,
            duration: hit.duration,
          })),
        })),
        drumPlacements: params.drum_placements.map((placement) => ({
          patternId: placement.pattern_id,
          start: placement.start,
          repeats: placement.repeats,
          velocityScale: placement.velocity_scale,
        })),
        sampleRate: params.sample_rate,
        gain: params.gain,
        reverb: params.reverb,
        chorus: params.chorus,
        ...(params.soundfont_path !== undefined ? { soundfontPath: params.soundfont_path } : {}),
        overwrite: params.overwrite,
      });
      return textResult(
        result,
        params.response_format,
        `Rendered ${result.durationSeconds.toFixed(3)} seconds of accompaniment audio`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_phrase_grammar",
  {
    title: "Browse, Validate, or Analyze Vocal Phrase Grammar",
    description: "Browse phrase choices, validate a blueprint, or analyze diversity; never generates melody.",
    inputSchema: PhraseGrammarToolInputSchema,
    outputSchema: workflowOutputSchema(PhraseGrammarDataOutputSchema),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (envelope) => {
    try {
      const params = PhraseGrammarInputSchema.parse({
        ...envelope.payload,
        action: envelope.action,
        response_format: envelope.response_format,
      });
      if (params.action === "catalog") {
        const catalog = listPhraseGrammar({
          ...(params.category ? { category: params.category } : {}),
          ...(params.bundle_id ? { bundleId: params.bundle_id } : {}),
          ...(params.query ? { query: params.query } : {}),
          offset: params.offset,
          limit: params.limit,
        });
        return workflowResult(
          { action: "catalog" as const, ...catalog },
          params.response_format,
          `Returned ${catalog.count}/${catalog.total} phrase-grammar component(s)`,
        );
      }
      if (params.action === "validate_blueprint") {
        const validation = validatePhraseGrammarBlueprint(params.blueprint);
        return workflowResult(
          { action: "validate_blueprint" as const, ...validation },
          params.response_format,
          `Validated phrase-grammar blueprint ${validation.blueprint.id}`,
        );
      }
      const loaded = await loadSongManifest(params.manifest_path);
      const report = analyzeManifestPhraseGrammar(loaded.manifest, {
        ...(params.track_id ? { trackId: params.track_id } : {}),
        maximumPairExamples: params.maximum_pair_examples,
      });
      return workflowResult(
        { action: "analyze_manifest" as const, path: loaded.path, revision: loaded.manifest.revision, ...report },
        params.response_format,
        `Analyzed ${report.summary.phrases} vocal phrase(s); ${report.summary.warnings} phrase-grammar warning(s)`,
      );
    } catch (error) {
      return workflowError(error);
    }
  },
);

server.registerTool(
  "vocaloid_japanese_g2p",
  {
    title: "Convert Japanese Reading to VOCALOID3 Phonemes",
    description: `Convert a kana reading into auditable mora units using only symbols documented by the bundled VOCALOID3 Japanese phoneme chart.

Hiragana, katakana, yoon, long vowels, moraic nasal, and common foreign-kana combinations are normalized deterministically. If displayed text contains kanji, reading is required: this tool deliberately does not guess lexical readings without a dictionary. Spaces in reading define word boundaries for positional dz/dZ versus z/Z. Optional nasal_between_vowels exposes Japanese nasal-g as an artistic choice. Small っ is reported without inventing an unsupported standalone phoneme; choose its timing later in vocaloid_align_japanese_phrase. The result includes every token, source span, fallback, and warning.`,
    inputSchema: JapaneseG2PInputSchema.extend({ response_format: ResponseFormatSchema }).strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const { response_format, ...input } = params;
      const result = japaneseG2P(input);
      return textResult(
        result,
        response_format,
        `Converted ${result.units.length} Japanese mora units with ${result.fallback_count} fallbacks`,
        result.warnings,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_align_japanese_phrase",
  {
    title: "Align Japanese Morae to Vocal Rhythm",
    description: "Align Japanese morae to stable rhythm slots as a manifest-compatible phrase, with explicit melisma and small-っ timing decisions.",
    inputSchema: JapanesePhraseAlignmentInputSchema.extend({ response_format: ResponseFormatSchema }).strict(),
    outputSchema: typedToolOutputSchema(JapaneseAlignmentDataOutputSchema),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const { response_format, ...input } = params;
      const result = alignJapanesePhrase(input);
      return textResult(
        result,
        response_format,
        `Aligned ${result.alignment.lyric_units} morae to ${result.alignment.voiced_slots} voiced slots`,
        result.warnings,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_compile_vocal_phrase",
  {
    title: "Compile Vocal Lyrics and Rhythm Phrase",
    description: `Compile phrase-level lyrics and rhythm cells into native VOCALOID note events without writing a project.

Use this to preview rapid lyrics, tuplets, syncopation, rests, pickups, and melisma before vocaloid_create_song. Sequential allocation consumes one lyric unit per note cell, which makes 1/16–1/64 or tuplet syllabic runs concise. Explicit allocation uses lyric_index: consecutive cells pointing to the same lyric automatically compile to the real-world VSQX continuation representation lyric='-' and phonemes='-'. A cell may override lyric/phonemes to split diphthongs or consonant clusters across notes. Rhythm values use 480 PPQ and support dotted notes and N-in-the-time-of-M tuplets; explicit tick durations remain available. Returns positioned notes plus phrase density/continuation statistics.`,
    inputSchema: z
      .object({
        time_signatures: z
          .array(
            z
              .object({
                measure: z.number().int().min(0).max(100_000),
                numerator: z.number().int().min(1).max(32),
                denominator: z.union([
                  z.literal(1), z.literal(2), z.literal(4),
                  z.literal(8), z.literal(16), z.literal(32),
                ]),
              })
              .strict(),
          )
          .min(1)
          .max(256)
          .default([{ measure: 0, numerator: 4, denominator: 4 }]),
        phrase: VocalPhraseSchema,
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = compileVocalPhrase(
        params.time_signatures,
        normalizeVocalPhrase(params.phrase),
      );
      return textResult(
        result,
        params.response_format,
        `Compiled ${result.noteCells} vocal notes (${result.continuations} continuations, fastest ${result.fastestNoteTicks ?? 0} ticks)`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_create_song",
  {
    title: "Create Structured VOCALOID Song",
    description: `Create a complete multi-track, multi-part V3/V4 VSQX song from nothing using musical positions.

Use this for long-form composition, lead/double/harmony/countermelody vocal tracks, named sections, tempo changes, meter changes, and real mono/stereo WAV backing or stems. Positions are zero-based measure/beat/tick coordinates after the count-in; the server converts them to VSQX project and part-relative ticks. Parts may contain direct notes and/or phrase-level lyric/rhythm cells for rapid syllables, tuplets, rests, syncopation, and melisma. Each track is monophonic and may contain many non-overlapping parts; use separate tracks for simultaneous harmony. Notes and control curves use absolute song positions, so agents can revise arrangements without manually calculating part offsets. Every track has an explicit installed voice and mixer settings. Audio headers are verified and their playTime is calculated across the tempo map. Call vocaloid_list_voices first. Use a descriptive sequence-based output filename. The project is written atomically and does not copy any source VSQX.`,
    inputSchema: z
      .object({
        output_path: PathSchema,
        format: z.enum(["vsq3", "vsq4"]).default("vsq3"),
        sequence_name: z.string().min(1).max(256).default("Agent Song"),
        pre_measure: z.number().int().min(0).max(127).default(1),
        time_signatures: z
          .array(
            z
              .object({
                measure: z.number().int().min(0).max(100_000),
                numerator: z.number().int().min(1).max(32),
                denominator: z.union([
                  z.literal(1),
                  z.literal(2),
                  z.literal(4),
                  z.literal(8),
                  z.literal(16),
                  z.literal(32),
                ]),
              })
              .strict(),
          )
          .min(1)
          .max(256)
          .default([{ measure: 0, numerator: 4, denominator: 4 }])
          .describe("Strictly ordered meter changes; the first must be at measure 0"),
        tempos: z
          .array(
            z
              .object({
                position: MusicalPositionSchema,
                bpm: z.number().min(20).max(400),
              })
              .strict(),
          )
          .min(1)
          .max(5000)
          .default([{ position: { measure: 0, beat: 0, tick: 0 }, bpm: 120 }])
          .describe("Strictly ordered tempo changes; the first must be at song position 0:0:0"),
        tracks: z
          .array(SongTrackSchema)
          .min(1)
          .max(16)
          .describe("Independent vocal tracks; use additional tracks for doubles and harmony"),
        audio_parts: z
          .array(SongAudioPartSchema)
          .max(256)
          .default([])
          .describe(
            "Optional real WAV accompaniment/stems embedded as native VSQX audio parts; metadata and playTime are derived from the files",
          ),
        overwrite: z.boolean().default(false),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await createSong({
        outputPath: params.output_path,
        format: params.format,
        sequenceName: params.sequence_name,
        preMeasure: params.pre_measure,
        timeSignatures: params.time_signatures,
        tempos: params.tempos,
        tracks: params.tracks.map((track) => ({
          name: track.name,
          ...(track.comment !== undefined ? { comment: track.comment } : {}),
          voice: { name: track.voice.name, componentId: track.voice.component_id },
          bankSelect: track.bank_select,
          programChange: track.program_change,
          ...(track.mixer
            ? {
                mixer: {
                  volume: track.mixer.volume,
                  pan: track.mixer.pan,
                  mute: track.mixer.mute,
                  solo: track.mixer.solo,
                  sendLevel: track.mixer.send_level,
                  sendEnabled: track.mixer.send_enabled,
                },
              }
            : {}),
          parts: track.parts.map((part) => {
            const curveNames = new Set<string>();
            for (const entry of part.control_curves) {
              if (curveNames.has(entry.curve)) {
                throw new Error(`${track.name}/${part.name} contains duplicate curve ${entry.curve}`);
              }
              curveNames.add(entry.curve);
            }
            return {
              name: part.name,
              ...(part.comment !== undefined ? { comment: part.comment } : {}),
              start: part.start,
              end: part.end,
              notes: [
                ...normalizePositionedNotes(part.notes),
                ...part.phrases.flatMap((phrase) =>
                  compileVocalPhrase(
                    params.time_signatures,
                    normalizeVocalPhrase(phrase),
                  ).notes
                ),
              ],
              controlCurves: Object.fromEntries(
                part.control_curves.map((entry) => [entry.curve, entry.points]),
              ),
            };
          }),
        })),
        audioParts: params.audio_parts.map((audio) => ({
          name: audio.name,
          ...(audio.comment !== undefined ? { comment: audio.comment } : {}),
          kind: audio.kind,
          filePath: audio.file_path,
          start: audio.start,
        })),
        overwrite: params.overwrite,
      });
      return textResult(
        result,
        params.response_format,
        `Created ${result.format} song with ${result.tracks} tracks and ${result.parts} parts`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_create_project",
  {
    title: "Create VOCALOID Project",
    description: `Create a complete schema-valid, single-track V3 or V4 VSQX project from nothing.

No input VSQX is read, copied, sampled, or required. Call vocaloid_list_voices first and pass an installed voice's name/component_id. Note ticks are relative to the new musical part. Notes may include note expression and selective vibrato depth/rate envelopes; control_curves can atomically add the complete DYN/BRE/BRI/CLE/GEN/POR/PIT/PBS tuning. Writes are restricted to the server workspace unless VOCALOID_WRITE_ROOTS explicitly adds another root. Existing output is refused unless overwrite=true; overwrites create a timestamped backup.`,
    inputSchema: z
      .object({
        output_path: PathSchema,
        format: z.enum(["vsq3", "vsq4"]).default("vsq4"),
        voice: z
          .object({
            name: z.string().min(1).max(256),
            component_id: z.string().length(16),
          })
          .strict(),
        bank_select: z.number().int().min(0).max(127).default(0),
        program_change: z.number().int().min(0).max(127).default(0),
        sequence_name: z.string().min(1).max(256).default("Agent Song"),
        track_name: z.string().min(1).max(256).default("Lead Vocal"),
        part_name: z.string().min(1).max(256).default("Verse 1"),
        bpm: z.number().min(20).max(400).default(120),
        numerator: z.number().int().min(1).max(32).default(4),
        denominator: z.union([
          z.literal(1),
          z.literal(2),
          z.literal(4),
          z.literal(8),
          z.literal(16),
          z.literal(32),
        ]).default(4),
        pre_measure: z.number().int().min(0).max(127).default(4),
        notes: z.array(NoteSchema).max(1000).default([]),
        control_curves: z
          .array(
            z
              .object({
                curve: CurveSchema,
                points: z.array(ControlPointSchema).min(1).max(5000),
              })
              .strict(),
          )
          .max(8)
          .default([])
          .describe(
            "Optional complete DYN/BRE/BRI/CLE/GEN/POR/PIT/PBS curves for a tuned project created in one atomic write",
          ),
        overwrite: z.boolean().default(false),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const curveNames = new Set<string>();
      for (const entry of params.control_curves) {
        if (curveNames.has(entry.curve)) {
          throw new Error(`control_curves contains duplicate curve ${entry.curve}`);
        }
        curveNames.add(entry.curve);
      }
      const result = await createProject({
        outputPath: params.output_path,
        format: params.format,
        voice: { name: params.voice.name, componentId: params.voice.component_id },
        bankSelect: params.bank_select,
        programChange: params.program_change,
        sequenceName: params.sequence_name,
        trackName: params.track_name,
        partName: params.part_name,
        bpm: params.bpm,
        numerator: params.numerator,
        denominator: params.denominator,
        preMeasure: params.pre_measure,
        notes: normalizeNotes(params.notes),
        controlCurves: Object.fromEntries(
          params.control_curves.map((entry) => [entry.curve, entry.points]),
        ),
        overwrite: params.overwrite,
      });
      return textResult(result, params.response_format, `Created ${result.format} project`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_update_note_expressions",
  {
    title: "Update VOCALOID Note Expressions",
    description: `Retune selected notes in an existing VSQX and write a derived project.

Use vocaloid_list_notes first; note_index is the stable index returned there. This tool updates pronunciation velocity, lyric/phonemes, accent, decay, opening, bend depth/length, rising/falling portamento, and built-in vibrato. Vibrato depth/rate envelopes use normalized positions across the whole note (0..65536) and values 0..127. Passing vibrato type 0 turns vibrato off and clears its envelopes. Unspecified fields are preserved. Existing outputs require overwrite=true and are backed up first.`,
    inputSchema: z
      .object({
        input_path: PathSchema,
        output_path: PathSchema,
        track_number: z.number().int().min(0).max(127).default(0),
        part_index: z.number().int().min(0).default(0),
        updates: z.array(NoteExpressionUpdateSchema).min(1).max(1000),
        overwrite: z.boolean().default(false),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await updateNoteExpressionsInProject(
        params.input_path,
        params.output_path,
        params.track_number,
        params.part_index,
        normalizeNoteExpressionUpdates(params.updates),
        params.overwrite,
      );
      return textResult(
        result,
        params.response_format,
        `Updated expressions on ${result.updated} notes`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_analyze_wav",
  {
    title: "Analyze WAV Mix Quality",
    description: "Measure WAV loudness, dynamics, peaks, clipping, and stereo balance without modifying the file.",
    inputSchema: z
      .object({
        path: PathSchema,
        target_lufs: z.number().min(-24).max(-5).default(-14),
        target_true_peak_dbfs: z.number().min(-6).max(-0.1).default(-1),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: typedToolOutputSchema(AudioQualityDataOutputSchema),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await analyzeAudioQuality(
        params.path,
        params.target_lufs,
        params.target_true_peak_dbfs,
      );
      return textResult(
        result,
        params.response_format,
        `Analyzed ${result.durationSeconds.toFixed(3)} seconds: ${result.integratedLufs.toFixed(1)} LUFS, ${result.truePeakDbfs.toFixed(1)} dBFS true peak`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_master_wav",
  {
    title: "Master WAV to Loudness and True-Peak Targets",
    description: `Create a new mastered 16-bit PCM WAV using measured two-pass EBU R128 loudness normalization and true-peak limiting.

The source is never modified and input_path must differ from output_path. The tool first measures loudness, renders to a temporary sibling, independently re-analyzes the result, and atomically commits only when integrated loudness is within 0.6 LU and true peak within 0.2 dB of the requested ceilings. Existing output is refused unless overwrite=true, which creates a timestamped backup. If the source already contains full-scale clipped samples, success reports sourceClipped=true: mastering can prevent new overs but cannot reconstruct lost transients, so a lower-level remix/re-render remains preferable.`,
    inputSchema: z
      .object({
        input_path: PathSchema,
        output_path: PathSchema,
        target_lufs: z.number().min(-24).max(-5).default(-14),
        target_true_peak_dbfs: z.number().min(-6).max(-0.1).default(-1),
        target_loudness_range_lu: z.number().min(1).max(20).default(11),
        overwrite: z.boolean().default(false),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await masterWav({
        inputPath: params.input_path,
        outputPath: params.output_path,
        targetLufs: params.target_lufs,
        targetTruePeakDbfs: params.target_true_peak_dbfs,
        targetLoudnessRangeLu: params.target_loudness_range_lu,
        overwrite: params.overwrite,
      });
      const warnings = [
        ...(result.sourceClipped
          ? ["The source contained clipped samples; re-render the mix with more headroom to restore transient quality"]
          : []),
        ...(!result.loudnessRangeTargetMet
          ? [`Output LRA is ${result.output.loudnessRangeLu.toFixed(1)} LU versus the requested ${result.targetLoudnessRangeLu.toFixed(1)} LU; revise section dynamics or bus compression rather than claiming the dynamic-range target was met`]
          : []),
      ];
      return textResult(
        result,
        params.response_format,
        `Mastered to ${result.output.integratedLufs.toFixed(1)} LUFS and ${result.output.truePeakDbfs.toFixed(1)} dBFS true peak`,
        warnings,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_render_wav",
  {
    title: "Render VOCALOID Project to WAV",
    description: `Render a validated V3/V4 VSQX through the installed original VOCALOID3 Editor and return verified audio metrics.

This is a bounded workflow operation: it launches a helper-owned minimized editor, guards export dialogs offscreen, selects Master Track WAV export, waits for a stable output, closes the editor, validates RIFF/WAVE structure, and rejects silent audio. It never reports success from file existence alone. Output is written to a temporary sibling and atomically renamed only after validation. Existing output is refused unless overwrite=true; replacement creates a timestamped backup. The native helper must first be built with scripts/build-native.sh.`,
    inputSchema: z
      .object({
        input_path: PathSchema.describe("Source V3/V4 .vsqx project"),
        output_path: PathSchema.describe("Destination .wav path within an allowed write root"),
        timeout_seconds: z
          .number()
          .int()
          .min(10)
          .max(600)
          .default(300)
          .describe("Total editor launch, synthesis, export, and cleanup deadline"),
        overwrite: z.boolean().default(false),
        allow_pre_send_adjustment: z.boolean().default(false)
          .describe("Explicitly allow Editor's exact Event Verification prompt to reduce Pre-Send time to fit the project's pre-measures"),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await renderProjectToWav(
        params.input_path,
        params.output_path,
        params.timeout_seconds,
        params.overwrite,
        params.allow_pre_send_adjustment,
      );
      const warnings = result.forcedTermination
        ? ["The helper had to terminate its own editor process after producing valid audio"]
        : [];
      return textResult(
        result,
        params.response_format,
        `Rendered ${result.durationSeconds.toFixed(3)} seconds of verified vocal audio`,
        warnings,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_add_notes",
  {
    title: "Add VOCALOID Notes",
    description: `Add notes to one part and save a new VSQX file or an explicitly approved overwrite.

Existing and new notes are sorted by relative tick, and playTime expands when necessary. The source is never changed when output_path differs. If output_path exists, overwrite=false refuses the operation; overwrite=true first creates a timestamped backup. This tool does not resolve overlaps automatically—validate or inspect the output afterward.`,
    inputSchema: z
      .object({
        input_path: PathSchema,
        output_path: PathSchema,
        track_number: z.number().int().min(0).max(127).default(0),
        part_index: z.number().int().min(0).default(0),
        notes: z.array(NoteSchema).min(1).max(1000),
        overwrite: z.boolean().default(false),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await addNotesToProject(
        params.input_path,
        params.output_path,
        params.track_number,
        params.part_index,
        normalizeNotes(params.notes),
        params.overwrite,
      );
      return textResult(result, params.response_format, `Added ${result.added} notes`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_add_control_points",
  {
    title: "Add VOCALOID Control Points",
    description: `Upsert points on a DYN/BRE/BRI/CLE/GEN/POR/PIT/PBS curve and write a derived VSQX.

DYN shapes loudness; BRE breathiness; BRI brightness; CLE clarity; GEN formant/gender; POR portamento timing; PIT pitch bend; PBS pitch-bend sensitivity in semitones. Curve ranges are enforced: PIT -8192..8191, PBS 0..24, all others 0..127. Approximate pitch offset is PIT/8192*PBS semitones. Prefer a few intentional points around transitions and phrase arcs rather than dense arbitrary curves. V4 curve names are encoded to its single-letter IDs. Duplicate curve/tick pairs are replaced. With replace_range=true, existing points on the chosen curve between the first and last supplied tick are removed before insertion. Existing outputs require overwrite=true and are backed up first.`,
    inputSchema: z
      .object({
        input_path: PathSchema,
        output_path: PathSchema,
        track_number: z.number().int().min(0).max(127).default(0),
        part_index: z.number().int().min(0).default(0),
        curve: CurveSchema,
        points: z.array(ControlPointSchema).min(1).max(5000),
        replace_range: z.boolean().default(false),
        overwrite: z.boolean().default(false),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await addControlPointsToProject(
        params.input_path,
        params.output_path,
        params.track_number,
        params.part_index,
        params.curve,
        params.points,
        params.replace_range,
        params.overwrite,
      );
      return textResult(
        result,
        params.response_format,
        `Added ${result.added} ${result.curve} points`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_import_vsqx_manifest",
  {
    title: "Import VSQX into Canonical Manifest",
    description: "Import a V3/V4 VSQX vocal score into a new stable-ID manifest and record the source with warnings for unsupported data.",
    inputSchema: z.object({
      source_path: PathSchema,
      output_manifest_path: PathSchema.describe("New .song.json path"),
      song_id: ManifestIdSchema,
      slug: ManifestIdSchema,
      title: z.string().min(1).max(256).optional(),
      sample_rate: z.union([z.literal(44_100), z.literal(48_000), z.literal(96_000)]).default(44_100),
      accompaniment_gain: z.number().gt(0).max(10).default(0.2),
      overwrite: z.boolean().default(false),
      response_format: ResponseFormatSchema,
    }).strict(),
    outputSchema: workflowOutputSchema(ImportVsqxDataOutputSchema),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await importVsqxToSongManifest({
        sourcePath: params.source_path,
        outputManifestPath: params.output_manifest_path,
        songId: params.song_id,
        slug: params.slug,
        ...(params.title !== undefined ? { title: params.title } : {}),
        overwrite: params.overwrite,
        sampleRate: params.sample_rate,
        accompanimentGain: params.accompaniment_gain,
      });
      return workflowResult(
        result,
        params.response_format,
        `Imported ${result.imported.notes} notes across ${result.imported.parts} part(s)`,
        result.warnings,
      );
    } catch (error) {
      return workflowError(error);
    }
  },
);

server.registerTool(
  "vocaloid_edit_song",
  {
    title: "Edit Canonical Song",
    description: "Apply one strict action payload from vocaloid://edit-song-contract; dry_run returns hashes, music-aware diff, theory/intent deltas, and preflight without writing.",
    inputSchema: EditSongInputSchema,
    outputSchema: workflowOutputSchema(EditSongDataOutputSchema),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (envelope) => {
    try {
      const params = EditSongActionRequestSchema.parse({
        ...envelope.payload,
        action: envelope.action,
        response_format: envelope.response_format,
      });
      if (params.action === "expand_tempo_curve") {
        const selectedCurve = params.curve ?? "ease_in_out";
        const result = expandTempoCurve({
          timeSignatures: params.time_signatures!,
          start: params.start!,
          end: params.end!,
          startBpm: params.start_bpm!,
          endBpm: params.end_bpm!,
          steps: params.steps ?? 8,
          curve: selectedCurve,
        });
        return workflowResult(
          { kind: "tempo_curve" as const, action: "expand_tempo_curve" as const, ...result },
          params.response_format,
          `Expanded ${selectedCurve} tempo curve into ${result.events.length} event(s)`,
        );
      }
      const inputPath = params.input_path!;
      const outputPath = params.output_path!;
      const expectedRevision = params.expected_revision!;
      const preview = async (mutator: (path: string) => Promise<unknown>) => {
        const result = await previewSongManifestMutation(
          inputPath,
          expectedRevision,
          mutator,
        );
        return workflowResult(
          { kind: "mutation_preview" as const, action: params.action, preview: result },
          params.response_format,
          `Dry-run ${params.action} preview: ${result.totalChanges} stable-object change(s)`,
        );
      };
      if (params.action === "set_composition_intent") {
        const intent = params.composition_intent!;
        if (params.dry_run) return preview((path) => setSongManifestCompositionIntent(
          path, path, expectedRevision, intent, true,
        ));
        const result = await setSongManifestCompositionIntent(
          inputPath, outputPath, expectedRevision, intent, params.overwrite,
        );
        const objectIds = [
          ...intent.sections.map((entry) => entry.id),
          ...intent.phrase_directions.flatMap((entry) => [entry.id, entry.listening_question.id]),
        ];
        const data = await normalizedAppliedEdit(params.action, inputPath, result, {
          changedCount: 1 + intent.sections.length + intent.phrase_directions.length,
          objectIds,
        });
        return workflowResult(data, params.response_format, `Applied ${params.action} as revision ${result.write.revision}`);
      }
      if (params.action === "set_composition_guidance") {
        const guidance = params.composition_guidance!;
        if (params.dry_run) return preview((path) => setSongManifestCompositionGuidance(
          path, path, expectedRevision, guidance, true,
        ));
        const result = await setSongManifestCompositionGuidance(
          inputPath, outputPath, expectedRevision, guidance, params.overwrite,
        );
        const data = await normalizedAppliedEdit(params.action, inputPath, result, {
          changedCount: 1 + guidance.exceptions.length,
          objectIds: guidance.exceptions.flatMap((exception) => [exception.id, ...exception.object_ids]),
        });
        return workflowResult(data, params.response_format, `Applied ${params.action} as revision ${result.write.revision}`);
      }
      if (params.action === "upsert_theory_exception") {
        const exception = params.theory_exception!;
        if (params.dry_run) return preview((path) => upsertSongManifestTheoryException(
          path, path, expectedRevision, exception, true,
        ));
        const result = await upsertSongManifestTheoryException(
          inputPath, outputPath, expectedRevision, exception, params.overwrite,
        );
        const data = await normalizedAppliedEdit(params.action, inputPath, result, {
          changedCount: 1,
          objectIds: [exception.id, ...exception.object_ids],
        });
        return workflowResult(data, params.response_format, `Applied ${params.action} as revision ${result.write.revision}`);
      }
      if (params.action === "upsert_section_intent") {
        const sectionIntent = params.section_intent!;
        if (params.dry_run) return preview((path) => upsertSongManifestSectionIntent(
          path, path, expectedRevision, sectionIntent, true,
        ));
        const result = await upsertSongManifestSectionIntent(
          inputPath, outputPath, expectedRevision, sectionIntent, params.overwrite,
        );
        const data = await normalizedAppliedEdit(params.action, inputPath, result, {
          changedCount: 1,
          objectIds: [sectionIntent.id, sectionIntent.section_id],
        });
        return workflowResult(data, params.response_format, `Applied ${params.action} as revision ${result.write.revision}`);
      }
      if (params.action === "upsert_phrase_direction") {
        const direction = params.phrase_direction!;
        if (params.dry_run) return preview((path) => upsertSongManifestPhraseDirection(
          path, path, expectedRevision, direction, true,
        ));
        const result = await upsertSongManifestPhraseDirection(
          inputPath, outputPath, expectedRevision, direction, params.overwrite,
        );
        const data = await normalizedAppliedEdit(params.action, inputPath, result, {
          changedCount: 1,
          objectIds: [direction.id, direction.listening_question.id],
        });
        return workflowResult(data, params.response_format, `Applied ${params.action} as revision ${result.write.revision}`);
      }
      if (params.action === "bind_phrase_realization") {
        const directionId = params.phrase_direction_id!;
        const links = params.realization_links!;
        if (params.dry_run) return preview((path) => bindSongManifestPhraseRealization(
          path, path, expectedRevision, directionId, links, true,
        ));
        const result = await bindSongManifestPhraseRealization(
          inputPath, outputPath, expectedRevision, directionId, links, params.overwrite,
        );
        const data = await normalizedAppliedEdit(params.action, inputPath, result, {
          changedCount: 1,
          objectIds: [directionId, ...Object.values(links).flatMap((entry) => entry ?? [])],
        });
        return workflowResult(data, params.response_format, `Applied ${params.action} as revision ${result.write.revision}`);
      }
      if (params.action === "replace_timeline") {
        const update = params.update!;
        if (params.dry_run) return preview((path) => updateSongManifestTimeline(path, path, expectedRevision, update, true));
        const result = await updateSongManifestTimeline(inputPath, outputPath, expectedRevision, update, params.overwrite);
        const data = await normalizedAppliedEdit(params.action, inputPath, result, { changedCount: Object.keys(update).length, objectIds: Object.keys(update) });
        return workflowResult(data, params.response_format, `Applied ${params.action} as revision ${result.write.revision}`);
      }
      if (params.action === "upsert_section") {
        const section = params.section!;
        if (params.dry_run) return preview((path) => upsertSongManifestSection(path, path, expectedRevision, section, true));
        const result = await upsertSongManifestSection(inputPath, outputPath, expectedRevision, section, params.overwrite);
        const data = await normalizedAppliedEdit(params.action, inputPath, result, { changedCount: 1, objectIds: [section.id] });
        return workflowResult(data, params.response_format, `Applied ${params.action} as revision ${result.write.revision}`);
      }
      if (params.action === "upsert_vocal_part") {
        const voice = params.voice!;
        const track = ManifestVocalTrackMetadataSchema.parse(params.track);
        const part = params.part!;
        if (params.dry_run) return preview((path) => upsertSongManifestVocalPart(path, path, expectedRevision, voice, track, part, true));
        const result = await upsertSongManifestVocalPart(inputPath, outputPath, expectedRevision, voice, track, part, params.overwrite);
        const data = await normalizedAppliedEdit(params.action, inputPath, result, { changedCount: 1, objectIds: [voice.id, track.id, part.id] });
        return workflowResult(data, params.response_format, `Applied ${params.action} as revision ${result.write.revision}`);
      }
      if (params.action === "upsert_vocal_phrase") {
        const phrase = params.phrase!;
        if (params.dry_run) return preview((path) => upsertSongManifestVocalPhrase(path, path, expectedRevision, params.vocal_track_id!, params.vocal_part_id!, phrase, true));
        const result = await upsertSongManifestVocalPhrase(inputPath, outputPath, expectedRevision, params.vocal_track_id!, params.vocal_part_id!, phrase, params.overwrite);
        const data = await normalizedAppliedEdit(params.action, inputPath, result, { changedCount: 1, objectIds: [phrase.id] });
        return workflowResult(data, params.response_format, `Applied ${params.action} as revision ${result.write.revision}`);
      }
      if (params.action === "apply_tuning") {
        const gestures = params.gestures!;
        if (params.dry_run) return preview((path) => applySongManifestTuningGestures(
          path, path, expectedRevision, params.vocal_track_id!, params.vocal_part_id!, gestures, true,
          params.materialize_existing,
        ));
        const result = await applySongManifestTuningGestures(
          inputPath, outputPath, expectedRevision, params.vocal_track_id!, params.vocal_part_id!, gestures,
          params.overwrite, params.materialize_existing,
        );
        const data = await normalizedAppliedEdit(params.action, inputPath, result, {
          changedCount: result.applied.affected_event_references,
          objectIds: gestures.flatMap((gesture) => [gesture.id, ...gesture.event_ids]),
          compiledGestures: result.applied.compiled,
        });
        return workflowResult(data, params.response_format, `Applied ${params.action} as revision ${result.write.revision}`);
      }
      if (params.action === "upsert_arrangement") {
        const track = ManifestArrangementTrackSchema.parse(params.track);
        if (params.dry_run) return preview((path) => upsertSongManifestArrangementTrack(path, path, expectedRevision, track, true));
        const result = await upsertSongManifestArrangementTrack(inputPath, outputPath, expectedRevision, track, params.overwrite);
        const data = await normalizedAppliedEdit(params.action, inputPath, result, { changedCount: 1, objectIds: [track.id] });
        return workflowResult(data, params.response_format, `Applied ${params.action} as revision ${result.write.revision}`);
      }
      if (params.action === "apply_groove") {
        const groove = params.groove!;
        if (params.dry_run) return preview((path) => applySongManifestGroove(path, path, expectedRevision, groove, true));
        const result = await applySongManifestGroove(inputPath, outputPath, expectedRevision, groove, params.overwrite);
        const data = await normalizedAppliedEdit(params.action, inputPath, result, {
          changedCount: result.changed,
          objectIds: result.deltas.map((entry) => entry.event_id),
          grooveDeltas: result.deltas,
        });
        return workflowResult(data, params.response_format, `Applied ${params.action} as revision ${result.write.revision}`);
      }
      if (params.action === "upsert_effect_chain") {
        const effectChain = params.effect_chain!;
        if (params.dry_run) return preview((path) => upsertSongManifestEffectChain(path, path, expectedRevision, effectChain, true));
        const result = await upsertSongManifestEffectChain(inputPath, outputPath, expectedRevision, effectChain, params.overwrite);
        const data = await normalizedAppliedEdit(params.action, inputPath, result, { changedCount: effectChain.effects.length, objectIds: [effectChain.id, ...effectChain.effects.map((effect) => effect.id)] });
        return workflowResult(data, params.response_format, `Applied ${params.action} as revision ${result.write.revision}`);
      }
      if (params.action === "upsert_section_dynamic") {
        const sectionDynamic = params.section_dynamic!;
        if (params.dry_run) return preview((path) => upsertSongManifestSectionDynamic(path, path, expectedRevision, sectionDynamic, true));
        const result = await upsertSongManifestSectionDynamic(inputPath, outputPath, expectedRevision, sectionDynamic, params.overwrite);
        const data = await normalizedAppliedEdit(params.action, inputPath, result, { changedCount: 1, objectIds: [sectionDynamic.id] });
        return workflowResult(data, params.response_format, `Applied ${params.action} as revision ${result.write.revision}`);
      }
      if (params.action === "transform_events") {
        const transform = params.transform!;
        if (params.dry_run) return preview((path) => transformSongManifestEvents(path, path, expectedRevision, transform, true));
        const result = await transformSongManifestEvents(inputPath, outputPath, expectedRevision, transform, params.overwrite);
        const data = await normalizedAppliedEdit(params.action, inputPath, result, { changedCount: result.changed, objectIds: transform.event_ids });
        return workflowResult(data, params.response_format, `Applied ${params.action} to ${result.changed} event(s)`);
      }
      const removal = params.removal!;
      if (params.dry_run) return preview((path) => removeSongManifestObjects(path, path, expectedRevision, removal, true));
      const result = await removeSongManifestObjects(inputPath, outputPath, expectedRevision, removal, params.overwrite);
      const data = await normalizedAppliedEdit(params.action, inputPath, result, { changedCount: result.removed, objectIds: removal.object_ids });
      return workflowResult(data, params.response_format, `Applied ${params.action} to ${result.removed} object(s)`);
    } catch (error) {
      return workflowError(error);
    }
  },
);

server.registerTool(
  "vocaloid_creative_journal",
  {
    title: "Record and Publish Creative Decisions",
    description: "Append, query, report, or publish the hash-bound creative journal.",
    inputSchema: CreativeJournalInputSchema,
    outputSchema: typedToolOutputSchema(CreativeJournalDataOutputSchema),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (envelope) => {
    try {
      const params = CreativeJournalActionRequestSchema.parse({
        ...envelope.payload,
        action: envelope.action,
        response_format: envelope.response_format,
      });
      if (params.action === "record") {
        const result = await recordCreativeDecision({
          manifestPath: params.manifest_path,
          expectedRevision: params.expected_revision,
          decision: params.decision,
          dryRun: params.dry_run,
        });
        return textResult(
          result,
          params.response_format,
          `${params.dry_run ? "Validated" : "Recorded"} creative decision ${result.entry.id}`,
        );
      }
      if (params.action === "list") {
        const result = await listCreativeDecisions({
          manifestPath: params.manifest_path,
          ...(params.phases ? { phases: params.phases } : {}),
          ...(params.currentness ? { currentness: params.currentness } : {}),
          offset: params.offset,
          limit: params.limit,
        });
        return textResult(
          result,
          params.response_format,
          `Read ${result.count} of ${result.total} creative decisions`,
        );
      }
      if (params.action === "report") {
        const result = await writeCreativeJournalReport({
          manifestPath: params.manifest_path,
          ...(params.output_path ? { outputPath: params.output_path } : {}),
          overwrite: params.overwrite,
        });
        return textResult(
          result,
          params.response_format,
          `Wrote ${result.entryCount}-decision creative report`,
        );
      }
      const result = await publishCreativeRecordPackage({
        manifestPath: params.manifest_path,
        expectedRevision: params.expected_revision,
        outputDirectory: params.output_directory,
        deliverables: params.deliverables,
        overwrite: params.overwrite,
      });
      return textResult(
        result,
        params.response_format,
        `Published complete ${result.entryCount}-decision creative record package`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_song_timeline",
  {
    title: "Plan or Replace Song Timeline",
    description: `Expand an explicit accelerando/ritardando curve into ordered tempo events, or atomically replace selected timeline/structure/harmony domains in a canonical manifest.

Tempo curves are deterministic calculations, not random rubato. Replacement revalidates every existing part, pattern, section reference, and position against the proposed meter/timeline; dry_run returns predicted hashes, music-aware diff, and preflight without changing the song.`,
    inputSchema: z.discriminatedUnion("action", [
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
        action: z.literal("replace"),
        update: ManifestTimelineUpdateSchema,
      }).strict(),
    ]),
    outputSchema: workflowOutputSchema(SongTimelineDataOutputSchema),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      if (params.action === "expand_tempo_curve") {
        const result = expandTempoCurve({
          timeSignatures: params.time_signatures,
          start: params.start,
          end: params.end,
          startBpm: params.start_bpm,
          endBpm: params.end_bpm,
          steps: params.steps,
          curve: params.curve,
        });
        return workflowResult(
          { action: "expand_tempo_curve" as const, ...result },
          params.response_format,
          `Expanded ${params.curve} tempo curve into ${result.events.length} event(s)`,
        );
      }
      if (params.dry_run) {
        const preview = await previewSongManifestMutation(
          params.input_path,
          params.expected_revision,
          (path) => updateSongManifestTimeline(
            path, path, params.expected_revision, params.update, true,
          ),
        );
        return workflowResult(
          { action: "replace" as const, dryRun: true as const, preview },
          params.response_format,
          "Dry-run timeline replacement preview",
        );
      }
      const result = await updateSongManifestTimeline(
        params.input_path,
        params.output_path,
        params.expected_revision,
        params.update,
        params.overwrite,
      );
      return workflowResult(
        { action: "replace" as const, dryRun: false as const, ...result },
        params.response_format,
        `Replaced song timeline domain(s) at revision ${result.write.revision}`,
      );
    } catch (error) {
      return workflowError(error);
    }
  },
);

server.registerTool(
  "vocaloid_create_song_manifest",
  {
    title: "Create Canonical Song Manifest",
    description: "Create the revisioned canonical song manifest; derive VSQX/WAV artifacts later through the build workflow.",
    inputSchema: z
      .object({
        output_path: PathSchema.describe("New .song.json path"),
        song_id: ManifestIdSchema,
        slug: ManifestIdSchema.describe("Filename-safe song slug used in all derived artifact names"),
        title: z.string().min(1).max(256),
        format: z.enum(["vsq3", "vsq4"]).default("vsq3"),
        pre_measure: z.number().int().min(0).max(127).default(1),
        time_signatures: z.array(ManifestTimeSignatureSchema).min(1).max(256)
          .default([{ measure: 0, numerator: 4, denominator: 4 }]),
        tempos: z.array(ManifestTempoSchema).min(1).max(5000)
          .default([{ position: { measure: 0, beat: 0, tick: 0 }, bpm: 120 }]),
        sections: z.array(ManifestSectionSchema).min(1).max(1024)
          .describe("Ordered, non-overlapping semantic song sections"),
        key_changes: z.array(ManifestKeyChangeSchema).max(1024).default([]),
        chord_changes: z.array(ManifestChordChangeSchema).max(20_000).default([]),
        sample_rate: z.union([z.literal(44_100), z.literal(48_000), z.literal(96_000)]).default(44_100),
        accompaniment_gain: z.number().gt(0).max(10).default(0.2),
        reverb: z.boolean().default(true),
        chorus: z.boolean().default(true),
        soundfont_path: PathSchema.optional(),
        overwrite: z.boolean().default(false),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: typedToolOutputSchema(ManifestWriteOutputSchema),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await createSongManifest({
        outputPath: params.output_path,
        songId: params.song_id,
        slug: params.slug,
        title: params.title,
        format: params.format,
        preMeasure: params.pre_measure,
        timeSignatures: params.time_signatures,
        tempos: params.tempos,
        sections: params.sections,
        keyChanges: params.key_changes,
        chordChanges: params.chord_changes,
        sampleRate: params.sample_rate,
        gain: params.accompaniment_gain,
        reverb: params.reverb,
        chorus: params.chorus,
        ...(params.soundfont_path !== undefined ? { soundfontPath: params.soundfont_path } : {}),
        overwrite: params.overwrite,
      });
      return textResult(result, params.response_format, `Created song manifest revision ${result.revision}`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_inspect_song_manifest",
  {
    title: "Inspect Song Manifest",
    description: "Verify and summarize a canonical song manifest, including its revision, stable IDs, inventories, intent, and artifact provenance.",
    inputSchema: z.object({ path: PathSchema, response_format: ResponseFormatSchema }).strict(),
    outputSchema: typedToolOutputSchema(ManifestSummaryDataOutputSchema),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ path, response_format }) => {
    try {
      const result = await inspectSongManifest(path);
      return textResult(result, response_format, `Song manifest revision ${result.revision}`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_preflight_song",
  {
    title: "Preflight Complete Song Workflow",
    description: "Run non-mutating structural, theory, vocal, arrangement, mix, artifact, intent, and host readiness checks with stable issue codes. Optionally return 3–8 deterministic theory-only repair hypotheses; every apply blueprint remains revision-bound and requires vocaloid_edit_song dry_run plus listening review.",
    inputSchema: z.object({
      manifest_path: PathSchema.describe("Canonical .song.json to lint"),
      artifact_check: z.enum(["none", "current", "all"]).default("current")
        .describe("none skips files; current hashes only current-composition artifacts; all also audits history"),
      include_performance_warnings: z.boolean().default(true)
        .describe("Include non-mutating range, rapid-event, and breath-run guidance"),
      check_voice_cache: z.boolean().default(true)
        .describe("Require non-expired voice verification for this exact Editor/helper fingerprint without launching Editor"),
      allow_unknown_editor: z.boolean().default(false)
        .describe("Allow reading a cache tied to an unknown but manually verified Editor build"),
      include_theory_proposals: z.boolean().default(false)
        .describe("Return bounded read-only repair hypotheses; never consults corpus/style data and never mutates"),
      max_theory_proposals: z.number().int().min(3).max(8).default(6),
      theory_proposal_kinds: z.array(TheoryProposalKindSchema).max(5).default([]),
      theory_proposal_issue_codes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,95}$/u)).max(64).default([]),
      theory_proposal_object_ids: z.array(ManifestIdSchema).max(256).default([]),
      response_format: ResponseFormatSchema,
    }).strict(),
    outputSchema: workflowOutputSchema(PreflightDataOutputSchema),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const verified = params.check_voice_cache
        ? await verifiedVoiceComponentIds(params.allow_unknown_editor)
        : undefined;
      const result = await preflightSongManifest(params.manifest_path, {
        artifactCheck: params.artifact_check,
        includePerformanceWarnings: params.include_performance_warnings,
        ...(verified ? { verifiedVoiceComponentIds: verified } : {}),
        ...(params.include_theory_proposals ? {
          theoryProposalOptions: {
            maxCandidates: params.max_theory_proposals,
            kinds: params.theory_proposal_kinds,
            issueCodes: params.theory_proposal_issue_codes,
            objectIds: params.theory_proposal_object_ids,
          },
        } : {}),
      });
      return workflowResult(
        result,
        params.response_format,
        `Preflight found ${result.counts.errors} error(s), ${result.counts.warnings} warning(s), and ${result.theoryProposals?.summary.candidateCount ?? 0} bounded proposal(s)`,
      );
    } catch (error) {
      return workflowError(error);
    }
  },
);

server.registerTool(
  "vocaloid_render_manifest_master",
  {
    title: "Render and Record Manifest Master",
    description: "Render a current VSQX through the original Editor, verify the WAV, and atomically record a provenance-bound master artifact.",
    inputSchema: z.object({
      manifest_path: PathSchema,
      expected_revision: z.number().int().min(1).describe("Latest inspected manifest revision"),
      project_artifact_id: ManifestIdSchema.describe("Current VSQX artifact returned by manifest build"),
      output_path: PathSchema.describe("New song-title/revision-bearing .wav path"),
      timeout_seconds: z.number().int().min(30).max(600).default(300),
      allow_pre_send_adjustment: z.boolean().default(false),
      allow_unknown_editor: z.boolean().default(false)
        .describe("Explicit opt-in only after bounded manual verification of this exact Editor build"),
      reference_lufs: z.number().min(-36).max(-5).default(-16)
        .describe("Analysis reference only; Editor render is not normalized"),
      reference_true_peak_dbfs: z.number().min(-12).max(0).default(-1)
        .describe("Analysis reference only; Editor render is not limited"),
      response_format: ResponseFormatSchema,
    }).strict(),
    outputSchema: workflowOutputSchema(ManifestMasterDataOutputSchema),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params, extra) => {
    try {
      const progressToken = extra._meta?.progressToken;
      const result = await renderSongManifestMaster({
        manifestPath: params.manifest_path,
        expectedRevision: params.expected_revision,
        projectArtifactId: params.project_artifact_id,
        outputPath: params.output_path,
        timeoutSeconds: params.timeout_seconds,
        allowPreSendAdjustment: params.allow_pre_send_adjustment,
        referenceLufs: params.reference_lufs,
        referenceTruePeakDbfs: params.reference_true_peak_dbfs,
        runtime: {
          requestId: String(extra.requestId),
          signal: extra.signal,
          allowUnknownEditor: params.allow_unknown_editor,
          ...(progressToken !== undefined
            ? {
                progress: async (update) => extra.sendNotification({
                  method: "notifications/progress",
                  params: {
                    progressToken,
                    progress: update.progress,
                    total: update.total,
                    message: `${update.stage}: ${update.message}`,
                  },
                }),
              }
            : {}),
        },
      });
      const warnings = [
        ...(result.render.clippedSampleValues > 0
          ? [`Editor master contains ${result.render.clippedSampleValues} clipped sample values; revise before delivery`]
          : []),
        ...(result.render.stereoBalanceDb !== null && Math.abs(result.render.stereoBalanceDb) > 3
          ? [`Editor master stereo balance is ${result.render.stereoBalanceDb.toFixed(2)} dB; confirm intentional panning`]
          : []),
      ];
      return workflowResult(
        result,
        params.response_format,
        `Recorded Editor master ${result.artifact.id} at manifest revision ${result.manifestRevision}`,
        warnings,
      );
    } catch (error) {
      return workflowError(error);
    }
  },
);

server.registerTool(
  "vocaloid_master_manifest_delivery",
  {
    title: "Master and Record Manifest Delivery",
    description: "Two-pass loudness-master a current mix/master, report deterministic peak/LRA transparency risk for source-vs-delivery A/B, and atomically record verified provenance.",
    inputSchema: z.object({
      manifest_path: PathSchema,
      expected_revision: z.number().int().min(1),
      source_artifact_id: ManifestIdSchema.describe("Current role=master or role=mix artifact"),
      output_path: PathSchema.describe("New song-title/revision-bearing final .wav path"),
      target_lufs: z.number().min(-24).max(-5).default(-16),
      target_true_peak_dbfs: z.number().min(-6).max(-0.1).default(-1),
      target_loudness_range_lu: z.number().min(1).max(20).default(7),
      allow_clipped_source: z.boolean().default(false)
        .describe("Explicitly document acceptance of unrecoverable source clipping"),
      response_format: ResponseFormatSchema,
    }).strict(),
    outputSchema: workflowOutputSchema(ManifestDeliveryDataOutputSchema),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await masterSongManifestDelivery({
        manifestPath: params.manifest_path,
        expectedRevision: params.expected_revision,
        sourceArtifactId: params.source_artifact_id,
        outputPath: params.output_path,
        targetLufs: params.target_lufs,
        targetTruePeakDbfs: params.target_true_peak_dbfs,
        targetLoudnessRangeLu: params.target_loudness_range_lu,
        allowClippedSource: params.allow_clipped_source,
      });
      const warnings = [
        ...(result.mastering.output.channelImbalance
          ? [`Final stereo balance is ${result.mastering.output.stereoBalanceDb?.toFixed(2)} dB; confirm it is intentional`]
          : []),
        ...(!result.mastering.loudnessRangeTargetMet
          ? [`Loudness range ${result.mastering.output.loudnessRangeLu.toFixed(1)} LU differs from the requested ${params.target_loudness_range_lu.toFixed(1)} LU; loudnorm does not invent dynamics`]
          : []),
        ...(result.mastering.transparencyReviewRecommended
          ? [`Mastering needs ${result.mastering.peakReductionRequiredDb.toFixed(1)} dB of peak reshaping and changed LRA by ${result.mastering.loudnessRangeChangeLu.toFixed(1)} LU; compare this source artifact and delivery over the same passage at equal LUFS before publishing`]
          : []),
      ];
      return workflowResult(
        result,
        params.response_format,
        `Recorded final ${result.mastering.output.integratedLufs.toFixed(1)} LUFS delivery ${result.artifact.id}`,
        warnings,
      );
    } catch (error) {
      return workflowError(error);
    }
  },
);

server.registerTool(
  "vocaloid_manifest_history",
  {
    title: "List, Diff, or Restore Manifest History",
    description: "List, music-diff, or monotonically restore verified immutable song-manifest history snapshots.",
    inputSchema: z.discriminatedUnion("action", [
      z.object({
        action: z.literal("list"),
        manifest_path: PathSchema,
        response_format: ResponseFormatSchema,
      }).strict(),
      z.object({
        action: z.literal("diff"),
        from_path: PathSchema.describe("Verified history path returned by action=list"),
        to_path: PathSchema.describe("Another verified history/current path for the same song"),
        response_format: ResponseFormatSchema,
      }).strict(),
      z.object({
        action: z.literal("restore"),
        manifest_path: PathSchema.describe("Current canonical manifest"),
        snapshot_path: PathSchema.describe("Historical snapshot path returned by action=list"),
        expected_revision: z.number().int().min(1),
        response_format: ResponseFormatSchema,
      }).strict(),
    ]),
    outputSchema: workflowOutputSchema(ManifestHistoryDataOutputSchema),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      if (params.action === "list") {
        const result = await listManifestHistory(params.manifest_path);
        return workflowResult(
          { action: "list" as const, ...result },
          params.response_format,
          `Found ${result.entries.length} verified manifest snapshot(s)`,
          result.invalid.map((entry) => `Invalid history entry ${entry.path}: ${entry.error}`),
        );
      }
      if (params.action === "diff") {
        const result = await diffManifestSnapshots(params.from_path, params.to_path);
        return workflowResult(
          { action: "diff" as const, ...result },
          params.response_format,
          `Manifest revisions differ by ${result.totalChanges} stable-object change(s)`,
        );
      }
      const result = await restoreSongManifestSnapshot(
        params.manifest_path,
        params.snapshot_path,
        params.expected_revision,
      );
      return workflowResult(
        { action: "restore" as const, ...result },
        params.response_format,
        `Restored revision ${result.restoredFrom.revision} as new revision ${result.write.revision}`,
      );
    } catch (error) {
      return workflowError(error);
    }
  },
);

const AudioReviewInputSchema = z.object({
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

const ReviewSongInputSchema = z.object({
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

server.registerTool(
  "vocaloid_review_audio",
  {
    title: "Render Section Preview or Loudness-Matched A/B",
    description: "Render section or 20–30s anchor previews and single-question loudness-matched A/B evidence; this tool never chooses a winner.",
    inputSchema: AudioReviewInputSchema,
    outputSchema: workflowOutputSchema(AudioReviewDataOutputSchema),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      if (params.action === "section_preview") {
        const result = await renderSongSectionPreview({
          manifestPath: params.manifest_path,
          expectedRevision: params.expected_revision,
          sourceArtifactId: params.source_artifact_id!,
          sectionId: params.section_id!,
          outputPath: params.output_path!,
          handleBeforeSeconds: params.handle_before_seconds,
          handleAfterSeconds: params.handle_after_seconds,
          referenceLufs: params.reference_lufs,
          referenceTruePeakDbfs: params.reference_true_peak_dbfs,
        });
        return workflowResult(
          { action: "section_preview" as const, ...result },
          params.response_format,
          `Rendered ${params.section_id} preview at ${result.quality.integratedLufs.toFixed(1)} LUFS`,
        );
      }
      if (params.action === "compare_ab") {
        const result = await compareSongSectionArtifacts({
          manifestPath: params.manifest_path,
          expectedRevision: params.expected_revision,
          artifactAId: params.artifact_a_id!,
          artifactBId: params.artifact_b_id!,
          sectionId: params.section_id!,
          outputAPath: params.output_a_path!,
          outputBPath: params.output_b_path!,
          handleBeforeSeconds: params.handle_before_seconds,
          handleAfterSeconds: params.handle_after_seconds,
          ...(params.match_lufs !== undefined ? { matchLufs: params.match_lufs } : {}),
          referenceTruePeakDbfs: params.reference_true_peak_dbfs,
        });
        return workflowResult(
          { action: "compare_ab" as const, ...result },
          params.response_format,
          `Rendered loudness-matched A/B for ${params.section_id} at ${result.targetLufs.toFixed(1)} LUFS`,
        );
      }
      if (params.action === "anchor_preview") {
        const result = await renderSongAnchorPassagePreview({
          manifestPath: params.manifest_path,
          expectedRevision: params.expected_revision,
          sourceArtifactId: params.source_artifact_id!,
          phraseDirectionId: params.phrase_direction_id!,
          auditionLayer: params.audition_layer!,
          outputPath: params.output_path!,
          targetDurationSeconds: params.target_duration_seconds,
          referenceLufs: params.reference_lufs,
          referenceTruePeakDbfs: params.reference_true_peak_dbfs,
        });
        return workflowResult(
          { action: "anchor_preview" as const, ...result },
          params.response_format,
          `Rendered ${params.audition_layer} for ${params.phrase_direction_id} (${result.quality.durationSeconds.toFixed(1)}s)`,
        );
      }
      const result = await compareSongAnchorPassageArtifacts({
        manifestPath: params.manifest_path,
        expectedRevision: params.expected_revision,
        artifactAId: params.artifact_a_id!,
        artifactBId: params.artifact_b_id!,
        phraseDirectionId: params.phrase_direction_id!,
        auditionLayer: params.audition_layer!,
        hypothesisFamily: params.hypothesis_family!,
        outputAPath: params.output_a_path!,
        outputBPath: params.output_b_path!,
        targetDurationSeconds: params.target_duration_seconds,
        ...(params.match_lufs !== undefined ? { matchLufs: params.match_lufs } : {}),
        referenceTruePeakDbfs: params.reference_true_peak_dbfs,
      });
      return workflowResult(
        { action: "compare_anchor_ab" as const, ...result },
        params.response_format,
        `Rendered single-question ${params.hypothesis_family} A/B for ${params.phrase_direction_id} at ${result.targetLufs.toFixed(1)} LUFS`,
      );
    } catch (error) {
      return workflowError(error);
    }
  },
);

server.registerTool(
  "vocaloid_review_song",
  {
    title: "List, Add, or Resolve Listening Notes",
    description: "List or persist qualitative listening notes, including hash-bound keep/reject/revise evidence for phrase intent; metrics cannot self-approve.",
    inputSchema: ReviewSongInputSchema,
    outputSchema: workflowOutputSchema(ReviewSongDataOutputSchema),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      if (params.action === "add") {
        await addSongManifestReviewNote(params.manifest_path, params.expected_revision!, params.note!);
      } else if (params.action === "resolve") {
        await resolveSongManifestReviewNote(
          params.manifest_path,
          params.expected_revision!,
          params.note_id!,
          params.resolution!,
        );
      }
      const loaded = await loadSongManifest(params.manifest_path);
      let notes = loaded.manifest.review_notes ?? [];
      if (params.action === "list") {
        if (params.status !== "all") notes = notes.filter((note) => note.status === params.status);
        if (params.section_id) notes = notes.filter((note) => note.section_id === params.section_id);
      }
      return workflowResult(
        {
          action: params.action,
          path: loaded.path,
          revision: loaded.manifest.revision,
          contentHash: loaded.manifest.content_hash,
          notes,
        },
        params.response_format,
        `${params.action === "list" ? "Listed" : params.action === "add" ? "Added" : "Resolved"} ${notes.length} review note(s)`,
      );
    } catch (error) {
      return workflowError(error);
    }
  },
);

server.registerTool(
  "vocaloid_get_song_section",
  {
    title: "Get One Song Section",
    description: "Fetch one semantic section and only the vocal, harmony, and arrangement objects that intersect it.",
    inputSchema: z
      .object({
        path: PathSchema,
        section_id: ManifestIdSchema,
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: typedToolOutputSchema(ManifestSectionDataOutputSchema),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ path, section_id, response_format }) => {
    try {
      const result = await getSongManifestSection(path, section_id);
      return textResult(result, response_format, `Loaded section ${section_id} from revision ${result.revision}`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_upsert_song_section",
  {
    title: "Upsert Song Section",
    description: `Insert or replace exactly one section by stable ID using optimistic revision control.

Unrelated IDs and creative content remain unchanged. Overlapping sections and dangling references are rejected.`,
    inputSchema: ManifestMutationPathSchema.extend({ section: ManifestSectionSchema }).strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      if (params.dry_run) {
        const preview = await previewSongManifestMutation(
          params.input_path,
          params.expected_revision,
          (path) => upsertSongManifestSection(path, path, params.expected_revision, params.section, true),
        );
        return textResult(preview, params.response_format, `Dry-run preview for section ${params.section.id}`);
      }
      const result = await upsertSongManifestSection(
        params.input_path,
        params.output_path,
        params.expected_revision,
        params.section,
        params.overwrite,
      );
      return textResult(result, params.response_format, `Upserted section ${params.section.id}`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_upsert_manifest_vocal_part",
  {
    title: "Upsert Manifest Vocal Part",
    description: `Insert or replace one vocal part and its voice/track metadata by stable ID.

Direct notes and phrase sources can express rapid syllables, rests, tuplets, melisma, note expression, vibrato, and control curves. This bounded operation keeps other parts and tracks intact. The supplied track voice_id must equal voice.id.`,
    inputSchema: ManifestMutationPathSchema.extend({
      voice: ManifestVoiceSchema,
      track: ManifestVocalTrackMetadataSchema,
      part: ManifestVocalPartSchema,
    }).strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      if (params.dry_run) {
        const preview = await previewSongManifestMutation(
          params.input_path,
          params.expected_revision,
          (path) => upsertSongManifestVocalPart(
            path, path, params.expected_revision, params.voice, params.track, params.part, true,
          ),
        );
        return textResult(preview, params.response_format, `Dry-run preview for vocal part ${params.part.id}`);
      }
      const result = await upsertSongManifestVocalPart(
        params.input_path,
        params.output_path,
        params.expected_revision,
        params.voice,
        params.track,
        params.part,
        params.overwrite,
      );
      return textResult(result, params.response_format, `Upserted vocal part ${params.part.id}`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_upsert_manifest_vocal_phrase",
  {
    title: "Upsert One Manifest Vocal Phrase",
    description: `Insert or replace one aligned vocal phrase inside an existing part by stable IDs.

This is the bounded write companion to vocaloid_align_japanese_phrase: it preserves voice, track, other parts, direct notes, other phrases, and tuning curves. The complete manifest is revalidated, including phrase bounds, globally unique lyric/cell IDs, rhythm allocation, and optimistic revision.`,
    inputSchema: ManifestMutationPathSchema.extend({
      vocal_track_id: ManifestIdSchema,
      vocal_part_id: ManifestIdSchema,
      phrase: ManifestVocalPhraseSchema,
    }).strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      if (params.dry_run) {
        const preview = await previewSongManifestMutation(
          params.input_path,
          params.expected_revision,
          (path) => upsertSongManifestVocalPhrase(
            path, path, params.expected_revision, params.vocal_track_id,
            params.vocal_part_id, params.phrase, true,
          ),
        );
        return textResult(preview, params.response_format, `Dry-run preview for vocal phrase ${params.phrase.id}`);
      }
      const result = await upsertSongManifestVocalPhrase(
        params.input_path,
        params.output_path,
        params.expected_revision,
        params.vocal_track_id,
        params.vocal_part_id,
        params.phrase,
        params.overwrite,
      );
      return textResult(result, params.response_format, `Upserted vocal phrase ${params.phrase.id}`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_apply_tuning_gestures",
  {
    title: "Apply High-Level Vocal Tuning Gestures",
    description: `Compile intentional vocal gestures onto stable direct-note or phrase-cell IDs in one manifest part.

Articulation writes native accent/decay/opening/consonant velocity/bend/portamento values. Vibrato writes editable type, length, depth, and rate envelopes. Pitch scoops create bounded PBS/PIT points and explicit reset points; dynamics/timbre arcs create sparse DYN/BRE/BRI/CLE/GEN/POR curves. Existing same-type curves are merged by musical tick while preserving existing stable point IDs. Gesture IDs/parameters persist beside the compiled values and cannot be silently reused. No opaque preset, randomization, or automatic quantization is applied: every compiled parameter is returned for inspection and the manifest revision/hash commits the exact result.`,
    inputSchema: ManifestMutationPathSchema.extend({
      vocal_track_id: ManifestIdSchema,
      vocal_part_id: ManifestIdSchema,
      gestures: z.array(ManifestTuningGestureSchema).min(1).max(256),
    }).strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      if (params.dry_run) {
        const preview = await previewSongManifestMutation(
          params.input_path,
          params.expected_revision,
          (path) => applySongManifestTuningGestures(
            path, path, params.expected_revision, params.vocal_track_id,
            params.vocal_part_id, params.gestures, true,
          ),
        );
        return textResult(preview, params.response_format, "Dry-run tuning gesture preview");
      }
      const result = await applySongManifestTuningGestures(
        params.input_path,
        params.output_path,
        params.expected_revision,
        params.vocal_track_id,
        params.vocal_part_id,
        params.gestures,
        params.overwrite,
      );
      return textResult(
        result,
        params.response_format,
        `Applied ${result.applied.gestures} tuning gestures to ${result.applied.affected_event_references} event references`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_upsert_manifest_arrangement_track",
  {
    title: "Upsert Manifest Arrangement Track",
    description: `Insert or replace one pitched or drum arrangement track by stable ID.

Use compact reusable patterns and section-tagged placements for long songs. Other tracks remain unchanged, and every pattern/section reference is validated.`,
    inputSchema: ManifestMutationPathSchema.extend({
      track: ManifestArrangementTrackSchema,
    }).strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      if (params.dry_run) {
        const preview = await previewSongManifestMutation(
          params.input_path,
          params.expected_revision,
          (path) => upsertSongManifestArrangementTrack(
            path, path, params.expected_revision, params.track, true,
          ),
        );
        return textResult(preview, params.response_format, `Dry-run preview for arrangement track ${params.track.id}`);
      }
      const result = await upsertSongManifestArrangementTrack(
        params.input_path,
        params.output_path,
        params.expected_revision,
        params.track,
        params.overwrite,
      );
      return textResult(result, params.response_format, `Upserted arrangement track ${params.track.id}`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_upsert_manifest_effect_chain",
  {
    title: "Upsert Manifest Effect Chain",
    description: `Insert or replace one ordered, reproducible stem or mix-bus effect chain.

target_id is a vocal/arrangement stable track ID or the reserved mix-bus. Supported typed effects are gain, pan, high/low-pass, parametric EQ, compressor, de-esser, multi-tap room, delay, and limiter; each has bounded parameters mapped to the installed FFmpeg filters. Disabled effects remain in creative intent but are skipped at render. Changing downstream effects changes mix_hash without invalidating raw stems' composition_hash.`,
    inputSchema: ManifestMutationPathSchema.extend({
      effect_chain: ManifestEffectChainSchema,
    }).strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      if (params.dry_run) {
        const preview = await previewSongManifestMutation(
          params.input_path,
          params.expected_revision,
          (path) => upsertSongManifestEffectChain(
            path, path, params.expected_revision, params.effect_chain, true,
          ),
        );
        return textResult(preview, params.response_format, `Dry-run preview for effect chain ${params.effect_chain.id}`);
      }
      const result = await upsertSongManifestEffectChain(
        params.input_path,
        params.output_path,
        params.expected_revision,
        params.effect_chain,
        params.overwrite,
      );
      return textResult(
        result,
        params.response_format,
        `Upserted ${params.effect_chain.effects.length}-effect chain ${params.effect_chain.id}`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_upsert_manifest_section_dynamic",
  {
    title: "Upsert Manifest Section Dynamic",
    description: `Set one section gain automation decision for a stable track or the mix-bus.

gain_db applies only inside the named semantic section, with an explicit ramp_ms at both edges. Automation is pre-effect so reverb/delay tails follow the driven section naturally. One target/section pair has exactly one stable automation object.`,
    inputSchema: ManifestMutationPathSchema.extend({
      section_dynamic: ManifestSectionDynamicsSchema,
    }).strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      if (params.dry_run) {
        const preview = await previewSongManifestMutation(
          params.input_path,
          params.expected_revision,
          (path) => upsertSongManifestSectionDynamic(
            path, path, params.expected_revision, params.section_dynamic, true,
          ),
        );
        return textResult(preview, params.response_format, `Dry-run preview for automation ${params.section_dynamic.id}`);
      }
      const result = await upsertSongManifestSectionDynamic(
        params.input_path,
        params.output_path,
        params.expected_revision,
        params.section_dynamic,
        params.overwrite,
      );
      return textResult(
        result,
        params.response_format,
        `Upserted ${params.section_dynamic.gain_db} dB automation ${params.section_dynamic.id}`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_transform_song_events",
  {
    title: "Transform Song Events",
    description: `Apply one deterministic transpose, velocity, duration, or tick-shift transform to selected stable event IDs or a bounded semantic scope.

Use event_ids for surgical edits. An empty event_ids list intentionally selects every matching event inside the supplied section/track/part scope. Pattern-relative events cannot be tick-shifted.`,
    inputSchema: ManifestMutationPathSchema.extend({ transform: ManifestTransformSchema }).strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      if (params.dry_run) {
        const preview = await previewSongManifestMutation(
          params.input_path,
          params.expected_revision,
          (path) => transformSongManifestEvents(
            path, path, params.expected_revision, params.transform, true,
          ),
        );
        return textResult(preview, params.response_format, "Dry-run event transform preview");
      }
      const result = await transformSongManifestEvents(
        params.input_path,
        params.output_path,
        params.expected_revision,
        params.transform,
        params.overwrite,
      );
      return textResult(result, params.response_format, `Transformed ${result.changed} stable events`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_apply_groove",
  {
    title: "Apply Seeded Arrangement Groove",
    description: `Apply explicit swing plus deterministic timing/velocity/gate humanization to selected direct or reusable-pattern arrangement events.

Every stable event gets an inspectable delta; the same seed and source revision reproduce the same composition hash. Section scope is allowed only for direct events because a reusable pattern can appear in several sections. dry_run validates the complete predicted manifest/preflight and returns a music-aware diff without touching the canonical file.`,
    inputSchema: ManifestMutationPathSchema.extend({ groove: ManifestGrooveSchema }).strict(),
    outputSchema: workflowOutputSchema(GrooveDataOutputSchema),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      if (params.dry_run) {
        const preview = await previewSongManifestMutation(
          params.input_path,
          params.expected_revision,
          (path) => applySongManifestGroove(
            path, path, params.expected_revision, params.groove, true,
          ),
        );
        return workflowResult(preview, params.response_format, "Dry-run groove preview");
      }
      const result = await applySongManifestGroove(
        params.input_path,
        params.output_path,
        params.expected_revision,
        params.groove,
        params.overwrite,
      );
      return workflowResult(
        { dryRun: false as const, ...result },
        params.response_format,
        `Applied seeded groove to ${result.changed} arrangement event(s)`,
      );
    } catch (error) {
      return workflowError(error);
    }
  },
);

server.registerTool(
  "vocaloid_remove_song_objects",
  {
    title: "Remove Song Objects",
    description: `Remove explicitly named sections, vocal parts/tracks, arrangement tracks, leaf events, effect chains, or section dynamics by stable ID.

The mutation is atomic. It rejects zero matches, every-section removal, dangling section references, and invalid empty phrases/patterns/parts.`,
    inputSchema: ManifestMutationPathSchema.extend({ removal: ManifestRemovalSchema }).strict(),
    outputSchema: ToolOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      if (params.dry_run) {
        const preview = await previewSongManifestMutation(
          params.input_path,
          params.expected_revision,
          (path) => removeSongManifestObjects(
            path, path, params.expected_revision, params.removal, true,
          ),
        );
        return textResult(preview, params.response_format, "Dry-run object removal preview");
      }
      const result = await removeSongManifestObjects(
        params.input_path,
        params.output_path,
        params.expected_revision,
        params.removal,
        params.overwrite,
      );
      return textResult(result, params.response_format, `Removed ${result.removed} song objects`);
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_build_song_manifest",
  {
    title: "Build Song Manifest Artifacts",
    description: "Build a verified accompaniment WAV and native VSQX from one immutable manifest revision, then record both artifacts atomically.",
    inputSchema: z
      .object({
        manifest_path: PathSchema,
        expected_revision: z.number().int().min(1),
        backing_output_path: PathSchema.describe("New slugged .wav accompaniment path"),
        project_output_path: PathSchema.describe("New slugged .vsqx project path"),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: typedToolOutputSchema(ManifestBuildDataOutputSchema),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await buildSongManifest({
        manifestPath: params.manifest_path,
        expectedRevision: params.expected_revision,
        backingOutputPath: params.backing_output_path,
        projectOutputPath: params.project_output_path,
      });
      return textResult(
        result,
        params.response_format,
        `Built manifest revision ${result.sourceRevision} into validated WAV and VSQX artifacts`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_render_instrument_stems",
  {
    title: "Render Manifest Instrument Stems",
    description: "Render selected arrangement tracks as isolated verified WAV stems with explicit pan/effect policy and manifest provenance.",
    inputSchema: z
      .object({
        manifest_path: PathSchema,
        expected_revision: z.number().int().min(1),
        output_directory: PathSchema.describe("Existing writable directory for slugged stem filenames"),
        track_ids: z.array(ManifestIdSchema).min(1).max(32).optional()
          .describe("Optional arrangement track IDs; omitted renders every instrument/drum track"),
        preserve_pan: z.boolean().describe("true preserves composed MIDI pan; false centers pitched stems"),
        include_renderer_effects: z.boolean()
          .describe("true keeps manifest FluidSynth reverb/chorus; false renders dry stems"),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: typedToolOutputSchema(StemRenderDataOutputSchema),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await renderSongManifestInstrumentStems({
        manifestPath: params.manifest_path,
        expectedRevision: params.expected_revision,
        outputDirectory: params.output_directory,
        preservePan: params.preserve_pan,
        includeRendererEffects: params.include_renderer_effects,
        ...(params.track_ids !== undefined ? { trackIds: params.track_ids } : {}),
      });
      return textResult(
        result,
        params.response_format,
        `Rendered ${result.stems.length} isolated instrument stems from composition ${result.sourceCompositionHash.slice(0, 12)}`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_render_vocal_stems",
  {
    title: "Render Manifest Vocal Stems",
    description: "Render selected vocal tracks individually through the original Editor as verified stems with explicit pan/send policy and provenance.",
    inputSchema: z
      .object({
        manifest_path: PathSchema,
        expected_revision: z.number().int().min(1),
        project_artifact_id: ManifestIdSchema.describe("VSQX artifact ID returned by manifest inspect/build"),
        output_directory: PathSchema.describe("Existing writable directory for slugged stem filenames"),
        vocal_track_ids: z.array(ManifestIdSchema).min(1).max(16).optional()
          .describe("Optional vocal track IDs; omitted renders every vocal track"),
        center_pan: z.boolean().describe("true centers each stem; false preserves the source track pan"),
        dry: z.boolean().describe("true disables vocal send routing; false preserves source send settings"),
        allow_pre_send_adjustment: z.boolean().default(false)
          .describe("Explicitly allow the Editor's exact Event Verification prompt to reduce Pre-Send for every selected stem"),
        volume: z.number().int().min(-898).max(600).optional()
          .describe("Optional explicit VOCALOID mixer volume; omitted preserves each source value"),
        timeout_seconds: z.number().int().min(10).max(600).default(300)
          .describe("Per-track original Editor export deadline"),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: typedToolOutputSchema(StemRenderDataOutputSchema),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await renderSongManifestVocalStems({
        manifestPath: params.manifest_path,
        expectedRevision: params.expected_revision,
        projectArtifactId: params.project_artifact_id,
        outputDirectory: params.output_directory,
        centerPan: params.center_pan,
        dry: params.dry,
        allowPreSendAdjustment: params.allow_pre_send_adjustment,
        ...(params.volume !== undefined ? { volume: params.volume } : {}),
        timeoutSeconds: params.timeout_seconds,
        ...(params.vocal_track_ids !== undefined ? { vocalTrackIds: params.vocal_track_ids } : {}),
      });
      return textResult(
        result,
        params.response_format,
        `Rendered ${result.stems.length} isolated VOCALOID stems from ${result.sourceProjectArtifact}`,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_analyze_vocal_stem",
  {
    title: "Analyze Vocal Score Versus Render",
    description: "Compare stable vocal events with a verified isolated stem and record reproducible pitch, timing, energy, diction, and vibrato evidence.",
    inputSchema: z
      .object({
        manifest_path: PathSchema,
        expected_revision: z.number().int().min(1),
        stem_artifact_id: ManifestIdSchema.describe("vocal_stem artifact ID from manifest inspect"),
        output_path: PathSchema.describe("New slugged filename ending in .vocal-analysis.json"),
        section_id: ManifestIdSchema.optional(),
        event_ids: z.array(ManifestIdSchema).min(1).max(5000).optional()
          .describe("Optional direct-note or phrase-cell stable IDs; omitted analyzes the selected section/track"),
        timeline_offset_seconds: z.number().min(-10).max(10).default(0)
          .describe("Explicit additional offset after automatic pre-measure/tempo mapping"),
        minimum_pitch_hz: z.number().min(30).max(500).default(60),
        maximum_pitch_hz: z.number().min(200).max(3000).default(1200),
        pitch_tolerance_cents: z.number().min(5).max(600).default(80),
        onset_tolerance_ms: z.number().min(10).max(1000).default(120),
        offset_tolerance_ms: z.number().min(10).max(2000).default(160),
        response_format: ResponseFormatSchema,
      })
      .strict()
      .refine((value) => value.maximum_pitch_hz > value.minimum_pitch_hz, {
        message: "maximum_pitch_hz must exceed minimum_pitch_hz",
      }),
    outputSchema: typedToolOutputSchema(VocalAnalysisDataOutputSchema),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await analyzeSongManifestVocalStem({
        manifestPath: params.manifest_path,
        expectedRevision: params.expected_revision,
        stemArtifactId: params.stem_artifact_id,
        outputPath: params.output_path,
        ...(params.section_id !== undefined ? { sectionId: params.section_id } : {}),
        ...(params.event_ids !== undefined ? { eventIds: params.event_ids } : {}),
        timelineOffsetSeconds: params.timeline_offset_seconds,
        minimumPitchHz: params.minimum_pitch_hz,
        maximumPitchHz: params.maximum_pitch_hz,
        pitchToleranceCents: params.pitch_tolerance_cents,
        onsetToleranceMilliseconds: params.onset_tolerance_ms,
        offsetToleranceMilliseconds: params.offset_tolerance_ms,
      });
      const warnings = [
        ...(result.audio.clippedSampleValues > 0
          ? [`Stem contains ${result.audio.clippedSampleValues} clipped sample values; pitch/timing evidence may be distorted`]
          : []),
        ...(result.summary.issueCounts.error > 0
          ? [`Analysis found ${result.summary.issueCounts.error} error-severity score/render deviations`]
          : []),
      ];
      return textResult(
        result,
        params.response_format,
        `Analyzed ${result.summary.events} score events (${result.summary.eventsWithPitch} with confident F0)`,
        warnings,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  "vocaloid_render_stem_mix",
  {
    title: "Render Reproducible Stem Mix",
    description: "Render selected verified stems through manifest automation/effects without hidden normalization, then record the measured mix and filter graph.",
    inputSchema: z
      .object({
        manifest_path: PathSchema,
        expected_revision: z.number().int().min(1),
        stem_artifact_ids: z.array(ManifestIdSchema).min(1).max(48),
        output_path: PathSchema.describe("New slugged .wav mix path"),
        sample_rate: z.union([z.literal(44_100), z.literal(48_000), z.literal(96_000)]),
        bit_depth: z.union([z.literal(16), z.literal(24)]),
        reference_lufs: z.number().min(-36).max(-5).default(-16)
          .describe("Analysis reference only; rendering does not normalize to this value"),
        reference_true_peak_dbfs: z.number().min(-12).max(0).default(-1)
          .describe("Analysis reference only; add an explicit limiter when desired"),
        timeout_seconds: z.number().int().min(10).max(900).default(300),
        response_format: ResponseFormatSchema,
      })
      .strict(),
    outputSchema: typedToolOutputSchema(StemMixDataOutputSchema),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async (params) => {
    try {
      const result = await renderSongManifestStemMix({
        manifestPath: params.manifest_path,
        expectedRevision: params.expected_revision,
        stemArtifactIds: params.stem_artifact_ids,
        outputPath: params.output_path,
        sampleRate: params.sample_rate,
        bitDepth: params.bit_depth,
        referenceLufs: params.reference_lufs,
        referenceTruePeakDbfs: params.reference_true_peak_dbfs,
        timeoutSeconds: params.timeout_seconds,
      });
      const warnings = [
        ...(result.quality.sampleClipping
          ? [`Mix contains ${result.quality.clippedSampleValues} full-scale sample values; lower source/chain gain and render a new revision`]
          : []),
        ...(result.quality.truePeakExceeded
          ? [`True peak ${result.quality.truePeakDbfs.toFixed(2)} dBFS exceeds the ${params.reference_true_peak_dbfs.toFixed(2)} dBFS reference`]
          : []),
        ...(result.quality.channelImbalance
          ? [`Stereo RMS balance is ${result.quality.stereoBalanceDb?.toFixed(2)} dB; confirm this is intentional before mastering`]
          : []),
      ];
      return textResult(
        result,
        params.response_format,
        `Rendered ${result.inputs.length}-stem mix at ${result.quality.integratedLufs.toFixed(1)} LUFS`,
        warnings,
      );
    } catch (error) {
      return errorResult(error);
    }
  },
);

function applyMcpProfile(profile: McpProfile): void {
  if (profile === "full") return;
  const enabledNames = profile === "production" ? PRODUCTION_TOOL_NAMES : LEGACY_VSQX_TOOL_NAMES;
  const registry = (server as unknown as {
    _registeredTools: Record<string, { enabled: boolean }>;
  })._registeredTools;
  for (const [name, tool] of Object.entries(registry)) {
    tool.enabled = enabledNames.has(name as never);
  }
  const missing = [...enabledNames].filter((name) => !(name in registry));
  if (missing.length > 0) {
    throw new Error(`MCP profile ${profile} references unregistered tools: ${missing.join(", ")}`);
  }
}

applyMcpProfile(MCP_PROFILE);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`vocaloid-mcp-server running via stdio (${MCP_PROFILE} profile)`);
}

main().catch((error: unknown) => {
  console.error("vocaloid-mcp-server failed:", error);
  process.exitCode = 1;
});
