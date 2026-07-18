import { access, mkdtemp, rm, unlink } from "node:fs/promises";
import { join } from "node:path";

import {
  renderAccompaniment,
  type AccompanimentTrackInput,
  type DrumHitInput,
  type DrumPatternInput,
  type DrumPatternPlacementInput,
} from "./accompaniment.js";
import { acquireEditorLease } from "./editor-lease.js";
import { resolveReadablePath, resolveWritableDirectory } from "./paths.js";
import { renderProjectToWav, type RenderRuntimeOptions } from "./render.js";
import { preflightSongManifest } from "./song-preflight.js";
import {
  fileSha256,
  loadSongManifest,
  recordSongManifestArtifacts,
  type ManifestArrangementTrack,
  type ManifestArtifact,
  type SongManifest,
} from "./song-manifest.js";
import { inspectProject, prepareVocalStemProject } from "./vsqx.js";


async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function songEnd(manifest: SongManifest) {
  const last = [...manifest.sections]
    .sort((left, right) => right.end.measure - left.end.measure
      || right.end.beat - left.end.beat
      || right.end.tick - left.end.tick)[0];
  if (!last) throw new Error("Manifest has no sections");
  return last.end;
}

function boundedArtifactId(prefix: string, stableId: string, revision: number): string {
  const suffix = `-r${revision}`;
  const available = 96 - prefix.length - suffix.length - 2;
  return `${prefix}-${stableId.slice(0, Math.max(1, available))}${suffix}`;
}

function pitchedTrack(track: Extract<ManifestArrangementTrack, { kind: "pitched" }>): AccompanimentTrackInput {
  return {
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
  };
}

function drumTrack(track: Extract<ManifestArrangementTrack, { kind: "drums" }>): {
  hits: DrumHitInput[];
  patterns: DrumPatternInput[];
  placements: DrumPatternPlacementInput[];
} {
  const prefix = `${track.id}--`;
  return {
    hits: track.hits.map((hit) => ({
      position: hit.position,
      noteNumber: hit.note_number,
      velocity: hit.velocity,
      duration: hit.duration,
    })),
    patterns: track.patterns.map((pattern) => ({
      id: `${prefix}${pattern.id}`,
      measures: pattern.measures,
      hits: pattern.hits.map((hit) => ({
        offset: hit.offset,
        noteNumber: hit.note_number,
        velocity: hit.velocity,
        duration: hit.duration,
      })),
    })),
    placements: track.placements.map((placement) => ({
      patternId: `${prefix}${placement.pattern_id}`,
      start: placement.start,
      repeats: placement.repeats,
      velocityScale: placement.velocity_scale,
    })),
  };
}

export interface RenderInstrumentStemsOptions {
  manifestPath: string;
  expectedRevision: number;
  outputDirectory: string;
  preservePan: boolean;
  includeRendererEffects: boolean;
  trackIds?: string[];
}

