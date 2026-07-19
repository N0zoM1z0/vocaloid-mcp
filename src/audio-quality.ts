import { execFile } from "node:child_process";
import { access, copyFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";

import { resolveReadablePath, resolveWritablePath } from "./paths.js";
import { analyzeWav, type WavAnalysis } from "./wav.js";


const execFileAsync = promisify(execFile);
const DEFAULT_FFMPEG = "/usr/bin/ffmpeg";

export interface LoudnessMetrics {
  integratedLufs: number;
  loudnessRangeLu: number;
  truePeakDbfs: number;
}

export interface AudioQualityAnalysis extends WavAnalysis, LoudnessMetrics {
  targetLufs: number;
  targetTruePeakDbfs: number;
  loudnessDeltaLu: number;
  sampleClipping: boolean;
  truePeakExceeded: boolean;
  channelImbalance: boolean;
  recommendations: string[];
}

export interface MasterWavOptions {
  inputPath: string;
  outputPath: string;
  targetLufs: number;
  targetTruePeakDbfs: number;
  targetLoudnessRangeLu: number;
  overwrite: boolean;
}

export interface MasterWavResult {
  inputPath: string;
  outputPath: string;
  backupPath?: string;
  sourceClipped: boolean;
  source: AudioQualityAnalysis;
  output: AudioQualityAnalysis;
  targetLoudnessRangeLu: number;
  loudnessRangeDeltaLu: number;
  loudnessRangeTargetMet: boolean;
  requestedLoudnessGainLu: number;
  peakSafeGainDb: number;
  peakReductionRequiredDb: number;
  loudnessRangeChangeLu: number;
  transparencyReviewRecommended: boolean;
  truePeakCorrectionDb: number;
  measuredByLoudnorm: {
    inputLufs: number;
    inputTruePeakDbfs: number;
    inputLoudnessRangeLu: number;
    inputThresholdLufs: number;
    targetOffsetLu: number;
  };
}

interface LoudnormMeasurement {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function finiteMetric(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`FFmpeg returned invalid ${name}: ${value}`);
  return parsed;
}

function parseEbur128(stderr: string): LoudnessMetrics {
  const summaryIndex = stderr.lastIndexOf("Summary:");
  const summary = summaryIndex >= 0 ? stderr.slice(summaryIndex) : stderr;
  const integrated = summary.match(/Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+)\s+LUFS/u)?.[1];
  const range = summary.match(/Loudness range:\s*\n\s*LRA:\s*(-?[\d.]+)\s+LU/u)?.[1];
  const peak = summary.match(/True peak:\s*\n\s*Peak:\s*(-?[\d.]+)\s+dBFS/u)?.[1];
  if (integrated === undefined || range === undefined || peak === undefined) {
    throw new Error("Could not parse FFmpeg EBU R128 summary; verify that ffmpeg has the ebur128 filter");
  }
  return {
    integratedLufs: finiteMetric(integrated, "integrated loudness"),
    loudnessRangeLu: finiteMetric(range, "loudness range"),
    truePeakDbfs: finiteMetric(peak, "true peak"),
  };
}

function recommendations(
  wav: WavAnalysis,
  loudness: LoudnessMetrics,
  targetLufs: number,
  targetTruePeakDbfs: number,
): string[] {
  const output: string[] = [];
  if (wav.clippedSampleValues > 0) {
    output.push(
      `Source contains ${wav.clippedSampleValues} full-scale sample values; lower track/backing levels and re-render before mastering because post-processing cannot restore clipped transients.`,
    );
  }
  if (wav.stereoBalanceDb !== null && Math.abs(wav.stereoBalanceDb) > 3) {
    const louder = wav.stereoBalanceDb > 0 ? "left" : "right";
    output.push(
      `Stereo RMS balance is ${Math.abs(wav.stereoBalanceDb).toFixed(2)} dB toward the ${louder} channel; inspect intentional panning and VOCALOID mixer routing (pan 0=hard left, 64=center, 127=hard right) before mastering.`,
    );
  }
  if (loudness.truePeakDbfs > targetTruePeakDbfs) {
    output.push(
      `True peak is ${loudness.truePeakDbfs.toFixed(2)} dBFS; reduce gain or use a true-peak limiter to stay at or below ${targetTruePeakDbfs.toFixed(2)} dBFS.`,
    );
  }
  const delta = targetLufs - loudness.integratedLufs;
  if (Math.abs(delta) > 0.5) {
    output.push(
      `Integrated loudness is ${loudness.integratedLufs.toFixed(2)} LUFS; apply approximately ${delta.toFixed(2)} LU toward the ${targetLufs.toFixed(2)} LUFS target.`,
    );
  }
  if (loudness.loudnessRangeLu > 14) {
    output.push(
      `Loudness range is ${loudness.loudnessRangeLu.toFixed(2)} LU; inspect section balance or gentle bus compression before limiting.`,
    );
  }
  if (output.length === 0) output.push("No clipping, loudness, or true-peak correction is required for the requested targets.");
  return output;
}

