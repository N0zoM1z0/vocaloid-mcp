import { normalizePitchClass, parsePitchName, pitchClassName, type ParsedPitchName } from "./pitch.js";
import { scaleDegreeForPitchName, type ParsedScale, type ScaleDegree } from "./scale.js";


export type ChordQuality =
  | "major"
  | "minor"
  | "diminished"
  | "half_diminished"
  | "augmented"
  | "suspended_second"
  | "suspended_fourth"
  | "power";

export interface ParsedChord {
  symbol: string;
  root: string;
  rootPitchClass: number;
  quality: string;
  normalizedQuality: ChordQuality;
  bass?: string;
  bassPitchClass?: number;
  pitchClasses: number[];
  requiredPitchClasses: number[];
  optionalPitchClasses: number[];
  pitchClassNames: string[];
  unsupportedExtensions: string[];
  unsupportedTokens: string[];
  exact: boolean;
}

export type HarmonicFunction = "tonic" | "predominant" | "dominant" | "other";

interface ChordState {
  intervals: Set<number>;
  required: Set<number>;
  optional: Set<number>;
  quality: ChordQuality;
  explicitSeventh: "minor" | "major" | "diminished" | null;
}

function initialState(quality: ChordQuality): ChordState {
  const base: Readonly<Record<ChordQuality, readonly number[]>> = {
    major: [0, 4, 7],
    minor: [0, 3, 7],
    diminished: [0, 3, 6],
    half_diminished: [0, 3, 6, 10],
    augmented: [0, 4, 8],
    suspended_second: [0, 2, 7],
    suspended_fourth: [0, 5, 7],
    power: [0, 7],
  };
  const intervals = new Set(base[quality]);
  return {
    intervals,
    required: new Set(intervals),
    optional: new Set<number>(),
    quality,
    explicitSeventh: quality === "half_diminished" ? "minor" : null,
  };
}

function consumeBaseQuality(raw: string): { state: ChordState; remainder: string } {
  const normalizedRaw = raw.replace(/^major/u, "maj").replace(/^minor/u, "min");
  const candidates: Array<[RegExp, ChordQuality]> = [
    [/^(?:m7b5|ø7?)/u, "half_diminished"],
    [/^(?:min|m|-)(?!aj)/u, "minor"],
    [/^(?:dim|°|o)/u, "diminished"],
    [/^(?:aug|\+)/u, "augmented"],
    [/^sus2/u, "suspended_second"],
    [/^sus(?:4)?/u, "suspended_fourth"],
    [/^5/u, "power"],
    [/^(?:maj|M|Δ)(?![0-9])/u, "major"],
  ];
  for (const [pattern, quality] of candidates) {
    const match = normalizedRaw.match(pattern);
    if (!match) continue;
    return { state: initialState(quality), remainder: normalizedRaw.slice(match[0].length) };
  }
  return { state: initialState("major"), remainder: normalizedRaw };
}

function replaceThird(state: ChordState, interval: 2 | 5): void {
  for (const third of [3, 4]) {
    state.intervals.delete(third);
    state.required.delete(third);
    state.optional.delete(third);
  }
  state.intervals.add(interval);
  state.required.add(interval);
  state.quality = interval === 2 ? "suspended_second" : "suspended_fourth";
}

function addSeventh(state: ChordState, kind: "minor" | "major" | "diminished"): void {
  for (const interval of [9, 10, 11]) {
    state.intervals.delete(interval);
    state.required.delete(interval);
    state.optional.delete(interval);
  }
  const interval = kind === "major" ? 11 : kind === "diminished" ? 9 : 10;
  state.intervals.add(interval);
  state.required.add(interval);
  state.explicitSeventh = kind;
}

function addExtension(state: ChordState, degree: 9 | 11 | 13, majorSeventh: boolean): void {
  addSeventh(state, majorSeventh ? "major" : state.quality === "diminished" ? "diminished" : "minor");
  const extensions = degree === 9 ? [2] : degree === 11 ? [2, 5] : [2, 5, 9];
  for (const interval of extensions) {
    state.intervals.add(interval);
    state.optional.add(interval);
  }
}

