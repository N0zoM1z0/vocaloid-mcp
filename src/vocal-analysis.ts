import { access, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import { resolveReadablePath, resolveWritablePath } from "./paths.js";
import {
  fileSha256,
  loadSongManifest,
  manifestExpectedVocalEvents,
  recordSongManifestArtifacts,
  type ManifestArtifact,
  type ManifestExpectedVocalEvent,
  type SongManifest,
} from "./song-manifest.js";
import { musicalPositionToTick } from "./vsqx.js";
import { analyzeWav, decodeWavMono } from "./wav.js";


interface PitchContourPoint {
  timeSeconds: number;
  pitchHz: number;
  centsFromTarget: number;
  confidence: number;
  rmsDbfs: number | null;
}

interface VocalAnalysisIssue {
  severity: "info" | "warning" | "error";
  code: string;
  eventIds: string[];
  message: string;
  recommendation: string;
}

interface FrameObservation {
  timeSeconds: number;
  sampleStart: number;
  rms: number;
  pitchHz: number | null;
  confidence: number | null;
  cents: number | null;
}

export interface AnalyzeVocalStemOptions {
  manifestPath: string;
  expectedRevision: number;
  stemArtifactId: string;
  outputPath: string;
  sectionId?: string;
  eventIds?: string[];
  timelineOffsetSeconds: number;
  minimumPitchHz: number;
  maximumPitchHz: number;
  pitchToleranceCents: number;
  onsetToleranceMilliseconds: number;
  offsetToleranceMilliseconds: number;
}

function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function decibels(value: number): number | null {
  return value > 0 ? 20 * Math.log10(value) : null;
}

function quantile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const position = (ordered.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const left = ordered[lower]!;
  const right = ordered[upper]!;
  return left + (right - left) * (position - lower);
}

function median(values: readonly number[]): number | null {
  return quantile(values, 0.5);
}

function mean(values: readonly number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function standardDeviation(values: readonly number[]): number | null {
  const average = mean(values);
  if (average === null || values.length < 2) return null;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

function midiFrequency(noteNumber: number): number {
  return 440 * (2 ** ((noteNumber - 69) / 12));
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

function frameRms(samples: Float32Array, start: number, length: number): number {
  let squares = 0;
  for (let index = 0; index < length; index += 1) {
    const value = samples[start + index] ?? 0;
    squares += value * value;
  }
  return Math.sqrt(squares / length);
}

function yinPitch(
  samples: Float32Array,
  start: number,
  length: number,
  sampleRate: number,
  minimumHz: number,
  maximumHz: number,
): { pitchHz: number; confidence: number } | null {
  const minimumLag = Math.max(2, Math.floor(sampleRate / maximumHz));
  const maximumLag = Math.min(length - 3, Math.ceil(sampleRate / minimumHz));
  if (maximumLag <= minimumLag) return null;
  const normalized = new Float64Array(maximumLag + 2);
  normalized[0] = 1;
  let running = 0;
  let bestLag = minimumLag;
  let bestValue = Number.POSITIVE_INFINITY;
  for (let lag = 1; lag <= maximumLag + 1; lag += 1) {
    let difference = 0;
    const compare = length - lag;
    for (let index = 0; index < compare; index += 1) {
      const delta = (samples[start + index] ?? 0) - (samples[start + index + lag] ?? 0);
      difference += delta * delta;
    }
    running += difference;
    normalized[lag] = running > 0 ? (difference * lag) / running : 1;
    if (lag >= minimumLag && lag <= maximumLag && normalized[lag]! < bestValue) {
      bestValue = normalized[lag]!;
      bestLag = lag;
    }
  }
  let selected = -1;
  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    if (normalized[lag]! < 0.2) {
      selected = lag;
      while (selected + 1 <= maximumLag && normalized[selected + 1]! < normalized[selected]!) selected++;
      break;
    }
  }
  if (selected < 0) selected = bestValue < 0.45 ? bestLag : -1;
  if (selected < 0) return null;
  const left = normalized[selected - 1] ?? normalized[selected]!;
  const center = normalized[selected]!;
  const right = normalized[selected + 1] ?? center;
  const denominator = left - 2 * center + right;
  const refined = Math.abs(denominator) > 1e-12
    ? selected + 0.5 * (left - right) / denominator
    : selected;
  const pitchHz = sampleRate / refined;
  const confidence = Math.max(0, Math.min(1, 1 - center));
  return Number.isFinite(pitchHz) ? { pitchHz, confidence } : null;
}

function consecutiveEnergyFrame(
  frames: readonly FrameObservation[],
  threshold: number,
  fromEnd: boolean,
): FrameObservation | null {
  if (frames.length < 2) return null;
  if (fromEnd) {
    for (let index = frames.length - 1; index >= 1; index -= 1) {
      if (frames[index]!.rms >= threshold && frames[index - 1]!.rms >= threshold) return frames[index]!;
    }
    return null;
  }
  for (let index = 0; index < frames.length - 1; index += 1) {
    if (frames[index]!.rms >= threshold && frames[index + 1]!.rms >= threshold) return frames[index]!;
  }
  return null;
}

function downsampleContour(points: PitchContourPoint[], maximum = 64): PitchContourPoint[] {
  if (points.length <= maximum) return points;
  const output: PitchContourPoint[] = [];
  for (let index = 0; index < maximum; index += 1) {
    output.push(points[Math.round((index * (points.length - 1)) / (maximum - 1))]!);
  }
  return output;
}

function vibratoMetrics(
  points: readonly FrameObservation[],
  startSeconds: number,
  endSeconds: number,
): { depthCents: number | null; rateHz: number | null; regularity: number | null; samples: number } {
  const selected = points.filter((point) =>
    point.timeSeconds >= startSeconds && point.timeSeconds <= endSeconds && point.cents !== null);
  if (selected.length < 8) return { depthCents: null, rateHz: null, regularity: null, samples: selected.length };
  const firstTime = selected[0]!.timeSeconds;
  const times = selected.map((point) => point.timeSeconds - firstTime);
  const values = selected.map((point) => point.cents!);
  const averageTime = mean(times)!;
  const averageValue = mean(values)!;
  const variance = times.reduce((sum, value) => sum + (value - averageTime) ** 2, 0);
  const slope = variance > 0
    ? times.reduce((sum, value, index) =>
        sum + (value - averageTime) * (values[index]! - averageValue), 0) / variance
    : 0;
  const detrended = values.map((value, index) => value - (averageValue + slope * (times[index]! - averageTime)));
  const low = quantile(detrended, 0.05);
  const high = quantile(detrended, 0.95);
  const depthCents = low !== null && high !== null ? (high - low) / 2 : null;
  const crossings: number[] = [];
  for (let index = 1; index < detrended.length; index += 1) {
    if (detrended[index - 1]! <= 0 && detrended[index]! > 0) {
      const time = selected[index]!.timeSeconds;
      if (crossings.length === 0 || time - crossings.at(-1)! >= 0.08) crossings.push(time);
    }
  }
  const intervals = crossings.slice(1).map((time, index) => time - crossings[index]!);
  const medianInterval = median(intervals);
  const rateHz = medianInterval !== null && medianInterval > 0 ? 1 / medianInterval : null;
  const intervalDeviation = standardDeviation(intervals);
  const regularity = medianInterval !== null && intervalDeviation !== null
    ? Math.max(0, 1 - intervalDeviation / medianInterval)
    : null;
  return {
    depthCents: depthCents === null ? null : round(depthCents, 2),
    rateHz: rateHz === null ? null : round(rateHz, 3),
    regularity: regularity === null ? null : round(regularity, 3),
    samples: selected.length,
  };
}

function analyzeExpectedEvent(
  manifest: SongManifest,
  event: ManifestExpectedVocalEvent,
  previous: ManifestExpectedVocalEvent | undefined,
  samples: Float32Array,
  sampleRate: number,
  audioDuration: number,
  options: AnalyzeVocalStemOptions,
): { analysis: Record<string, unknown>; issues: VocalAnalysisIssue[] } {
  const startTick = musicalPositionToTick(manifest.time_signatures, event.position);
  const endTick = startTick + event.duration;
  const expectedStart = songTickSeconds(manifest, startTick) + options.timelineOffsetSeconds;
  const expectedEnd = songTickSeconds(manifest, endTick) + options.timelineOffsetSeconds;
  const expectedDuration = expectedEnd - expectedStart;
  const targetHz = midiFrequency(event.noteNumber);
  const windowStart = Math.max(0, expectedStart - 0.16);
  const windowEnd = Math.min(audioDuration, expectedEnd + 0.2);
  const frameLength = Math.max(128, Math.round(sampleRate * 0.04));
  const hop = Math.max(16, Math.round(sampleRate * 0.01));
  const firstSample = Math.max(0, Math.floor(windowStart * sampleRate));
  const finalSample = Math.min(samples.length - frameLength, Math.ceil(windowEnd * sampleRate));
  const frames: FrameObservation[] = [];
  for (let sampleStart = firstSample; sampleStart <= finalSample; sampleStart += hop) {
    frames.push({
      timeSeconds: (sampleStart + frameLength / 2) / sampleRate,
      sampleStart,
      rms: frameRms(samples, sampleStart, frameLength),
      pitchHz: null,
      confidence: null,
      cents: null,
    });
  }
  const peakRms = Math.max(0, ...frames.map((frame) => frame.rms));
  const preRms = frames.filter((frame) => frame.timeSeconds < expectedStart - 0.02).map((frame) => frame.rms);
  const noiseRms = median(preRms) ?? 0;
  const energyThreshold = Math.max(0.000_5, noiseRms * 3, peakRms * 0.08);
  const pitchMinimum = Math.max(options.minimumPitchHz, targetHz / 2.5);
  const pitchMaximum = Math.min(options.maximumPitchHz, targetHz * 2.5);
  for (const frame of frames) {
    if (frame.rms < energyThreshold) continue;
    const pitch = yinPitch(
      samples,
      frame.sampleStart,
      frameLength,
      sampleRate,
      pitchMinimum,
      pitchMaximum,
    );
    if (!pitch) continue;
    frame.pitchHz = pitch.pitchHz;
    frame.confidence = pitch.confidence;
    frame.cents = 1200 * Math.log2(pitch.pitchHz / targetHz);
  }

  const energyOnset = consecutiveEnergyFrame(frames, energyThreshold, false);
  const energyOffset = consecutiveEnergyFrame(frames, energyThreshold, true);
  const voicedOnset = frames.find((frame) =>
    frame.timeSeconds >= expectedStart - 0.08
      && frame.confidence !== null && frame.confidence >= 0.65
      && frame.cents !== null && Math.abs(frame.cents) <= 200) ?? null;
  const guard = Math.min(0.06, Math.max(0.015, expectedDuration * 0.15));
  const stableFrames = frames.filter((frame) =>
    frame.timeSeconds >= expectedStart + guard && frame.timeSeconds <= expectedEnd - guard);
  const confidentFrames = stableFrames.filter((frame) =>
    frame.confidence !== null && frame.confidence >= 0.65 && frame.cents !== null && frame.pitchHz !== null);
  const cents = confidentFrames.map((frame) => frame.cents!);
  const absoluteCents = cents.map(Math.abs);
  const pitchHz = confidentFrames.map((frame) => frame.pitchHz!);
  const medianCents = median(cents);
  const medianPitch = median(pitchHz);
  const pitchP95 = quantile(absoluteCents, 0.95);
  const previousEnd = previous
    ? songTickSeconds(
        manifest,
        musicalPositionToTick(manifest.time_signatures, previous.position) + previous.duration,
      ) + options.timelineOffsetSeconds
    : null;
  const boundaryContinuous = previousEnd !== null && expectedStart - previousEnd < 0.08
    && energyOnset !== null && energyOnset.timeSeconds < expectedStart - 0.1;
  const onsetDeviationMs = energyOnset ? (energyOnset.timeSeconds - expectedStart) * 1000 : null;
  const voicedOnsetDeviationMs = voicedOnset ? (voicedOnset.timeSeconds - expectedStart) * 1000 : null;
  const offsetDeviationMs = energyOffset ? (energyOffset.timeSeconds - expectedEnd) * 1000 : null;
  const consonantLeadMs = energyOnset && voicedOnset
    ? (voicedOnset.timeSeconds - energyOnset.timeSeconds) * 1000
    : null;
  const vibratoStart = event.vibrato && event.vibrato.length > 0
    ? expectedEnd - expectedDuration * (event.vibrato.length / 100)
    : expectedStart + expectedDuration * 0.4;
  const vibrato = vibratoMetrics(confidentFrames, vibratoStart, expectedEnd - 0.02);
  const contour = downsampleContour(confidentFrames.map((frame) => ({
    timeSeconds: round(frame.timeSeconds),
    pitchHz: round(frame.pitchHz!, 3),
    centsFromTarget: round(frame.cents!, 2),
    confidence: round(frame.confidence!, 4),
    rmsDbfs: decibels(frame.rms) === null ? null : round(decibels(frame.rms)!, 2),
  })));
  const issues: VocalAnalysisIssue[] = [];
  const addIssue = (
    severity: VocalAnalysisIssue["severity"],
    code: string,
    message: string,
    recommendation: string,
  ): void => {
    issues.push({ severity, code, eventIds: [event.id], message, recommendation });
  };
  const voicedRatio = stableFrames.length > 0 ? confidentFrames.length / stableFrames.length : 0;
  if (expectedDuration < 0.12) {
    addIssue(
      "info",
      "rapid-note-limited-resolution",
      `Note ${event.id} lasts ${Math.round(expectedDuration * 1000)} ms; isolated F0/timing estimates have limited resolution`,
      "Judge this event with its phrase contour and neighboring syllables, not as a standalone sustained note",
    );
  }
  if (voicedRatio < 0.3) {
    addIssue(
      "warning",
      "low-voiced-ratio",
      `Only ${(voicedRatio * 100).toFixed(1)}% of stable frames produced confident F0`,
      "Inspect phonemes, consonant duration, note length, dynamics, and stem isolation before changing pitch curves",
    );
  }
  if (medianCents !== null && Math.abs(medianCents) > options.pitchToleranceCents) {
    addIssue(
      Math.abs(medianCents) > options.pitchToleranceCents * 2 ? "error" : "warning",
      "pitch-center-deviation",
      `Median pitch center is ${medianCents >= 0 ? "+" : ""}${medianCents.toFixed(1)} cents from MIDI ${event.noteNumber}`,
      "Inspect the contour for intentional scoop/portamento; revise PIT/PBS or note pitch only if the sustained center is unintended",
    );
  }
  if (!boundaryContinuous && onsetDeviationMs !== null
    && Math.abs(onsetDeviationMs) > options.onsetToleranceMilliseconds) {
    addIssue(
      "warning",
      onsetDeviationMs > 0 ? "late-energy-onset" : "early-energy-onset",
      `Energy onset differs from score by ${onsetDeviationMs.toFixed(1)} ms`,
      "Check consonant timing, preceding rest, VEL, and note position; apply a timing edit only after separating systematic export offset",
    );
  }
  if (offsetDeviationMs !== null && Math.abs(offsetDeviationMs) > options.offsetToleranceMilliseconds) {
    addIssue(
      "warning",
      offsetDeviationMs > 0 ? "long-release" : "short-release",
      `Detected energy offset differs from score by ${offsetDeviationMs.toFixed(1)} ms`,
      "Check gate length, following note continuity, vibrato tail, and send/release before revising note duration",
    );
  }
  return {
    analysis: {
      eventId: event.id,
      source: event.source,
      trackId: event.trackId,
      partId: event.partId,
      sectionId: event.sectionId ?? null,
      phraseId: event.phraseId ?? null,
      lyric: event.lyric,
      phonemes: event.phonemes,
      noteNumber: event.noteNumber,
      targetHz: round(targetHz, 3),
      expected: {
        position: event.position,
        durationTicks: event.duration,
        startSeconds: round(expectedStart),
        endSeconds: round(expectedEnd),
        durationSeconds: round(expectedDuration),
        vibratoType: event.vibrato?.type ?? 0,
        vibratoLengthPercent: event.vibrato?.length ?? 0,
      },
      observed: {
        energyThresholdDbfs: decibels(energyThreshold) === null ? null : round(decibels(energyThreshold)!, 2),
        energyOnsetSeconds: energyOnset ? round(energyOnset.timeSeconds) : null,
        voicedOnsetSeconds: voicedOnset ? round(voicedOnset.timeSeconds) : null,
        energyOffsetSeconds: energyOffset ? round(energyOffset.timeSeconds) : null,
        energyOnsetDeviationMs: onsetDeviationMs === null ? null : round(onsetDeviationMs, 2),
        voicedOnsetDeviationMs: voicedOnsetDeviationMs === null ? null : round(voicedOnsetDeviationMs, 2),
        offsetDeviationMs: offsetDeviationMs === null ? null : round(offsetDeviationMs, 2),
        consonantLeadMs: consonantLeadMs === null ? null : round(consonantLeadMs, 2),
        boundaryContinuous,
        medianPitchHz: medianPitch === null ? null : round(medianPitch, 3),
        medianCentsError: medianCents === null ? null : round(medianCents, 2),
        meanCentsError: mean(cents) === null ? null : round(mean(cents)!, 2),
        pitchStdDevCents: standardDeviation(cents) === null ? null : round(standardDeviation(cents)!, 2),
        p95AbsoluteCentsError: pitchP95 === null ? null : round(pitchP95, 2),
        medianPitchConfidence: median(confidentFrames.map((frame) => frame.confidence!)) === null
          ? null
          : round(median(confidentFrames.map((frame) => frame.confidence!))!, 4),
        voicedRatio: round(voicedRatio, 4),
        pitchFrames: confidentFrames.length,
        vibrato,
      },
      pitchContour: contour,
      issueCodes: issues.map((issue) => issue.code),
    },
    issues,
  };
}

function phraseSummaries(eventAnalyses: Array<Record<string, unknown>>) {
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const event of eventAnalyses) {
    const phraseId = typeof event.phraseId === "string" ? event.phraseId : null;
    const partId = String(event.partId);
    const groupId = phraseId ?? partId;
    const group = groups.get(groupId) ?? [];
    group.push(event);
    groups.set(groupId, group);
  }
  return [...groups.entries()].map(([groupId, events]) => {
    const first = events[0]!;
    const last = events.at(-1)!;
    const firstExpected = first.expected as Record<string, number>;
    const lastExpected = last.expected as Record<string, number>;
    const observations = events.map((event) => event.observed as Record<string, number | null | boolean>);
    const onsets = observations.map((observed) => observed.energyOnsetSeconds)
      .filter((value): value is number => typeof value === "number");
    const offsets = observations.map((observed) => observed.energyOffsetSeconds)
      .filter((value): value is number => typeof value === "number");
    const cents = observations.map((observed) => observed.medianCentsError)
      .filter((value): value is number => typeof value === "number");
    const voicedRatios = observations.map((observed) => observed.voicedRatio)
      .filter((value): value is number => typeof value === "number");
    return {
      groupId,
      groupType: typeof first.phraseId === "string" ? "phrase" : "part",
      partId: first.partId,
      sectionId: first.sectionId,
      eventIds: events.map((event) => event.eventId),
      notes: events.length,
      plannedStartSeconds: firstExpected.startSeconds,
      plannedEndSeconds: lastExpected.endSeconds,
      observedStartSeconds: onsets.length > 0 ? Math.min(...onsets) : null,
      observedEndSeconds: offsets.length > 0 ? Math.max(...offsets) : null,
      startDeviationMs: onsets.length > 0
        ? round((Math.min(...onsets) - firstExpected.startSeconds!) * 1000, 2)
        : null,
      endDeviationMs: offsets.length > 0
        ? round((Math.max(...offsets) - lastExpected.endSeconds!) * 1000, 2)
        : null,
      medianAbsolutePitchCenterCents: median(cents.map(Math.abs)) === null
        ? null
        : round(median(cents.map(Math.abs))!, 2),
      meanVoicedRatio: mean(voicedRatios) === null ? null : round(mean(voicedRatios)!, 4),
    };
  });
}

function artifactId(trackId: string, revision: number): string {
  const prefix = "vocal-analysis";
  const suffix = `-r${revision}`;
  const available = 96 - prefix.length - suffix.length - 2;
  return `${prefix}-${trackId.slice(0, Math.max(1, available))}${suffix}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function analyzeSongManifestVocalStem(options: AnalyzeVocalStemOptions) {
  const loaded = await loadSongManifest(options.manifestPath);
  const manifest = loaded.manifest;
  if (manifest.revision !== options.expectedRevision) {
    throw new Error(`Stale manifest revision ${options.expectedRevision}; current revision is ${manifest.revision}`);
  }
  const stem = manifest.artifacts.find((artifact) => artifact.id === options.stemArtifactId);
  if (!stem || stem.role !== "vocal_stem") {
    throw new Error(`No vocal_stem artifact with stable ID ${options.stemArtifactId}`);
  }
  if (stem.source_composition_hash !== manifest.composition_hash) {
    throw new Error(
      `Vocal stem ${stem.id} belongs to composition ${stem.source_composition_hash}, `
      + `but current composition is ${manifest.composition_hash}; render a new stem first`,
    );
  }
  const trackId = typeof stem.metadata.track_id === "string" ? stem.metadata.track_id : null;
  if (!trackId) throw new Error(`Vocal stem ${stem.id} has no track_id provenance`);
  if (options.sectionId && !manifest.sections.some((section) => section.id === options.sectionId)) {
    throw new Error(`Manifest has no section ${options.sectionId}`);
  }
  const sourcePath = await resolveReadablePath(stem.path);
  const sourceDigest = await fileSha256(sourcePath);
  if (sourceDigest.sha256 !== stem.sha256 || sourceDigest.bytes !== stem.bytes) {
    throw new Error(`Vocal stem ${stem.id} no longer matches its recorded SHA-256/size`);
  }
  let events = manifestExpectedVocalEvents(manifest, trackId);
  const requestedIds = options.eventIds ? new Set(options.eventIds) : null;
  if (requestedIds && requestedIds.size !== options.eventIds?.length) {
    throw new Error("eventIds contains duplicates");
  }
  if (requestedIds) for (const id of requestedIds) {
    if (!events.some((event) => event.id === id)) throw new Error(`Vocal track ${trackId} has no event ${id}`);
  }
  if (options.sectionId) events = events.filter((event) => event.sectionId === options.sectionId);
  if (requestedIds) events = events.filter((event) => requestedIds.has(event.id));
  if (events.length === 0) throw new Error("Analysis scope selected zero vocal events");
  if (events.length > 5000) throw new Error(`Analysis scope has ${events.length} events; maximum is 5000`);

  const outputPath = await resolveWritablePath(options.outputPath);
  if (extname(outputPath).toLowerCase() !== ".json" || !outputPath.endsWith(".vocal-analysis.json")) {
    throw new Error("outputPath must end in .vocal-analysis.json");
  }
  if (await exists(outputPath)) throw new Error(`Analysis output already exists: ${outputPath}`);
  const wav = await analyzeWav(sourcePath);
  const decoded = await decodeWavMono(sourcePath, 8_000, 900);
  const analyses: Array<Record<string, unknown>> = [];
  const issues: VocalAnalysisIssue[] = [];
  const allTrackEvents = manifestExpectedVocalEvents(manifest, trackId);
  for (const event of events) {
    const index = allTrackEvents.findIndex((candidate) => candidate.id === event.id);
    const result = analyzeExpectedEvent(
      manifest,
      event,
      index > 0 ? allTrackEvents[index - 1] : undefined,
      decoded.samples,
      decoded.sampleRate,
      decoded.durationSeconds,
      options,
    );
    analyses.push(result.analysis);
    issues.push(...result.issues);
  }
  const observed = analyses.map((event) => event.observed as Record<string, number | null | boolean>);
  const pitchCenters = observed.map((entry) => entry.medianCentsError)
    .filter((value): value is number => typeof value === "number");
  const voicedRatios = observed.map((entry) => entry.voicedRatio)
    .filter((value): value is number => typeof value === "number");
  const unconnectedOnsetDeviations = observed
    .filter((entry) => entry.boundaryContinuous !== true)
    .map((entry) => entry.energyOnsetDeviationMs)
    .filter((value): value is number => typeof value === "number");
  const issueCounts = { info: 0, warning: 0, error: 0 };
  for (const issue of issues) issueCounts[issue.severity]++;
  const document = {
    schema: "vocaloid-score-render-analysis/v1",
    createdAt: new Date().toISOString(),
    sourceManifest: loaded.path,
    sourceManifestRevision: manifest.revision,
    sourceCompositionHash: manifest.composition_hash,
    sourceStemArtifact: stem.id,
    sourceStemPath: sourcePath,
    sourceStemSha256: sourceDigest.sha256,
    vocalTrackId: trackId,
    scope: {
      sectionId: options.sectionId ?? null,
      requestedEventIds: options.eventIds ?? [],
      analyzedEvents: events.length,
    },
    alignment: {
      preMeasureSeconds: round(preMeasureSeconds(manifest)),
      timelineOffsetSeconds: options.timelineOffsetSeconds,
      estimatedGlobalEnergyOffsetMilliseconds: median(unconnectedOnsetDeviations) === null
        ? null
        : round(median(unconnectedOnsetDeviations)!, 2),
      note: "The estimated offset is observational; consonants and phrasing also affect energy onset. Re-run with an explicit timelineOffsetSeconds only when a systematic export offset is evidenced.",
    },
    audio: {
      durationSeconds: wav.durationSeconds,
      sampleRate: wav.sampleRate,
      channels: wav.channels,
      peakDbfs: wav.peakDbfs,
      rmsDbfs: wav.rmsDbfs,
      clippedSampleValues: wav.clippedSampleValues,
      analysisSampleRate: decoded.sampleRate,
    },
    tolerances: {
      pitchCents: options.pitchToleranceCents,
      onsetMilliseconds: options.onsetToleranceMilliseconds,
      offsetMilliseconds: options.offsetToleranceMilliseconds,
      pitchRangeHz: [options.minimumPitchHz, options.maximumPitchHz],
    },
    summary: {
      events: events.length,
      eventsWithPitch: pitchCenters.length,
      medianAbsolutePitchCenterCents: median(pitchCenters.map(Math.abs)) === null
        ? null
        : round(median(pitchCenters.map(Math.abs))!, 2),
      p95AbsolutePitchCenterCents: quantile(pitchCenters.map(Math.abs), 0.95) === null
        ? null
        : round(quantile(pitchCenters.map(Math.abs), 0.95)!, 2),
      meanVoicedRatio: mean(voicedRatios) === null ? null : round(mean(voicedRatios)!, 4),
      issueCounts,
    },
    phrases: phraseSummaries(analyses),
    events: analyses,
    issues,
  };
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  const temporary = join(dirname(outputPath), `.${basename(outputPath)}.tmp-${process.pid}-${Date.now()}`);
  try {
    await writeFile(temporary, serialized, { encoding: "utf8", flag: "wx" });
    await rename(temporary, outputPath);
    const digest = await fileSha256(outputPath);
    const artifact: ManifestArtifact = {
      id: artifactId(trackId, manifest.revision),
      role: "analysis",
      path: outputPath,
      ...digest,
      source_revision: manifest.revision,
      source_composition_hash: manifest.composition_hash,
      dependencies: [stem.id, trackId],
      metadata: {
        analysis_type: "score-vs-render-vocal",
        stem_artifact: stem.id,
        track_id: trackId,
        events: events.length,
        pitch_tolerance_cents: options.pitchToleranceCents,
        onset_tolerance_ms: options.onsetToleranceMilliseconds,
        offset_tolerance_ms: options.offsetToleranceMilliseconds,
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
      ...document,
      outputPath,
      outputSha256: digest.sha256,
      artifact,
      manifestRevision: mutation.write.revision,
      manifestContentHash: mutation.write.contentHash,
    };
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    await unlink(outputPath).catch(() => undefined);
    throw error;
  }
}
