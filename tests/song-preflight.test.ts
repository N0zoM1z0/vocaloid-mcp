import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildSongManifest,
  createSongManifest,
  upsertSongManifestArrangementTrack,
  upsertSongManifestVocalPart,
} from "../src/song-manifest.js";
import { preflightSongManifest } from "../src/song-preflight.js";


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("preflight aggregates vocal overlap and readiness before expensive build output", async (context) => {
  const temporary = await mkdtemp(join(ROOT, ".test-song-preflight-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "overlap.song.json");
  await createSongManifest({
    outputPath: manifestPath,
    songId: "preflight-overlap",
    slug: "preflight-overlap",
    title: "Preflight Overlap",
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
    gain: 0.18,
    reverb: false,
    chorus: false,
    overwrite: false,
  });
  const voice = { id: "voice-ia-rocks", name: "IA_ROCKS", component_id: "BDREB7P2KTWKYDC5" };
  const track = { id: "lead", name: "Lead", voice_id: voice.id };
  await upsertSongManifestVocalPart(
    manifestPath,
    manifestPath,
    1,
    voice,
    track,
    {
      id: "lead-a",
      section_id: "verse",
      name: "Lead A",
      start: { measure: 0, beat: 0 },
      end: { measure: 2, beat: 0 },
      notes: [{
        id: "note-a",
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
    voice,
    track,
    {
      id: "lead-b",
      section_id: "verse",
      name: "Lead B",
      start: { measure: 1, beat: 0 },
      end: { measure: 2, beat: 0 },
      notes: [{
        id: "note-b",
        position: { measure: 1, beat: 0 },
        duration: 480,
        note_number: 62,
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
      notes: [{
        id: "piano-c",
        position: { measure: 0, beat: 0 },
        duration: 480,
        note_number: 60,
      }],
    },
    true,
  );

  const result = await preflightSongManifest(manifestPath, {
    artifactCheck: "none",
    includePerformanceWarnings: true,
  });
  assert.equal(result.revision, 4);
  assert.equal(result.readiness.score.ready, false);
  assert.equal(result.readiness.build.ready, false);
  assert.ok(result.issues.some((entry) => entry.code === "PART_OVERLAP"));
  assert.equal(result.counts.errors, 1);

  const backingPath = join(temporary, "must-not-exist.wav");
  const projectPath = join(temporary, "must-not-exist.vsqx");
  await assert.rejects(
    buildSongManifest({
      manifestPath,
      expectedRevision: 4,
      backingOutputPath: backingPath,
      projectOutputPath: projectPath,
    }),
    /Song preflight rejected build: PART_OVERLAP/u,
  );
  assert.equal(await exists(backingPath), false);
  assert.equal(await exists(projectPath), false);
});

test("preflight distinguishes score readiness from later artifact stages", async (context) => {
  const temporary = await mkdtemp(join(ROOT, ".test-song-preflight-ready-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "ready.song.json");
  await createSongManifest({
    outputPath: manifestPath,
    songId: "preflight-ready",
    slug: "preflight-ready",
    title: "Preflight Ready",
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 132 }],
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
      id: "lead-part",
      section_id: "verse",
      name: "Lead Part",
      start: { measure: 0, beat: 0 },
      end: { measure: 1, beat: 0 },
      notes: [{
        id: "lead-note",
        position: { measure: 0, beat: 0 },
        duration: 480,
        note_number: 67,
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
        duration: 480,
        note_number: 48,
      }],
    },
    true,
  );
  const result = await preflightSongManifest(manifestPath, {
    artifactCheck: "none",
    includePerformanceWarnings: true,
  });
  assert.equal(result.counts.errors, 0);
  assert.equal(result.readiness.score.ready, true);
  assert.equal(result.readiness.build.ready, true);
  assert.deepEqual(result.readiness.render.blockers, ["CURRENT_VSQX_REQUIRED"]);
  assert.deepEqual(result.readiness.mix.blockers, [
    "CURRENT_VOCAL_STEM_REQUIRED",
    "CURRENT_INSTRUMENT_STEM_REQUIRED",
  ]);
});
