import assert from "node:assert/strict";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { expandArrangement, renderAccompaniment } from "../src/accompaniment.js";


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("expands compact patterns across a 96-measure arrangement", () => {
  const arrangement = expandArrangement({
    outputPath: "unused.wav",
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 120 }],
    end: { measure: 96, beat: 0 },
    tracks: [
      {
        name: "Shamisen Ostinato",
        program: 106,
        patterns: [
          {
            id: "verse-2bar",
            measures: 2,
            notes: [0, 1, 2, 3].map((beat) => ({
              offset: { measure: beat < 2 ? 0 : 1, beat: beat % 2 },
              duration: 240,
              noteNumber: 64 + beat,
              velocity: 84,
            })),
          },
        ],
        placements: [
          {
            patternId: "verse-2bar",
            start: { measure: 0, beat: 0 },
            repeats: 48,
          },
        ],
      },
    ],
    drumPatterns: [
      {
        id: "taiko-bar",
        measures: 1,
        hits: [0, 1, 2, 3].map((beat) => ({
          offset: { measure: 0, beat },
          noteNumber: beat % 2 === 0 ? 36 : 38,
        })),
      },
    ],
    drumPlacements: [
      { patternId: "taiko-bar", start: { measure: 0, beat: 0 }, repeats: 96 },
    ],
    sampleRate: 44_100,
    gain: 0.2,
    reverb: true,
    chorus: true,
    overwrite: false,
  });
  assert.equal(arrangement.tracks[0]?.notes.length, 192);
  assert.equal(arrangement.drums.length, 384);
  assert.equal(arrangement.sourceNotes, 8);
  assert.equal(arrangement.patterns, 2);
  assert.equal(arrangement.placements, 2);
  assert.equal(arrangement.tracks[0]?.notes.at(-1)?.position.measure, 95);
});

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

test("renders the installed Japanese preset palette including a bank variation", async (context) => {
  if (!(await isReadable("/usr/bin/fluidsynth")) || !(await isReadable("/usr/share/sounds/sf2/FluidR3_GM.sf2"))) {
    context.skip("FluidSynth and the default GM SoundFont are unavailable");
    return;
  }
  const temporary = await mkdtemp(join(ROOT, ".test-japanese-palette-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const output = join(temporary, "wafuu.wav");
  const programs = [
    { name: "Shakuhachi", program: 77, bankLsb: 0, noteNumber: 76 },
    { name: "Shamisen", program: 106, bankLsb: 0, noteNumber: 64 },
    { name: "Taisho Koto", program: 107, bankLsb: 8, noteNumber: 69 },
    { name: "Taiko", program: 116, bankLsb: 0, noteNumber: 48 },
  ];
  const result = await renderAccompaniment({
    outputPath: output,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 120 }],
    end: { measure: 1, beat: 0 },
    tracks: programs.map((preset, beat) => ({
      name: preset.name,
      program: preset.program,
      bankMsb: 0,
      bankLsb: preset.bankLsb,
      notes: [
        {
          position: { measure: 0, beat },
          duration: 420,
          noteNumber: preset.noteNumber,
          velocity: 88,
        },
      ],
    })),
    sampleRate: 44_100,
    gain: 0.15,
    reverb: true,
    chorus: false,
    overwrite: false,
  });
  assert.equal(result.tracks, 4);
  assert.equal(result.notes, 4);
  assert.equal(result.silent, false);
  assert.equal(result.clippedSampleValues, 0);
});
