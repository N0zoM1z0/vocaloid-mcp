import { access, unlink } from "node:fs/promises";
import { extname } from "node:path";

import {
  analyzeAudioQuality,
  masterWav,
  type MasterWavResult,
} from "./audio-quality.js";
import { resolveReadablePath, resolveWritablePath } from "./paths.js";
import {
  renderProjectToWav,
  type RenderResult,
  type RenderRuntimeOptions,
} from "./render.js";
import {
  fileSha256,
  loadSongManifest,
  recordSongManifestArtifacts,
  type ManifestArtifact,
} from "./song-manifest.js";
import { preflightSongManifest, type SongPreflightResult } from "./song-preflight.js";


async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function boundedArtifactId(prefix: string, revision: number): string {
  return `${prefix}-r${revision}`;
}

function requireCurrentArtifact(
  artifacts: readonly ManifestArtifact[],
  artifactId: string,
  allowedRoles: readonly ManifestArtifact["role"][],
  compositionHash: string,
): ManifestArtifact {
  const artifact = artifacts.find((candidate) => candidate.id === artifactId);
  if (!artifact || !allowedRoles.includes(artifact.role)) {
    throw new Error(`No ${allowedRoles.join("/")} artifact with stable ID ${artifactId}`);
  }
  if (artifact.source_composition_hash !== compositionHash) {
    throw new Error(
      `Artifact ${artifactId} belongs to composition ${artifact.source_composition_hash}, `
      + `but the current composition is ${compositionHash}`,
    );
  }
  return artifact;
}

async function resolveVerifiedArtifact(artifact: ManifestArtifact, extension: string): Promise<string> {
  const path = await resolveReadablePath(artifact.path);
  if (extname(path).toLowerCase() !== extension) {
    throw new Error(`Artifact ${artifact.id} must point to a ${extension} file`);
  }
  const digest = await fileSha256(path);
  if (digest.sha256 !== artifact.sha256 || digest.bytes !== artifact.bytes) {
    throw new Error(`Artifact ${artifact.id} no longer matches its recorded SHA-256/size`);
  }
  return path;
}

export interface RenderManifestMasterOptions {
  manifestPath: string;
  expectedRevision: number;
  projectArtifactId: string;
  outputPath: string;
  timeoutSeconds: number;
  allowPreSendAdjustment: boolean;
  referenceLufs: number;
  referenceTruePeakDbfs: number;
  runtime?: RenderRuntimeOptions;
}

export interface RenderManifestMasterResult {
  sourceRevision: number;
  sourceCompositionHash: string;
  manifestRevision: number;
  manifestContentHash: string;
  projectArtifactId: string;
  preflight: SongPreflightResult["readiness"];
  render: RenderResult;
  artifact: ManifestArtifact;
}

export async function renderSongManifestMaster(
  options: RenderManifestMasterOptions,
): Promise<RenderManifestMasterResult> {
  const loaded = await loadSongManifest(options.manifestPath);
  const manifest = loaded.manifest;
  if (manifest.revision !== options.expectedRevision) {
    throw new Error(`Stale manifest revision ${options.expectedRevision}; current revision is ${manifest.revision}`);
  }
  const projectArtifact = requireCurrentArtifact(
    manifest.artifacts,
    options.projectArtifactId,
    ["vsqx"],
    manifest.composition_hash,
  );
  const projectPath = await resolveVerifiedArtifact(projectArtifact, ".vsqx");
  const outputPath = await resolveWritablePath(options.outputPath);
  if (extname(outputPath).toLowerCase() !== ".wav") throw new Error("outputPath must end in .wav");
  if (await exists(outputPath)) throw new Error(`Master output already exists: ${outputPath}`);

  const preflight = await preflightSongManifest(loaded.path, {
    artifactCheck: "current",
    includePerformanceWarnings: true,
  });
  if (!preflight.readiness.build.ready) {
    throw new Error(`Manifest master render blocked by preflight: ${preflight.readiness.build.blockers.join(", ")}`);
  }

  try {
    const render = await renderProjectToWav(
      projectPath,
      outputPath,
      options.timeoutSeconds,
      false,
      options.allowPreSendAdjustment,
      options.runtime,
    );
    const quality = await analyzeAudioQuality(
      outputPath,
      options.referenceLufs,
      options.referenceTruePeakDbfs,
    );
    const digest = await fileSha256(outputPath);
    const artifact: ManifestArtifact = {
      id: boundedArtifactId("editor-master", manifest.revision),
      role: "master",
      path: outputPath,
      ...digest,
      source_revision: manifest.revision,
      source_composition_hash: manifest.composition_hash,
      dependencies: [projectArtifact.id],
      metadata: {
        renderer: "vocaloid3-original-editor",
        timeline_origin: "project_start",
        editor_sha256: render.editorSha256,
        editor_version: render.editorVersion,
        known_editor_fingerprint: render.knownEditorFingerprint,
        allow_pre_send_adjustment: options.allowPreSendAdjustment,
        event_verification_seen: render.eventVerificationSeen,
        pre_send_adjusted: render.preSendAdjusted,
        integrated_lufs: quality.integratedLufs,
        loudness_range_lu: quality.loudnessRangeLu,
        true_peak_dbfs: quality.truePeakDbfs,
        sample_clipping: quality.sampleClipping,
        stereo_balance_db: quality.stereoBalanceDb ?? 0,
      },
      created_at: new Date().toISOString(),
    };
    const mutation = await recordSongManifestArtifacts(
      loaded.path,
      manifest.revision,
      manifest.composition_hash,
      [artifact],
    );
    return {
      sourceRevision: manifest.revision,
      sourceCompositionHash: manifest.composition_hash,
      manifestRevision: mutation.write.revision,
      manifestContentHash: mutation.write.contentHash,
      projectArtifactId: projectArtifact.id,
      preflight: preflight.readiness,
      render: { ...render, ...quality, path: outputPath },
      artifact,
    };
  } catch (error) {
    await unlink(outputPath).catch(() => undefined);
    throw error;
  }
}

