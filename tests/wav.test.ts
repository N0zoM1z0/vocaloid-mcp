import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { analyzeWav } from "../src/wav.js";


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function pcm16Wav(samples: number[], sampleRate = 8_000, channels = 1): Buffer {
  const dataBytes = samples.length * 2;
  const output = Buffer.alloc(44 + dataBytes);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(36 + dataBytes, 4);
  output.write("WAVE", 8, "ascii");
  output.write("fmt ", 12, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(channels, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * channels * 2, 28);
  output.writeUInt16LE(channels * 2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36, "ascii");
  output.writeUInt32LE(dataBytes, 40);
  for (const [index, sample] of samples.entries()) output.writeInt16LE(sample, 44 + index * 2);
  return output;
}

test("analyzes PCM WAV amplitude and duration", async (context) => {
  const temporary = await mkdtemp(join(ROOT, ".test-wav-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const path = join(temporary, "tone.wav");
  await writeFile(path, pcm16Wav([0, 16_384, -16_384, 0], 8_000, 1));
  const result = await analyzeWav(path);
  assert.equal(result.audioFormat, "pcm");
  assert.equal(result.sampleRate, 8_000);
  assert.equal(result.channels, 1);
  assert.equal(result.bitsPerSample, 16);
  assert.equal(result.durationSeconds, 4 / 8_000);
  assert.equal(result.peak, 0.5);
  assert.ok(Math.abs(result.rms - Math.sqrt(0.125)) < 1e-12);
  assert.equal(result.clippedSampleValues, 0);
  assert.equal(result.clippedRatio, 0);
  assert.ok(Math.abs((result.crestFactorDb ?? 0) - 3.010299956639812) < 1e-9);
  assert.equal(result.silent, false);
});

test("marks zero PCM as silent", async (context) => {
  const temporary = await mkdtemp(join(ROOT, ".test-wav-silent-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const path = join(temporary, "silent.wav");
  await writeFile(path, pcm16Wav(new Array<number>(800).fill(0)));
  const result = await analyzeWav(path);
  assert.equal(result.silent, true);
  assert.equal(result.clippedSampleValues, 0);
});

test("counts full-scale PCM sample values", async (context) => {
  const temporary = await mkdtemp(join(ROOT, ".test-wav-clipped-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const path = join(temporary, "clipped.wav");
  await writeFile(path, pcm16Wav([32_767, -32_768, 0, 16_384]));
  const result = await analyzeWav(path);
  assert.equal(result.clippedSampleValues, 2);
  assert.equal(result.clippedRatio, 0.5);
});

test("reports per-channel levels and stereo imbalance", async (context) => {
  const temporary = await mkdtemp(join(ROOT, ".test-wav-balance-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const path = join(temporary, "left-heavy.wav");
  await writeFile(
    path,
    pcm16Wav([16_384, 1_638, -16_384, -1_638, 16_384, 1_638, -16_384, -1_638], 8_000, 2),
  );
  const result = await analyzeWav(path);
  assert.equal(result.channelStats.length, 2);
  assert.equal(result.channelStats[0]?.peak, 0.5);
  assert.ok(Math.abs((result.channelStats[1]?.peak ?? 0) - 1_638 / 32_768) < 1e-12);
  assert.ok((result.stereoBalanceDb ?? 0) > 19.9);
  assert.ok((result.channelRmsSpreadDb ?? 0) > 19.9);
});

test("analyzes the manually exported VOCALOID fixture when present", async (context) => {
  const path = "/mnt/c/Users/21992/Downloads/test_2.wav";
  try {
    await access(path);
  } catch {
    context.skip(`${path} is unavailable`);
    return;
  }
  const result = await analyzeWav(path);
  assert.equal(result.sampleRate, 44_100);
  assert.equal(result.channels, 2);
  assert.equal(result.bitsPerSample, 16);
  assert.ok(result.durationSeconds > 9);
  assert.equal(result.silent, false);
});
