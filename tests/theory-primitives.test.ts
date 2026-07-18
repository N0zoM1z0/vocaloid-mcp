import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { createSongManifest, loadSongManifest } from "../src/song-manifest.js";
import {
  harmonicFunctionForChord,
  parseChordSymbol,
  romanNumeralForChord,
} from "../src/theory/chord.js";
import {
  enharmonicEquivalent,
  intervalClass,
  midiNoteName,
  parsePitchName,
  pitchClassName,
} from "../src/theory/pitch.js";
import {
  normalizeScaleMode,
  parseScale,
  pitchClassInScale,
  scaleDegreeForPitchClass,
  scaleDegreeForPitchName,
} from "../src/theory/scale.js";
import {
  activeIntervalAt,
  activePointAt,
  buildTheoryTimeline,
  intervalsAt,
  theoryContextAtTick,
  timelineTick,
} from "../src/theory/timeline.js";


test("pitch primitives preserve spelling and compare enharmonic pitch classes", () => {
  assert.deepEqual(parsePitchName("E#"), {
    input: "E#",
    letter: "E",
    accidental: "#",
    accidentalOffset: 1,
    pitchClass: 5,
    normalized: "E#",
  });
  assert.equal(parsePitchName("H"), null);
  assert.equal(enharmonicEquivalent("F#", "Gb"), true);
  assert.equal(enharmonicEquivalent("C", "B#"), true);
  assert.equal(enharmonicEquivalent("C", "Db"), false);
  assert.equal(pitchClassName(13, "flat"), "Db");
  assert.equal(midiNoteName(60), "C4");
  assert.equal(intervalClass(11, 2), 3);
});

test("scale primitives normalize modes, preserve diatonic spelling, and expose altered degrees", () => {
  assert.equal(normalizeScaleMode("Natural Minor"), "natural_minor");
  assert.equal(normalizeScaleMode("yō"), "yo");
  assert.equal(normalizeScaleMode("unknown"), null);

  const sharpMajor = parseScale("F#", "major");
  assert.ok(sharpMajor);
  assert.deepEqual(sharpMajor.pitchClassNames, ["F#", "G#", "A#", "B", "C#", "D#", "E#"]);
  assert.equal(pitchClassInScale(5, sharpMajor), true);
  assert.equal(pitchClassInScale(6, sharpMajor), true);

  const cMajor = parseScale("C", "ionian");
  assert.ok(cMajor);
  assert.deepEqual(scaleDegreeForPitchClass(11, cMajor), { degree: 7, alteration: 0, exact: true });
  assert.deepEqual(scaleDegreeForPitchName("Db", cMajor), { degree: 2, alteration: -1, exact: false });
  assert.deepEqual(scaleDegreeForPitchName("C#", cMajor), { degree: 1, alteration: 1, exact: false });

  const inScale = parseScale("D", "in");
  assert.ok(inScale);
  assert.deepEqual(inScale.intervals, [0, 1, 5, 7, 8]);
});

test("chord parser handles alterations, omissions, extensions, slash bass, and unsupported tokens", () => {
  const cases: Array<[string, number[], string]> = [
    ["Cmaj7", [0, 4, 7, 11], "major"],
    ["F#m7/C#", [0, 3, 7, 10], "minor"],
    ["Bbsus4", [0, 5, 7], "suspended_fourth"],
    ["Bm7b5", [0, 3, 6, 10], "half_diminished"],
    ["C7(b9,#11)", [0, 1, 4, 6, 7, 10], "major"],
    ["C13(no5)", [0, 2, 4, 5, 9, 10], "major"],
    ["Ddim7", [0, 3, 6, 9], "diminished"],
    ["Eaug", [0, 4, 8], "augmented"],
  ];
  for (const [symbol, relativePitchClasses, quality] of cases) {
    const chord = parseChordSymbol(symbol);
    assert.ok(chord, symbol);
    const relative = chord.pitchClasses
      .map((pitchClass) => (pitchClass - chord.rootPitchClass + 12) % 12)
      .sort((left, right) => left - right);
    assert.deepEqual(relative, relativePitchClasses, symbol);
    assert.equal(chord.normalizedQuality, quality, symbol);
    assert.equal(chord.exact, true, symbol);
  }
  assert.equal(parseChordSymbol("not-a-chord"), null);
  const partial = parseChordSymbol("Cmaj7mystery");
  assert.ok(partial);
  assert.equal(partial.exact, false);
  assert.deepEqual(partial.unsupportedTokens, ["mystery"]);
});

