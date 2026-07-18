const ROOTS: Readonly<Record<string, number>> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  "E#": 5,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
  Cb: 11,
};

export interface ParsedChord {
  symbol: string;
  root: string;
  rootPitchClass: number;
  quality: string;
  bass?: string;
  pitchClasses: number[];
  unsupportedExtensions: string[];
}

function normalizedQuality(raw: string): { intervals: number[]; unsupported: string[] } {
  const quality = raw.trim();
  const lower = quality.toLowerCase();
  let intervals: number[];
  if (/^(m|min|-)(?!aj)/u.test(lower)) intervals = [0, 3, 7];
  else if (/^(dim|o|°)/u.test(lower)) intervals = [0, 3, 6];
  else if (/^(aug|\+)/u.test(lower)) intervals = [0, 4, 8];
  else if (/^sus2/u.test(lower)) intervals = [0, 2, 7];
  else if (/^sus(4)?/u.test(lower)) intervals = [0, 5, 7];
  else if (/^5/u.test(lower)) intervals = [0, 7];
  else intervals = [0, 4, 7];

  if (/dim7|o7|°7/u.test(lower)) intervals.push(9);
  else if (/maj7|ma7|Δ7/u.test(quality)) intervals.push(11);
  else if (/(^|[^0-9])7/u.test(lower)) intervals.push(10);
  else if (/(^|[^0-9])6/u.test(lower)) intervals.push(9);
  if (/add9|\(9\)/u.test(lower)) intervals.push(2);
  else if (/(^|[^0-9])9/u.test(lower)) {
    if (!intervals.includes(10) && !intervals.includes(11)) intervals.push(10);
    intervals.push(2);
  }
  if (/add11|\(11\)/u.test(lower)) intervals.push(5);
  if (/add13|\(13\)/u.test(lower)) intervals.push(9);

  const recognized = [
    /m(?!aj)|min|-/giu, /dim|o|°/giu, /aug|\+/giu, /sus2|sus4|sus/giu,
    /maj7|ma7|Δ7|dim7|o7|°7|add9|add11|add13|5|6|7|9|11|13/giu,
    /[()]/gu,
  ];
  let remaining = quality;
  for (const expression of recognized) remaining = remaining.replace(expression, "");
  const unsupported = remaining.split(/[,\s]+/u).filter(Boolean);
  return { intervals: [...new Set(intervals)].sort((a, b) => a - b), unsupported };
}

export function parseChordSymbol(symbol: string): ParsedChord | null {
  const match = symbol.trim().match(/^([A-G](?:#|b)?)([^/]*)?(?:\/([A-G](?:#|b)?))?$/u);
  if (!match) return null;
  const root = match[1]!;
  const rootPitchClass = ROOTS[root];
  if (rootPitchClass === undefined) return null;
  const quality = match[2] ?? "";
  const bass = match[3];
  const { intervals, unsupported } = normalizedQuality(quality);
  const pitchClasses = intervals.map((interval) => (rootPitchClass + interval) % 12);
  if (bass && ROOTS[bass] !== undefined) pitchClasses.push(ROOTS[bass]!);
  return {
    symbol,
    root,
    rootPitchClass,
    quality,
    ...(bass ? { bass } : {}),
    pitchClasses: [...new Set(pitchClasses)].sort((a, b) => a - b),
    unsupportedExtensions: unsupported,
  };
}

export function isChordTone(noteNumber: number, chord: ParsedChord): boolean {
  return chord.pitchClasses.includes(((noteNumber % 12) + 12) % 12);
}
