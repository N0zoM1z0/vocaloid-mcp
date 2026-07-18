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
  type ManifestEffectChain,
  type ManifestSectionDynamic,
  type SongManifest,
} from "./song-manifest.js";
import { musicalPositionToTick } from "./vsqx.js";


const execFileAsync = promisify(execFile);

export interface RenderManifestStemMixOptions {
  manifestPath: string;
  expectedRevision: number;
  stemArtifactIds: string[];
  outputPath: string;
  sampleRate: 44_100 | 48_000 | 96_000;
  bitDepth: 16 | 24;
  referenceLufs: number;
  referenceTruePeakDbfs: number;
  timeoutSeconds: number;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function linearGain(decibels: number): number {
  return 10 ** (decibels / 20);
}

function number(value: number, digits = 8): string {
  return Number(value.toFixed(digits)).toString();
}

function effectFilter(effect: ManifestEffectChain["effects"][number]): string | null {
  if (!effect.enabled) return null;
  switch (effect.type) {
    case "gain": {
      const parameters = effect.parameters;
      return `volume=${number(parameters.gain_db)}dB`;
    }
    case "pan": {
      const parameters = effect.parameters;
      return `stereotools=balance_out=${number(parameters.pan)}:bmode_out=power`;
    }
    case "highpass": {
      const parameters = effect.parameters;
      return `highpass=f=${number(parameters.frequency_hz)}:t=q:w=${number(parameters.q)}:p=${parameters.poles}`;
    }
    case "lowpass": {
      const parameters = effect.parameters;
      return `lowpass=f=${number(parameters.frequency_hz)}:t=q:w=${number(parameters.q)}:p=${parameters.poles}`;
    }
    case "equalizer": {
      const parameters = effect.parameters;
      return `equalizer=f=${number(parameters.frequency_hz)}:t=q:w=${number(parameters.q)}:g=${number(parameters.gain_db)}:m=${number(parameters.mix)}`;
    }
    case "compressor": {
      const parameters = effect.parameters;
      return [
        `acompressor=threshold=${number(linearGain(parameters.threshold_db))}`,
        `ratio=${number(parameters.ratio)}`,
        `attack=${number(parameters.attack_ms)}`,
        `release=${number(parameters.release_ms)}`,
        `makeup=${number(linearGain(parameters.makeup_db))}`,
        `knee=${number(parameters.knee)}`,
        `detection=${parameters.detection}`,
        `mix=${number(parameters.mix)}`,
      ].join(":");
    }
    case "deesser": {
      const parameters = effect.parameters;
      return `deesser=i=${number(parameters.intensity)}:m=${number(parameters.max_deessing)}:f=${number(parameters.frequency_focus)}:s=o`;
    }
    case "reverb": {
      const parameters = effect.parameters;
      const secondDelay = Math.min(5000, parameters.delay_ms * 1.618);
      const secondDecay = parameters.decay * 0.62;
      return `aecho=in_gain=${number(parameters.in_gain)}:out_gain=${number(parameters.out_gain)}:delays=${number(parameters.delay_ms)}|${number(secondDelay)}:decays=${number(parameters.decay)}|${number(secondDecay)}`;
    }
    case "delay": {
      const parameters = effect.parameters;
      return `aecho=in_gain=${number(parameters.in_gain)}:out_gain=${number(parameters.out_gain)}:delays=${number(parameters.delay_ms)}:decays=${number(parameters.decay)}`;
    }
    case "limiter": {
      const parameters = effect.parameters;
      return `alimiter=limit=${number(linearGain(parameters.limit_db))}:attack=${number(parameters.attack_ms)}:release=${number(parameters.release_ms)}:level=false:latency=true`;
    }
  }
}

function preMeasureSeconds(manifest: SongManifest): number {
  const signature = manifest.time_signatures[0]!;
  const ticks = manifest.pre_measure * signature.numerator * ((480 * 4) / signature.denominator);
  return (ticks * 60) / (480 * manifest.tempos[0]!.bpm);
}

function songTickSeconds(manifest: SongManifest, targetTick: number): number {
  const tempos = manifest.tempos.map((tempo) => ({
    tick: musicalPositionToTick(manifest.time_signatures, tempo.position),
    bpm: tempo.bpm,
  }));
  let seconds = preMeasureSeconds(manifest);
  let cursor = 0;
  let bpm = tempos[0]!.bpm;
  for (let index = 1; index < tempos.length; index += 1) {
    const event = tempos[index]!;
    if (event.tick >= targetTick) break;
    seconds += ((event.tick - cursor) * 60) / (480 * bpm);
    cursor = event.tick;
    bpm = event.bpm;
  }
  seconds += ((targetTick - cursor) * 60) / (480 * bpm);
  return seconds;
}

function dynamicFilter(
  manifest: SongManifest,
  dynamics: readonly ManifestSectionDynamic[],
): string | null {
  if (dynamics.length === 0) return null;
  const terms = dynamics.map((dynamic) => {
    const section = manifest.sections.find((candidate) => candidate.id === dynamic.section_id);
    if (!section) throw new Error(`Unknown section ${dynamic.section_id}`);
    const start = songTickSeconds(
      manifest,
      musicalPositionToTick(manifest.time_signatures, section.start),
    );
    const end = songTickSeconds(
      manifest,
      musicalPositionToTick(manifest.time_signatures, section.end),
    );
    const ramp = Math.min(dynamic.ramp_ms / 1000, (end - start) / 2);
    const envelope = ramp <= 0
      ? `between(t,${number(start)},${number(end)})`
      : `if(between(t,${number(start)},${number(end)}),if(lt(t,${number(start + ramp)}),(t-${number(start)})/${number(ramp)},if(gt(t,${number(end - ramp)}),(${number(end)}-t)/${number(ramp)},1)),0)`;
    return `${number(dynamic.gain_db)}*(${envelope})`;
  });
  return `volume='pow(10,(${terms.join("+")})/20)':eval=frame`;
}

function compileChain(chain: ManifestEffectChain | undefined): string[] {
  return chain ? chain.effects.map(effectFilter).filter((value): value is string => value !== null) : [];
}

function mixArtifactId(revision: number): string {
  return `stem-mix-r${revision}`;
}

export async function renderSongManifestStemMix(options: RenderManifestStemMixOptions) {
  if (options.stemArtifactIds.length === 0) throw new Error("stemArtifactIds must not be empty");
  if (new Set(options.stemArtifactIds).size !== options.stemArtifactIds.length) {
    throw new Error("stemArtifactIds contains duplicates");
  }
  const loaded = await loadSongManifest(options.manifestPath);
  const manifest = loaded.manifest;
  if (manifest.revision !== options.expectedRevision) {
    throw new Error(`Stale manifest revision ${options.expectedRevision}; current revision is ${manifest.revision}`);
  }
  const selected = options.stemArtifactIds.map((id) => {
    const artifact = manifest.artifacts.find((candidate) => candidate.id === id);
    if (!artifact || !["vocal_stem", "instrument_stem"].includes(artifact.role)) {
      throw new Error(`No vocal_stem/instrument_stem artifact with stable ID ${id}`);
    }
    if (artifact.source_composition_hash !== manifest.composition_hash) {
      throw new Error(
        `Stem ${id} belongs to composition ${artifact.source_composition_hash}, `
        + `but current composition is ${manifest.composition_hash}`,
      );
    }
    const trackId = typeof artifact.metadata.track_id === "string" ? artifact.metadata.track_id : null;
    if (!trackId) throw new Error(`Stem ${id} has no track_id provenance`);
    return { artifact, trackId };
  });
  if (new Set(selected.map((entry) => entry.trackId)).size !== selected.length) {
    throw new Error("Selected stems contain more than one artifact for the same track_id");
  }
  const outputPath = await resolveWritablePath(options.outputPath);
  if (extname(outputPath).toLowerCase() !== ".wav") throw new Error("outputPath must end in .wav");
  if (await exists(outputPath)) throw new Error(`Mix output already exists: ${outputPath}`);
  const resolvedInputs = await Promise.all(selected.map(async (entry) => {
    const path = await resolveReadablePath(entry.artifact.path);
    const digest = await fileSha256(path);
    if (digest.sha256 !== entry.artifact.sha256 || digest.bytes !== entry.artifact.bytes) {
      throw new Error(`Stem ${entry.artifact.id} no longer matches its recorded SHA-256/size`);
    }
    return { ...entry, path, digest };
  }));

  const chains = new Map(manifest.mix.effect_chains.map((chain) => [chain.target_id, chain]));
  const dynamicsByTarget = new Map<string, ManifestSectionDynamic[]>();
  for (const dynamic of manifest.mix.section_dynamics) {
    const values = dynamicsByTarget.get(dynamic.target_id) ?? [];
    values.push(dynamic);
    dynamicsByTarget.set(dynamic.target_id, values);
  }
  const filters: string[] = [];
  const preDelayMilliseconds = Math.round(preMeasureSeconds(manifest) * 1000);
  for (const [index, input] of resolvedInputs.entries()) {
    const chainFilters = [
      "asetpts=PTS-STARTPTS",
      `aresample=${options.sampleRate}`,
      "aformat=sample_fmts=fltp:channel_layouts=stereo",
    ];
    const timelineOrigin = input.artifact.metadata.timeline_origin;
    if (timelineOrigin === "song_start" || (timelineOrigin === undefined && input.artifact.role === "instrument_stem")) {
      chainFilters.push(`adelay=${preDelayMilliseconds}:all=1`);
    } else if (timelineOrigin !== "project_start") {
      throw new Error(`Stem ${input.artifact.id} has unsupported timeline_origin ${String(timelineOrigin)}`);
    }
    const dynamics = dynamicFilter(manifest, dynamicsByTarget.get(input.trackId) ?? []);
    if (dynamics) chainFilters.push(dynamics);
    chainFilters.push(...compileChain(chains.get(input.trackId)));
    filters.push(`[${index}:a]${chainFilters.join(",")}[stem${index}]`);
  }
  const mixFilters = [
    `${resolvedInputs.map((_input, index) => `[stem${index}]`).join("")}amix=inputs=${resolvedInputs.length}:duration=longest:dropout_transition=0:normalize=0`,
  ];
  const busDynamics = dynamicFilter(manifest, dynamicsByTarget.get("mix-bus") ?? []);
  if (busDynamics) mixFilters.push(busDynamics);
  mixFilters.push(...compileChain(chains.get("mix-bus")));
  mixFilters.push(`aresample=${options.sampleRate}`, "aformat=sample_fmts=fltp:channel_layouts=stereo");
  filters.push(`${mixFilters.join(",")}[mixout]`);
  const filterGraph = filters.join(";");
  const temporary = join(dirname(outputPath), `.${basename(outputPath)}.mix-${process.pid}-${Date.now()}.wav`);
  const ffmpeg = process.env.FFMPEG_PATH ?? "/usr/bin/ffmpeg";
  try {
    await execFileAsync(
      ffmpeg,
      [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        ...resolvedInputs.flatMap((input) => ["-i", input.path]),
        "-filter_complex", filterGraph,
        "-map", "[mixout]",
        "-ar", String(options.sampleRate),
        "-ac", "2",
        "-c:a", options.bitDepth === 24 ? "pcm_s24le" : "pcm_s16le",
        temporary,
      ],
      { timeout: options.timeoutSeconds * 1000, maxBuffer: 8 * 1024 * 1024 },
    );
    const quality = await analyzeAudioQuality(
      temporary,
      options.referenceLufs,
      options.referenceTruePeakDbfs,
    );
    if (quality.silent) throw new Error("Rendered stem mix is silent");
    await rename(temporary, outputPath);
    const digest = await fileSha256(outputPath);
    const artifact: ManifestArtifact = {
      id: mixArtifactId(manifest.revision),
      role: "mix",
      path: outputPath,
      ...digest,
      source_revision: manifest.revision,
      source_composition_hash: manifest.composition_hash,
      dependencies: resolvedInputs.map((input) => input.artifact.id),
      metadata: {
        renderer: "ffmpeg-filter-complex",
        source_mix_hash: manifest.mix_hash,
        sample_rate: options.sampleRate,
        bit_depth: options.bitDepth,
        input_stems: resolvedInputs.length,
        reference_lufs: options.referenceLufs,
        reference_true_peak_dbfs: options.referenceTruePeakDbfs,
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
      sourceMixHash: manifest.mix_hash,
      manifestRevision: mutation.write.revision,
      manifestContentHash: mutation.write.contentHash,
      outputPath,
      outputSha256: digest.sha256,
      inputs: resolvedInputs.map((input) => ({
        artifactId: input.artifact.id,
        trackId: input.trackId,
        path: input.path,
        sha256: input.digest.sha256,
        timelineOrigin: input.artifact.metadata.timeline_origin,
        effectChainId: chains.get(input.trackId)?.id ?? null,
        sectionDynamicsIds: (dynamicsByTarget.get(input.trackId) ?? []).map((entry) => entry.id),
      })),
      bus: {
        effectChainId: chains.get("mix-bus")?.id ?? null,
        sectionDynamicsIds: (dynamicsByTarget.get("mix-bus") ?? []).map((entry) => entry.id),
      },
      filterGraph,
      quality: { ...quality, path: outputPath },
      artifact,
    };
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    await unlink(outputPath).catch(() => undefined);
    throw error;
  }
}
