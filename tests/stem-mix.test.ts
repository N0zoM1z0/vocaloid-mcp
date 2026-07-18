import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createSongManifest,
  fileSha256,
  loadSongManifest,
  recordSongManifestArtifacts,
  upsertSongManifestArrangementTrack,
  upsertSongManifestEffectChain,
  upsertSongManifestSectionDynamic,
  upsertSongManifestVocalPart,
} from "../src/song-manifest.js";
import { renderSongManifestStemMix } from "../src/stem-mix.js";
import { decodeWavMono } from "../src/wav.js";


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function writeTone(
  path: string,
  durationSeconds: number,
  activeStartSeconds: number,
  frequency: number,
  leftGain: number,
  rightGain: number,
): Promise<void> {
  const sampleRate = 44_100;
  const channels = 2;
  const frames = Math.round(durationSeconds * sampleRate);
  const blockAlign = channels * 2;
  const dataBytes = frames * blockAlign;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * blockAlign, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / sampleRate;
    const local = time - activeStartSeconds;
    const envelope = local >= 0
      ? Math.min(1, local / 0.02) * Math.min(1, (durationSeconds - time) / 0.03)
      : 0;
    const source = Math.sin(2 * Math.PI * frequency * Math.max(0, local)) * 0.18 * envelope;
    const offset = 44 + frame * blockAlign;
    wav.writeInt16LE(Math.round(source * leftGain * 32_767), offset);
    wav.writeInt16LE(Math.round(source * rightGain * 32_767), offset + 2);
  }
  await writeFile(path, wav);
}

