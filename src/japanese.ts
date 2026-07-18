import { z } from "zod";


const StableIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,95}$/u);
const PhraseIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,84}$/u)
  .describe("Stable phrase ID, limited to 85 characters so generated mora IDs remain valid");

const PositionSchema = z
  .object({
    measure: z.number().int().min(0).max(100_000),
    beat: z.number().int().min(0).max(31),
    tick: z.number().int().min(0).max(1919).default(0),
  })
  .strict();

const RhythmValueSchema = z
  .object({
    denominator: z.union([
      z.literal(1), z.literal(2), z.literal(4), z.literal(8),
      z.literal(16), z.literal(32), z.literal(64),
    ]),
    dots: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
    tuplet: z
      .object({
        played: z.number().int().min(2).max(16),
        in_time_of: z.number().int().min(1).max(16),
      })
      .strict()
      .optional(),
  })
  .strict();

const VibratoPointSchema = z
  .object({
    position: z.number().int().min(0).max(65_536),
    value: z.number().int().min(0).max(127),
  })
  .strict();

const VibratoSchema = z
  .object({
    type: z.number().int().min(0).max(16),
    length: z.number().int().min(0).max(100),
    depth: z.array(VibratoPointSchema).max(128).default([]),
    rate: z.array(VibratoPointSchema).max(128).default([]),
  })
  .strict();

export const JapaneseG2PInputSchema = z
  .object({
    text: z.string().min(1).max(10_000)
      .describe("Displayed Japanese text. If it contains kanji, reading is required."),
    reading: z.string().min(1).max(20_000).optional()
      .describe("Explicit kana reading. Spaces define word boundaries for positional affricates."),
    affricate_mode: z.enum(["position", "affricate", "fricative"]).default("position")
      .describe("How ざ/じ rows choose dz/dZ versus z/Z."),
    g_mode: z.enum(["plosive", "nasal_between_vowels"]).default("plosive")
      .describe("Whether eligible medial が-row onsets use Japanese nasal N/N'."),
  })
  .strict();

export const JapaneseNoteSlotSchema = z
  .object({
    id: StableIdSchema,
    duration: z.union([z.number().int().min(1), RhythmValueSchema]),
    rest: z.boolean().default(false),
    note_number: z.number().int().min(0).max(127).optional(),
    mora_index: z.number().int().min(0).optional()
      .describe("Required on voiced slots in explicit mode; repeat an index for native melisma."),
    gate_percent: z.number().int().min(1).max(100).default(100),
    velocity: z.number().int().min(0).max(127).default(64),
    style: z.record(z.string().min(1).max(32), z.number().int()).default({}),
    vibrato: VibratoSchema.optional(),
  })
  .strict();

export const JapanesePhraseAlignmentInputSchema = JapaneseG2PInputSchema.extend({
  phrase_id: PhraseIdSchema,
  start: PositionSchema,
  allocation: z.enum(["sequential", "explicit"]).default("sequential"),
  sokuon_strategy: z.enum(["rest", "attach_next"]).optional()
    .describe("Required when the reading contains small っ. rest needs a rest slot; attach_next repeats the following consonant."),
  note_slots: z.array(JapaneseNoteSlotSchema).min(1).max(20_000),
}).strict();

export type JapaneseG2PInput = z.input<typeof JapaneseG2PInputSchema>;
export type JapanesePhraseAlignmentInput = z.input<typeof JapanesePhraseAlignmentInputSchema>;

export const VOCALOID3_JAPANESE_PHONEMES = [
  "a", "i", "M", "e", "o",
  "k", "k'", "g", "g'", "N", "N'",
  "s", "S", "z", "Z", "dz", "dZ",
  "t", "t'", "ts", "tS", "d", "d'",
  "n", "J",
  "h", "h\\", "C", "p\\", "p\\'",
  "b", "b'", "p", "p'",
  "m", "m'", "j", "4", "4'", "w", "N\\",
] as const;

