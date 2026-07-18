import { spawn } from "node:child_process";
import { open } from "node:fs/promises";


export interface WavAnalysis {
  path: string;
  bytes: number;
  audioFormat: "pcm" | "ieee_float";
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
  dataBytes: number;
  durationSeconds: number;
  sampleValues: number;
  peak: number;
  peakDbfs: number | null;
  rms: number;
  rmsDbfs: number | null;
  crestFactorDb: number | null;
  clippedSampleValues: number;
  clippedRatio: number;
  channelStats: WavChannelAnalysis[];
  stereoBalanceDb: number | null;
  channelRmsSpreadDb: number | null;
  silent: boolean;
}

export interface WavChannelAnalysis {
  channel: number;
  peak: number;
  peakDbfs: number | null;
  rms: number;
  rmsDbfs: number | null;
  clippedSampleValues: number;
  clippedRatio: number;
}

export interface DecodedMonoWav {
  path: string;
  sourceSampleRate: number;
  sampleRate: number;
  sourceChannels: number;
  durationSeconds: number;
  samples: Float32Array;
}

interface DataChunk {
  offset: number;
  size: number;
}

async function readExactly(
  handle: Awaited<ReturnType<typeof open>>,
  length: number,
  position: number,
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let completed = 0;
  while (completed < length) {
    const result = await handle.read(buffer, completed, length - completed, position + completed);
    if (result.bytesRead === 0) throw new Error("Unexpected end of WAV file");
    completed += result.bytesRead;
  }
  return buffer;
}

function decibels(value: number): number | null {
  return value > 0 ? 20 * Math.log10(value) : null;
}

function normalizedSample(
  buffer: Buffer,
  offset: number,
  audioFormat: number,
  bitsPerSample: number,
): number {
  if (audioFormat === 3 && bitsPerSample === 32) {
    const value = buffer.readFloatLE(offset);
    return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  }
  switch (bitsPerSample) {
    case 8:
      return (buffer.readUInt8(offset) - 128) / 128;
    case 16:
      return buffer.readInt16LE(offset) / 32_768;
    case 24:
      return buffer.readIntLE(offset, 3) / 8_388_608;
    case 32:
      return buffer.readInt32LE(offset) / 2_147_483_648;
    default:
      throw new Error(`Unsupported PCM resolution: ${bitsPerSample} bits`);
  }
}

