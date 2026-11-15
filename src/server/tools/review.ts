import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { analyzeAudioQuality } from "../../audio-quality.js";
import {
  compareSongAnchorPassageArtifacts,
  compareSongSectionArtifacts,
  renderSongAnchorPassagePreview,
  renderSongSectionPreview,
} from "../../audio-review.js";
import {
  addSongManifestReviewNote,
  loadSongManifest,
  resolveSongManifestReviewNote,
} from "../../song-manifest.js";
import { analyzeSongManifestVocalStem } from "../../vocal-analysis.js";
import {
  PathSchema,
  ResponseFormatSchema,
  workflowError,
  workflowOutputSchema,
  workflowResult,
} from "../results.js";
import {
  AudioQualityDataOutputSchema,
  AudioReviewDataOutputSchema,
  AudioReviewInputSchema,
  ManifestIdSchema,
  ReviewSongDataOutputSchema,
  ReviewSongInputSchema,
  VocalAnalysisDataOutputSchema,
} from "../schemas.js";

export function registerReviewTools(server: McpServer): void {
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
      outputSchema: workflowOutputSchema(AudioQualityDataOutputSchema),
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
        return workflowResult(
          result,
          params.response_format,
          `Analyzed ${result.durationSeconds.toFixed(3)} seconds: ${result.integratedLufs.toFixed(1)} LUFS, ${result.truePeakDbfs.toFixed(1)} dBFS true peak`,
        );
      } catch (error) {
        return workflowError(error);
      }
    },
  );

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
      outputSchema: workflowOutputSchema(VocalAnalysisDataOutputSchema),
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
        return workflowResult(
          result,
          params.response_format,
          `Analyzed ${result.summary.events} score events (${result.summary.eventsWithPitch} with confident F0)`,
          warnings,
        );
      } catch (error) {
        return workflowError(error);
      }
    },
  );
}
