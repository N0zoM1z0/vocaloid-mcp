import { normalizePitchClass, parsePitchName, pitchClassName, type ParsedPitchName } from "./pitch.js";


export type ScaleMode =
  | "major"
  | "natural_minor"
  | "harmonic_minor"
  | "melodic_minor"
  | "ionian"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "aeolian"
  | "locrian"
  | "major_pentatonic"
  | "minor_pentatonic"
  | "yo"
  | "in";

const MODE_INTERVALS: Readonly<Record<ScaleMode, readonly number[]>> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  natural_minor: [0, 2, 3, 5, 7, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
  melodic_minor: [0, 2, 3, 5, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  major_pentatonic: [0, 2, 4, 7, 9],
  minor_pentatonic: [0, 3, 5, 7, 10],
  yo: [0, 2, 5, 7, 9],
  in: [0, 1, 5, 7, 8],
};

const MODE_ALIASES: Readonly<Record<string, ScaleMode>> = {
  major: "major",
  maj: "major",
  ionian: "ionian",
  minor: "natural_minor",
  min: "natural_minor",
  naturalminor: "natural_minor",
  natural_minor: "natural_minor",
  aeolian: "aeolian",
  harmonicminor: "harmonic_minor",
  harmonic_minor: "harmonic_minor",
  melodicminor: "melodic_minor",
  melodic_minor: "melodic_minor",
  dorian: "dorian",
  phrygian: "phrygian",
  lydian: "lydian",
  mixolydian: "mixolydian",
  locrian: "locrian",
  majorpentatonic: "major_pentatonic",
  major_pentatonic: "major_pentatonic",
  majpent: "major_pentatonic",
  minorpentatonic: "minor_pentatonic",
  minor_pentatonic: "minor_pentatonic",
  minpent: "minor_pentatonic",
  yo: "yo",
  yō: "yo",
  in: "in",
};

export interface ParsedScale {
  tonic: ParsedPitchName;
  mode: ScaleMode;
  intervals: number[];
  pitchClasses: number[];
  pitchClassNames: string[];
}

export interface ScaleDegree {
  degree: number;
  alteration: number;
  exact: boolean;
}

const DIATONIC_LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;
const NATURAL_BY_LETTER: Readonly<Record<(typeof DIATONIC_LETTERS)[number], number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

export function normalizeScaleMode(input: string): ScaleMode | null {
  const normalized = input.trim().toLowerCase().replace(/[\s-]+/gu, "_");
  return MODE_ALIASES[normalized] ?? MODE_ALIASES[normalized.replaceAll("_", "")] ?? null;
}

export function parseScale(tonicInput: string, modeInput: string): ParsedScale | null {
  const tonic = parsePitchName(tonicInput);
  const mode = normalizeScaleMode(modeInput);
  if (!tonic || !mode) return null;
  const intervals = [...MODE_INTERVALS[mode]];
  const pitchClasses = intervals.map((interval) => normalizePitchClass(tonic.pitchClass + interval));
  const preference = tonic.accidental.includes("b") ? "flat" : "sharp";
  const tonicLetterIndex = DIATONIC_LETTERS.indexOf(tonic.letter);
  const diatonicNames = pitchClasses.length === 7
    ? pitchClasses.map((pitchClass, index) => {
        const letter = DIATONIC_LETTERS[(tonicLetterIndex + index) % DIATONIC_LETTERS.length]!;
        const offset = signedPitchClassOffset(NATURAL_BY_LETTER[letter], pitchClass);
        const accidental = offset > 0 ? "#".repeat(offset) : "b".repeat(-offset);
        return `${letter}${accidental}`;
      })
    : null;
  return {
    tonic,
    mode,
    intervals,
    pitchClasses,
    pitchClassNames: diatonicNames ?? pitchClasses.map((pitchClass) => pitchClassName(pitchClass, preference)),
  };
}

export function pitchClassInScale(pitchClass: number, scale: ParsedScale): boolean {
  return scale.pitchClasses.includes(normalizePitchClass(pitchClass));
}

function signedPitchClassOffset(from: number, to: number): number {
  const upward = normalizePitchClass(to - from);
  return upward > 6 ? upward - 12 : upward;
}

export function scaleDegreeForPitchClass(pitchClass: number, scale: ParsedScale): ScaleDegree {
  const normalized = normalizePitchClass(pitchClass);
  const exactIndex = scale.pitchClasses.indexOf(normalized);
  if (exactIndex >= 0) return { degree: exactIndex + 1, alteration: 0, exact: true };
  const candidates = scale.pitchClasses.map((candidate, index) => ({
    degree: index + 1,
    alteration: signedPitchClassOffset(candidate, normalized),
  }));
  candidates.sort((left, right) =>
    Math.abs(left.alteration) - Math.abs(right.alteration)
    || left.alteration - right.alteration
    || left.degree - right.degree);
  const nearest = candidates[0]!;
  return { ...nearest, exact: false };
}

export function scaleDegreeForPitchName(pitchName: string, scale: ParsedScale): ScaleDegree {
  const pitch = parsePitchName(pitchName);
  if (!pitch || scale.pitchClasses.length !== 7) {
    if (!pitch) throw new Error(`Invalid pitch name ${JSON.stringify(pitchName)}`);
    return scaleDegreeForPitchClass(pitch.pitchClass, scale);
  }
  const tonicLetterIndex = DIATONIC_LETTERS.indexOf(scale.tonic.letter);
  const pitchLetterIndex = DIATONIC_LETTERS.indexOf(pitch.letter);
  const degreeIndex = (pitchLetterIndex - tonicLetterIndex + DIATONIC_LETTERS.length) % DIATONIC_LETTERS.length;
  const expectedPitchClass = scale.pitchClasses[degreeIndex]!;
  const alteration = signedPitchClassOffset(expectedPitchClass, pitch.pitchClass);
  return { degree: degreeIndex + 1, alteration, exact: alteration === 0 };
}

export function scaleIntervals(mode: ScaleMode): readonly number[] {
  return MODE_INTERVALS[mode];
}