const VOCALOID3_PHONEME_SET = new Set<string>(VOCALOID3_JAPANESE_PHONEMES);
const VOWELS = new Set(["a", "i", "M", "e", "o"]);
const BOUNDARY = /^[\s、。，．,.!?！？・…〜~「」『』（）()［］\[\]【】]+$/u;
const KANA_OR_BOUNDARY = /^[\u3040-\u309f\u30a0-\u30ff\s、。，．,.!?！？・…〜~「」『』（）()［］\[\]【】]+$/u;

interface Mapping {
  phonemes: string[];
  warning?: string;
  fallback?: boolean;
}

const BASE: Readonly<Record<string, readonly string[]>> = {
  "あ": ["a"], "い": ["i"], "う": ["M"], "え": ["e"], "お": ["o"],
  "か": ["k", "a"], "き": ["k'", "i"], "く": ["k", "M"], "け": ["k", "e"], "こ": ["k", "o"],
  "が": ["g", "a"], "ぎ": ["g'", "i"], "ぐ": ["g", "M"], "げ": ["g", "e"], "ご": ["g", "o"],
  "さ": ["s", "a"], "し": ["S", "i"], "す": ["s", "M"], "せ": ["s", "e"], "そ": ["s", "o"],
  "た": ["t", "a"], "ち": ["tS", "i"], "つ": ["ts", "M"], "て": ["t", "e"], "と": ["t", "o"],
  "な": ["n", "a"], "に": ["J", "i"], "ぬ": ["n", "M"], "ね": ["n", "e"], "の": ["n", "o"],
  "は": ["h", "a"], "ひ": ["C", "i"], "ふ": ["p\\", "M"], "へ": ["h", "e"], "ほ": ["h", "o"],
  "ば": ["b", "a"], "び": ["b'", "i"], "ぶ": ["b", "M"], "べ": ["b", "e"], "ぼ": ["b", "o"],
  "ぱ": ["p", "a"], "ぴ": ["p'", "i"], "ぷ": ["p", "M"], "ぺ": ["p", "e"], "ぽ": ["p", "o"],
  "ま": ["m", "a"], "み": ["m'", "i"], "む": ["m", "M"], "め": ["m", "e"], "も": ["m", "o"],
  "や": ["j", "a"], "ゆ": ["j", "M"], "よ": ["j", "o"],
  "ら": ["4", "a"], "り": ["4'", "i"], "る": ["4", "M"], "れ": ["4", "e"], "ろ": ["4", "o"],
  "わ": ["w", "a"], "ゐ": ["w", "i"], "ゑ": ["w", "e"], "を": ["o"],
  "ぁ": ["a"], "ぃ": ["i"], "ぅ": ["M"], "ぇ": ["e"], "ぉ": ["o"],
};

const FIXED_COMBINATIONS: Readonly<Record<string, readonly string[]>> = {
  "いぇ": ["j", "e"],
  "うぁ": ["w", "a"], "うぃ": ["w", "i"], "うぇ": ["w", "e"], "うぉ": ["w", "o"],
  "くぁ": ["k", "w", "a"], "くぃ": ["k", "w", "i"], "くぇ": ["k", "w", "e"], "くぉ": ["k", "w", "o"],
  "ぐぁ": ["g", "w", "a"], "ぐぃ": ["g", "w", "i"], "ぐぇ": ["g", "w", "e"], "ぐぉ": ["g", "w", "o"],
  "すぃ": ["s", "i"],
  "しぇ": ["S", "e"],
  "ちぇ": ["tS", "e"],
  "つぁ": ["ts", "a"], "つぃ": ["ts", "i"], "つぇ": ["ts", "e"], "つぉ": ["ts", "o"],
  "てぃ": ["t'", "i"], "とぅ": ["t", "M"],
  "でぃ": ["d'", "i"], "どぅ": ["d", "M"],
  "ふぁ": ["p\\", "a"], "ふぃ": ["p\\'", "i"], "ふぇ": ["p\\", "e"], "ふぉ": ["p\\", "o"],
};

const PALATAL_ONSETS: Readonly<Record<string, string>> = {
  "き": "k'", "ぎ": "g'", "し": "S", "ち": "tS", "に": "J", "ひ": "C",
  "び": "b'", "ぴ": "p'", "み": "m'", "り": "4'",
};