export async function analyzeWav(path: string): Promise<WavAnalysis> {
  const handle = await open(path, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 44) throw new Error(`WAV is too small: ${path}`);
    const header = await readExactly(handle, 12, 0);
    if (header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE") {
      throw new Error(`Not a RIFF/WAVE file: ${path}`);
    }

    let audioFormat = 0;
    let channels = 0;
    let sampleRate = 0;
    let byteRate = 0;
    let blockAlign = 0;
    let bitsPerSample = 0;
    const dataChunks: DataChunk[] = [];
    let offset = 12;
    while (offset + 8 <= info.size) {
      const chunkHeader = await readExactly(handle, 8, offset);
      const id = chunkHeader.toString("ascii", 0, 4);
      const size = chunkHeader.readUInt32LE(4);
      const dataOffset = offset + 8;
      if (dataOffset + size > info.size) {
        throw new Error(`WAV chunk ${id} extends beyond the file`);
      }
      if (id === "fmt ") {
        if (size < 16) throw new Error("WAV fmt chunk is shorter than 16 bytes");
        const format = await readExactly(handle, Math.min(size, 64), dataOffset);
        audioFormat = format.readUInt16LE(0);
        channels = format.readUInt16LE(2);
        sampleRate = format.readUInt32LE(4);
        byteRate = format.readUInt32LE(8);
        blockAlign = format.readUInt16LE(12);
        bitsPerSample = format.readUInt16LE(14);
      } else if (id === "data") {
        dataChunks.push({ offset: dataOffset, size });
      }
      offset = dataOffset + size + (size & 1);
    }

    if (audioFormat !== 1 && audioFormat !== 3) {
      throw new Error(`Unsupported WAV audio format ${audioFormat}; expected PCM or IEEE float`);
    }
    if (channels < 1 || channels > 32) throw new Error(`Invalid WAV channel count ${channels}`);
    if (sampleRate < 8_000 || sampleRate > 768_000) {
      throw new Error(`Invalid WAV sample rate ${sampleRate}`);
    }
    const bytesPerSample = bitsPerSample / 8;
    if (!Number.isInteger(bytesPerSample) || ![1, 2, 3, 4].includes(bytesPerSample)) {
      throw new Error(`Unsupported WAV resolution ${bitsPerSample}`);
    }
    if (audioFormat === 3 && bitsPerSample !== 32) {
      throw new Error(`Unsupported IEEE-float WAV resolution ${bitsPerSample}`);
    }
    if (blockAlign !== channels * bytesPerSample || byteRate !== sampleRate * blockAlign) {
      throw new Error("Inconsistent WAV fmt block alignment or byte rate");
    }
    if (dataChunks.length === 0) throw new Error("WAV has no data chunk");

    let peak = 0;
    let squareSum = 0;
    let sampleValues = 0;
    let clippedSampleValues = 0;
    let dataBytes = 0;
    const channelPeaks = new Array<number>(channels).fill(0);
    const channelSquareSums = new Array<number>(channels).fill(0);
    const channelSampleValues = new Array<number>(channels).fill(0);
    const channelClippedValues = new Array<number>(channels).fill(0);
    const clipThreshold = audioFormat === 3
      ? 1
      : 1 - 1 / (2 ** (bitsPerSample - 1));
    const targetBufferBytes = 256 * 1024;
    const bufferBytes = Math.max(blockAlign, Math.floor(targetBufferBytes / blockAlign) * blockAlign);
    for (const chunk of dataChunks) {
      if (chunk.size % blockAlign !== 0) throw new Error("WAV data is not frame-aligned");
      dataBytes += chunk.size;
      let cursor = 0;
      while (cursor < chunk.size) {
        const length = Math.min(bufferBytes, chunk.size - cursor);
        const buffer = await readExactly(handle, length, chunk.offset + cursor);
        for (let sampleOffset = 0; sampleOffset < length; sampleOffset += bytesPerSample) {
          const channelIndex = sampleValues % channels;
          const value = normalizedSample(buffer, sampleOffset, audioFormat, bitsPerSample);
          const magnitude = Math.abs(value);
          if (magnitude > peak) peak = magnitude;
          if (magnitude > (channelPeaks[channelIndex] ?? 0)) channelPeaks[channelIndex] = magnitude;
          if (magnitude >= clipThreshold) {
            clippedSampleValues++;
            channelClippedValues[channelIndex] = (channelClippedValues[channelIndex] ?? 0) + 1;
          }
          squareSum += value * value;
          channelSquareSums[channelIndex] = (channelSquareSums[channelIndex] ?? 0) + value * value;
          channelSampleValues[channelIndex] = (channelSampleValues[channelIndex] ?? 0) + 1;
          sampleValues++;
        }
        cursor += length;
      }
    }
    const rms = sampleValues > 0 ? Math.sqrt(squareSum / sampleValues) : 0;
    const durationSeconds = dataBytes / byteRate;
    const peakDbfs = decibels(peak);
    const rmsDbfs = decibels(rms);
    const channelStats = channelPeaks.map((channelPeak, channelIndex) => {
      const count = channelSampleValues[channelIndex] ?? 0;
      const channelRms = count > 0
        ? Math.sqrt((channelSquareSums[channelIndex] ?? 0) / count)
        : 0;
      const channelClipped = channelClippedValues[channelIndex] ?? 0;
      return {
        channel: channelIndex + 1,
        peak: channelPeak,
        peakDbfs: decibels(channelPeak),
        rms: channelRms,
        rmsDbfs: decibels(channelRms),
        clippedSampleValues: channelClipped,
        clippedRatio: count > 0 ? channelClipped / count : 0,
      };
    });
    const finiteChannelRms = channelStats
      .map((channel) => channel.rmsDbfs)
      .filter((value): value is number => value !== null);
    const channelRmsSpreadDb = finiteChannelRms.length >= 2
      ? Math.max(...finiteChannelRms) - Math.min(...finiteChannelRms)
      : null;
    const leftRmsDbfs = channelStats[0]?.rmsDbfs;
    const rightRmsDbfs = channelStats[1]?.rmsDbfs;
    const stereoBalanceDb = channels === 2 && leftRmsDbfs !== null && leftRmsDbfs !== undefined
      && rightRmsDbfs !== null && rightRmsDbfs !== undefined
      ? leftRmsDbfs - rightRmsDbfs
      : null;
    return {
      path,
      bytes: info.size,
      audioFormat: audioFormat === 1 ? "pcm" : "ieee_float",
      channels,
      sampleRate,
      bitsPerSample,
      blockAlign,
      dataBytes,
      durationSeconds,
      sampleValues,
      peak,
      peakDbfs,
      rms,
      rmsDbfs,
      crestFactorDb: peakDbfs !== null && rmsDbfs !== null ? peakDbfs - rmsDbfs : null,
      clippedSampleValues,
      clippedRatio: sampleValues > 0 ? clippedSampleValues / sampleValues : 0,
      channelStats,
      stereoBalanceDb,
      channelRmsSpreadDb,
      silent: peak < 0.000_01 || rms < 0.000_001,
    };
  } finally {
    await handle.close();
  }
}

