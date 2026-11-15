import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { masterSongManifestDelivery, renderSongManifestMaster } from "../../delivery.js";
import { buildSongManifest } from "../../song-manifest.js";
import { renderSongManifestStemMix } from "../../stem-mix.js";
import { renderSongManifestInstrumentStems, renderSongManifestVocalStems } from "../../stems.js";
import {
  PathSchema,
  ResponseFormatSchema,
  workflowError,
  workflowOutputSchema,
  workflowResult,
} from "../results.js";
import {
  ManifestBuildDataOutputSchema,
  ManifestDeliveryDataOutputSchema,
  ManifestIdSchema,
  ManifestMasterDataOutputSchema,
  StemMixDataOutputSchema,
  StemRenderDataOutputSchema,
} from "../schemas.js";

export function registerRenderTools(server: McpServer): void {
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
      outputSchema: workflowOutputSchema(ManifestBuildDataOutputSchema),
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
        return workflowResult(
          result,
          params.response_format,
          `Built manifest revision ${result.sourceRevision} into validated WAV and VSQX artifacts`,
        );
      } catch (error) {
        return workflowError(error);
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
      outputSchema: workflowOutputSchema(StemRenderDataOutputSchema),
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
        return workflowResult(
          result,
          params.response_format,
          `Rendered ${result.stems.length} isolated instrument stems from composition ${result.sourceCompositionHash.slice(0, 12)}`,
        );
      } catch (error) {
        return workflowError(error);
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
      outputSchema: workflowOutputSchema(StemRenderDataOutputSchema),
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
        return workflowResult(
          result,
          params.response_format,
          `Rendered ${result.stems.length} isolated VOCALOID stems from ${result.sourceProjectArtifact}`,
        );
      } catch (error) {
        return workflowError(error);
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
      outputSchema: workflowOutputSchema(StemMixDataOutputSchema),
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
        return workflowResult(
          result,
          params.response_format,
          `Rendered ${result.inputs.length}-stem mix at ${result.quality.integratedLufs.toFixed(1)} LUFS`,
          warnings,
        );
      } catch (error) {
        return workflowError(error);
      }
    },
  );
}