const SMALL_VOWEL: Readonly<Record<string, string>> = {
  "ゃ": "a", "ゅ": "M", "ょ": "o", "ぁ": "a", "ぃ": "i", "ぅ": "M", "ぇ": "e", "ぉ": "o",
};

function katakanaToHiragana(value: string): string {
  return [...value.normalize("NFKC")].map((character) => {
    const code = character.codePointAt(0)!;
    if (code >= 0x30a1 && code <= 0x30f6) return String.fromCodePoint(code - 0x60);
    return character;
  }).join("");
}

function chooseAffricate(
  row: "z" | "j",
  wordInitial: boolean,
  mode: "position" | "affricate" | "fricative",
): string {
  const affricate = row === "z" ? "dz" : "dZ";
  const fricative = row === "z" ? "z" : "Z";
  if (mode === "affricate") return affricate;
  if (mode === "fricative") return fricative;
  return wordInitial ? affricate : fricative;
}

function mapMora(
  surface: string,
  wordInitial: boolean,
  previousVowel: string | null,
  affricateMode: "position" | "affricate" | "fricative",
  gMode: "plosive" | "nasal_between_vowels",
): Mapping {
  const last = [...surface].at(-1);
  const smallVowel = last ? SMALL_VOWEL[last] : undefined;
  const first = [...surface][0];
  if (!first) throw new Error("Internal error: empty mora");

  if (first === "じ" || first === "ぢ") {
    return { phonemes: [chooseAffricate("j", wordInitial, affricateMode), smallVowel ?? "i"] };
  }
  if (["ざ", "ず", "ぜ", "ぞ", "づ"].includes(first)) {
    const vowels: Record<string, string> = { "ざ": "a", "ず": "M", "ぜ": "e", "ぞ": "o", "づ": "M" };
    return { phonemes: [chooseAffricate("z", wordInitial, affricateMode), smallVowel ?? vowels[first]!] };
  }
  if (["だ", "で", "ど"].includes(first)) {
    const vowels: Record<string, string> = { "だ": "a", "で": "e", "ど": "o" };
    return { phonemes: ["d", smallVowel ?? vowels[first]!] };
  }
  if (first === "ゔ") {
    return {
      phonemes: ["b", smallVowel ?? "M"],
      fallback: true,
      warning: `${surface} approximated with Japanese /b/ because the VOCALOID3 Japanese phoneme chart has no /v/ token`,
    };
  }
  const fixed = FIXED_COMBINATIONS[surface];
  if (fixed) {
    let phonemes = [...fixed];
    if (gMode === "nasal_between_vowels" && previousVowel !== null && first === "ぐ") {
      phonemes = ["N", ...phonemes.slice(1)];
    }
    return { phonemes };
  }
  const palatal = PALATAL_ONSETS[first];
  if (surface.length > 1 && palatal && smallVowel) {
    const onset = gMode === "nasal_between_vowels" && previousVowel !== null && first === "ぎ" ? "N'" : palatal;
    return { phonemes: [onset, smallVowel] };
  }
  const base = BASE[surface];
  if (!base) throw new Error(`Unsupported kana mora ${JSON.stringify(surface)}; supply explicit phonemes in the manifest`);
  const phonemes = [...base];
  if (gMode === "nasal_between_vowels" && previousVowel !== null && ["が", "ぎ", "ぐ", "げ", "ご"].includes(first)) {
    phonemes[0] = first === "ぎ" ? "N'" : "N";
  }
  return { phonemes };
}

export interface JapaneseMoraUnit {
  index: number;
  suggested_id: string;
  surface: string;
  normalized: string;
  kind: "mora" | "moraic_nasal" | "long_vowel" | "sokuon";
  phonemes: string | null;
  phoneme_tokens: string[];
  onset: string | null;
  vowel: string | null;
  word_initial: boolean;
  source_start: number;
  source_end: number;
  next_onset?: string;
  fallback: boolean;
  warnings: string[];
}

