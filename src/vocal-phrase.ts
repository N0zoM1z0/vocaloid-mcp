import type {
  MusicalPosition,
  PositionedNoteInput,
  SongTimeSignatureInput,
} from "./vsqx.js";
import { musicalPositionToTick, musicalTickToPosition } from "./vsqx.js";


export interface RhythmValueInput {
  denominator: 1 | 2 | 4 | 8 | 16 | 32 | 64;
  dots?: 0 | 1 | 2;
  tuplet?: { played: number; inTimeOf: number };
}

export interface LyricUnitInput {
  lyric: string;
  phonemes: string;
  phonemeLocked?: boolean;
}

export interface VocalRhythmCellInput {
  duration: number | RhythmValueInput;
  rest?: boolean;
  noteNumber?: number;
  lyricIndex?: number;
  lyric?: string;
  phonemes?: string;
  phonemeLocked?: boolean;
  gatePercent?: number;
  velocity?: number;
  style?: Record<string, number>;
  vibrato?: PositionedNoteInput["vibrato"];
}

export interface VocalPhraseInput {
  start: MusicalPosition;
  allocation: "sequential" | "explicit";
  lyrics: LyricUnitInput[];
  cells: VocalRhythmCellInput[];
}

export interface CompiledVocalPhrase {
  notes: PositionedNoteInput[];
  startTick: number;
  endTick: number;
  noteCells: number;
  restCells: number;
  lyricUnits: number;
  continuations: number;
  fastestNoteTicks: number | null;
}

