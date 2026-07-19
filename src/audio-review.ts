import { execFile } from "node:child_process";
import { access, rename, unlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";

import { analyzeAudioQuality } from "./audio-quality.js";
import { buildAnchorAuditionPlan, type AnchorAuditionPlan } from "./intent/audition.js";
import {
  IntentAuditionLayerSchema,
  IntentHypothesisFamilySchema,
  type IntentAuditionLayer,
  type IntentHypothesisFamily,
} from "./intent/types.js";
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

function anchorBounds(
  manifest: SongManifest,
  artifact: ManifestArtifact,
  plan: AnchorAuditionPlan,
) {
  const originOffset = artifactOrigin(artifact) === "project_start" ? preMeasureSeconds(manifest) : 0;
  return {
    origin: artifactOrigin(artifact),
    semanticStartSeconds: plan.passage.startSeconds,
    semanticEndSeconds: plan.passage.endSeconds,
    trimStartSeconds: plan.passage.startSeconds + originOffset,
    trimEndSeconds: plan.passage.endSeconds + originOffset,
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

export interface RenderAnchorPassagePreviewOptions {
  manifestPath: string;
  expectedRevision: number;
  sourceArtifactId: string;
  phraseDirectionId: string;
  auditionLayer: IntentAuditionLayer;
  outputPath: string;
  targetDurationSeconds?: number;
  referenceLufs: number;
  referenceTruePeakDbfs: number;
}

export async function renderSongAnchorPassagePreview(options: RenderAnchorPassagePreviewOptions) {
  const auditionLayer = IntentAuditionLayerSchema.parse(options.auditionLayer);
  const loaded = await loadSongManifest(options.manifestPath);
  const manifest = loaded.manifest;
  if (manifest.revision !== options.expectedRevision) {
    throw new Error(`Stale manifest revision ${options.expectedRevision}; current revision is ${manifest.revision}`);
  }
  const source = await currentAudioArtifact(manifest, options.sourceArtifactId);
  const plan = buildAnchorAuditionPlan(manifest, options.phraseDirectionId, options.targetDurationSeconds ?? 25);
  if (!plan.passage.targetDurationMet) {
    throw new Error(
      `Anchor passage ${options.phraseDirectionId} is ${plan.passage.durationSeconds.toFixed(2)}s; `
      + "choose a section/core that can preserve 20..30 seconds",
    );
  }
  const outputPath = await resolveWritablePath(options.outputPath);
  if (extname(outputPath).toLowerCase() !== ".wav") throw new Error("outputPath must end in .wav");
  if (await exists(outputPath)) throw new Error(`Anchor preview output already exists: ${outputPath}`);
  const bounds = anchorBounds(manifest, source.artifact, plan);
  const temporary = join(dirname(outputPath), `.${basename(outputPath)}.anchor-${process.pid}-${Date.now()}.wav`);
  try {
    await renderTrim(source.path, temporary, bounds.trimStartSeconds, bounds.trimEndSeconds);
    const quality = await analyzeAudioQuality(
      temporary,
      options.referenceLufs,
      options.referenceTruePeakDbfs,
    );
    if (quality.silent) throw new Error(`Anchor preview ${options.phraseDirectionId}/${auditionLayer} is silent`);
    if (quality.durationSeconds < 19.9 || quality.durationSeconds > 30.1) {
      throw new Error(`Rendered anchor preview is ${quality.durationSeconds.toFixed(2)}s, outside 20..30 seconds`);
    }
    await rename(temporary, outputPath);
    const digest = await fileSha256(outputPath);
    const artifact: ManifestArtifact = {
      id: artifactId(`anchor-${auditionLayer}`, source.artifact.id, plan.passage.sectionId, manifest.revision),
      role: "preview",
      path: outputPath,
      ...digest,
      source_revision: manifest.revision,
      source_composition_hash: manifest.composition_hash,
      dependencies: [source.artifact.id, plan.phraseDirectionId, plan.passage.sectionId],
      metadata: {
        renderer: "ffmpeg-anchor-preview",
        source_artifact: source.artifact.id,
        source_timeline_origin: bounds.origin,
        timeline_origin: "preview_start",
        audition_kind: "anchor_passage",
        audition_layer: auditionLayer,
        phrase_direction_id: plan.phraseDirectionId,
        listening_question_id: plan.listeningQuestionId,
        intent_hash: plan.intentHash,
        section_id: plan.passage.sectionId,
        passage_start_tick: plan.passage.startTick,
        passage_end_tick: plan.passage.endTick,
        passage_duration_seconds: quality.durationSeconds,
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
      sectionId: plan.passage.sectionId,
      phraseDirectionId: plan.phraseDirectionId,
      listeningQuestionId: plan.listeningQuestionId,
      auditionLayer,
      plan,
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

export interface CompareAnchorPassageArtifactsOptions {
  manifestPath: string;
  expectedRevision: number;
  artifactAId: string;
  artifactBId: string;
  phraseDirectionId: string;
  auditionLayer: IntentAuditionLayer;
  hypothesisFamily: IntentHypothesisFamily;
  outputAPath: string;
  outputBPath: string;
  targetDurationSeconds?: number;
  matchLufs?: number;
  referenceTruePeakDbfs: number;
}

export async function compareSongAnchorPassageArtifacts(options: CompareAnchorPassageArtifactsOptions) {
  const auditionLayer = IntentAuditionLayerSchema.parse(options.auditionLayer);
  const hypothesisFamily = IntentHypothesisFamilySchema.parse(options.hypothesisFamily);
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
  const plan = buildAnchorAuditionPlan(manifest, options.phraseDirectionId, options.targetDurationSeconds ?? 25);
  if (!plan.passage.targetDurationMet) {
    throw new Error(
      `Anchor passage ${options.phraseDirectionId} is ${plan.passage.durationSeconds.toFixed(2)}s; `
      + "choose a section/core that can preserve 20..30 seconds",
    );
  }
  const [outputA, outputB] = await Promise.all([
    resolveWritablePath(options.outputAPath),
    resolveWritablePath(options.outputBPath),
  ]);
  if (outputA === outputB) throw new Error("outputAPath and outputBPath must be distinct");
  for (const path of [outputA, outputB]) {
    if (extname(path).toLowerCase() !== ".wav") throw new Error("A/B output paths must end in .wav");
    if (await exists(path)) throw new Error(`A/B output already exists: ${path}`);
  }
  const boundsA = anchorBounds(manifest, a.artifact, plan);
  const boundsB = anchorBounds(manifest, b.artifact, plan);
  const rawA = join(dirname(outputA), `.${basename(outputA)}.anchor-raw-${process.pid}-${Date.now()}.wav`);
  const rawB = join(dirname(outputB), `.${basename(outputB)}.anchor-raw-${process.pid}-${Date.now()}.wav`);
  const temporaryA = join(dirname(outputA), `.${basename(outputA)}.anchor-match-${process.pid}-${Date.now()}.wav`);
  const temporaryB = join(dirname(outputB), `.${basename(outputB)}.anchor-match-${process.pid}-${Date.now()}.wav`);
  try {
    await Promise.all([
      renderTrim(a.path, rawA, boundsA.trimStartSeconds, boundsA.trimEndSeconds),
      renderTrim(b.path, rawB, boundsB.trimStartSeconds, boundsB.trimEndSeconds),
    ]);
    const [analysisA, analysisB] = await Promise.all([
      analyzeAudioQuality(rawA, -16, options.referenceTruePeakDbfs),
      analyzeAudioQuality(rawB, -16, options.referenceTruePeakDbfs),
    ]);
    if (analysisA.durationSeconds < 19.9 || analysisB.durationSeconds < 19.9) {
      throw new Error("One A/B source cannot cover the 20-second anchor passage");
    }
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
      throw new Error("Loudness matching would clip an anchor A/B; choose a quieter matchLufs");
    }
    await Promise.all([rename(temporaryA, outputA), rename(temporaryB, outputB)]);
    const [digestA, digestB] = await Promise.all([fileSha256(outputA), fileSha256(outputB)]);
    const pairId = `${a.artifact.id}:${b.artifact.id}:${plan.phraseDirectionId}:${hypothesisFamily}`;
    const now = new Date().toISOString();
    const sharedMetadata = {
      renderer: "ffmpeg-anchor-loudness-match",
      timeline_origin: "preview_start",
      audition_kind: "anchor_passage",
      audition_layer: auditionLayer,
      comparison_kind: "single_question_ab",
      hypothesis_family: hypothesisFamily,
      pair_id: pairId,
      phrase_direction_id: plan.phraseDirectionId,
      listening_question_id: plan.listeningQuestionId,
      intent_hash: plan.intentHash,
      section_id: plan.passage.sectionId,
      passage_start_tick: plan.passage.startTick,
      passage_end_tick: plan.passage.endTick,
      passage_duration_seconds: plan.passage.durationSeconds,
      target_lufs: targetLufs,
    } as const;
    const artifacts: ManifestArtifact[] = [
      {
        id: artifactId("anchor-ab-a", a.artifact.id, plan.passage.sectionId, manifest.revision),
        role: "preview",
        path: outputA,
        ...digestA,
        source_revision: manifest.revision,
        source_composition_hash: manifest.composition_hash,
        dependencies: [a.artifact.id, plan.phraseDirectionId, plan.passage.sectionId],
        metadata: { ...sharedMetadata, side: "A", gain_db: gainA, source_artifact: a.artifact.id },
        created_at: now,
      },
      {
        id: artifactId("anchor-ab-b", b.artifact.id, plan.passage.sectionId, manifest.revision),
        role: "preview",
        path: outputB,
        ...digestB,
        source_revision: manifest.revision,
        source_composition_hash: manifest.composition_hash,
        dependencies: [b.artifact.id, plan.phraseDirectionId, plan.passage.sectionId],
        metadata: { ...sharedMetadata, side: "B", gain_db: gainB, source_artifact: b.artifact.id },
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
      sectionId: plan.passage.sectionId,
      phraseDirectionId: plan.phraseDirectionId,
      listeningQuestionId: plan.listeningQuestionId,
      auditionLayer,
      hypothesisFamily,
      targetLufs,
      plan,
      reviewBinding: {
        review_kind: "intent_fidelity" as const,
        phrase_direction_id: plan.phraseDirectionId,
        listening_question_id: plan.listeningQuestionId,
        intent_hash: plan.intentHash,
        composition_hash: manifest.composition_hash,
        A: { artifact_id: artifacts[0]!.id, artifact_sha256: artifacts[0]!.sha256 },
        B: { artifact_id: artifacts[1]!.id, artifact_sha256: artifacts[1]!.sha256 },
        hypothesis_family: hypothesisFamily,
      },
      A: {
        sourceArtifactId: a.artifact.id,
        outputPath: outputA,
        gainDb: gainA,
        before: analysisA,
        after: { ...matchedA, path: outputA },
        artifact: artifacts[0],
      },
      B: {
        sourceArtifactId: b.artifact.id,
        outputPath: outputB,
        gainDb: gainB,
        before: analysisB,
        after: { ...matchedB, path: outputB },
        artifact: artifacts[1],
      },
    };
  } catch (error) {
    await Promise.all([rawA, rawB, temporaryA, temporaryB, outputA, outputB]
      .map((path) => unlink(path).catch(() => undefined)));
    throw error;
  } finally {
    await Promise.all([rawA, rawB].map((path) => unlink(path).catch(() => undefined)));
  }
}
