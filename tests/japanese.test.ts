import assert from "node:assert/strict";
import test from "node:test";

import {
  alignJapanesePhrase,
  japaneseG2P,
  VOCALOID3_JAPANESE_PHONEMES,
} from "../src/japanese.js";
import { ManifestVocalPhraseSchema } from "../src/song-manifest.js";
import { compileVocalPhrase } from "../src/vocal-phrase.js";


const FOUR_FOUR = [{ measure: 0, numerator: 4, denominator: 4 }];

test("maps kana through only the bundled VOCALOID3 Japanese phoneme inventory", () => {
  const result = japaneseG2P({ text: "きぼう しあわせ つき いのち そら じかん" });
  assert.deepEqual(
    result.units.map((unit) => [unit.surface, unit.phonemes]),
    [
      ["き", "k' i"], ["ぼ", "b o"], ["う", "M"],
      ["し", "S i"], ["あ", "a"], ["わ", "w a"], ["せ", "s e"],
      ["つ", "ts M"], ["き", "k' i"],
      ["い", "i"], ["の", "n o"], ["ち", "tS i"],
      ["そ", "s o"], ["ら", "4 a"],
      ["じ", "dZ i"], ["か", "k a"], ["ん", "N\\"],
    ],
  );
  const allowed = new Set(VOCALOID3_JAPANESE_PHONEMES);
  assert.ok(result.units.flatMap((unit) => unit.phoneme_tokens).every((token) => allowed.has(token as never)));
  assert.equal(result.fallback_count, 0);
});

test("normalizes katakana, yoon, long vowels, foreign kana, and explicit pronunciation choices", () => {
  assert.deepEqual(
    japaneseG2P({ text: "キャラスーパー ファイル" }).units.map((unit) => unit.phonemes),
    ["k' a", "4 a", "s M", "M", "p a", "a", "p\\ a", "i", "4 M"],
  );
  assert.equal(japaneseG2P({ text: "いじ" }).units[1]?.phonemes, "Z i");
  assert.equal(japaneseG2P({ text: "いじ", affricate_mode: "affricate" }).units[1]?.phonemes, "dZ i");
  assert.equal(japaneseG2P({ text: "かが", g_mode: "nasal_between_vowels" }).units[1]?.phonemes, "N a");
  const vFallback = japaneseG2P({ text: "ヴォーカル" });
  assert.equal(vFallback.units[0]?.phonemes, "b o");
  assert.equal(vFallback.fallback_count, 1);
  assert.match(vFallback.warnings.join(" "), /no \/v\/ token/u);
});

test("requires explicit kana reading for kanji instead of guessing", () => {
  assert.throws(() => japaneseG2P({ text: "希望" }), /provide an explicit kana reading/u);
  const result = japaneseG2P({ text: "希望", reading: "きぼう" });
  assert.equal(result.source_text, "希望");
  assert.deepEqual(result.units.map((unit) => unit.phonemes), ["k' i", "b o", "M"]);
});

test("aligns rapid sequential morae into a manifest-compatible phrase", () => {
  const result = alignJapanesePhrase({
    text: "かけぬけるよるへ",
    phrase_id: "rapid-phrase",
    start: { measure: 2, beat: 3 },
    allocation: "sequential",
    note_slots: Array.from({ length: 8 }, (_unused, index) => ({
      id: `rapid-cell-${index + 1}`,
      duration: { denominator: 32 as const },
      note_number: 64 + index % 3,
      gate_percent: 90,
    })),
  });
  const phrase = ManifestVocalPhraseSchema.parse(result.phrase);
  assert.equal(phrase.lyrics.length, 8);
  assert.equal(phrase.cells.length, 8);
  assert.deepEqual(phrase.linguistic_source, {
    language: "ja",
    text: "かけぬけるよるへ",
    reading: "かけぬけるよるへ",
    normalized_reading: "かけぬけるよるへ",
    affricate_mode: "position",
    g_mode: "plosive",
    sokuon_strategy: "not_needed",
  });
  assert.deepEqual(phrase.lyrics.map((unit) => unit.phonemes), [
    "k a", "k e", "n M", "k e", "4 M", "j o", "4 M", "h e",
  ]);
});