export async function decodeWavMono(
  path: string,
  targetSampleRate = 8_000,
  maximumDurationSeconds = 900,
): Promise<DecodedMonoWav> {
  if (!Number.isInteger(targetSampleRate) || targetSampleRate < 4_000 || targetSampleRate > 48_000) {
    throw new Error(`targetSampleRate must be an integer in 4000..48000, got ${targetSampleRate}`);
  }
  const analysis = await analyzeWav(path);
  if (analysis.durationSeconds > maximumDurationSeconds) {
    throw new Error(
      `WAV duration ${analysis.durationSeconds.toFixed(3)}s exceeds analysis limit ${maximumDurationSeconds}s`,
    );
  }
  const ffmpeg = process.env.FFMPEG_PATH ?? "/usr/bin/ffmpeg";
  const chunks: Buffer[] = [];
  const errors: Buffer[] = [];
  let outputBytes = 0;
  const maximumBytes = Math.ceil(maximumDurationSeconds * targetSampleRate * 4) + 4096;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel", "error",
        "-i", path,
        "-map", "0:a:0",
        "-ac", "1",
        "-ar", String(targetSampleRate),
        "-f", "f32le",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maximumBytes) {
        child.kill("SIGKILL");
        reject(new Error(`Decoded PCM exceeds ${maximumBytes} byte safety limit`));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errors.reduce((sum, entry) => sum + entry.length, 0) < 1024 * 1024) errors.push(chunk);
    });
    child.on("error", (error) => reject(new Error(`Could not launch FFmpeg decoder: ${error.message}`)));
    child.on("close", (code, signal) => {
      if (code === 0) resolve();
      else {
        const detail = Buffer.concat(errors).toString("utf8").trim();
        reject(new Error(`FFmpeg mono decode failed (${code ?? signal ?? "unknown"}): ${detail}`));
      }
    });
  });
  const pcm = Buffer.concat(chunks);
  if (pcm.length === 0 || pcm.length % 4 !== 0) {
    throw new Error(`FFmpeg returned invalid f32le sample bytes: ${pcm.length}`);
  }
  const samples = new Float32Array(pcm.length / 4);
  for (let index = 0; index < samples.length; index += 1) {
    const value = pcm.readFloatLE(index * 4);
    samples[index] = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  }
  return {
    path,
    sourceSampleRate: analysis.sampleRate,
    sampleRate: targetSampleRate,
    sourceChannels: analysis.channels,
    durationSeconds: samples.length / targetSampleRate,
    samples,
  };
}
