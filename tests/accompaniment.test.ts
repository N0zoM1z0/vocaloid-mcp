import assert from "node:assert/strict";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { renderAccompaniment } from "../src/accompaniment.js";


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function isReadable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("renders structured instruments and drums to verified stereo PCM", async (context) => {
  if (!(await isReadable("/usr/bin/fluidsynth")) || !(await isReadable("/usr/share/sounds/sf2/FluidR3_GM.sf2"))) {
    context.skip("FluidSynth and the default GM SoundFont are unavailable");
    return;
  }
  const temporary = await mkdtemp(join(ROOT, ".test-accompaniment-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const output = join(temporary, "backing.wav");
  const result = await renderAccompaniment({
    outputPath: output,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 120 }],
    end: { measure: 1, beat: 0 },
    tracks: [
      {
        name: "Piano",
        program: 0,
        pan: 52,
        notes: [
          { position: { measure: 0, beat: 0 }, duration: 480, noteNumber: 60 },
          { position: { measure: 0, beat: 1 }, duration: 480, noteNumber: 64 },
          { position: { measure: 0, beat: 2 }, duration: 480, noteNumber: 67 },
          { position: { measure: 0, beat: 3 }, duration: 480, noteNumber: 72 },
        ],
      },
      {
        name: "Bass",
        program: 33,
        pan: 72,
        notes: [
          { position: { measure: 0, beat: 0 }, duration: 960, noteNumber: 36 },
          { position: { measure: 0, beat: 2 }, duration: 960, noteNumber: 43 },
        ],
      },
    ],
    drums: [
      { position: { measure: 0, beat: 0 }, noteNumber: 36 },
      { position: { measure: 0, beat: 1 }, noteNumber: 38 },
      { position: { measure: 0, beat: 2 }, noteNumber: 36 },
      { position: { measure: 0, beat: 3 }, noteNumber: 38 },
    ],
    sampleRate: 44_100,
    gain: 0.2,
    reverb: true,
    chorus: true,
    overwrite: false,
  });
  assert.equal(result.audioFormat, "pcm");
  assert.equal(result.bitsPerSample, 16);
  assert.equal(result.channels, 2);
  assert.equal(result.sampleRate, 44_100);
  assert.equal(result.silent, false);
  assert.equal(result.tracks, 2);
  assert.equal(result.notes, 6);
  assert.equal(result.drumHits, 4);
  assert.equal(result.endTick, 1920);
  assert.ok(result.durationSeconds >= 2);
  assert.deepEqual(await readdir(temporary), ["backing.wav"]);
});