function integerRange(value: number, minimum: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer in ${minimum}..${maximum}, got ${value}`);
  }
}

export function rhythmValueTicks(value: number | RhythmValueInput): number {
  if (typeof value === "number") {
    integerRange(value, 1, 2_147_483_647, "duration ticks");
    return value;
  }
  const base = 1920 / value.denominator;
  let multiplier = 1;
  if ((value.dots ?? 0) >= 1) multiplier += 0.5;
  if ((value.dots ?? 0) >= 2) multiplier += 0.25;
  if (value.tuplet) {
    integerRange(value.tuplet.played, 2, 16, "tuplet.played");
    integerRange(value.tuplet.inTimeOf, 1, 16, "tuplet.inTimeOf");
    multiplier *= value.tuplet.inTimeOf / value.tuplet.played;
  }
  const ticks = base * multiplier;
  if (!Number.isInteger(ticks) || ticks < 1) {
    throw new Error(
      `Rhythm value does not resolve to an integer number of 480-PPQ ticks: ${ticks}. Use explicit tick duration.`,
    );
  }
  return ticks;
}

export function compileVocalPhrase(
  signatures: readonly SongTimeSignatureInput[],
  phrase: VocalPhraseInput,
): CompiledVocalPhrase {
  if (phrase.lyrics.length === 0) throw new Error("phrase.lyrics must not be empty");
  if (phrase.cells.length === 0) throw new Error("phrase.cells must not be empty");
  for (const [index, lyric] of phrase.lyrics.entries()) {
    if (lyric.lyric.length < 1 || lyric.lyric.length > 32) {
      throw new Error(`phrase.lyrics[${index}].lyric must contain 1..32 characters`);
    }
    if (lyric.phonemes.length < 1 || lyric.phonemes.length > 32) {
      throw new Error(`phrase.lyrics[${index}].phonemes must contain 1..32 characters`);
    }
  }
  const startTick = musicalPositionToTick(signatures, phrase.start);
  let currentTick = startTick;
  let sequentialIndex = 0;
  let previousLyricIndex: number | null = null;
  let noteCells = 0;
  let restCells = 0;
  let continuations = 0;
  let fastestNoteTicks: number | null = null;
  const usedLyrics = new Set<number>();
  const notes: PositionedNoteInput[] = [];

  for (const [cellIndex, cell] of phrase.cells.entries()) {
    const stepTicks = rhythmValueTicks(cell.duration);
    if (cell.rest) {
      if (cell.noteNumber !== undefined || cell.lyricIndex !== undefined || cell.lyric !== undefined || cell.phonemes !== undefined) {
        throw new Error(`phrase.cells[${cellIndex}] is a rest and cannot contain note or lyric fields`);
      }
      restCells++;
      currentTick += stepTicks;
      previousLyricIndex = null;
      continue;
    }
    if (cell.noteNumber === undefined) {
      throw new Error(`phrase.cells[${cellIndex}].noteNumber is required for a note cell`);
    }
    integerRange(cell.noteNumber, 0, 127, `phrase.cells[${cellIndex}].noteNumber`);
    integerRange(cell.velocity ?? 64, 0, 127, `phrase.cells[${cellIndex}].velocity`);
    integerRange(cell.gatePercent ?? 100, 1, 100, `phrase.cells[${cellIndex}].gatePercent`);
    if (phrase.allocation === "explicit" && cell.lyricIndex === undefined && cell.lyric === undefined) {
      throw new Error(
        `phrase.cells[${cellIndex}] needs lyricIndex or a lyric override in explicit allocation mode`,
      );
    }
    if (phrase.allocation === "sequential" && cell.lyricIndex !== undefined) {
      throw new Error(`phrase.cells[${cellIndex}].lyricIndex is only valid in explicit allocation mode`);
    }
    const lyricIndex = cell.lyricIndex ?? sequentialIndex;
    const lyricUnit = phrase.lyrics[lyricIndex];
    if (!lyricUnit && cell.lyric === undefined) {
      throw new Error(
        `phrase.cells[${cellIndex}] has no lyric unit at index ${lyricIndex}; add lyrics or use explicit allocation`,
      );
    }
    const continuation =
      phrase.allocation === "explicit"
      && cell.lyric === undefined
      && cell.phonemes === undefined
      && previousLyricIndex === lyricIndex;
    const lyric = cell.lyric ?? (continuation ? "-" : lyricUnit?.lyric);
    const phonemes = cell.phonemes ?? (continuation ? "-" : lyricUnit?.phonemes);
    if (!lyric || !phonemes) {
      throw new Error(`phrase.cells[${cellIndex}] could not resolve lyric and phonemes`);
    }
    if (lyric.length > 32 || phonemes.length > 32) {
      throw new Error(`phrase.cells[${cellIndex}] resolved lyric/phonemes exceed 32 characters`);
    }
    const duration = Math.max(1, Math.floor((stepTicks * (cell.gatePercent ?? 100)) / 100));
    notes.push({
      position: musicalTickToPosition(signatures, currentTick),
      duration,
      noteNumber: cell.noteNumber,
      lyric,
      phonemes,
      phonemeLocked: cell.phonemeLocked ?? lyricUnit?.phonemeLocked ?? false,
      velocity: cell.velocity ?? 64,
      ...(cell.style !== undefined ? { style: cell.style } : {}),
      ...(cell.vibrato !== undefined ? { vibrato: cell.vibrato } : {}),
    });
    noteCells++;
    fastestNoteTicks = fastestNoteTicks === null ? duration : Math.min(fastestNoteTicks, duration);
    if (continuation) continuations++;
    if (lyricUnit) usedLyrics.add(lyricIndex);
    previousLyricIndex = lyricIndex;
    if (phrase.allocation === "sequential") sequentialIndex++;
    currentTick += stepTicks;
  }
  if (usedLyrics.size !== phrase.lyrics.length) {
    const unused = phrase.lyrics
      .map((_lyric, index) => index)
      .filter((index) => !usedLyrics.has(index));
    throw new Error(`phrase has unused lyric indices: ${unused.join(", ")}`);
  }
  return {
    notes,
    startTick,
    endTick: currentTick,
    noteCells,
    restCells,
    lyricUnits: phrase.lyrics.length,
    continuations,
    fastestNoteTicks,
  };
}
