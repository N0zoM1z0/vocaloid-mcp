import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { discoverVoices } from "../src/voices.js";
import {
  addControlPointsToProject,
  addNotesToProject,
  createProject,
  inspectProject,
  listControlPoints,
  listNotes,
  updateNoteExpressionsInProject,
  validateProject,
} from "../src/vsqx.js";


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const IA = { name: "IA", componentId: "BLRGDDR4M3WM2LC6" };
const BASE_NOTES = [
  { tick: 0, duration: 480, noteNumber: 60, lyric: "ら", phonemes: "a", velocity: 64 },
  { tick: 480, duration: 480, noteNumber: 62, lyric: "ら", phonemes: "a", velocity: 72 },
];

async function isReadable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

for (const format of ["vsq3", "vsq4"] as const) {
  test(`${format} create, edit, paginate, and validate`, async (context) => {
    const temporary = await mkdtemp(join(ROOT, `.test-${format}-`));
    context.after(async () => rm(temporary, { recursive: true, force: true }));
    const original = join(temporary, `original-${format}.vsqx`);
    const withNotes = join(temporary, `notes-${format}.vsqx`);
    const withControls = join(temporary, `controls-${format}.vsqx`);
    const withExpressions = join(temporary, `expressions-${format}.vsqx`);

    await createProject({
      outputPath: original,
      format,
      voice: IA,
      bankSelect: 0,
      programChange: 0,
      sequenceName: "MCP Smoke",
      trackName: "Lead",
      partName: "Verse",
      bpm: 128,
      numerator: 4,
      denominator: 4,
      preMeasure: 4,
      notes: BASE_NOTES,
      overwrite: false,
    });

    const validation = await validateProject(original);
    assert.equal(validation.valid, true, validation.diagnostics.join("\n"));
    const summary = await inspectProject(original);
    assert.equal(summary.format, format);
    assert.equal(summary.sequenceName, "MCP Smoke");
    assert.equal(summary.tracks[0]?.noteCount, 2);
    assert.equal(summary.tempos[0]?.bpm, 128);

    const firstPage = await listNotes(original, 0, 0, undefined, undefined, 0, 1);
    assert.equal(firstPage.page.count, 1);
    assert.equal(firstPage.page.total, 2);
    assert.equal(firstPage.page.has_more, true);
    assert.equal(firstPage.page.next_offset, 1);

    await addNotesToProject(
      original,
      withNotes,
      0,
      0,
      [{ tick: 960, duration: 960, noteNumber: 64, lyric: "あ", phonemes: "a" }],
      false,
    );
    assert.equal((await inspectProject(withNotes)).tracks[0]?.noteCount, 3);

    await addControlPointsToProject(
      withNotes,
      withControls,
      0,
      0,
      "DYN",
      [
        { tick: 0, value: 64 },
        { tick: 480, value: 80 },
      ],
      false,
      false,
    );
    const controls = await listControlPoints(
      withControls,
      0,
      0,
      "DYN",
      undefined,
      undefined,
      0,
      100,
    );
    assert.deepEqual(
      controls.page.items.map(({ tick, value, curve }) => ({ tick, value, curve })),
      [
        { tick: 0, value: 64, curve: "DYN" },
        { tick: 480, value: 80, curve: "DYN" },
      ],
    );
    const editedValidation = await validateProject(withControls);
    assert.equal(editedValidation.valid, true, editedValidation.diagnostics.join("\n"));

    await updateNoteExpressionsInProject(
      withControls,
      withExpressions,
      0,
      0,
      [
        {
          noteIndex: 1,
          velocity: 58,
          style: {
            accent: 68,
            decay: 42,
            bendDep: 18,
            bendLen: 24,
            risePort: 1,
            opening: 112,
          },
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
      ],
      false,
    );
    const tunedNotes = await listNotes(
      withExpressions,
      0,
      0,
      undefined,
      undefined,
      0,
      100,
    );
    const tuned = tunedNotes.page.items.find((note) => note.index === 1);
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
    const tunedValidation = await validateProject(withExpressions);
    assert.equal(tunedValidation.valid, true, tunedValidation.diagnostics.join("\n"));
  });
}

test("creates a tuned VSQX atomically from notes, vibrato, and curves", async (context) => {
  const temporary = await mkdtemp(join(ROOT, ".test-song-spec-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const output = join(temporary, "from-zero.vsqx");
  await createProject({
    outputPath: output,
    format: "vsq4",
    voice: IA,
    bankSelect: 0,
    programChange: 0,
    sequenceName: "From Zero",
    trackName: "Lead",
    partName: "Verse",
    bpm: 132,
    numerator: 4,
    denominator: 4,
    preMeasure: 1,
    notes: [
      {
        tick: 0,
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
      },
    ],
    controlCurves: {
      DYN: [
        { tick: 0, value: 58 },
        { tick: 720, value: 72 },
      ],
      PBS: [{ tick: 0, value: 2 }],
      PIT: [
        { tick: 0, value: -1024 },
        { tick: 90, value: 0 },
      ],
    },
    overwrite: false,
  });
  assert.equal((await validateProject(output)).valid, true);
  assert.equal((await listNotes(output, 0, 0, undefined, undefined, 0, 10)).page.items[0]?.style.vibType, 1);
  assert.equal((await listControlPoints(output, 0, 0, undefined, undefined, undefined, 0, 100)).page.total, 5);
});

test("accepts the numeric Japanese flap phoneme token", async (context) => {
  const temporary = await mkdtemp(join(ROOT, ".test-phonemes-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const output = join(temporary, "japanese-flap.vsqx");
  await createProject({
    outputPath: output,
    format: "vsq4",
    voice: IA,
    bankSelect: 0,
    programChange: 0,
    sequenceName: "Japanese flap phoneme regression",
    trackName: "Lead",
    partName: "Verse",
    bpm: 120,
    numerator: 4,
    denominator: 4,
    preMeasure: 1,
    notes: [
      { tick: 0, duration: 480, noteNumber: 60, lyric: "ら", phonemes: "4 a" },
    ],
    overwrite: false,
  });
  assert.equal((await validateProject(output)).valid, true);
  assert.equal(
    (await listNotes(output, 0, 0, undefined, undefined, 0, 10)).page.items[0]?.phonemes,
    "4 a",
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
