import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { discoverVoices } from "../src/voices.js";
import {
  createSong,
  inspectProject,
  listControlPoints,
  listNotes,
  prepareVocalStemProject,
  validateProject,
} from "../src/vsqx.js";
import type { SongPartInput } from "../src/vsqx.js";


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const IA = { name: "IA", componentId: "BLRGDDR4M3WM2LC6" };
const FOUR_FOUR = [{ measure: 0, numerator: 4, denominator: 4 }];

/** Write a one-track, one-part song whose part starts at measure 0. */
async function createSingleTrackSong(
  outputPath: string,
  format: "vsq3" | "vsq4",
  bpm: number,
  part: Omit<SongPartInput, "name" | "start">,
) {
  return createSong({
    outputPath,
    format,
    sequenceName: "Single Track",
    preMeasure: 1,
    timeSignatures: FOUR_FOUR,
    tempos: [{ position: { measure: 0, beat: 0 }, bpm }],
    tracks: [{
      name: "Lead",
      voice: IA,
      bankSelect: 0,
      programChange: 0,
      parts: [{ name: "Verse", start: { measure: 0, beat: 0 }, ...part }],
    }],
    overwrite: false,
  });
}

async function isReadable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeStereoWav(path: string, durationSeconds = 0.1): Promise<void> {
  const channels = 2;
  const sampleRate = 44_100;
  const bitsPerSample = 16;
  const frames = Math.round(sampleRate * durationSeconds);
  const blockAlign = channels * (bitsPerSample / 8);
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
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    const sample = Math.round(Math.sin((frame * Math.PI * 2 * 440) / sampleRate) * 4096);
    wav.writeInt16LE(sample, 44 + frame * blockAlign);
    wav.writeInt16LE(sample, 44 + frame * blockAlign + 2);
  }
  await writeFile(path, wav);
}

for (const format of ["vsq3", "vsq4"] as const) {
  test(`${format} writes notes, expressions, vibrato, and curves that read back and validate`, async (context) => {
    const temporary = await mkdtemp(join(ROOT, `.test-${format}-`));
    context.after(async () => rm(temporary, { recursive: true, force: true }));
    const output = join(temporary, `song-${format}.vsqx`);
    await createSingleTrackSong(output, format, 128, {
      end: { measure: 1, beat: 0 },
      notes: [
        { position: { measure: 0, beat: 0 }, duration: 480, noteNumber: 60, lyric: "ら", phonemes: "4 a", velocity: 64 },
        {
          position: { measure: 0, beat: 1 },
          duration: 480,
          noteNumber: 62,
          lyric: "ら",
          phonemes: "4 a",
          velocity: 58,
          style: { accent: 68, decay: 42, bendDep: 18, bendLen: 24, risePort: 1, opening: 112 },
          vibrato: {
            type: 13,
            length: 55,
            depth: [
              { position: 29_491, value: 48 },
              { position: 65_536, value: 68 },
            ],
            rate: [{ position: 29_491, value: 56 }],
          },
        },
        { position: { measure: 0, beat: 2 }, duration: 960, noteNumber: 64, lyric: "あ", phonemes: "a" },
      ],
      controlCurves: {
        DYN: [
          { position: { measure: 0, beat: 0 }, value: 64 },
          { position: { measure: 0, beat: 1 }, value: 80 },
        ],
      },
    });

    const validation = await validateProject(output);
    assert.equal(validation.valid, true, validation.diagnostics.join("\n"));
    const summary = await inspectProject(output);
    assert.equal(summary.format, format);
    assert.equal(summary.sequenceName, "Single Track");
    assert.equal(summary.tracks[0]?.noteCount, 3);
    assert.equal(summary.tempos[0]?.bpm, 128);

    const firstPage = await listNotes(output, 0, 0, undefined, undefined, 0, 1);
    assert.equal(firstPage.page.count, 1);
    assert.equal(firstPage.page.total, 3);
    assert.equal(firstPage.page.has_more, true);
    assert.equal(firstPage.page.next_offset, 1);
    assert.equal(firstPage.page.items[0]?.phonemes, "4 a", "numeric Japanese flap token survives");

    const controls = await listControlPoints(output, 0, 0, "DYN", undefined, undefined, 0, 100);
    assert.deepEqual(
      controls.page.items.map(({ tick, value, curve }) => ({ tick, value, curve })),
      [
        { tick: 0, value: 64, curve: "DYN" },
        { tick: 480, value: 80, curve: "DYN" },
      ],
    );

    const notes = await listNotes(output, 0, 0, undefined, undefined, 0, 100);
    const tuned = notes.page.items.find((note) => note.index === 1);
    assert.equal(tuned?.velocity, 58);
    assert.equal(tuned?.style.accent, 68);
    assert.equal(tuned?.style.bendDep, 18);
    assert.equal(tuned?.style.risePort, 1);
    assert.equal(tuned?.style.vibType, 13);
    assert.equal(tuned?.style.vibLen, 55);
    assert.deepEqual(tuned?.styleSequences.vibDep, [
      { position: 29_491, value: 48 },
      { position: 65_536, value: 68 },
    ]);
    assert.deepEqual(tuned?.styleSequences.vibRate, [
      { position: 29_491, value: 56 },
    ]);
  });
}

