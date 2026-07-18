import { execFile } from "node:child_process";
import { access, rename, unlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";

import { analyzeAudioQuality } from "./audio-quality.js";
import { resolveReadablePath, resolveWritablePath } from "./paths.js";
import {
  fileSha256,
  loadSongManifest,
  recordSongManifestArtifacts,
  type ManifestArtifact,
  type SongManifest,
} from "./song-manifest.js";
import { musicalPositionToTick } from "./vsqx.js";


const execFileAsync = promisify(execFile);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function tickSeconds(manifest: SongManifest, targetTick: number): number {
  const tempos = manifest.tempos.map((tempo) => ({
    tick: musicalPositionToTick(manifest.time_signatures, tempo.position),
    bpm: tempo.bpm,
  }));
  let seconds = 0;
  let currentTick = 0;
  let tempoIndex = 0;
  while (currentTick < targetTick) {
    const active = tempos[tempoIndex]!;
    const next = tempos[tempoIndex + 1];
    const segmentEnd = Math.min(targetTick, next?.tick ?? targetTick);
    seconds += ((segmentEnd - currentTick) * 60) / (480 * active.bpm);
    currentTick = segmentEnd;
    if (next && currentTick >= next.tick) tempoIndex += 1;
  }
  return seconds;
}

function preMeasureSeconds(manifest: SongManifest): number {
  const signature = manifest.time_signatures[0]!;
  const ticksPerMeasure = signature.numerator * (480 * 4 / signature.denominator);
  return (manifest.pre_measure * ticksPerMeasure * 60) / (480 * manifest.tempos[0]!.bpm);
}

function artifactOrigin(artifact: ManifestArtifact): "song_start" | "project_start" {
  if (artifact.metadata.timeline_origin === "song_start") return "song_start";
  if (artifact.metadata.timeline_origin === "project_start") return "project_start";
  return artifact.role === "backing" || artifact.role === "instrument_stem"
    ? "song_start"
    : "project_start";
}

function sectionBounds(
  manifest: SongManifest,
  artifact: ManifestArtifact,
  sectionId: string,
  handleBeforeSeconds: number,
  handleAfterSeconds: number,
) {
  const section = manifest.sections.find((candidate) => candidate.id === sectionId);
  if (!section) throw new Error(`Manifest has no section ${sectionId}`);
  const originOffset = artifactOrigin(artifact) === "project_start" ? preMeasureSeconds(manifest) : 0;
  const semanticStart = tickSeconds(
    manifest,
    musicalPositionToTick(manifest.time_signatures, section.start),
  ) + originOffset;
  const semanticEnd = tickSeconds(
    manifest,
    musicalPositionToTick(manifest.time_signatures, section.end),
  ) + originOffset;
  return {
    section,
    origin: artifactOrigin(artifact),
    semanticStartSeconds: semanticStart,
    semanticEndSeconds: semanticEnd,
    trimStartSeconds: Math.max(0, semanticStart - handleBeforeSeconds),
    trimEndSeconds: semanticEnd + handleAfterSeconds,
  };
}

function artifactId(prefix: string, sourceId: string, sectionId: string, revision: number): string {
  const suffix = `-${sectionId}-r${revision}`;
  const available = Math.max(1, 96 - prefix.length - suffix.length - 2);
  return `${prefix}-${sourceId.slice(0, available)}${suffix}`;
}

async function currentAudioArtifact(
  manifest: SongManifest,
  id: string,
): Promise<{ artifact: ManifestArtifact; path: string }> {
  const artifact = manifest.artifacts.find((candidate) => candidate.id === id);
  if (!artifact || ["vsqx", "analysis", "preview"].includes(artifact.role)) {
    throw new Error(`No audio artifact with stable ID ${id}`);
  }
  if (artifact.source_composition_hash !== manifest.composition_hash) {
    throw new Error(`Audio artifact ${id} is stale for the current composition`);
  }
  const path = await resolveReadablePath(artifact.path);
  if (extname(path).toLowerCase() !== ".wav") throw new Error(`Audio artifact ${id} is not a .wav file`);
  const digest = await fileSha256(path);
  if (digest.sha256 !== artifact.sha256 || digest.bytes !== artifact.bytes) {
    throw new Error(`Audio artifact ${id} no longer matches recorded SHA-256/size`);
  }
  return { artifact, path };
}

async function renderTrim(
  inputPath: string,
  temporaryPath: string,
  startSeconds: number,
  endSeconds: number,
  volumeDb = 0,
): Promise<void> {
  const ffmpeg = process.env.FFMPEG_PATH ?? "/usr/bin/ffmpeg";
  const filters = [
    `atrim=start=${startSeconds.toFixed(6)}:end=${endSeconds.toFixed(6)}`,
    "asetpts=PTS-STARTPTS",
    ...(volumeDb === 0 ? [] : [`volume=${volumeDb.toFixed(6)}dB`]),
    "aformat=sample_fmts=fltp:channel_layouts=stereo",
  ];
  await execFileAsync(
    ffmpeg,
    [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", inputPath,
      "-af", filters.join(","), "-ac", "2", "-c:a", "pcm_s16le", temporaryPath,
    ],
    { timeout: 300_000, maxBuffer: 8 * 1024 * 1024 },
  );
}

export interface RenderSectionPreviewOptions {
  manifestPath: string;
  expectedRevision: number;
  sourceArtifactId: string;
  sectionId: string;
  outputPath: string;
  handleBeforeSeconds: number;
  handleAfterSeconds: number;
  referenceLufs: number;
  referenceTruePeakDbfs: number;
}

export async function renderSongSectionPreview(options: RenderSectionPreviewOptions) {
  const loaded = await loadSongManifest(options.manifestPath);
  const manifest = loaded.manifest;
  if (manifest.revision !== options.expectedRevision) {
    throw new Error(`Stale manifest revision ${options.expectedRevision}; current revision is ${manifest.revision}`);
  }
  const source = await currentAudioArtifact(manifest, options.sourceArtifactId);
  const outputPath = await resolveWritablePath(options.outputPath);
  if (extname(outputPath).toLowerCase() !== ".wav") throw new Error("outputPath must end in .wav");
  if (await exists(outputPath)) throw new Error(`Preview output already exists: ${outputPath}`);
  const bounds = sectionBounds(
    manifest,
    source.artifact,
    options.sectionId,
    options.handleBeforeSeconds,
    options.handleAfterSeconds,
  );
  const temporary = join(dirname(outputPath), `.${basename(outputPath)}.preview-${process.pid}-${Date.now()}.wav`);
  try {
    await renderTrim(source.path, temporary, bounds.trimStartSeconds, bounds.trimEndSeconds);
    const quality = await analyzeAudioQuality(
      temporary,
      options.referenceLufs,
      options.referenceTruePeakDbfs,
    );
    if (quality.silent) throw new Error(`Section preview ${options.sectionId} is silent`);
    await rename(temporary, outputPath);
    const digest = await fileSha256(outputPath);
    const artifact: ManifestArtifact = {
      id: artifactId("preview", source.artifact.id, options.sectionId, manifest.revision),
      role: "preview",
      path: outputPath,
      ...digest,
      source_revision: manifest.revision,
      source_composition_hash: manifest.composition_hash,
      dependencies: [source.artifact.id, bounds.section.id],
      metadata: {
        renderer: "ffmpeg-section-preview",
        source_artifact: source.artifact.id,
        section_id: bounds.section.id,
        timeline_origin: "preview_start",
        source_timeline_origin: bounds.origin,
        semantic_start_seconds: bounds.semanticStartSeconds,
        semantic_end_seconds: bounds.semanticEndSeconds,
        handle_before_seconds: options.handleBeforeSeconds,
        handle_after_seconds: options.handleAfterSeconds,
        integrated_lufs: quality.integratedLufs,
        true_peak_dbfs: quality.truePeakDbfs,
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
      manifestRevision: mutation.write.revision,
      manifestContentHash: mutation.write.contentHash,
      sourceArtifactId: source.artifact.id,
      sectionId: bounds.section.id,
      bounds,
      outputPath,
      quality: { ...quality, path: outputPath },
      artifact,
    };
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    await unlink(outputPath).catch(() => undefined);
    throw error;
  }
}

export interface CompareSectionArtifactsOptions {
  manifestPath: string;
  expectedRevision: number;
  artifactAId: string;
  artifactBId: string;
  sectionId: string;
  outputAPath: string;
  outputBPath: string;
  handleBeforeSeconds: number;
  handleAfterSeconds: number;
  matchLufs?: number;
  referenceTruePeakDbfs: number;
}

export async function compareSongSectionArtifacts(options: CompareSectionArtifactsOptions) {
  const loaded = await loadSongManifest(options.manifestPath);
  const manifest = loaded.manifest;
  if (manifest.revision !== options.expectedRevision) {
    throw new Error(`Stale manifest revision ${options.expectedRevision}; current revision is ${manifest.revision}`);
  }
  if (options.artifactAId === options.artifactBId) throw new Error("A/B artifacts must be different");
  const [a, b] = await Promise.all([
    currentAudioArtifact(manifest, options.artifactAId),
    currentAudioArtifact(manifest, options.artifactBId),
  ]);
  const [outputA, outputB] = await Promise.all([
    resolveWritablePath(options.outputAPath),
    resolveWritablePath(options.outputBPath),
  ]);
  if (outputA === outputB) throw new Error("outputAPath and outputBPath must be distinct");
  for (const path of [outputA, outputB]) {
    if (extname(path).toLowerCase() !== ".wav") throw new Error("A/B output paths must end in .wav");
    if (await exists(path)) throw new Error(`A/B output already exists: ${path}`);
  }
  const boundsA = sectionBounds(manifest, a.artifact, options.sectionId, options.handleBeforeSeconds, options.handleAfterSeconds);
  const boundsB = sectionBounds(manifest, b.artifact, options.sectionId, options.handleBeforeSeconds, options.handleAfterSeconds);
  const rawA = join(dirname(outputA), `.${basename(outputA)}.raw-${process.pid}-${Date.now()}.wav`);
  const rawB = join(dirname(outputB), `.${basename(outputB)}.raw-${process.pid}-${Date.now()}.wav`);
  const temporaryA = join(dirname(outputA), `.${basename(outputA)}.match-${process.pid}-${Date.now()}.wav`);
  const temporaryB = join(dirname(outputB), `.${basename(outputB)}.match-${process.pid}-${Date.now()}.wav`);
  try {
    await Promise.all([
      renderTrim(a.path, rawA, boundsA.trimStartSeconds, boundsA.trimEndSeconds),
      renderTrim(b.path, rawB, boundsB.trimStartSeconds, boundsB.trimEndSeconds),
    ]);
    const [analysisA, analysisB] = await Promise.all([
      analyzeAudioQuality(rawA, -16, options.referenceTruePeakDbfs),
      analyzeAudioQuality(rawB, -16, options.referenceTruePeakDbfs),
    ]);
    const targetLufs = options.matchLufs ?? Math.min(analysisA.integratedLufs, analysisB.integratedLufs);
    if (targetLufs < -36 || targetLufs > -8) throw new Error("matchLufs must be in -36..-8");
    const gainA = targetLufs - analysisA.integratedLufs;
    const gainB = targetLufs - analysisB.integratedLufs;
    await Promise.all([
      renderTrim(rawA, temporaryA, 0, analysisA.durationSeconds, gainA),
      renderTrim(rawB, temporaryB, 0, analysisB.durationSeconds, gainB),
    ]);
    const [matchedA, matchedB] = await Promise.all([
      analyzeAudioQuality(temporaryA, targetLufs, options.referenceTruePeakDbfs),
      analyzeAudioQuality(temporaryB, targetLufs, options.referenceTruePeakDbfs),
    ]);
    if (matchedA.sampleClipping || matchedB.sampleClipping
      || matchedA.truePeakDbfs > 0 || matchedB.truePeakDbfs > 0) {
      throw new Error("Loudness matching would clip an A/B preview; choose a quieter matchLufs");
    }
    await Promise.all([rename(temporaryA, outputA), rename(temporaryB, outputB)]);
    const [digestA, digestB] = await Promise.all([fileSha256(outputA), fileSha256(outputB)]);
    const pairId = `${a.artifact.id}:${b.artifact.id}:${options.sectionId}`;
    const now = new Date().toISOString();
    const artifacts: ManifestArtifact[] = [
      {
        id: artifactId("ab-a", a.artifact.id, options.sectionId, manifest.revision),
        role: "preview",
        path: outputA,
        ...digestA,
        source_revision: manifest.revision,
        source_composition_hash: manifest.composition_hash,
        dependencies: [a.artifact.id, options.sectionId],
        metadata: { renderer: "ffmpeg-loudness-match", pair_id: pairId, side: "A", target_lufs: targetLufs, gain_db: gainA, source_artifact: a.artifact.id, section_id: options.sectionId, timeline_origin: "preview_start" },
        created_at: now,
      },
      {
        id: artifactId("ab-b", b.artifact.id, options.sectionId, manifest.revision),
        role: "preview",
        path: outputB,
        ...digestB,
        source_revision: manifest.revision,
        source_composition_hash: manifest.composition_hash,
        dependencies: [b.artifact.id, options.sectionId],
        metadata: { renderer: "ffmpeg-loudness-match", pair_id: pairId, side: "B", target_lufs: targetLufs, gain_db: gainB, source_artifact: b.artifact.id, section_id: options.sectionId, timeline_origin: "preview_start" },
        created_at: now,
      },
    ];
    const mutation = await recordSongManifestArtifacts(
      loaded.path,
      manifest.revision,
      manifest.composition_hash,
      artifacts,
    );
    return {
      sourceRevision: manifest.revision,
      manifestRevision: mutation.write.revision,
      manifestContentHash: mutation.write.contentHash,
      sectionId: options.sectionId,
      targetLufs,
      A: { sourceArtifactId: a.artifact.id, outputPath: outputA, gainDb: gainA, before: analysisA, after: { ...matchedA, path: outputA }, artifact: artifacts[0] },
      B: { sourceArtifactId: b.artifact.id, outputPath: outputB, gainDb: gainB, before: analysisB, after: { ...matchedB, path: outputB }, artifact: artifacts[1] },
    };
  } catch (error) {
    await Promise.all([rawA, rawB, temporaryA, temporaryB, outputA, outputB]
      .map((path) => unlink(path).catch(() => undefined)));
    throw error;
  } finally {
    await Promise.all([rawA, rawB].map((path) => unlink(path).catch(() => undefined)));
  }
}