async function ffmpegPath(): Promise<string> {
  const path = process.env.FFMPEG_PATH ?? DEFAULT_FFMPEG;
  if (!(await exists(path))) throw new Error(`FFmpeg is unavailable: ${path}`);
  return path;
}

export async function analyzeAudioQuality(
  inputPath: string,
  targetLufs: number,
  targetTruePeakDbfs: number,
): Promise<AudioQualityAnalysis> {
  const source = await resolveReadablePath(inputPath);
  if (extname(source).toLowerCase() !== ".wav") throw new Error(`Expected a .wav input: ${source}`);
  const [wav, ffmpeg] = await Promise.all([analyzeWav(source), ffmpegPath()]);
  let stderr: string;
  try {
    const result = await execFileAsync(
      ffmpeg,
      ["-hide_banner", "-nostats", "-i", source, "-filter_complex", "ebur128=peak=true", "-f", "null", "-"],
      { timeout: 300_000, maxBuffer: 8 * 1024 * 1024 },
    );
    stderr = result.stderr;
  } catch (error) {
    if (typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string") {
      stderr = error.stderr;
    } else {
      throw error;
    }
  }
  const loudness = parseEbur128(stderr);
  return {
    ...wav,
    ...loudness,
    targetLufs,
    targetTruePeakDbfs,
    loudnessDeltaLu: targetLufs - loudness.integratedLufs,
    sampleClipping: wav.clippedSampleValues > 0,
    truePeakExceeded: loudness.truePeakDbfs > targetTruePeakDbfs,
    channelImbalance: wav.stereoBalanceDb !== null && Math.abs(wav.stereoBalanceDb) > 3,
    recommendations: recommendations(wav, loudness, targetLufs, targetTruePeakDbfs),
  };
}