export async function renderSongManifestInstrumentStems(options: RenderInstrumentStemsOptions) {
  const loaded = await loadSongManifest(options.manifestPath);
  const manifest = loaded.manifest;
  if (manifest.revision !== options.expectedRevision) {
    throw new Error(`Stale manifest revision ${options.expectedRevision}; current revision is ${manifest.revision}`);
  }
  const preflight = await preflightSongManifest(loaded.path, {
    artifactCheck: "none",
    includePerformanceWarnings: false,
  });
  const instrumentBlockerCodes = new Set([
    "ARRANGEMENT_EVENT_PAST_SONG_END",
    "PATTERN_EVENT_OUT_OF_BOUNDS",
    "PLACEMENT_PAST_SONG_END",
  ]);
  const instrumentBlockers = preflight.readiness.build.blockers.filter((code) => instrumentBlockerCodes.has(code));
  if (instrumentBlockers.length > 0) {
    throw new Error(`Instrument stem render blocked by preflight: ${instrumentBlockers.join(", ")}`);
  }
  if (manifest.accompaniment.tracks.length === 0) throw new Error("Manifest has no arrangement tracks");
  const requested = options.trackIds ? new Set(options.trackIds) : null;
  if (requested && requested.size !== options.trackIds?.length) throw new Error("trackIds contains duplicates");
  if (requested) for (const id of requested) {
    if (!manifest.accompaniment.tracks.some((track) => track.id === id)) {
      throw new Error(`Manifest has no arrangement track ${id}`);
    }
  }
  const selectedTracks = requested
    ? manifest.accompaniment.tracks.filter((track) => requested.has(track.id))
    : manifest.accompaniment.tracks;
  if (selectedTracks.length === 0) throw new Error("trackIds selected zero arrangement tracks");
  const directory = await resolveWritableDirectory(options.outputDirectory);
  const profile = `${options.preservePan ? "mixpan" : "center"}-${options.includeRendererEffects ? "fx" : "dry"}`;
  const outputPaths = selectedTracks.map((track) =>
    join(directory, `${manifest.slug}-instrument-${track.id}-r${manifest.revision}-${profile}.wav`));
  for (const path of outputPaths) {
    if (await exists(path)) throw new Error(`Stem output already exists; use a new revision directory/path: ${path}`);
  }

  const created: string[] = [];
  try {
    const stems = [];
    const artifacts: ManifestArtifact[] = [];
    for (const [index, track] of selectedTracks.entries()) {
      const outputPath = outputPaths[index]!;
      const drums = track.kind === "drums" ? drumTrack(track) : null;
      const result = await renderAccompaniment({
        outputPath,
        timeSignatures: manifest.time_signatures,
        tempos: manifest.tempos,
        end: songEnd(manifest),
        tracks: track.kind === "pitched"
          ? [{ ...pitchedTrack(track), pan: options.preservePan ? track.pan : 64 }]
          : [],
        drums: drums?.hits ?? [],
        drumPatterns: drums?.patterns ?? [],
        drumPlacements: drums?.placements ?? [],
        sampleRate: manifest.accompaniment.sample_rate,
        gain: manifest.accompaniment.gain,
        reverb: options.includeRendererEffects && manifest.accompaniment.reverb,
        chorus: options.includeRendererEffects && manifest.accompaniment.chorus,
        ...(manifest.accompaniment.soundfont_path
          ? { soundfontPath: manifest.accompaniment.soundfont_path }
          : {}),
        overwrite: false,
      });
      created.push(outputPath);
      const digest = await fileSha256(outputPath);
      const artifact: ManifestArtifact = {
        id: boundedArtifactId("instrument-stem", track.id, manifest.revision),
        role: "instrument_stem",
        path: outputPath,
        ...digest,
        source_revision: manifest.revision,
        source_composition_hash: manifest.composition_hash,
        dependencies: [track.id],
        metadata: {
          track_id: track.id,
          track_name: track.name,
          track_kind: track.kind,
          preserve_pan: options.preservePan,
          renderer_effects: options.includeRendererEffects,
          renderer: "fluidsynth",
          timeline_origin: "song_start",
        },
        created_at: new Date().toISOString(),
      };
      artifacts.push(artifact);
      stems.push({ trackId: track.id, trackName: track.name, trackKind: track.kind, ...result, ...digest });
    }
    const mutation = await recordSongManifestArtifacts(
      loaded.path,
      manifest.revision,
      manifest.composition_hash,
      artifacts,
    );
    return {
      sourceRevision: manifest.revision,
      sourceCompositionHash: manifest.composition_hash,
      manifestRevision: mutation.write.revision,
      manifestContentHash: mutation.write.contentHash,
      profile: { preservePan: options.preservePan, includeRendererEffects: options.includeRendererEffects },
      stems,
      artifacts,
    };
  } catch (error) {
    await Promise.all(created.map((path) => unlink(path).catch(() => undefined)));
    throw error;
  }
}

export interface RenderVocalStemsOptions {
  manifestPath: string;
  expectedRevision: number;
  projectArtifactId: string;
  outputDirectory: string;
  centerPan: boolean;
  dry: boolean;
  volume?: number;
  timeoutSeconds: number;
  vocalTrackIds?: string[];
  allowPreSendAdjustment: boolean;
  runtime?: Omit<RenderRuntimeOptions, "lease">;
}