test("renders a reproducible stem mix with ordered effects, section dynamics, and separate mix hash", async (context) => {
  const temporary = await mkdtemp(join(ROOT, ".test-stem-mix-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "mix-song.song.json");
  await createSongManifest({
    outputPath: manifestPath,
    songId: "mix-song",
    slug: "mix-song",
    title: "Mix Song",
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 120 }],
    sections: [
      {
        id: "verse",
        name: "Verse",
        kind: "verse",
        start: { measure: 0, beat: 0 },
        end: { measure: 1, beat: 0 },
      },
      {
        id: "chorus",
        name: "Chorus",
        kind: "chorus",
        start: { measure: 1, beat: 0 },
        end: { measure: 2, beat: 0 },
      },
    ],
    sampleRate: 44_100,
    gain: 0.2,
    reverb: false,
    chorus: false,
    overwrite: false,
  });
  await upsertSongManifestVocalPart(
    manifestPath,
    manifestPath,
    1,
    { id: "voice-ia", name: "IA", component_id: "BLRGDDR4M3WM2LC6" },
    { id: "lead", name: "Lead", voice_id: "voice-ia" },
    {
      id: "verse-lead",
      section_id: "verse",
      name: "Verse Lead",
      start: { measure: 0, beat: 0 },
      end: { measure: 1, beat: 0 },
      notes: [{
        id: "lead-note",
        position: { measure: 0, beat: 0 },
        duration: 1920,
        note_number: 69,
        lyric: "ら",
        phonemes: "4 a",
      }],
    },
    true,
  );
  await upsertSongManifestArrangementTrack(
    manifestPath,
    manifestPath,
    2,
    {
      kind: "pitched",
      id: "piano",
      name: "Piano",
      program: 0,
      notes: [{
        id: "piano-note",
        position: { measure: 0, beat: 0 },
        duration: 3840,
        note_number: 48,
      }],
    },
    true,
  );
  const vocalPath = join(temporary, "mix-song-vocal-lead-r3-center-dry.wav");
  const pianoPath = join(temporary, "mix-song-instrument-piano-r3-center-dry.wav");
  await writeTone(vocalPath, 6, 2, 440, 1, 1);
  await writeTone(pianoPath, 4, 0, 220, 1, 1);
  const source = (await loadSongManifest(manifestPath)).manifest;
  const [vocalDigest, pianoDigest] = await Promise.all([
    fileSha256(vocalPath),
    fileSha256(pianoPath),
  ]);
  await recordSongManifestArtifacts(
    manifestPath,
    3,
    source.composition_hash,
    [
      {
        id: "vocal-stem-lead-r3",
        role: "vocal_stem",
        path: vocalPath,
        ...vocalDigest,
        source_revision: 3,
        source_composition_hash: source.composition_hash,
        dependencies: ["lead"],
        metadata: { track_id: "lead", timeline_origin: "project_start", dry: true },
        created_at: new Date().toISOString(),
      },
      {
        id: "instrument-stem-piano-r3",
        role: "instrument_stem",
        path: pianoPath,
        ...pianoDigest,
        source_revision: 3,
        source_composition_hash: source.composition_hash,
        dependencies: ["piano"],
        metadata: { track_id: "piano", timeline_origin: "song_start", renderer_effects: false },
        created_at: new Date().toISOString(),
      },
    ],
  );
  const beforeMix = (await loadSongManifest(manifestPath)).manifest;
  await upsertSongManifestEffectChain(
    manifestPath,
    manifestPath,
    4,
    {
      id: "lead-chain",
      target_id: "lead",
      effects: [
        { id: "lead-hpf", type: "highpass", parameters: { frequency_hz: 80 } },
        { id: "lead-eq", type: "equalizer", parameters: { frequency_hz: 2800, q: 1.2, gain_db: 1.5 } },
        {
          id: "lead-compressor",
          type: "compressor",
          parameters: { threshold_db: -20, ratio: 2.5, attack_ms: 15, release_ms: 120, makeup_db: 1 },
        },
        { id: "lead-deesser", type: "deesser", parameters: { intensity: 0.15 } },
        { id: "lead-room", type: "reverb", parameters: { delay_ms: 28, decay: 0.18 } },
      ],
    },
    true,
  );
  await upsertSongManifestEffectChain(
    manifestPath,
    manifestPath,
    5,
    {
      id: "piano-chain",
      target_id: "piano",
      effects: [
        { id: "piano-gain", type: "gain", parameters: { gain_db: -8 } },
        { id: "piano-pan", type: "pan", parameters: { pan: -0.35 } },
        { id: "piano-delay", type: "delay", parameters: { delay_ms: 90, decay: 0.12 } },
      ],
    },
    true,
  );
  await upsertSongManifestEffectChain(
    manifestPath,
    manifestPath,
    6,
    {
      id: "mix-bus-chain",
      target_id: "mix-bus",
      effects: [
        { id: "bus-lowpass", type: "lowpass", parameters: { frequency_hz: 18_000 } },
        { id: "bus-limiter", type: "limiter", parameters: { limit_db: -1.2 } },
      ],
    },
    true,
  );
  await upsertSongManifestSectionDynamic(
    manifestPath,
    manifestPath,
    7,
    {
      id: "lead-chorus-up",
      target_id: "lead",
      section_id: "chorus",
      gain_db: 2,
      ramp_ms: 120,
    },
    true,
  );
  await upsertSongManifestSectionDynamic(
    manifestPath,
    manifestPath,
    8,
    {
      id: "bus-verse-down",
      target_id: "mix-bus",
      section_id: "verse",
      gain_db: -1.5,
      ramp_ms: 80,
    },
    true,
  );
  const configured = (await loadSongManifest(manifestPath)).manifest;
  assert.equal(configured.composition_hash, beforeMix.composition_hash);
  assert.notEqual(configured.mix_hash, beforeMix.mix_hash);

  const outputPath = join(temporary, "mix-song-mix-r9.wav");
  const result = await renderSongManifestStemMix({
    manifestPath,
    expectedRevision: 9,
    stemArtifactIds: ["vocal-stem-lead-r3", "instrument-stem-piano-r3"],
    outputPath,
    sampleRate: 44_100,
    bitDepth: 24,
    referenceLufs: -16,
    referenceTruePeakDbfs: -1,
    timeoutSeconds: 120,
  });
  assert.equal(result.manifestRevision, 10);
  assert.equal(result.sourceCompositionHash, configured.composition_hash);
  assert.equal(result.sourceMixHash, configured.mix_hash);
  assert.equal(result.quality.channels, 2);
  assert.equal(result.quality.bitsPerSample, 24);
  assert.equal(result.quality.silent, false);
  assert.ok(result.quality.durationSeconds >= 6);
  assert.match(result.filterGraph, /adelay=2000/u);
  assert.match(result.filterGraph, /highpass=/u);
  assert.match(result.filterGraph, /acompressor=/u);
  assert.match(result.filterGraph, /deesser=/u);
  assert.match(result.filterGraph, /aecho=/u);
  assert.match(result.filterGraph, /alimiter=/u);
  assert.match(result.filterGraph, /volume='pow/u);
  assert.equal(result.artifact.metadata.source_mix_hash, configured.mix_hash);
  assert.deepEqual(result.artifact.dependencies, ["vocal-stem-lead-r3", "instrument-stem-piano-r3"]);
  const decoded = await decodeWavMono(outputPath, 8_000, 30);
  const firstAudibleSample = decoded.samples.findIndex((sample) => Math.abs(sample) > 0.001);
  assert.ok(firstAudibleSample >= 0);
  assert.ok(firstAudibleSample / decoded.sampleRate >= 1.95);
  assert.ok(firstAudibleSample / decoded.sampleRate <= 2.1);
});