function parseLoudnorm(stderr: string): LoudnormMeasurement {
  const matches = [...stderr.matchAll(/\{[\s\S]*?"target_offset"\s*:\s*"[^"]+"[\s\S]*?\}/gu)];
  const raw = matches.at(-1)?.[0];
  if (!raw) throw new Error("Could not parse FFmpeg loudnorm measurement JSON");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("FFmpeg loudnorm measurement is not an object");
  }
  const candidate = parsed as Partial<LoudnormMeasurement>;
  for (const key of ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"] as const) {
    if (typeof candidate[key] !== "string") throw new Error(`FFmpeg loudnorm result is missing ${key}`);
  }
  return candidate as LoudnormMeasurement;
}

export async function masterWav(options: MasterWavOptions): Promise<MasterWavResult> {
  if (!Number.isFinite(options.targetLufs) || options.targetLufs < -24 || options.targetLufs > -5) {
    throw new Error(`targetLufs must be in -24..-5, got ${options.targetLufs}`);
  }
  if (
    !Number.isFinite(options.targetTruePeakDbfs)
    || options.targetTruePeakDbfs < -6
    || options.targetTruePeakDbfs > -0.1
  ) {
    throw new Error(`targetTruePeakDbfs must be in -6..-0.1, got ${options.targetTruePeakDbfs}`);
  }
  if (
    !Number.isFinite(options.targetLoudnessRangeLu)
    || options.targetLoudnessRangeLu < 1
    || options.targetLoudnessRangeLu > 20
  ) {
    throw new Error(`targetLoudnessRangeLu must be in 1..20, got ${options.targetLoudnessRangeLu}`);
  }
  const inputPath = await resolveReadablePath(options.inputPath);
  const outputPath = await resolveWritablePath(options.outputPath);
  if (extname(inputPath).toLowerCase() !== ".wav" || extname(outputPath).toLowerCase() !== ".wav") {
    throw new Error("inputPath and outputPath must both end in .wav");
  }
  if (inputPath === outputPath) throw new Error("Mastering requires a distinct outputPath to preserve the source");
  const outputExists = await exists(outputPath);
  if (outputExists && !options.overwrite) {
    throw new Error(`Output already exists: ${outputPath}. Set overwrite=true to replace it.`);
  }
  const source = await analyzeAudioQuality(inputPath, options.targetLufs, options.targetTruePeakDbfs);
  const requestedLoudnessGainLu = options.targetLufs - source.integratedLufs;
  const peakSafeGainDb = options.targetTruePeakDbfs - source.truePeakDbfs;
  const peakReductionRequiredDb = Math.max(0, requestedLoudnessGainLu - peakSafeGainDb);
  const ffmpeg = await ffmpegPath();
  const baseFilter = [
    `I=${options.targetLufs}`,
    `LRA=${options.targetLoudnessRangeLu}`,
    `TP=${options.targetTruePeakDbfs}`,
  ].join(":");
  let firstPassStderr = "";
  try {
    const result = await execFileAsync(
      ffmpeg,
      [
        "-hide_banner", "-nostats", "-i", inputPath,
        "-af", `loudnorm=${baseFilter}:print_format=json`,
        "-f", "null", "-",
      ],
      { timeout: 300_000, maxBuffer: 8 * 1024 * 1024 },
    );
    firstPassStderr = result.stderr;
  } catch (error) {
    if (typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string") {
      firstPassStderr = error.stderr;
    } else {
      throw error;
    }
  }
  const measured = parseLoudnorm(firstPassStderr);
  const measuredValues = {
    inputLufs: finiteMetric(measured.input_i, "loudnorm input_i"),
    inputTruePeakDbfs: finiteMetric(measured.input_tp, "loudnorm input_tp"),
    inputLoudnessRangeLu: finiteMetric(measured.input_lra, "loudnorm input_lra"),
    inputThresholdLufs: finiteMetric(measured.input_thresh, "loudnorm input_thresh"),
    targetOffsetLu: finiteMetric(measured.target_offset, "loudnorm target_offset"),
  };
  const secondFilter = [
    baseFilter,
    `measured_I=${measuredValues.inputLufs}`,
    `measured_LRA=${measuredValues.inputLoudnessRangeLu}`,
    `measured_TP=${measuredValues.inputTruePeakDbfs}`,
    `measured_thresh=${measuredValues.inputThresholdLufs}`,
    `offset=${measuredValues.targetOffsetLu}`,
    "linear=true",
    "print_format=summary",
  ].join(":");
  const temporary = join(
    dirname(outputPath),
    `.${basename(outputPath)}.master-${process.pid}-${Date.now()}.wav`,
  );
  let correctionTemporary: string | null = null;
  try {
    await execFileAsync(
      ffmpeg,
      [
        "-hide_banner", "-nostats", "-y", "-i", inputPath,
        "-af", `loudnorm=${secondFilter}`,
        "-ar", String(source.sampleRate),
        "-ac", String(source.channels),
        "-c:a", "pcm_s16le",
        temporary,
      ],
      { timeout: 300_000, maxBuffer: 8 * 1024 * 1024 },
    );
    let output = await analyzeAudioQuality(
      temporary,
      options.targetLufs,
      options.targetTruePeakDbfs,
    );
    let truePeakCorrectionDb = 0;
    if (output.truePeakDbfs > options.targetTruePeakDbfs) {
      truePeakCorrectionDb = options.targetTruePeakDbfs - output.truePeakDbfs - 0.05;
      correctionTemporary = `${temporary}.true-peak.wav`;
      await execFileAsync(
        ffmpeg,
        [
          "-hide_banner", "-nostats", "-y", "-i", temporary,
          "-af", `volume=${truePeakCorrectionDb.toFixed(3)}dB`,
          "-ar", String(source.sampleRate),
          "-ac", String(source.channels),
          "-c:a", "pcm_s16le",
          correctionTemporary,
        ],
        { timeout: 300_000, maxBuffer: 8 * 1024 * 1024 },
      );
      await unlink(temporary);
      await rename(correctionTemporary, temporary);
      correctionTemporary = null;
      output = await analyzeAudioQuality(
        temporary,
        options.targetLufs,
        options.targetTruePeakDbfs,
      );
    }
    if (Math.abs(output.integratedLufs - options.targetLufs) > 0.6) {
      throw new Error(
        `Master output missed loudness target: ${output.integratedLufs} LUFS vs ${options.targetLufs} LUFS`,
      );
    }
    if (output.truePeakDbfs > options.targetTruePeakDbfs + 0.05) {
      throw new Error(
        `Master output exceeded true-peak target: ${output.truePeakDbfs} dBFS vs ${options.targetTruePeakDbfs} dBFS`,
      );
    }
    let backupPath: string | undefined;
    if (outputExists) {
      backupPath = `${outputPath}.bak-${new Date().toISOString().replaceAll(":", "-")}`;
      await copyFile(outputPath, backupPath);
    }
    await rename(temporary, outputPath);
    const loudnessRangeChangeLu = output.loudnessRangeLu - source.loudnessRangeLu;
    const transparencyReviewRecommended = peakReductionRequiredDb > 1.5
      || Math.abs(loudnessRangeChangeLu) > 1.5;
    return {
      inputPath,
      outputPath,
      ...(backupPath ? { backupPath } : {}),
      sourceClipped: source.sampleClipping,
      source,
      output: { ...output, path: outputPath },
      targetLoudnessRangeLu: options.targetLoudnessRangeLu,
      loudnessRangeDeltaLu: output.loudnessRangeLu - options.targetLoudnessRangeLu,
      loudnessRangeTargetMet:
        Math.abs(output.loudnessRangeLu - options.targetLoudnessRangeLu) <= 1.5,
      requestedLoudnessGainLu,
      peakSafeGainDb,
      peakReductionRequiredDb,
      loudnessRangeChangeLu,
      transparencyReviewRecommended,
      truePeakCorrectionDb,
      measuredByLoudnorm: measuredValues,
    };
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if (correctionTemporary) await unlink(correctionTemporary).catch(() => undefined);
    throw error;
  }
}