for (const format of ["vsq3", "vsq4"] as const) {
  test(`${format} creates a structured multi-track, multi-part song`, async (context) => {
    const temporary = await mkdtemp(join(ROOT, `.test-structured-${format}-`));
    context.after(async () => rm(temporary, { recursive: true, force: true }));
    const output = join(temporary, `structured-${format}.vsqx`);
    const backing = join(temporary, "backing.wav");
    await writeStereoWav(backing);
    const result = await createSong({
      outputPath: output,
      format,
      sequenceName: "Long Form Harmony",
      preMeasure: 1,
      timeSignatures: [
        { measure: 0, numerator: 4, denominator: 4 },
        { measure: 8, numerator: 3, denominator: 4 },
      ],
      tempos: [
        { position: { measure: 0, beat: 0 }, bpm: 120 },
        { position: { measure: 8, beat: 0 }, bpm: 132 },
      ],
      tracks: [
        {
          name: "Lead",
          voice: IA,
          bankSelect: 0,
          programChange: 0,
          mixer: { pan: 64, volume: 0 },
          parts: [
            {
              name: "Verse",
              start: { measure: 0, beat: 0 },
              end: { measure: 4, beat: 0 },
              notes: [
                {
                  position: { measure: 0, beat: 0 },
                  duration: 480,
                  noteNumber: 60,
                  lyric: "あ",
                  phonemes: "a",
                },
              ],
              controlCurves: {
                DYN: [
                  { position: { measure: 0, beat: 0 }, value: 64 },
                  { position: { measure: 3, beat: 3 }, value: 72 },
                ],
                PIT: [
                  { position: { measure: 1, beat: 0 }, value: -256 },
                ],
              },
            },
            {
              name: "Chorus",
              start: { measure: 8, beat: 0 },
              end: { measure: 12, beat: 0 },
              notes: [
                {
                  position: { measure: 8, beat: 0 },
                  duration: 720,
                  noteNumber: 67,
                  lyric: "ら",
                  phonemes: "4 a",
                },
              ],
            },
          ],
        },
        {
          name: "Harmony",
          voice: IA,
          bankSelect: 0,
          programChange: 0,
          mixer: { pan: 80, volume: -120 },
          parts: [
            {
              name: "Chorus Harmony",
              start: { measure: 8, beat: 0 },
              end: { measure: 12, beat: 0 },
              notes: [
                {
                  position: { measure: 8, beat: 0 },
                  duration: 720,
                  noteNumber: 64,
                  lyric: "ら",
                  phonemes: "4 a",
                },
              ],
            },
          ],
        },
      ],
      audioParts: [
        {
          name: "Backing",
          kind: "stereo",
          filePath: backing,
          start: { measure: 0, beat: 0 },
        },
      ],
      overwrite: false,
    });
    assert.deepEqual(
      { tracks: result.tracks, parts: result.parts, notes: result.notes, controls: result.controlPoints },
      { tracks: 2, parts: 3, notes: 3, controls: 3 },
    );
    assert.equal(result.audioParts, 1);
    const validation = await validateProject(output);
    assert.equal(validation.valid, true, validation.diagnostics.join("\n"));
    const summary = await inspectProject(output);
    assert.deepEqual(summary.timeSignatures, [
      { measure: 0, numerator: 4, denominator: 4 },
      { measure: 8, numerator: 3, denominator: 4 },
    ]);
    assert.deepEqual(summary.tempos, [
      { tick: 0, bpm: 120 },
      { tick: 17_280, bpm: 132 },
    ]);
    assert.equal(summary.tracks.length, 2);
    assert.equal(summary.tracks[0]?.parts[0]?.tick, 1_920);
    assert.equal(summary.tracks[0]?.parts[1]?.tick, 17_280);
    assert.equal(summary.tracks[1]?.parts[0]?.tick, 17_280);
    assert.equal(summary.audioParts.length, 1);
    assert.equal(summary.audioParts[0]?.kind, "stereo");
    assert.equal(summary.audioParts[0]?.sampleRate, 44_100);
    assert.equal(summary.audioParts[0]?.bitsPerSample, 16);
    assert.equal(summary.audioParts[0]?.channels, 2);
    assert.equal(summary.audioParts[0]?.playTime, 96);
    assert.match(summary.audioParts[0]?.filePath ?? "", /backing\.wav$/u);

    const isolated = join(temporary, `structured-${format}-harmony-stem.vsqx`);
    const isolation = await prepareVocalStemProject(
      output,
      isolated,
      1,
      { centerPan: true, dry: true, volume: -100 },
      false,
    );
    assert.equal(isolation.removedAudioParts, 1);
    assert.deepEqual(
      isolation.after.map((unit) => [
        unit.trackNumber,
        unit.mute,
        unit.pan,
        unit.volume,
        unit.sendEnabled,
        unit.sendLevel,
      ]),
      [
        [0, true, 64, 0, false, -898],
        [1, false, 64, -100, false, -898],
      ],
    );
    const isolatedSummary = await inspectProject(isolated);
    assert.equal(isolatedSummary.audioParts.length, 0);
    assert.equal((await validateProject(isolated)).valid, true);
  });
}