test("aligns explicit repeated mora indices to native melisma continuations", () => {
  const result = alignJapanesePhrase({
    text: "そら",
    phrase_id: "melisma-phrase",
    start: { measure: 0, beat: 0 },
    allocation: "explicit",
    note_slots: [
      { id: "melisma-cell-1", duration: 120, note_number: 67, mora_index: 0 },
      { id: "melisma-cell-2", duration: 120, note_number: 69, mora_index: 0 },
      { id: "melisma-cell-3", duration: 240, note_number: 71, mora_index: 1 },
    ],
  });
  const compiled = compileVocalPhrase(FOUR_FOUR, {
    start: result.phrase.start,
    allocation: result.phrase.allocation,
    lyrics: result.phrase.lyrics.map((unit) => ({
      lyric: unit.lyric,
      phonemes: unit.phonemes,
      phonemeLocked: unit.phoneme_locked,
    })),
    cells: result.phrase.cells.map((cell) => ({
      duration: typeof cell.duration === "number"
        ? cell.duration
        : {
            denominator: cell.duration.denominator,
            dots: cell.duration.dots,
            ...(cell.duration.tuplet
              ? { tuplet: { played: cell.duration.tuplet.played, inTimeOf: cell.duration.tuplet.in_time_of } }
              : {}),
          },
      rest: cell.rest,
      ...(cell.note_number !== undefined ? { noteNumber: cell.note_number } : {}),
      ...(cell.lyric_index !== undefined ? { lyricIndex: cell.lyric_index } : {}),
    })),
  });
  assert.equal(result.alignment.continuations, 1);
  assert.deepEqual(compiled.notes.map((note) => note.lyric), ["そ", "-", "ら"]);
  assert.deepEqual(compiled.notes.map((note) => note.phonemes), ["s o", "-", "4 a"]);
});

test("makes small-tsu timing explicit without inventing a chart token", () => {
  const g2p = japaneseG2P({ text: "がっこう" });
  assert.equal(g2p.units[1]?.kind, "sokuon");
  assert.equal(g2p.units[1]?.phonemes, null);
  assert.equal(g2p.units[1]?.next_onset, "k");
  assert.throws(
    () => alignJapanesePhrase({
      text: "がっこう",
      phrase_id: "school",
      start: { measure: 0, beat: 0 },
      note_slots: [
        { id: "school-1", duration: 120, note_number: 60 },
        { id: "school-2", duration: 120, note_number: 62 },
        { id: "school-3", duration: 120, note_number: 64 },
      ],
    }),
    /choose sokuon_strategy/u,
  );
  const rested = alignJapanesePhrase({
    text: "がっこう",
    phrase_id: "school",
    start: { measure: 0, beat: 0 },
    sokuon_strategy: "rest",
    note_slots: [
      { id: "school-1", duration: 120, note_number: 60 },
      { id: "school-stop", duration: 60, rest: true },
      { id: "school-2", duration: 120, note_number: 62 },
      { id: "school-3", duration: 120, note_number: 64 },
    ],
  });
  assert.equal(rested.alignment.sokuon_count, 1);
  assert.equal(rested.phrase.cells[1]?.rest, true);
  assert.equal(rested.phrase.lyrics[1]?.lyric, "っこ");
  assert.ok(rested.phrase.lyrics.every((unit) => !unit.phonemes.includes("っ")));
  const attached = alignJapanesePhrase({
    text: "がっこう",
    phrase_id: "school-attached",
    start: { measure: 0, beat: 0 },
    sokuon_strategy: "attach_next",
    note_slots: [
      { id: "school-attached-1", duration: 120, note_number: 60 },
      { id: "school-attached-2", duration: 120, note_number: 62 },
      { id: "school-attached-3", duration: 120, note_number: 64 },
    ],
  });
  assert.equal(attached.phrase.lyrics[1]?.lyric, "っこ");
  assert.equal(attached.phrase.lyrics[1]?.phonemes, "k k o");
  assert.match(attached.warnings.join(" "), /experimental repeated-consonant/u);
  assert.throws(
    () => alignJapanesePhrase({
      text: "がっこう",
      phrase_id: "school-bad",
      start: { measure: 0, beat: 0 },
      sokuon_strategy: "rest",
      note_slots: [
        { id: "school-bad-stop", duration: 60, rest: true },
        { id: "school-bad-1", duration: 120, note_number: 60 },
        { id: "school-bad-2", duration: 120, note_number: 62 },
        { id: "school-bad-3", duration: 120, note_number: 64 },
      ],
    }),
    /insert a rest slot here/u,
  );
});

test("keeps generated phrase IDs and lyric counts inside manifest limits", () => {
  assert.throws(
    () => alignJapanesePhrase({
      text: "あ",
      phrase_id: `p${"x".repeat(85)}`,
      start: { measure: 0, beat: 0 },
      note_slots: [{ id: "id-limit-cell", duration: 120, note_number: 60 }],
    }),
    /Invalid string/u,
  );
  assert.throws(
    () => alignJapanesePhrase({
      text: "あ".repeat(5001),
      phrase_id: "too-many-morae",
      start: { measure: 0, beat: 0 },
      note_slots: [{ id: "count-limit-cell", duration: 120, note_number: 60 }],
    }),
    /supports at most 5000/u,
  );
});
