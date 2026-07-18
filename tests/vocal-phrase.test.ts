import assert from "node:assert/strict";
import test from "node:test";

import { compileVocalPhrase, rhythmValueTicks } from "../src/vocal-phrase.js";


const FOUR_FOUR = [{ measure: 0, numerator: 4, denominator: 4 }];

test("compiles rapid sequential lyrics at 1/32 resolution", () => {
  const lyrics = ["か", "け", "ぬ", "け", "る", "よ", "る", "へ"].map((lyric, index) => ({
    lyric,
    phonemes: ["k a", "k e", "n M", "k e", "4 M", "j o", "4 M", "h e"][index]!,
  }));
  const result = compileVocalPhrase(FOUR_FOUR, {
    start: { measure: 2, beat: 3 },
    allocation: "sequential",
    lyrics,
    cells: lyrics.map((_lyric, index) => ({
      duration: { denominator: 32 },
      noteNumber: 64 + (index % 3),
      gatePercent: 90,
    })),
  });
  assert.equal(result.noteCells, 8);
  assert.equal(result.endTick - result.startTick, 480);
  assert.equal(result.fastestNoteTicks, 54);
  assert.deepEqual(
    result.notes.map((note) => [note.position.measure, note.position.beat, note.position.tick]),
    [
      [2, 3, 0], [2, 3, 60], [2, 3, 120], [2, 3, 180],
      [2, 3, 240], [2, 3, 300], [2, 3, 360], [2, 3, 420],
    ],
  );
  assert.deepEqual(result.notes.map((note) => note.lyric), lyrics.map((lyric) => lyric.lyric));
});

test("compiles explicit melisma to native hyphen continuations", () => {
  const result = compileVocalPhrase(FOUR_FOUR, {
    start: { measure: 0, beat: 0 },
    allocation: "explicit",
    lyrics: [
      { lyric: "そ", phonemes: "s o", phonemeLocked: true },
      { lyric: "ら", phonemes: "4 a", phonemeLocked: true },
    ],
    cells: [
      { duration: { denominator: 8, tuplet: { played: 3, inTimeOf: 2 } }, noteNumber: 67, lyricIndex: 0 },
      { duration: { denominator: 8, tuplet: { played: 3, inTimeOf: 2 } }, noteNumber: 69, lyricIndex: 0 },
      { duration: { denominator: 8, tuplet: { played: 3, inTimeOf: 2 } }, noteNumber: 71, lyricIndex: 0 },
      { duration: { denominator: 4 }, noteNumber: 72, lyricIndex: 1 },
    ],
  });
  assert.equal(rhythmValueTicks({ denominator: 8, tuplet: { played: 3, inTimeOf: 2 } }), 160);
  assert.equal(result.continuations, 2);
  assert.deepEqual(result.notes.map((note) => note.lyric), ["そ", "-", "-", "ら"]);
  assert.deepEqual(result.notes.map((note) => note.phonemes), ["s o", "-", "-", "4 a"]);
  assert.equal(result.endTick, 960);
});
