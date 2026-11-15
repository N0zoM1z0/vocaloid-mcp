const NATURAL_PITCH_CLASSES: Readonly<Record<PitchLetter, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"] as const;

export type PitchLetter = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export interface ParsedPitchName {
  input: string;
  letter: PitchLetter;
  accidental: string;
  accidentalOffset: number;
  pitchClass: number;
  normalized: string;
}

export function normalizePitchClass(value: number): number {
  if (!Number.isInteger(value)) throw new Error(`Pitch class must be an integer, got ${value}`);
  return ((value % 12) + 12) % 12;
}

function accidentalOffset(accidental: string): number | null {
  let offset = 0;
  for (const token of accidental) {
    if (token === "#") offset += 1;
    else if (token === "b") offset -= 1;
    else if (token === "x") offset += 2;
    else return null;
  }
  return offset;
}

export function parsePitchName(input: string): ParsedPitchName | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^([A-Ga-g])((?:#{1,2}|b{1,2}|x)?)$/u);
  if (!match) return null;
  const letter = match[1]!.toUpperCase() as PitchLetter;
  const accidental = match[2] ?? "";
  const offset = accidentalOffset(accidental);
  if (offset === null) return null;
  return {
    input,
    letter,
    accidental,
    accidentalOffset: offset,
    pitchClass: normalizePitchClass(NATURAL_PITCH_CLASSES[letter] + offset),
    normalized: `${letter}${accidental}`,
  };
}

export function pitchClassName(pitchClass: number, preference: "sharp" | "flat" = "sharp"): string {
  return (preference === "flat" ? FLAT_NAMES : SHARP_NAMES)[normalizePitchClass(pitchClass)]!;
}

export function midiNoteName(noteNumber: number, preference: "sharp" | "flat" = "sharp"): string {
  if (!Number.isInteger(noteNumber) || noteNumber < 0 || noteNumber > 127) {
    throw new Error(`MIDI note number must be an integer in 0..127, got ${noteNumber}`);
  }
  return `${pitchClassName(noteNumber, preference)}${Math.floor(noteNumber / 12) - 1}`;
}

export function intervalClass(fromPitchClass: number, toPitchClass: number): number {
  return normalizePitchClass(normalizePitchClass(toPitchClass) - normalizePitchClass(fromPitchClass));
}

export function enharmonicEquivalent(left: string | number, right: string | number): boolean {
  const resolve = (value: string | number): number | null =>
    typeof value === "number" ? normalizePitchClass(value) : parsePitchName(value)?.pitchClass ?? null;
  const leftPitch = resolve(left);
  const rightPitch = resolve(right);
  return leftPitch !== null && rightPitch !== null && leftPitch === rightPitch;
}
