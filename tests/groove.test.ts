import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  applySongManifestGroove,
  createSongManifest,
  loadSongManifest,
  upsertSongManifestArrangementTrack,
} from "../src/song-manifest.js";


test("seeded groove applies inspectable swing/humanize deltas reproducibly", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-groove-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const original = join(temporary, "groove.song.json");
  await createSongManifest({
    outputPath: original,
    songId: "groove-song",
    slug: "groove-song",
    title: "Groove Song",
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 150 }],
    sections: [{ id: "verse", name: "Verse", kind: "verse", start: { measure: 0, beat: 0 }, end: { measure: 4, beat: 0 } }],
    sampleRate: 44_100,
    gain: 0.2,
    reverb: false,
    chorus: false,
    overwrite: false,
  });
  await upsertSongManifestArrangementTrack(
    original,
    original,
    1,
    {
      kind: "pitched",
      id: "shamisen",
      name: "Shamisen",
      program: 106,
      patterns: [{
        id: "shamisen-eighths",
        measures: 1,
        notes: Array.from({ length: 8 }, (_, index) => ({
          id: `shamisen-${index}`,
          offset: { measure: 0, beat: Math.floor(index / 2), tick: (index % 2) * 240 },
          duration: 180,
          note_number: 60 + (index % 3),
          velocity: 90,
        })),
      }],
      placements: [{
        id: "shamisen-placement",
        pattern_id: "shamisen-eighths",
        section_id: "verse",
        start: { measure: 0, beat: 0 },
        repeats: 4,
      }],
    },
    true,
  );
  const copy = join(temporary, "groove-copy.song.json");
  await copyFile(original, copy);
  const parameters = {
    seed: "wa-rock-humanize-v1",
    arrangement_track_ids: ["shamisen"],
    targets: ["pattern_events" as const],
    grid_ticks: 240,
    swing_percent: 60,
    timing_jitter_ticks: 5,
    velocity_jitter: 6,
    gate_jitter_percent: 8,
    preserve_downbeats: true,
  };
  const first = await applySongManifestGroove(original, original, 2, parameters, true);
  const second = await applySongManifestGroove(copy, copy, 2, parameters, true);
  assert.equal(first.changed, 8);
  assert.deepEqual(first.deltas, second.deltas);
  assert.equal(first.deltas[0]?.random_timing_ticks, 0);
  assert.equal(first.deltas[0]?.swing_ticks, 0);
  assert.equal(first.deltas[1]?.swing_ticks, 48);
  assert.ok(first.deltas.some((entry) => entry.velocity_delta !== 0));
  assert.ok(first.deltas.some((entry) => entry.gate_delta_ticks !== 0));
  const firstManifest = (await loadSongManifest(original)).manifest;
  const secondManifest = (await loadSongManifest(copy)).manifest;
  assert.equal(firstManifest.composition_hash, secondManifest.composition_hash);
});
