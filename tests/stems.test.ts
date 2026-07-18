import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildSongManifest,
  createSongManifest,
  loadSongManifest,
  upsertSongManifestArrangementTrack,
  upsertSongManifestVocalPart,
} from "../src/song-manifest.js";
import {
  renderSongManifestInstrumentStems,
  renderSongManifestVocalStems,
} from "../src/stems.js";
import { analyzeSongManifestVocalStem } from "../src/vocal-analysis.js";


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function readable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("renders each manifest instrument and drum track as a provenance-linked stereo stem", async (context) => {
  if (!(await readable("/usr/bin/fluidsynth")) || !(await readable("/usr/share/sounds/sf2/FluidR3_GM.sf2"))) {
    context.skip("FluidSynth and the default GM SoundFont are unavailable");
    return;
  }
  const temporary = await mkdtemp(join(ROOT, ".test-stems-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "stem-song.song.json");
  await createSongManifest({
    outputPath: manifestPath,
    songId: "stem-song",
    slug: "stem-song",
    title: "Stem Song",
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
    gain: 0.18,
    reverb: true,
    chorus: true,
    overwrite: false,
  });
  await upsertSongManifestArrangementTrack(
    manifestPath,
    manifestPath,
    1,
    {
      kind: "pitched",
      id: "shamisen",
      name: "Shamisen",
      program: 106,
      pan: 28,
      notes: [
        { id: "shamisen-a", position: { measure: 0, beat: 0 }, duration: 480, note_number: 60 },
        { id: "shamisen-b", position: { measure: 0, beat: 1 }, duration: 480, note_number: 64 },
      ],
    },
    true,
  );
  await upsertSongManifestArrangementTrack(
    manifestPath,
    manifestPath,
    2,
    {
      kind: "drums",
      id: "taiko",
      name: "Taiko",
      hits: [
        { id: "taiko-hit-1", position: { measure: 0, beat: 0 }, note_number: 36 },
        { id: "taiko-hit-2", position: { measure: 0, beat: 2 }, note_number: 38 },
      ],
    },
    true,
  );
  const before = (await loadSongManifest(manifestPath)).manifest;
  const result = await renderSongManifestInstrumentStems({
    manifestPath,
    expectedRevision: 3,
    outputDirectory: temporary,
    preservePan: false,
    includeRendererEffects: false,
  });
  assert.equal(result.sourceRevision, 3);
  assert.equal(result.manifestRevision, 4);
  assert.equal(result.sourceCompositionHash, before.composition_hash);
  assert.equal(result.stems.length, 2);
  assert.deepEqual(result.stems.map((stem) => stem.trackId), ["shamisen", "taiko"]);
  assert.ok(result.stems.every((stem) => stem.channels === 2 && stem.silent === false));
  assert.ok(result.stems.every((stem) => stem.outputPath.includes("stem-song-instrument-")));

  const after = (await loadSongManifest(manifestPath)).manifest;
  assert.equal(after.composition_hash, before.composition_hash);
  assert.equal(after.revision, 4);
  assert.deepEqual(
    after.artifacts.map((artifact) => [artifact.role, artifact.dependencies[0], artifact.source_composition_hash]),
    [
      ["instrument_stem", "shamisen", before.composition_hash],
      ["instrument_stem", "taiko", before.composition_hash],
    ],
  );
  assert.deepEqual(after.artifacts.map((artifact) => artifact.metadata.preserve_pan), [false, false]);
  assert.deepEqual(after.artifacts.map((artifact) => artifact.metadata.renderer_effects), [false, false]);
});

test("exports isolated lead and harmony stems through the original VOCALOID Editor", async (context) => {
  if (process.env.VOCALOID_INTEGRATION_TEST !== "1") {
    context.skip("Set VOCALOID_INTEGRATION_TEST=1 for the original Editor integration test");
    return;
  }
  const prerequisites = [
    "/usr/bin/fluidsynth",
    "/usr/share/sounds/sf2/FluidR3_GM.sf2",
    "/mnt/d/Vocaloid/Vocaloid3FE/VOCALOID3.exe",
    join(ROOT, "build/native/vocaloid_export.exe"),
  ];
  if (!(await Promise.all(prerequisites.map(readable))).every(Boolean)) {
    context.skip("VOCALOID Editor integration prerequisites are unavailable");
    return;
  }
  const temporary = await mkdtemp(join(ROOT, ".test-vocal-stems-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "vocal-stem-song.song.json");
  await createSongManifest({
    outputPath: manifestPath,
    songId: "vocal-stem-song",
    slug: "vocal-stem-song",
    title: "Vocal Stem Song",
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
    gain: 0.12,
    reverb: false,
    chorus: false,
    overwrite: false,
  });
  await upsertSongManifestVocalPart(
    manifestPath,
    manifestPath,
    1,
    { id: "voice-ia", name: "IA", component_id: "BLRGDDR4M3WM2LC6" },
    { id: "lead", name: "Lead", voice_id: "voice-ia", mixer: { pan: 48, volume: -120 } },
    {
      id: "verse-lead",
      section_id: "verse",
      name: "Verse Lead",
      start: { measure: 0, beat: 0 },
      end: { measure: 1, beat: 0 },
      notes: [{
        id: "lead-note",
        position: { measure: 0, beat: 0 },
        duration: 960,
        note_number: 60,
        lyric: "ら",
        phonemes: "4 a",
      }],
    },
    true,
  );
  await upsertSongManifestVocalPart(
    manifestPath,
    manifestPath,
    2,
    { id: "voice-ia", name: "IA", component_id: "BLRGDDR4M3WM2LC6" },
    { id: "harmony", name: "Harmony", voice_id: "voice-ia", mixer: { pan: 84, volume: -240 } },
    {
      id: "verse-harmony",
      section_id: "verse",
      name: "Verse Harmony",
      start: { measure: 0, beat: 0 },
      end: { measure: 1, beat: 0 },
      notes: [{
        id: "harmony-note",
        position: { measure: 0, beat: 0 },
        duration: 960,
        note_number: 64,
        lyric: "ら",
        phonemes: "4 a",
      }],
    },
    true,
  );
  await upsertSongManifestArrangementTrack(
    manifestPath,
    manifestPath,
    3,
    {
      kind: "pitched",
      id: "piano",
      name: "Piano",
      program: 0,
      notes: [{ id: "piano-c", position: { measure: 0, beat: 0 }, duration: 1920, note_number: 48 }],
    },
    true,
  );
  const backingPath = join(temporary, "vocal-stem-song-backing-r4.wav");
  const projectPath = join(temporary, "vocal-stem-song-r4.vsqx");
  await buildSongManifest({
    manifestPath,
    expectedRevision: 4,
    backingOutputPath: backingPath,
    projectOutputPath: projectPath,
  });
  const before = (await loadSongManifest(manifestPath)).manifest;
  const result = await renderSongManifestVocalStems({
    manifestPath,
    expectedRevision: 5,
    projectArtifactId: "vsqx-r4",
    outputDirectory: temporary,
    centerPan: true,
    dry: true,
    allowPreSendAdjustment: false,
    timeoutSeconds: 180,
  });
  assert.equal(result.manifestRevision, 6);
  assert.equal(result.sourceCompositionHash, before.composition_hash);
  assert.deepEqual(result.stems.map((stem) => stem.trackId), ["lead", "harmony"]);
  assert.ok(result.stems.every((stem) => stem.channels === 2 && stem.silent === false));
  assert.ok(result.stems.every((stem) => stem.isolation.removedAudioParts === 1));
  assert.ok(result.stems.every((stem) => stem.outputPath.includes("vocal-stem-song-vocal-")));
  const after = (await loadSongManifest(manifestPath)).manifest;
  assert.equal(after.composition_hash, before.composition_hash);
  assert.deepEqual(
    after.artifacts.filter((artifact) => artifact.role === "vocal_stem")
      .map((artifact) => artifact.dependencies),
    [["vsqx-r4", "lead"], ["vsqx-r4", "harmony"]],
  );
  const analysis = await analyzeSongManifestVocalStem({
    manifestPath,
    expectedRevision: 6,
    stemArtifactId: "vocal-stem-lead-r5",
    outputPath: join(temporary, "vocal-stem-song-lead-r6.vocal-analysis.json"),
    sectionId: "verse",
    eventIds: ["lead-note"],
    timelineOffsetSeconds: 0,
    minimumPitchHz: 60,
    maximumPitchHz: 1_200,
    pitchToleranceCents: 120,
    onsetToleranceMilliseconds: 250,
    offsetToleranceMilliseconds: 250,
  });
  assert.equal(analysis.manifestRevision, 7);
  assert.equal(analysis.summary.events, 1);
  assert.equal(analysis.summary.eventsWithPitch, 1);
  assert.ok((analysis.events[0]?.pitchContour as unknown[] | undefined)?.length);
});