export interface JapaneseG2PResult {
  source_text: string;
  reading: string;
  normalized_reading: string;
  affricate_mode: "position" | "affricate" | "fricative";
  g_mode: "plosive" | "nasal_between_vowels";
  units: JapaneseMoraUnit[];
  boundaries: Array<{ source_start: number; source_end: number; surface: string; after_unit_index: number }>;
  phoneme_inventory: readonly string[];
  fallback_count: number;
  warnings: string[];
}

export function japaneseG2P(input: JapaneseG2PInput): JapaneseG2PResult {
  const parsed = JapaneseG2PInputSchema.parse(input);
  const readingSource = parsed.reading ?? parsed.text;
  if (!parsed.reading && !KANA_OR_BOUNDARY.test(parsed.text.normalize("NFKC"))) {
    throw new Error(
      "text contains kanji, Latin text, digits, or unsupported symbols; provide an explicit kana reading because this tool does not guess lexical readings",
    );
  }
  if (!KANA_OR_BOUNDARY.test(readingSource.normalize("NFKC"))) {
    throw new Error("reading must contain kana plus spaces/punctuation only");
  }
  const reading = katakanaToHiragana(readingSource);
  const characters = [...reading];
  const units: JapaneseMoraUnit[] = [];
  const boundaries: JapaneseG2PResult["boundaries"] = [];
  const warnings: string[] = [];
  let wordInitial = true;
  let previousVowel: string | null = null;

  for (let index = 0; index < characters.length;) {
    const current = characters[index]!;
    if (BOUNDARY.test(current)) {
      let end = index + 1;
      while (end < characters.length && BOUNDARY.test(characters[end]!)) end++;
      boundaries.push({
        source_start: index,
        source_end: end,
        surface: characters.slice(index, end).join(""),
        after_unit_index: units.length - 1,
      });
      wordInitial = true;
      previousVowel = null;
      index = end;
      continue;
    }
    if (current === "ー") {
      if (!previousVowel) throw new Error(`Long-vowel mark at reading offset ${index} has no preceding vowel`);
      units.push({
        index: units.length,
        suggested_id: `mora-${String(units.length + 1).padStart(4, "0")}`,
        surface: current,
        normalized: current,
        kind: "long_vowel",
        phonemes: previousVowel,
        phoneme_tokens: [previousVowel],
        onset: null,
        vowel: previousVowel,
        word_initial: false,
        source_start: index,
        source_end: index + 1,
        fallback: false,
        warnings: [],
      });
      wordInitial = false;
      index++;
      continue;
    }
    if (current === "っ") {
      units.push({
        index: units.length,
        suggested_id: `mora-${String(units.length + 1).padStart(4, "0")}`,
        surface: current,
        normalized: current,
        kind: "sokuon",
        phonemes: null,
        phoneme_tokens: [],
        onset: null,
        vowel: null,
        word_initial: wordInitial,
        source_start: index,
        source_end: index + 1,
        fallback: false,
        warnings: ["Small っ has no standalone symbol in the bundled VOCALOID3 Japanese phoneme chart; choose an alignment strategy explicitly"],
      });
      index++;
      continue;
    }
    if (current === "ん") {
      units.push({
        index: units.length,
        suggested_id: `mora-${String(units.length + 1).padStart(4, "0")}`,
        surface: current,
        normalized: current,
        kind: "moraic_nasal",
        phonemes: "N\\",
        phoneme_tokens: ["N\\"],
        onset: "N\\",
        vowel: null,
        word_initial: wordInitial,
        source_start: index,
        source_end: index + 1,
        fallback: false,
        warnings: [],
      });
      previousVowel = null;
      wordInitial = false;
      index++;
      continue;
    }
    const next = characters[index + 1];
    const combined = next && SMALL_VOWEL[next] ? `${current}${next}` : null;
    let surface = current;
    if (combined) {
      const fixed = FIXED_COMBINATIONS[combined];
      const palatal = PALATAL_ONSETS[current];
      const positional = ["じ", "ぢ", "ざ", "ず", "ぜ", "ぞ", "づ", "だ", "で", "ど", "ゔ"].includes(current);
      if (fixed || palatal || positional) surface = combined;
      else if (!BASE[current]) throw new Error(`Unsupported kana combination ${JSON.stringify(combined)}`);
    }
    const mapping = mapMora(surface, wordInitial, previousVowel, parsed.affricate_mode, parsed.g_mode);
    for (const token of mapping.phonemes) {
      if (!VOCALOID3_PHONEME_SET.has(token)) {
        throw new Error(`Internal Japanese G2P mapping emitted unsupported VOCALOID3 token ${token}`);
      }
    }
    const vowel = [...mapping.phonemes].reverse().find((token) => VOWELS.has(token)) ?? null;
    const onsetTokens = vowel === null ? mapping.phonemes : mapping.phonemes.slice(0, -1);
    const unitWarnings = mapping.warning ? [mapping.warning] : [];
    units.push({
      index: units.length,
      suggested_id: `mora-${String(units.length + 1).padStart(4, "0")}`,
      surface,
      normalized: surface,
      kind: "mora",
      phonemes: mapping.phonemes.join(" "),
      phoneme_tokens: mapping.phonemes,
      onset: onsetTokens.length > 0 ? onsetTokens.join(" ") : null,
      vowel,
      word_initial: wordInitial,
      source_start: index,
      source_end: index + [...surface].length,
      fallback: mapping.fallback ?? false,
      warnings: unitWarnings,
    });
    warnings.push(...unitWarnings);
    previousVowel = vowel;
    wordInitial = false;
    index += [...surface].length;
  }
  if (units.length === 0) throw new Error("reading contains no pronounceable morae");
  for (let index = 0; index < units.length; index++) {
    const unit = units[index]!;
    if (unit.kind !== "sokuon") continue;
    const nextUnit = units.slice(index + 1).find((candidate) => candidate.kind !== "sokuon");
    const nextOnset = nextUnit?.onset?.split(" ")[0];
    if (!nextOnset || VOWELS.has(nextOnset) || nextOnset === "N\\") {
      unit.warnings.push("Small っ is not followed by a supported consonant onset");
    } else {
      unit.next_onset = nextOnset;
    }
    warnings.push(...unit.warnings);
  }
  return {
    source_text: parsed.text,
    reading: readingSource,
    normalized_reading: reading,
    affricate_mode: parsed.affricate_mode,
    g_mode: parsed.g_mode,
    units,
    boundaries,
    phoneme_inventory: VOCALOID3_JAPANESE_PHONEMES,
    fallback_count: units.filter((unit) => unit.fallback).length,
    warnings: [...new Set(warnings)],
  };
}