test("materializes PIT/PBS curves and pre-measure offsets", async (context) => {
  const temporary = await mkdtemp(join(ROOT, ".test-song-spec-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const output = join(temporary, "from-zero.vsqx");
  await createSingleTrackSong(output, "vsq4", 132, {
    end: { measure: 1, beat: 0 },
    notes: [{
      position: { measure: 0, beat: 0 },
      duration: 960,
      noteNumber: 64,
      lyric: "あ",
      phonemes: "a",
      vibrato: {
        type: 1,
        length: 50,
        depth: [{ position: 32_768, value: 64 }],
        rate: [{ position: 32_768, value: 50 }],
      },
    }],
    controlCurves: {
      DYN: [
        { position: { measure: 0, beat: 0 }, value: 58 },
        { position: { measure: 0, beat: 1, tick: 240 }, value: 72 },
      ],
      PBS: [{ position: { measure: 0, beat: 0 }, value: 2 }],
      PIT: [
        { position: { measure: 0, beat: 0 }, value: -1024 },
        { position: { measure: 0, beat: 0, tick: 90 }, value: 0 },
      ],
    },
  });
  assert.equal((await validateProject(output)).valid, true);
  const summary = await inspectProject(output);
  assert.equal(summary.tracks[0]?.parts[0]?.tick, 1_920, "one 4/4 pre-measure precedes measure 0");
  assert.equal((await listNotes(output, 0, 0, undefined, undefined, 0, 10)).page.items[0]?.style.vibType, 1);
  const curves = await listControlPoints(output, 0, 0, undefined, undefined, undefined, 0, 100);
  assert.equal(curves.page.total, 5);
  assert.deepEqual(
    curves.page.items.filter((point) => point.curve === "PIT").map(({ tick, value }) => [tick, value]),
    [[0, -1024], [90, 0]],
  );
});

test("discover the locally installed IA voices", async (context) => {
  const root = "/mnt/d/Vocaloid/VoiceDB";
  if (!(await isReadable(root))) {
    context.skip(`${root} is unavailable`);
    return;
  }
  const voices = await discoverVoices([root]);
  assert.ok(voices.some((voice) => voice.componentId === "BLRGDDR4M3WM2LC6"));
  assert.ok(voices.some((voice) => voice.componentId === "BDREB7P2KTWKYDC5"));
});

test("inspect the local real-world V4 corpus sample", async (context) => {
  const path = "/mnt/d/Vocaloid/vsqx/Creative (GHOST Remix)/Creative GHOST remix.vsqx";
  if (!(await isReadable(path))) {
    context.skip(`${path} is unavailable`);
    return;
  }
  const summary = await inspectProject(path);
  assert.equal(summary.format, "vsq4");
  assert.equal(summary.tracks.length, 6);
  assert.equal(
    summary.tracks.reduce((sum, track) => sum + track.noteCount, 0),
    1986,
  );
});
