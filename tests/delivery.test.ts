import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { masterSongManifestDelivery } from "../src/delivery.js";
import { preflightSongManifest } from "../src/song-preflight.js";
import {
  createSongManifest,
  fileSha256,
  loadSongManifest,
  inspectSongManifest,
  recordSongManifestArtifacts,
  setSongManifestCompositionGuidance,
  upsertSongManifestArrangementTrack,
  upsertSongManifestEffectChain,
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
  assert.equal(
    recorded?.metadata.mastering_transparency_review_recommended,
    result.mastering.transparencyReviewRecommended,
  );
  assert.equal(
    recorded?.metadata.mastering_peak_reduction_required_db,
    result.mastering.peakReductionRequiredDb,
  );

  const staleMixPath = join(temporary, "delivery-song-stale-mix-r5.wav");
  await writeFile(staleMixPath, stereoTone(3));
  const beforeMixChange = (await loadSongManifest(manifestPath)).manifest;
  await recordSongManifestArtifacts(manifestPath, 5, compositionHash, [{
    id: "stem-mix-r5",
    role: "mix",
    path: staleMixPath,
    ...(await fileSha256(staleMixPath)),
    source_revision: 5,
    source_composition_hash: compositionHash,
    dependencies: ["lead"],
    metadata: { renderer: "fixture", source_mix_hash: beforeMixChange.mix_hash },
    created_at: new Date().toISOString(),
  }]);
  await upsertSongManifestEffectChain(
    manifestPath,
    manifestPath,
    6,
    {
      id: "lead-chain",
      target_id: "lead",
      effects: [{ id: "lead-gain", type: "gain", parameters: { gain_db: -2 } }],
    },
    true,
  );
  const summary = await inspectSongManifest(manifestPath);
  const staleSummary = summary.artifacts.find((artifact) => artifact.id === "stem-mix-r5");
  assert.equal(staleSummary?.currentComposition, true);
  assert.equal(staleSummary?.currentMix, false);
  const stalePreflight = await preflightSongManifest(manifestPath, {
    artifactCheck: "none",
    includePerformanceWarnings: false,
  });
  assert.ok(stalePreflight.issues.some((issue) => issue.code === "STALE_MIX_ARTIFACT"));
  const staleDeliveryPath = join(temporary, "must-not-deliver-stale-mix.wav");
  await assert.rejects(
    masterSongManifestDelivery({
      manifestPath,
      expectedRevision: 7,
      sourceArtifactId: "stem-mix-r5",
      outputPath: staleDeliveryPath,
      targetLufs: -16,
      targetTruePeakDbfs: -1,
      targetLoudnessRangeLu: 7,
      allowClippedSource: false,
    }),
    /belongs to mix hash.*current mix hash/u,
  );
  assert.equal(await access(staleDeliveryPath).then(() => true, () => false), false);

  await setSongManifestCompositionGuidance(manifestPath, manifestPath, 7, {
    theory_ruleset_id: "core/v1",
    strictness: "balanced",
    harmonic_language: "tonal",
    required_review_severities: [],
    intent_review_policy: {
      mode: "required_for_delivery",
      require_song_intent: true,
      require_section_intent: false,
      minimum_anchor_phrases: 0,
      require_current_audition_review: false,
    },
    exceptions: [],
  }, true);
  const policyBlockedPath = join(temporary, "must-not-deliver-without-intent-review.wav");
  await assert.rejects(
    masterSongManifestDelivery({
      manifestPath,
      expectedRevision: 8,
      sourceArtifactId: "editor-master-r3",
      outputPath: policyBlockedPath,
      targetLufs: -16,
      targetTruePeakDbfs: -1,
      targetLoudnessRangeLu: 7,
      allowClippedSource: false,
    }),
    /Final delivery blocked.*COMPOSITION_INTENT_REQUIRED/u,
  );
  assert.equal(await access(policyBlockedPath).then(() => true, () => false), false);
});
