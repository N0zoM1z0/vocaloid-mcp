import assert from "node:assert/strict";
import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { analyzeAudioQuality, masterWav } from "../src/audio-quality.js";


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function stereoSine(durationSeconds: number, amplitude: number, rightScale = 1): Buffer {
  const channels = 2;
  const sampleRate = 44_100;
  const frames = Math.round(durationSeconds * sampleRate);
  const blockAlign = 4;
  const dataBytes = frames * blockAlign;
  const output = Buffer.alloc(44 + dataBytes);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(36 + dataBytes, 4);
  output.write("WAVE", 8, "ascii");
  output.write("fmt ", 12, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(channels, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * blockAlign, 28);
  output.writeUInt16LE(blockAlign, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36, "ascii");
  output.writeUInt32LE(dataBytes, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    const value = Math.round(Math.sin((frame * Math.PI * 2 * 440) / sampleRate) * amplitude * 32_767);
    output.writeInt16LE(value, 44 + frame * blockAlign);
    output.writeInt16LE(Math.round(value * rightScale), 44 + frame * blockAlign + 2);
  }
  return output;
}

test("analyzes EBU loudness and masters to bounded targets", async (context) => {
  try {
    await access("/usr/bin/ffmpeg");
  } catch {
    context.skip("FFmpeg is unavailable");
    return;
  }
  const temporary = await mkdtemp(join(ROOT, ".test-audio-quality-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const input = join(temporary, "input.wav");
  const output = join(temporary, "mastered.wav");
  await writeFile(input, stereoSine(3, 0.5));

  const analysis = await analyzeAudioQuality(input, -16, -1);
  assert.equal(analysis.sampleClipping, false);
  assert.equal(analysis.channelImbalance, false);
  assert.ok(Math.abs(analysis.stereoBalanceDb ?? 0) < 0.01);
  assert.equal(analysis.clippedSampleValues, 0);
  assert.ok(Number.isFinite(analysis.integratedLufs));
  assert.ok(Number.isFinite(analysis.truePeakDbfs));

  const result = await masterWav({
    inputPath: input,
    outputPath: output,
    targetLufs: -16,
    targetTruePeakDbfs: -1,
    targetLoudnessRangeLu: 7,
    overwrite: false,
  });
  assert.equal(result.sourceClipped, false);
  assert.equal(result.loudnessRangeTargetMet, false);
  assert.equal(result.targetLoudnessRangeLu, 7);
  assert.ok(Math.abs(result.output.integratedLufs - -16) <= 0.6);
  assert.ok(result.output.truePeakDbfs <= -0.8);
  assert.equal(result.output.clippedSampleValues, 0);
  assert.deepEqual((await readdir(temporary)).sort(), ["input.wav", "mastered.wav"]);

  const imbalanced = join(temporary, "imbalanced.wav");
  await writeFile(imbalanced, stereoSine(3, 0.5, 0.1));
  const imbalancedAnalysis = await analyzeAudioQuality(imbalanced, -16, -1);
  assert.equal(imbalancedAnalysis.channelImbalance, true);
  assert.ok((imbalancedAnalysis.stereoBalanceDb ?? 0) > 19);
  assert.ok(
    imbalancedAnalysis.recommendations.some((item) => item.includes("VOCALOID mixer routing")),
  );
});