function applyAlteration(state: ChordState, token: string): void {
  const degreeIntervals: Readonly<Record<string, readonly [number, number]>> = {
    b5: [7, 6],
    "#5": [7, 8],
    b9: [2, 1],
    "#9": [2, 3],
    "#11": [5, 6],
    b13: [9, 8],
  };
  const [natural, altered] = degreeIntervals[token]!;
  state.intervals.delete(natural);
  state.optional.delete(natural);
  state.required.delete(natural);
  state.intervals.add(altered);
  state.required.add(altered);
}

function omitDegree(state: ChordState, degree: 3 | 5): void {
  const candidates = degree === 3 ? [3, 4] : [6, 7, 8];
  for (const interval of candidates) {
    state.intervals.delete(interval);
    state.required.delete(interval);
    state.optional.delete(interval);
  }
}

function tokenizeQuality(raw: string, state: ChordState): string[] {
  let remaining = raw.replace(/[(),\s]/gu, "");
  const unsupported: string[] = [];
  const patterns: Array<[RegExp, (token: string) => void]> = [
    [/^(?:maj|M|Δ)(?:13|11|9|7)/u, (token) => {
      const degree = Number.parseInt(token.replace(/^(?:maj|M|Δ)/u, ""), 10) as 7 | 9 | 11 | 13;
      if (degree === 7) addSeventh(state, "major");
      else addExtension(state, degree, true);
    }],
    [/^(?:add)(?:13|11|9|2)/u, (token) => {
      const degree = Number.parseInt(token.slice(3), 10);
      const interval = degree === 2 || degree === 9 ? 2 : degree === 11 ? 5 : 9;
      state.intervals.add(interval);
      state.required.add(interval);
    }],
    [/^(?:omit|no)(?:3|5)/u, (token) => omitDegree(state, Number.parseInt(token.replace(/^(?:omit|no)/u, ""), 10) as 3 | 5)],
    [/^(?:sus2|sus4|sus)/u, (token) => replaceThird(state, token === "sus2" ? 2 : 5)],
    [/^(?:b5|#5|b9|#9|#11|b13)/u, (token) => applyAlteration(state, token)],
    [/^(?:13|11|9)/u, (token) => addExtension(state, Number.parseInt(token, 10) as 9 | 11 | 13, false)],
    [/^7/u, () => addSeventh(state, state.quality === "diminished" ? "diminished" : "minor")],
    [/^6/u, () => {
      state.intervals.add(9);
      state.required.add(9);
    }],
  ];
  while (remaining.length > 0) {
    let consumed = false;
    for (const [pattern, apply] of patterns) {
      const match = remaining.match(pattern);
      if (!match) continue;
      apply(match[0]);
      remaining = remaining.slice(match[0].length);
      consumed = true;
      break;
    }
    if (consumed) continue;
    const unknown = remaining.match(/^[^#b0-9]+|^(?:[#b]?[0-9]+)|^./u)?.[0] ?? remaining[0]!;
    unsupported.push(unknown);
    remaining = remaining.slice(unknown.length);
  }
  return unsupported;
}

function parseSymbolParts(symbol: string): {
  root: ParsedPitchName;
  quality: string;
  bass?: ParsedPitchName;
} | null {
  const trimmed = symbol.trim();
  const match = trimmed.match(/^([A-Ga-g](?:#{1,2}|b{1,2}|x)?)(.*?)(?:\/([A-Ga-g](?:#{1,2}|b{1,2}|x)?))?$/u);
  if (!match) return null;
  const root = parsePitchName(match[1]!);
  const bass = match[3] ? parsePitchName(match[3]) : undefined;
  if (!root || (match[3] && !bass)) return null;
  return { root, quality: match[2] ?? "", ...(bass ? { bass } : {}) };
}

export function parseChordSymbol(symbol: string): ParsedChord | null {
  const parts = parseSymbolParts(symbol);
  if (!parts) return null;
  const { state, remainder } = consumeBaseQuality(parts.quality);
  const unsupportedTokens = tokenizeQuality(remainder, state);
  const requiredIntervals = [...state.required].sort((left, right) => left - right);
  const optionalIntervals = [...state.optional]
    .filter((interval) => !state.required.has(interval))
    .sort((left, right) => left - right);
  const intervals = [...state.intervals].sort((left, right) => left - right);
  const toPitchClass = (interval: number): number => normalizePitchClass(parts.root.pitchClass + interval);
  const pitchClasses = intervals.map(toPitchClass);
  if (parts.bass && !pitchClasses.includes(parts.bass.pitchClass)) pitchClasses.push(parts.bass.pitchClass);
  pitchClasses.sort((left, right) => left - right);
  const preference = parts.root.accidental.includes("b") ? "flat" : "sharp";
  return {
    symbol,
    root: parts.root.normalized,
    rootPitchClass: parts.root.pitchClass,
    quality: parts.quality,
    normalizedQuality: state.quality,
    ...(parts.bass ? { bass: parts.bass.normalized, bassPitchClass: parts.bass.pitchClass } : {}),
    pitchClasses,
    requiredPitchClasses: requiredIntervals.map(toPitchClass).sort((left, right) => left - right),
    optionalPitchClasses: optionalIntervals.map(toPitchClass).sort((left, right) => left - right),
    pitchClassNames: pitchClasses.map((pitchClass) => pitchClassName(pitchClass, preference)),
    unsupportedExtensions: unsupportedTokens,
    unsupportedTokens,
    exact: unsupportedTokens.length === 0,
  };
}

export function isChordTone(noteNumber: number, chord: ParsedChord): boolean {
  return chord.pitchClasses.includes(normalizePitchClass(noteNumber));
}

function accidentalPrefix(alteration: number): string {
  if (alteration === 0) return "";
  return alteration > 0 ? "#".repeat(alteration) : "b".repeat(-alteration);
}

function romanBase(degree: ScaleDegree, chord: ParsedChord): string {
  const numerals = ["I", "II", "III", "IV", "V", "VI", "VII"];
  const numeral = numerals[degree.degree - 1] ?? String(degree.degree);
  const lower = chord.normalizedQuality === "minor"
    || chord.normalizedQuality === "diminished"
    || chord.normalizedQuality === "half_diminished";
  const qualityMark = chord.normalizedQuality === "diminished"
    ? "°"
    : chord.normalizedQuality === "half_diminished"
      ? "ø"
      : chord.normalizedQuality === "augmented"
        ? "+"
        : "";
  return `${accidentalPrefix(degree.alteration)}${lower ? numeral.toLowerCase() : numeral}${qualityMark}`;
}

function extensionSuffix(chord: ParsedChord): string {
  const compact = chord.quality.replace(/[(),\s]/gu, "");
  if (/13/u.test(compact)) return "13";
  if (/11/u.test(compact)) return "11";
  if (/9/u.test(compact)) return "9";
  if (/7/u.test(compact) || chord.normalizedQuality === "half_diminished") return "7";
  if (/6/u.test(compact)) return "6";
  return "";
}

export function romanNumeralForChord(chord: ParsedChord, scale: ParsedScale): string {
  const degree = scaleDegreeForPitchName(chord.root, scale);
  return `${romanBase(degree, chord)}${extensionSuffix(chord)}`;
}

export function harmonicFunctionForChord(chord: ParsedChord, scale: ParsedScale): HarmonicFunction {
  const degree = scaleDegreeForPitchName(chord.root, scale);
  if (degree.alteration !== 0) return "other";
  if ([1, 3, 6].includes(degree.degree)) return "tonic";
  if ([2, 4].includes(degree.degree)) return "predominant";
  if ([5, 7].includes(degree.degree)) return "dominant";
  return "other";
}
