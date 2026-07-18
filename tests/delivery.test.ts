import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { masterSongManifestDelivery } from "../src/delivery.js";
import {
  createSongManifest,
  fileSha256,
  loadSongManifest,
  recordSongManifestArtifacts,
  upsertSongManifestArrangementTrack,
  upsertSongManifestVocalPart,
} from "../src/song-manifest.js";


function stereoTone(durationSeconds: number): Buffer {
  const sampleRate = 44_100;
  const frames = Math.round(sampleRate * durationSeconds);
  const blockAlign = 4;
  const dataBytes = frames * blockAlign;
  const output = Buffer.alloc(44 + dataBytes);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(36 + dataBytes, 4);
  output.write("WAVE", 8, "ascii");
  output.write("fmt ", 12, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(2, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * blockAlign, 28);
  output.writeUInt16LE(blockAlign, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36, "ascii");
  output.writeUInt32LE(dataBytes, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    const value = Math.round(Math.sin((frame * Math.PI * 2 * 220) / sampleRate) * 0.15 * 32_767);
    output.writeInt16LE(value, 44 + frame * blockAlign);
    output.writeInt16LE(value, 44 + frame * blockAlign + 2);
  }
  return output;
}

test("manifest-aware delivery verifies provenance and atomically records mastering", async (context) => {
  try {
    await access("/usr/bin/ffmpeg");
  } catch {
    context.skip("FFmpeg is unavailable");
    return;
  }
  const temporary = await mkdtemp(join(process.cwd(), ".test-delivery-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "delivery-song.song.json");
  await createSongManifest({
    outputPath: manifestPath,
    songId: "delivery-song",
    slug: "delivery-song",
    title: "Delivery Song",
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 120 }],
    sections: [{
      id: "verse",
      name: "Verse",
      kind: "verse",
      start: { measure: 0, beat: 0 },
      end: { measure: 2, beat: 0 },
    }],
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
    { id: "voice-ia-rocks", name: "IA_ROCKS", component_id: "BDREB7P2KTWKYDC5" },
    { id: "lead", name: "Lead", voice_id: "voice-ia-rocks" },
    {
      id: "lead-verse",
      section_id: "verse",
      name: "Lead Verse",
      start: { measure: 0, beat: 0 },
      end: { measure: 2, beat: 0 },
      notes: [{
        id: "lead-note",
        position: { measure: 0, beat: 0 },
        duration: 960,
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
        duration: 960,
        note_number: 48,
      }],
    },
    true,
  );
  const masterPath = join(temporary, "delivery-song-editor-master-r3.wav");
  await writeFile(masterPath, stereoTone(3));
  const digest = await fileSha256(masterPath);
  const compositionHash = (await loadSongManifest(manifestPath)).manifest.composition_hash;
  await recordSongManifestArtifacts(manifestPath, 3, compositionHash, [{
    id: "editor-master-r3",
    role: "master",
    path: masterPath,
    ...digest,
    source_revision: 3,
    source_composition_hash: compositionHash,
    dependencies: ["lead"],
    metadata: { renderer: "fixture" },
    created_at: new Date().toISOString(),
  }]);

  const deliveryPath = join(temporary, "delivery-song-final-r4.wav");
  const result = await masterSongManifestDelivery({
    manifestPath,
    expectedRevision: 4,
    sourceArtifactId: "editor-master-r3",
    outputPath: deliveryPath,
    targetLufs: -16,
    targetTruePeakDbfs: -1,
    targetLoudnessRangeLu: 7,
    allowClippedSource: false,
  });
  assert.equal(result.manifestRevision, 5);
  assert.equal(result.artifact.role, "delivery");
  assert.deepEqual(result.artifact.dependencies, ["editor-master-r3"]);
  assert.ok(Math.abs(result.mastering.output.integratedLufs - -16) <= 0.6);
  const after = (await loadSongManifest(manifestPath)).manifest;
  const recorded = after.artifacts.find((artifact) => artifact.id === result.artifact.id);
  assert.equal(recorded?.sha256, (await fileSha256(deliveryPath)).sha256);
  assert.equal(recorded?.source_composition_hash, compositionHash);
});