export interface MasterManifestDeliveryOptions {
  manifestPath: string;
  expectedRevision: number;
  sourceArtifactId: string;
  outputPath: string;
  targetLufs: number;
  targetTruePeakDbfs: number;
  targetLoudnessRangeLu: number;
  allowClippedSource: boolean;
}

export interface MasterManifestDeliveryResult {
  sourceRevision: number;
  sourceCompositionHash: string;
  manifestRevision: number;
  manifestContentHash: string;
  sourceArtifactId: string;
  mastering: MasterWavResult;
  artifact: ManifestArtifact;
}

export async function masterSongManifestDelivery(
  options: MasterManifestDeliveryOptions,
): Promise<MasterManifestDeliveryResult> {
  const loaded = await loadSongManifest(options.manifestPath);
  const manifest = loaded.manifest;
  if (manifest.revision !== options.expectedRevision) {
    throw new Error(`Stale manifest revision ${options.expectedRevision}; current revision is ${manifest.revision}`);
  }
  const sourceArtifact = requireCurrentArtifact(
    manifest.artifacts,
    options.sourceArtifactId,
    ["master", "mix"],
    manifest.composition_hash,
  );
  if (sourceArtifact.role === "mix" && sourceArtifact.metadata.source_mix_hash !== manifest.mix_hash) {
    throw new Error(
      `Mix artifact ${sourceArtifact.id} belongs to mix hash ${String(sourceArtifact.metadata.source_mix_hash)}, `
      + `but the current mix hash is ${manifest.mix_hash}; render a new mix before delivery`,
    );
  }
  const sourcePath = await resolveVerifiedArtifact(sourceArtifact, ".wav");
  const outputPath = await resolveWritablePath(options.outputPath);
  if (extname(outputPath).toLowerCase() !== ".wav") throw new Error("outputPath must end in .wav");
  if (await exists(outputPath)) throw new Error(`Delivery output already exists: ${outputPath}`);

  try {
    const mastering = await masterWav({
      inputPath: sourcePath,
      outputPath,
      targetLufs: options.targetLufs,
      targetTruePeakDbfs: options.targetTruePeakDbfs,
      targetLoudnessRangeLu: options.targetLoudnessRangeLu,
      overwrite: false,
    });
    if (mastering.source.sampleClipping && !options.allowClippedSource) {
      throw new Error(
        `Source artifact ${sourceArtifact.id} contains ${mastering.source.clippedSampleValues} clipped sample values; `
        + "revise the mix or explicitly set allow_clipped_source=true to document acceptance",
      );
    }
    const digest = await fileSha256(outputPath);
    const artifact: ManifestArtifact = {
      id: boundedArtifactId("delivery", manifest.revision),
      role: "delivery",
      path: outputPath,
      ...digest,
      source_revision: manifest.revision,
      source_composition_hash: manifest.composition_hash,
      dependencies: [sourceArtifact.id],
      metadata: {
        renderer: "ffmpeg-loudnorm-two-pass",
        timeline_origin: sourceArtifact.metadata.timeline_origin === "song_start" ? "song_start" : "project_start",
        source_role: sourceArtifact.role,
        ...(sourceArtifact.role === "mix" ? { source_mix_hash: manifest.mix_hash } : {}),
        target_lufs: options.targetLufs,
        target_true_peak_dbfs: options.targetTruePeakDbfs,
        target_lra_lu: options.targetLoudnessRangeLu,
        integrated_lufs: mastering.output.integratedLufs,
        loudness_range_lu: mastering.output.loudnessRangeLu,
        true_peak_dbfs: mastering.output.truePeakDbfs,
        true_peak_correction_db: mastering.truePeakCorrectionDb,
        sample_clipping: mastering.output.sampleClipping,
        source_clipping_accepted: options.allowClippedSource,
        stereo_balance_db: mastering.output.stereoBalanceDb ?? 0,
      },
      created_at: new Date().toISOString(),
    };
    const mutation = await recordSongManifestArtifacts(
      loaded.path,
      manifest.revision,
      manifest.composition_hash,
      [artifact],
    );
    return {
      sourceRevision: manifest.revision,
      sourceCompositionHash: manifest.composition_hash,
      manifestRevision: mutation.write.revision,
      manifestContentHash: mutation.write.contentHash,
      sourceArtifactId: sourceArtifact.id,
      mastering,
      artifact,
    };
  } catch (error) {
    await unlink(outputPath).catch(() => undefined);
    throw error;
  }
}
