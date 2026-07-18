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
  upsertSongManifestVocalPart,
} from "../src/song-manifest.js";
import { analyzeSongManifestVocalStem } from "../src/vocal-analysis.js";


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function writeSyntheticVocal(path: string): Promise<void> {
  const sampleRate = 44_100;
  const channels = 2;
  const seconds = 4;
  const frames = sampleRate * seconds;
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
  let phase = 0;
  let noiseState = 0x1234_5678;
  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / sampleRate;
    let value = 0;
    if (time >= 2.02 && time < 2.08) {
      noiseState = (Math.imul(noiseState, 1_664_525) + 1_013_904_223) >>> 0;
      value = (((noiseState / 0xffff_ffff) * 2) - 1) * 0.08;
    } else if (time >= 2.08 && time < 3.02) {
      const local = time - 2.08;
      const cents = 100 + 24 * Math.sin(2 * Math.PI * 5 * local);
      const frequency = 440 * (2 ** (cents / 1200));
      phase += (2 * Math.PI * frequency) / sampleRate;
      const fadeIn = Math.min(1, local / 0.025);
      const fadeOut = Math.min(1, (3.02 - time) / 0.03);
      value = Math.sin(phase) * 0.24 * fadeIn * fadeOut;
    }
    const sample = Math.max(-32_768, Math.min(32_767, Math.round(value * 32_767)));
    const offset = 44 + frame * blockAlign;
    wav.writeInt16LE(sample, offset);
    wav.writeInt16LE(sample, offset + 2);
  }
  await writeFile(path, wav);
}

test("compares stable score events with rendered pitch, consonant onset, release, and vibrato", async (context) => {
  const temporary = await mkdtemp(join(ROOT, ".test-vocal-analysis-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "analysis-song.song.json");
  await createSongManifest({
    outputPath: manifestPath,
    songId: "analysis-song",
    slug: "analysis-song",
    title: "Analysis Song",
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 120 }],
    sections: [{
      id: "verse",
      name: "Verse",
      kind: "verse",
      start: { measure: 0, beat: 0 },
      end: { measure: 1, beat: 0 },
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
    { id: "voice-ia", name: "IA", component_id: "BLRGDDR4M3WM2LC6" },
    { id: "lead", name: "Lead", voice_id: "voice-ia" },
    {
      id: "verse-lead",
      section_id: "verse",
      name: "Verse Lead",
      start: { measure: 0, beat: 0 },
      end: { measure: 1, beat: 0 },
      notes: [{
        id: "lead-a4",
        position: { measure: 0, beat: 0 },
        duration: 960,
        note_number: 69,
        lyric: "ら",
        phonemes: "4 a",
        vibrato: { type: 1, length: 80 },
      }],
    },
    true,
  );
  const vocalPath = join(temporary, "analysis-song-vocal-lead-r2-center-dry.wav");
  await writeSyntheticVocal(vocalPath);
  const beforeArtifact = (await loadSongManifest(manifestPath)).manifest;
  const digest = await fileSha256(vocalPath);
  await recordSongManifestArtifacts(
    manifestPath,
    2,
    beforeArtifact.composition_hash,
    [{
      id: "synthetic-vocal-stem",
      role: "vocal_stem",
      path: vocalPath,
      ...digest,
      source_revision: 2,
      source_composition_hash: beforeArtifact.composition_hash,
      dependencies: ["lead"],
      metadata: { track_id: "lead", center_pan: true, dry: true },
      created_at: new Date().toISOString(),
    }],
  );
  const analysisPath = join(temporary, "analysis-song-lead-r3.vocal-analysis.json");
  const result = await analyzeSongManifestVocalStem({
    manifestPath,
    expectedRevision: 3,
    stemArtifactId: "synthetic-vocal-stem",
    outputPath: analysisPath,
    sectionId: "verse",
    eventIds: ["lead-a4"],
    timelineOffsetSeconds: 0,
    minimumPitchHz: 60,
    maximumPitchHz: 1_200,
    pitchToleranceCents: 50,
    onsetToleranceMilliseconds: 100,
    offsetToleranceMilliseconds: 100,
  });
  assert.equal(result.manifestRevision, 4);
  assert.equal(result.summary.events, 1);
  assert.equal(result.summary.eventsWithPitch, 1);
  assert.ok((result.summary.medianAbsolutePitchCenterCents ?? 0) > 70);
  assert.ok((result.summary.medianAbsolutePitchCenterCents ?? 999) < 130);
  const event = result.events[0] as {
    observed?: {
      energyOnsetDeviationMs?: number;
      voicedOnsetDeviationMs?: number;
      consonantLeadMs?: number;
      medianCentsError?: number;
      vibrato?: { depthCents?: number; rateHz?: number };
    };
    issueCodes?: string[];
    pitchContour?: unknown[];
  };
  assert.ok((event.observed?.energyOnsetDeviationMs ?? 999) >= 0);
  assert.ok((event.observed?.energyOnsetDeviationMs ?? 999) <= 70);
  assert.ok((event.observed?.voicedOnsetDeviationMs ?? 0) >= 50);
  assert.ok((event.observed?.consonantLeadMs ?? 0) >= 30);
  assert.ok((event.observed?.medianCentsError ?? 0) > 70);
  assert.ok((event.observed?.vibrato?.depthCents ?? 0) > 10);
  assert.ok((event.observed?.vibrato?.rateHz ?? 0) > 3.5);
  assert.ok((event.observed?.vibrato?.rateHz ?? 99) < 6.5);
  assert.ok(event.issueCodes?.includes("pitch-center-deviation"));
  assert.ok((event.pitchContour?.length ?? 0) > 10);

  const after = (await loadSongManifest(manifestPath)).manifest;
  assert.equal(after.composition_hash, beforeArtifact.composition_hash);
  const artifact = after.artifacts.find((candidate) => candidate.role === "analysis");
  assert.equal(artifact?.dependencies[0], "synthetic-vocal-stem");
  assert.equal(artifact?.metadata.analysis_type, "score-vs-render-vocal");
});
