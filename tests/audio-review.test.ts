import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { compareSongSectionArtifacts, renderSongSectionPreview } from "../src/audio-review.js";
import {
  createSongManifest,
  fileSha256,
  loadSongManifest,
  recordSongManifestArtifacts,
} from "../src/song-manifest.js";


function tone(seconds: number, amplitude: number): Buffer {
  const sampleRate = 44_100;
  const frames = Math.round(seconds * sampleRate);
  const blockAlign = 4;
  const bytes = frames * blockAlign;
  const output = Buffer.alloc(44 + bytes);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(36 + bytes, 4);
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
  output.writeUInt32LE(bytes, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * 330 * frame) / sampleRate) * amplitude * 32_767);
    output.writeInt16LE(value, 44 + frame * blockAlign);
    output.writeInt16LE(value, 44 + frame * blockAlign + 2);
  }
  return output;
}

test("section preview and loudness-matched A/B retain manifest provenance", async (context) => {
  try {
    await access("/usr/bin/ffmpeg");
  } catch {
    context.skip("FFmpeg is unavailable");
    return;
  }
  const temporary = await mkdtemp(join(process.cwd(), ".test-audio-review-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "review.song.json");
  await createSongManifest({
    outputPath: manifestPath,
    songId: "review-song",
    slug: "review-song",
    title: "Review Song",
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 120 }],
    sections: [
      { id: "verse", name: "Verse", kind: "verse", start: { measure: 0, beat: 0 }, end: { measure: 1, beat: 0 } },
      { id: "chorus", name: "Chorus", kind: "chorus", start: { measure: 1, beat: 0 }, end: { measure: 2, beat: 0 } },
    ],
    sampleRate: 44_100,
    gain: 0.2,
    reverb: false,
    chorus: false,
    overwrite: false,
  });
  const pathA = join(temporary, "a.wav");
  const pathB = join(temporary, "b.wav");
  await Promise.all([writeFile(pathA, tone(7, 0.1)), writeFile(pathB, tone(7, 0.3))]);
  const [digestA, digestB] = await Promise.all([fileSha256(pathA), fileSha256(pathB)]);
  const compositionHash = (await loadSongManifest(manifestPath)).manifest.composition_hash;
  await recordSongManifestArtifacts(manifestPath, 1, compositionHash, [
    {
      id: "master-a",
      role: "master",
      path: pathA,
      ...digestA,
      source_revision: 1,
      source_composition_hash: compositionHash,
      dependencies: ["verse"],
      metadata: { timeline_origin: "project_start" },
      created_at: new Date().toISOString(),
    },
    {
      id: "master-b",
      role: "master",
      path: pathB,
      ...digestB,
      source_revision: 1,
      source_composition_hash: compositionHash,
      dependencies: ["verse"],
      metadata: { timeline_origin: "project_start" },
      created_at: new Date().toISOString(),
    },
  ]);
  const preview = await renderSongSectionPreview({
    manifestPath,
    expectedRevision: 2,
    sourceArtifactId: "master-a",
    sectionId: "verse",
    outputPath: join(temporary, "review-song-verse-preview-r2.wav"),
    handleBeforeSeconds: 0,
    handleAfterSeconds: 0,
    referenceLufs: -16,
    referenceTruePeakDbfs: -1,
  });
  assert.ok(Math.abs(preview.quality.durationSeconds - 2) < 0.02);
  assert.equal(preview.artifact.role, "preview");
  assert.deepEqual(preview.artifact.dependencies, ["master-a", "verse"]);

  const comparison = await compareSongSectionArtifacts({
    manifestPath,
    expectedRevision: 3,
    artifactAId: "master-a",
    artifactBId: "master-b",
    sectionId: "verse",
    outputAPath: join(temporary, "review-song-verse-a-matched-r3.wav"),
    outputBPath: join(temporary, "review-song-verse-b-matched-r3.wav"),
    handleBeforeSeconds: 0,
    handleAfterSeconds: 0,
    referenceTruePeakDbfs: -1,
  });
  assert.ok(Math.abs(comparison.A.after.integratedLufs - comparison.B.after.integratedLufs) <= 0.2);
  assert.equal(comparison.manifestRevision, 4);
  const after = (await loadSongManifest(manifestPath)).manifest;
  assert.equal(after.artifacts.filter((artifact) => artifact.role === "preview").length, 3);
});
