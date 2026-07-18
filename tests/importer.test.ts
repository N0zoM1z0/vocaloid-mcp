import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { importVsqxToSongManifest } from "../src/importer.js";
import { loadSongManifest } from "../src/song-manifest.js";
import { createSong } from "../src/vsqx.js";


test("imports VSQX score into canonical stable-ID manifest with explicit source provenance", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-importer-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const sourcePath = join(temporary, "source.vsqx");
  await createSong({
    outputPath: sourcePath,
    format: "vsq3",
    sequenceName: "Imported Source",
    preMeasure: 1,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [
      { position: { measure: 0, beat: 0 }, bpm: 120 },
      { position: { measure: 1, beat: 0 }, bpm: 144 },
    ],
    tracks: [{
      name: "IA_ROCKS Lead",
      voice: { name: "IA_ROCKS", componentId: "BDREB7P2KTWKYDC5" },
      bankSelect: 0,
      programChange: 0,
      parts: [{
        name: "Verse",
        start: { measure: 0, beat: 0 },
        end: { measure: 2, beat: 0 },
        notes: [
          { position: { measure: 0, beat: 0 }, duration: 480, noteNumber: 69, lyric: "は", phonemes: "h a", phonemeLocked: true, velocity: 72, style: { opening: 80 } },
          { position: { measure: 0, beat: 1 }, duration: 960, noteNumber: 72, lyric: "な", phonemes: "n a", phonemeLocked: true, velocity: 76, vibrato: { type: 2, length: 45 } },
        ],
        controlCurves: {
          DYN: [{ position: { measure: 0, beat: 0 }, value: 64 }, { position: { measure: 1, beat: 0 }, value: 88 }],
        },
      }],
    }],
    overwrite: false,
  });
  const manifestPath = join(temporary, "imported.song.json");
  const result = await importVsqxToSongManifest({
    sourcePath,
    outputManifestPath: manifestPath,
    songId: "imported-source",
    slug: "imported-source",
    title: "Imported Source",
    overwrite: false,
    sampleRate: 44_100,
    accompanimentGain: 0.2,
  });
  assert.deepEqual(result.imported, { tracks: 1, parts: 1, notes: 2, controls: 2 });
  const manifest = (await loadSongManifest(manifestPath)).manifest;
  assert.equal(manifest.vocal_tracks[0]?.voice_id, "voice-ia-rocks");
  assert.equal(manifest.vocal_tracks[0]?.parts[0]?.notes[1]?.vibrato?.type, 2);
  assert.equal(manifest.vocal_tracks[0]?.parts[0]?.control_curves[0]?.curve, "DYN");
  assert.equal(manifest.tempos[1]?.bpm, 144);
  assert.equal(manifest.artifacts.at(-1)?.metadata.kind, "vsqx-import-source");
  assert.equal(manifest.artifacts.at(-1)?.role, "analysis");
});
