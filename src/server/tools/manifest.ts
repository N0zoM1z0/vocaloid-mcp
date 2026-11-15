import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { importVsqxToSongManifest } from "../../importer.js";
import { diffManifestSnapshots, listManifestHistory } from "../../manifest-history.js";
import { previewSongManifestMutation } from "../../mutation-preview.js";
import {
  applySongManifestGroove,
  applySongManifestTuningGestures,
  bindSongManifestPhraseRealization,
  createSongManifest,
  getSongManifestSection,
  inspectSongManifest,
  ManifestArrangementTrackSchema,
  ManifestChordChangeSchema,
  ManifestKeyChangeSchema,
  ManifestSectionSchema,
  ManifestTempoSchema,
  ManifestTimeSignatureSchema,
  ManifestVocalTrackMetadataSchema,
  removeSongManifestObjects,
  restoreSongManifestSnapshot,
  setSongManifestCompositionGuidance,
  setSongManifestCompositionIntent,
  transformSongManifestEvents,
  updateSongManifestTimeline,
  upsertSongManifestArrangementTrack,
  upsertSongManifestEffectChain,
  upsertSongManifestPhraseDirection,
  upsertSongManifestSection,
  upsertSongManifestSectionDynamic,
  upsertSongManifestSectionIntent,
  upsertSongManifestTheoryException,
  upsertSongManifestVocalPart,
  upsertSongManifestVocalPhrase,
} from "../../song-manifest.js";
import { preflightSongManifest } from "../../song-preflight.js";
import { expandTempoCurve } from "../../tempo.js";
import { TheoryProposalKindSchema } from "../../theory/proposals.js";
import { verifiedVoiceComponentIds } from "../../voice-readiness.js";
import {
  PathSchema,
  ResponseFormatSchema,
  workflowError,
  workflowOutputSchema,
  workflowResult,
} from "../results.js";
import {
  EditMutationActionSchema,
  EditSongActionRequestSchema,
  EditSongDataOutputSchema,
  EditSongInputSchema,
  GrooveDeltaOutputSchema,
  ImportVsqxDataOutputSchema,
  ManifestHistoryDataOutputSchema,
  ManifestIdSchema,
  ManifestSectionDataOutputSchema,
  ManifestSummaryDataOutputSchema,
  ManifestWriteOutputSchema,
  PreflightDataOutputSchema,
} from "../schemas.js";

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

export function registerManifestTools(server: McpServer): void {
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
      outputSchema: workflowOutputSchema(ManifestWriteOutputSchema),
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
        return workflowResult(result, params.response_format, `Created song manifest revision ${result.revision}`);
      } catch (error) {
        return workflowError(error);
      }
    },
  );

  server.registerTool(
    "vocaloid_inspect_song_manifest",
    {
      title: "Inspect Song Manifest",
      description: "Verify and summarize a canonical song manifest, including its revision, stable IDs, inventories, intent, and artifact provenance.",
      inputSchema: z.object({ path: PathSchema, response_format: ResponseFormatSchema }).strict(),
      outputSchema: workflowOutputSchema(ManifestSummaryDataOutputSchema),
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
        return workflowResult(result, response_format, `Song manifest revision ${result.revision}`);
      } catch (error) {
        return workflowError(error);
      }
    },
  );

  server.registerTool(
    "vocaloid_preflight_song",
    {
      title: "Preflight Complete Song Workflow",
      description: "Run non-mutating structure, theory, vocal, arrangement, mix, artifact, intent, and host checks. Optional repair hypotheses stay deterministic, theory-only, revision-bound, and require vocaloid_edit_song dry_run plus listening.",
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
      outputSchema: workflowOutputSchema(ManifestSectionDataOutputSchema),
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
        return workflowResult(result, response_format, `Loaded section ${section_id} from revision ${result.revision}`);
      } catch (error) {
        return workflowError(error);
      }
    },
  );
}