export interface JapaneseAlignedPhraseResult {
  phrase: {
    id: string;
    start: { measure: number; beat: number; tick: number };
    allocation: "sequential" | "explicit";
    lyrics: Array<{ id: string; lyric: string; phonemes: string; phoneme_locked: true }>;
    cells: Array<{
      id: string;
      duration: number | z.infer<typeof RhythmValueSchema>;
      rest: boolean;
      note_number?: number;
      lyric_index?: number;
      gate_percent: number;
      velocity: number;
      style: Record<string, number>;
      vibrato?: z.infer<typeof VibratoSchema>;
    }>;
    linguistic_source: {
      language: "ja";
      text: string;
      reading: string;
      normalized_reading: string;
      affricate_mode: "position" | "affricate" | "fricative";
      g_mode: "plosive" | "nasal_between_vowels";
      sokuon_strategy: "not_needed" | "rest" | "attach_next";
    };
  };
  g2p: JapaneseG2PResult;
  alignment: {
    lyric_units: number;
    voiced_slots: number;
    rest_slots: number;
    continuations: number;
    sokuon_count: number;
    sokuon_strategy: "not_needed" | "rest" | "attach_next";
  };
  warnings: string[];
}

export function alignJapanesePhrase(input: JapanesePhraseAlignmentInput): JapaneseAlignedPhraseResult {
  const parsed = JapanesePhraseAlignmentInputSchema.parse(input);
  const g2p = japaneseG2P({
    text: parsed.text,
    ...(parsed.reading !== undefined ? { reading: parsed.reading } : {}),
    affricate_mode: parsed.affricate_mode,
    g_mode: parsed.g_mode,
  });
  const sokuon = g2p.units.filter((unit) => unit.kind === "sokuon");
  if (sokuon.length > 0 && parsed.sokuon_strategy === undefined) {
    throw new Error(
      "reading contains small っ; choose sokuon_strategy=rest (explicit silence slot) or attach_next (experimental repeated consonant)",
    );
  }
  const warnings = [...g2p.warnings];
  const lyricUnits = g2p.units.filter((unit) => unit.kind !== "sokuon").map((unit) => ({ ...unit }));
  const lyricOriginalIndices = g2p.units
    .map((unit, index) => ({ unit, index }))
    .filter(({ unit }) => unit.kind !== "sokuon")
    .map(({ index }) => index);

  for (const stop of sokuon) {
    const lyricIndex = lyricOriginalIndices.findIndex((original) => original > stop.index);
    const next = lyricUnits[lyricIndex];
    if (next) next.surface = `${stop.surface}${next.surface}`;
  }

  if (parsed.sokuon_strategy === "attach_next") {
    for (const stop of sokuon) {
      if (!stop.next_onset) {
        throw new Error(`Cannot attach small っ at mora index ${stop.index}: no following consonant onset`);
      }
      const lyricIndex = lyricOriginalIndices.findIndex((original) => original > stop.index);
      const next = lyricUnits[lyricIndex];
      if (!next?.phonemes) throw new Error(`Cannot resolve lyric following small っ at mora index ${stop.index}`);
      next.phoneme_tokens = [stop.next_onset, ...next.phoneme_tokens];
      next.phonemes = next.phoneme_tokens.join(" ");
    }
    warnings.push(
      "sokuon_strategy=attach_next is an experimental repeated-consonant rendering inside one note; audition and revise timing because the manual defines no standalone small-っ token",
    );
  }

  const lyrics = lyricUnits.map((unit, index) => ({
    id: `${parsed.phrase_id}-mora-${String(index + 1).padStart(4, "0")}`,
    lyric: unit.surface,
    phonemes: unit.phonemes!,
    phoneme_locked: true as const,
  }));
  if (lyrics.length > 5000) {
    throw new Error(`Alignment produced ${lyrics.length} lyric units; a manifest phrase supports at most 5000`);
  }
  for (const lyric of lyrics) {
    if (lyric.lyric.length > 32 || lyric.phonemes.length > 32) {
      throw new Error(`Aligned lyric ${lyric.id} exceeds the manifest 32-character lyric/phoneme limit`);
    }
  }
  const voicedSlots = parsed.note_slots.filter((slot) => !slot.rest);
  const restSlots = parsed.note_slots.filter((slot) => slot.rest);
  let continuations = 0;

  if (parsed.allocation === "sequential") {
    const specified = parsed.note_slots.find((slot) => slot.mora_index !== undefined);
    if (specified) throw new Error(`Sequential allocation does not accept mora_index (${specified.id})`);
    if (voicedSlots.length !== lyrics.length) {
      throw new Error(
        `Sequential alignment needs exactly ${lyrics.length} voiced slots for ${lyrics.length} morae; received ${voicedSlots.length}. `
        + "Use explicit mode with repeated mora_index for melisma, or add rhythm cells for rapid lyrics.",
      );
    }
  } else {
    const used = new Set<number>();
    let previous: number | null = null;
    for (const slot of voicedSlots) {
      if (slot.mora_index === undefined) throw new Error(`Explicit voiced slot ${slot.id} requires mora_index`);
      if (slot.mora_index >= lyrics.length) {
        throw new Error(`Slot ${slot.id} mora_index ${slot.mora_index} is outside 0..${lyrics.length - 1}`);
      }
      used.add(slot.mora_index);
      if (previous === slot.mora_index) continuations++;
      previous = slot.mora_index;
    }
    const unused = lyrics.map((_unit, index) => index).filter((index) => !used.has(index));
    if (unused.length > 0) throw new Error(`Explicit alignment leaves mora indices unused: ${unused.join(", ")}`);
  }

  if (parsed.sokuon_strategy === "rest") {
    if (restSlots.length < sokuon.length) {
      throw new Error(
        `sokuon_strategy=rest needs at least ${sokuon.length} explicit rest slots; received ${restSlots.length}`,
      );
    }
    if (parsed.allocation === "sequential") {
      let unitIndex = 0;
      for (const slot of parsed.note_slots) {
        const unit = g2p.units[unitIndex];
        if (slot.rest) {
          if (unit?.kind === "sokuon") unitIndex++;
          continue;
        }
        if (unit?.kind === "sokuon") {
          throw new Error(
            `Sequential slot ${slot.id} reaches small っ at mora index ${unit.index}; insert a rest slot here`,
          );
        }
        if (unit) unitIndex++;
      }
      const missingStop = g2p.units.slice(unitIndex).find((unit) => unit.kind === "sokuon");
      if (missingStop) throw new Error(`Small っ at mora index ${missingStop.index} has no corresponding rest slot`);
    } else {
      for (const stop of sokuon) {
        const previousLyricIndex = lyricOriginalIndices.filter((original) => original < stop.index).length - 1;
        const nextLyricIndex = lyricOriginalIndices.findIndex((original) => original > stop.index);
        const previousSlots = parsed.note_slots
          .map((slot, index) => ({ slot, index }))
          .filter(({ slot }) => !slot.rest && slot.mora_index === previousLyricIndex);
        const nextSlots = parsed.note_slots
          .map((slot, index) => ({ slot, index }))
          .filter(({ slot }) => !slot.rest && slot.mora_index === nextLyricIndex);
        const after = previousSlots.length > 0 ? previousSlots.at(-1)!.index : -1;
        const before = nextSlots.length > 0 ? nextSlots[0]!.index : parsed.note_slots.length;
        const timed = parsed.note_slots.slice(after + 1, before).some((slot) => slot.rest);
        if (!timed) {
          throw new Error(
            `Small っ at mora index ${stop.index} needs a rest slot between lyric indices ${previousLyricIndex} and ${nextLyricIndex}`,
          );
        }
      }
    }
    warnings.push(
      "Small っ is represented by a position-checked rest slot, not an invented phoneme; audition its duration",
    );
  }

  const cells = parsed.note_slots.map((slot) => ({
    id: slot.id,
    duration: slot.duration,
    rest: slot.rest,
    ...(slot.note_number !== undefined ? { note_number: slot.note_number } : {}),
    ...(parsed.allocation === "explicit" && slot.mora_index !== undefined
      ? { lyric_index: slot.mora_index }
      : {}),
    gate_percent: slot.gate_percent,
    velocity: slot.velocity,
    style: slot.style,
    ...(slot.vibrato !== undefined ? { vibrato: slot.vibrato } : {}),
  }));
  for (const slot of cells) {
    if (slot.rest) {
      delete slot.note_number;
      delete slot.lyric_index;
    } else if (slot.note_number === undefined) {
      throw new Error(`Voiced slot ${slot.id} requires note_number`);
    }
  }

  return {
    phrase: {
      id: parsed.phrase_id,
      start: parsed.start,
      allocation: parsed.allocation,
      lyrics,
      cells,
      linguistic_source: {
        language: "ja",
        text: g2p.source_text,
        reading: g2p.reading,
        normalized_reading: g2p.normalized_reading,
        affricate_mode: g2p.affricate_mode,
        g_mode: g2p.g_mode,
        sokuon_strategy: sokuon.length === 0 ? "not_needed" : parsed.sokuon_strategy!,
      },
    },
    g2p,
    alignment: {
      lyric_units: lyrics.length,
      voiced_slots: voicedSlots.length,
      rest_slots: restSlots.length,
      continuations,
      sokuon_count: sokuon.length,
      sokuon_strategy: sokuon.length === 0 ? "not_needed" : parsed.sokuon_strategy!,
    },
    warnings: [...new Set(warnings)],
  };
}