test("Roman numeral and harmonic function use active scale spelling", () => {
  const scale = parseScale("C", "major");
  const dominant = parseChordSymbol("G7");
  const borrowed = parseChordSymbol("Dbmaj7");
  const supertonic = parseChordSymbol("Dm7");
  assert.ok(scale && dominant && borrowed && supertonic);
  assert.equal(romanNumeralForChord(dominant, scale), "V7");
  assert.equal(romanNumeralForChord(borrowed, scale), "bII7");
  assert.equal(harmonicFunctionForChord(dominant, scale), "dominant");
  assert.equal(harmonicFunctionForChord(supertonic, scale), "predominant");
  assert.equal(harmonicFunctionForChord(borrowed, scale), "other");
});

test("timeline index resolves active meter, tempo, key, chord, and section deterministically", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-theory-timeline-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const path = join(temporary, "timeline.song.json");
  await createSongManifest({
    outputPath: path,
    songId: "theory-timeline",
    slug: "theory-timeline",
    title: "Theory Timeline",
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [
      { measure: 0, numerator: 4, denominator: 4 },
      { measure: 2, numerator: 6, denominator: 8 },
    ],
    tempos: [
      { position: { measure: 0, beat: 0 }, bpm: 120 },
      { position: { measure: 2, beat: 0 }, bpm: 150 },
    ],
    sections: [
      { id: "verse", name: "Verse", kind: "verse", start: { measure: 0, beat: 0 }, end: { measure: 2, beat: 0 } },
      { id: "chorus", name: "Chorus", kind: "chorus", start: { measure: 2, beat: 0 }, end: { measure: 4, beat: 0 } },
    ],
    keyChanges: [
      { id: "key-c", position: { measure: 0, beat: 0 }, tonic: "C", mode: "major" },
      { id: "key-d-dorian", position: { measure: 2, beat: 0 }, tonic: "D", mode: "dorian" },
    ],
    chordChanges: [
      { id: "chord-c", position: { measure: 0, beat: 0 }, symbol: "Cmaj7", duration_ticks: 1920 },
      { id: "chord-g", position: { measure: 1, beat: 0 }, symbol: "G7", duration_ticks: 1920 },
      { id: "chord-dm", position: { measure: 2, beat: 0 }, symbol: "Dm9", duration_ticks: 1440 },
    ],
    sampleRate: 44_100,
    gain: 0.2,
    reverb: false,
    chorus: false,
    overwrite: false,
  });
  const manifest = (await loadSongManifest(path)).manifest;
  const timeline = buildTheoryTimeline(manifest);
  const chorusTick = timelineTick(manifest, { measure: 2, beat: 0, tick: 0 });
  const contextAtChorus = theoryContextAtTick(timeline, chorusTick);
  assert.equal(contextAtChorus.meter?.value.numerator, 6);
  assert.equal(contextAtChorus.tempo?.value.bpm, 150);
  assert.equal(contextAtChorus.key?.value.parsed?.mode, "dorian");
  assert.equal(contextAtChorus.chord?.value.parsed?.symbol, "Dm9");
  assert.equal(contextAtChorus.section?.id, "chorus");
  assert.equal(activePointAt(timeline.keys, -1), null);
  assert.equal(activeIntervalAt(timeline.chords, timeline.songEndTick), null);
});

test("interval queries find long earlier intervals without scanning intervening gaps", () => {
  const intervals = [
    { id: "long", startTick: 0, endTick: 1000, value: "long" },
    { id: "short-a", startTick: 100, endTick: 200, value: "short-a" },
    { id: "short-b", startTick: 300, endTick: 400, value: "short-b" },
  ];
  assert.equal(activeIntervalAt(intervals, 150)?.id, "short-a");
  assert.equal(activeIntervalAt(intervals, 450)?.id, "long");
  assert.equal(activeIntervalAt(intervals, 1000), null);
  assert.deepEqual(intervalsAt(intervals, 150).map((event) => event.id), ["long", "short-a"]);
});
