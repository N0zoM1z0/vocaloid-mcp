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
  silent: boolean;
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
          const value = normalizedSample(buffer, sampleOffset, audioFormat, bitsPerSample);
          const magnitude = Math.abs(value);
          if (magnitude > peak) peak = magnitude;
          if (magnitude >= clipThreshold) clippedSampleValues++;
          squareSum += value * value;
          sampleValues++;
        }
        cursor += length;
      }
    }
    const rms = sampleValues > 0 ? Math.sqrt(squareSum / sampleValues) : 0;
    const durationSeconds = dataBytes / byteRate;
    const peakDbfs = decibels(peak);
    const rmsDbfs = decibels(rms);
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
      silent: peak < 0.000_01 || rms < 0.000_001,
    };
  } finally {
    await handle.close();
  }
}