export async function renderSongManifestVocalStems(options: RenderVocalStemsOptions) {
  const loaded = await loadSongManifest(options.manifestPath);
  const manifest = loaded.manifest;
  if (manifest.revision !== options.expectedRevision) {
    throw new Error(`Stale manifest revision ${options.expectedRevision}; current revision is ${manifest.revision}`);
  }
  const preflight = await preflightSongManifest(loaded.path, {
    artifactCheck: "current",
    includePerformanceWarnings: false,
  });
  const vocalIgnoredCodes = new Set([
    "NO_PITCHED_ARRANGEMENT_TRACK",
    "ARRANGEMENT_EVENT_PAST_SONG_END",
    "PATTERN_EVENT_OUT_OF_BOUNDS",
    "PLACEMENT_PAST_SONG_END",
  ]);
  const vocalBlockers = preflight.readiness.render.blockers.filter((code) => !vocalIgnoredCodes.has(code));
  if (vocalBlockers.length > 0) {
    throw new Error(`Vocal stem render blocked by preflight: ${vocalBlockers.join(", ")}`);
  }
  if (manifest.vocal_tracks.length === 0) throw new Error("Manifest has no vocal tracks");
  const projectArtifact = manifest.artifacts.find((artifact) => artifact.id === options.projectArtifactId);
  if (!projectArtifact || projectArtifact.role !== "vsqx") {
    throw new Error(`No VSQX artifact with stable ID ${options.projectArtifactId}`);
  }
  if (projectArtifact.source_composition_hash !== manifest.composition_hash) {
    throw new Error(
      `VSQX artifact ${projectArtifact.id} belongs to composition ${projectArtifact.source_composition_hash}, `
      + `but current composition is ${manifest.composition_hash}; build the manifest again first`,
    );
  }
  const sourceProject = await resolveReadablePath(projectArtifact.path);
  const projectDigest = await fileSha256(sourceProject);
  if (projectDigest.sha256 !== projectArtifact.sha256 || projectDigest.bytes !== projectArtifact.bytes) {
    throw new Error(`VSQX artifact ${projectArtifact.id} no longer matches its recorded SHA-256/size`);
  }
  const project = await inspectProject(sourceProject);
  if (project.tracks.length !== manifest.vocal_tracks.length) {
    throw new Error(
      `VSQX has ${project.tracks.length} vocal tracks but manifest has ${manifest.vocal_tracks.length}`,
    );
  }
  for (const [index, track] of manifest.vocal_tracks.entries()) {
    const projectTrack = project.tracks[index];
    if (!projectTrack || projectTrack.trackNumber !== index || projectTrack.name !== track.name) {
      throw new Error(
        `VSQX track ${index} does not match manifest track ${track.id}/${track.name}; rebuild before stem export`,
      );
    }
  }

  const requested = options.vocalTrackIds ? new Set(options.vocalTrackIds) : null;
  if (requested && requested.size !== options.vocalTrackIds?.length) {
    throw new Error("vocalTrackIds contains duplicates");
  }
  if (requested) for (const id of requested) {
    if (!manifest.vocal_tracks.some((track) => track.id === id)) {
      throw new Error(`Manifest has no vocal track ${id}`);
    }
  }
  const selectedTracks = manifest.vocal_tracks
    .map((track, trackNumber) => ({ track, trackNumber }))
    .filter(({ track }) => !requested || requested.has(track.id));
  if (selectedTracks.length === 0) throw new Error("vocalTrackIds selected zero vocal tracks");

  const directory = await resolveWritableDirectory(options.outputDirectory);
  const profile = `${options.centerPan ? "center" : "mixpan"}-${options.dry ? "dry" : "send"}`;
  const outputPaths = selectedTracks.map(({ track }) =>
    join(directory, `${manifest.slug}-vocal-${track.id}-r${manifest.revision}-${profile}.wav`));
  for (const path of outputPaths) {
    if (await exists(path)) throw new Error(`Stem output already exists; use a new revision directory/path: ${path}`);
  }

  const created: string[] = [];
  const lease = await acquireEditorLease(
    options.runtime?.requestId ?? `vocal-stems-${process.pid}-${manifest.revision}`,
  );
  let temporary: string | null = null;
  try {
    temporary = await mkdtemp(join(directory, `.${manifest.slug}-vocal-stems-`));
    const stems = [];
    const artifacts: ManifestArtifact[] = [];
    for (const [selectionIndex, { track, trackNumber }] of selectedTracks.entries()) {
      const isolatedProject = join(temporary, `${track.id}.vsqx`);
      const isolation = await prepareVocalStemProject(
        sourceProject,
        isolatedProject,
        trackNumber,
        {
          centerPan: options.centerPan,
          dry: options.dry,
          ...(options.volume !== undefined ? { volume: options.volume } : {}),
        },
        false,
      );
      const outputPath = outputPaths[selectionIndex]!;
      const result = await renderProjectToWav(
        isolatedProject,
        outputPath,
        options.timeoutSeconds,
        false,
        options.allowPreSendAdjustment,
        {
          ...options.runtime,
          requestId: lease.requestId,
          lease,
        },
      );
      created.push(outputPath);
      const digest = await fileSha256(outputPath);
      const artifact: ManifestArtifact = {
        id: boundedArtifactId("vocal-stem", track.id, manifest.revision),
        role: "vocal_stem",
        path: outputPath,
        ...digest,
        source_revision: manifest.revision,
        source_composition_hash: manifest.composition_hash,
        dependencies: [projectArtifact.id, track.id],
        metadata: {
          track_id: track.id,
          track_name: track.name,
          track_number: trackNumber,
          source_project_artifact: projectArtifact.id,
          center_pan: options.centerPan,
          dry: options.dry,
          allow_pre_send_adjustment: options.allowPreSendAdjustment,
          event_verification_seen: result.eventVerificationSeen,
          pre_send_adjusted: result.preSendAdjusted,
          timeline_origin: "project_start",
          ...(options.volume !== undefined ? { volume: options.volume } : {}),
        },
        created_at: new Date().toISOString(),
      };
      artifacts.push(artifact);
      stems.push({ trackId: track.id, trackName: track.name, trackNumber, isolation, ...result, ...digest });
    }
    const mutation = await recordSongManifestArtifacts(
      loaded.path,
      manifest.revision,
      manifest.composition_hash,
      artifacts,
    );
    return {
      sourceRevision: manifest.revision,
      sourceCompositionHash: manifest.composition_hash,
      sourceProjectArtifact: projectArtifact.id,
      manifestRevision: mutation.write.revision,
      manifestContentHash: mutation.write.contentHash,
      profile: {
        centerPan: options.centerPan,
        dry: options.dry,
        volume: options.volume ?? null,
        allowPreSendAdjustment: options.allowPreSendAdjustment,
      },
      stems,
      artifacts,
    };
  } catch (error) {
    await Promise.all(created.map((path) => unlink(path).catch(() => undefined)));
    throw error;
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
    await lease.release();
  }
}
