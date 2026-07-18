export interface StylePaletteSummary {
  id: string;
  title: string;
  uri: string;
  description: string;
  tags: string[];
}

export const IA_ROCKS_COMPONENT_ID = "BDREB7P2KTWKYDC5" as const;

export interface StylePalette extends StylePaletteSummary {
  status: "production-guidance";
  rendererBoundary: string;
  voice: {
    preferredName: "IA_ROCKS";
    componentId: typeof IA_ROCKS_COMPONENT_ID;
    rangeGuidance: string;
    performance: string[];
  };
  composition: Record<string, unknown>;
  arrangement: Array<Record<string, unknown>>;
  groove: Record<string, unknown>;
  mix: Record<string, unknown>;
  provenance?: Record<string, unknown>;
}

const boundary = "FluidR3 GM is a deterministic draft renderer. Program names describe arrangement roles, not authentic sampled technique; keep renderer provenance and replace stems with a licensed SF2/VST/DAW renderer for release-grade timbre.";

export const STYLE_PALETTES: readonly StylePalette[] = [
  {
    id: "wa-rock-hanairo",
    title: "花色和風ロック",
    uri: "vocaloid://styles/wa-rock-hanairo",
    description: "和旋法色彩、三味線／箏の応答、尺八、太鼓と現代 rock section arc。",
    tags: ["和風", "rock", "shamisen", "koto", "shakuhachi", "taiko", "tempo-change"],
    status: "production-guidance",
    rendererBoundary: boundary,
    voice: {
      preferredName: "IA_ROCKS",
      componentId: IA_ROCKS_COMPONENT_ID,
      rangeGuidance: "中心は G3–D5、chorus peak は E5–G5 を短く使い、尺八と同じ octave を長時間占有しない。",
      performance: [
        "Aメロは opening 58–78、chorus は 82–108 の弧を event IDs に明示する。",
        "速い子音列は 1/16 cells と短い breath gap を交互に置き、語尾の母音だけ melisma／vibrato にする。",
        "三味線の attack と主唱 consonant が競合する箇所は交互応答にし、同時連打を避ける。",
      ],
    },
    composition: {
      tempo: { opening_bpm: 92, verse_bpm: 138, chorus_bpm: 154, bridge_bpm: 116, final_bpm: 160 },
      meters: ["4/4 core", "optional 2/4 pickup", "one 6/8 bridge for contrast"],
      pitch_material: ["minor pentatonic", "yo scale color: 1 2 4 5 6", "in scale color: 1 b2 4 5 b6"],
      harmony: "Use modern minor rock harmony underneath sparse Japanese-scale melodic anchor tones; reserve bII or iv color for transitions.",
      form: ["shakuhachi free pickup", "intro", "verse-a", "verse-b", "prechorus", "chorus", "instrumental", "bridge", "double-chorus", "outro"],
      target_duration_seconds: [190, 245],
    },
    arrangement: [
      { role: "shamisen ostinato", gm: { bank_msb: 0, bank_lsb: 0, program: 106 }, register: "G3–D5", articulation: "short 45–70% gates, alternating accents, response gaps" },
      { role: "koto arpeggio/color", gm: { bank_msb: 0, bank_lsb: 0, program: 107 }, register: "C4–C6", articulation: "broken voicings and written scalar runs; do not label them sampled glissandi" },
      { role: "shakuhachi answer", gm: { bank_msb: 0, bank_lsb: 0, program: 77 }, register: "D4–A5", articulation: "long breath-shaped answers, sparse pitch scoops" },
      { role: "taiko layer", gm: { bank_msb: 0, bank_lsb: 0, program: 116 }, articulation: "section downbeats and fills; combine carefully with channel-10 kick/snare" },
      { role: "rock rhythm guitar", gm: { bank_msb: 0, bank_lsb: 0, program: 30 }, register: "E2–E5", articulation: "power-chord rhythm, rests around vocal pickups" },
      { role: "picked bass", gm: { bank_msb: 0, bank_lsb: 0, program: 34 }, register: "E1–D3", articulation: "lock with kick; passing tones before section boundaries" },
      { role: "drum kit", channel: 10, notes: [36, 38, 42, 46, 49, 51], articulation: "half-time verse, driving eighth chorus, tom/taiko transition fills" },
    ],
    groove: {
      grid_ticks: 120,
      swing_percent: [50, 54],
      timing_jitter_ticks: [0, 9],
      velocity_jitter: [2, 8],
      advice: "Humanize accompaniment per stable ID with a seed; keep vocal rhythm intentional and preview every rapid phrase.",
    },
    mix: {
      pan: { lead: 64, shamisen: 40, koto: 88, shakuhachi: 76, guitars: [28, 100] },
      vocal_chain: ["highpass 75–95 Hz", "gentle 2–4 dB compression", "light de-ess", "short plate/send"],
      arrangement: "Use section dynamics and subtract 2–4 kHz from busy plucks/guitars when the lyric is dense.",
      delivery: { integrated_lufs: -15, true_peak_dbfs: -1, target_lra_lu: 7 },
    },
    provenance: {
      lyrics_source_path: "/home/pentester/coding/codex_ida/vocaloid/artifacts/evals/[Lyrics] Hanairo Biyori.txt",
      requirement: "Preserve the source text verbatim as the lyric authority. Store agent-authored kana reading, normalized reading, G2P decisions, and compiled phonemes separately; never guess or replace ambiguous readings silently.",
    },
  },
  {
    id: "ia-j-rock",
    title: "IA_ROCKS 疾走 J-Rock",
    uri: "vocaloid://styles/ia-j-rock",
    description: "高速歌詞、guitar/bass/drum drive、half-time bridge、anthemic double chorus。",
    tags: ["j-rock", "fast-lyrics", "guitar", "anthem", "tempo-arc"],
    status: "production-guidance",
    rendererBoundary: boundary,
    voice: {
      preferredName: "IA_ROCKS",
      componentId: IA_ROCKS_COMPONENT_ID,
      rangeGuidance: "Verse A3–C5, chorus B3–F#5, only isolated peaks above F#5.",
      performance: [
        "Consonant velocity 68–92 for rapid lines; do not increase every syllable equally.",
        "Use pitch scoops only on structural attacks and vibrato on sustained vowel destinations.",
        "Create explicit rests at line ends; continuous 12+ second runs are a preflight warning.",
      ],
    },
    composition: {
      tempo: { intro_bpm: 148, verse_bpm: 156, prechorus_bpm: 162, chorus_bpm: 168, bridge_bpm: 126, final_bpm: 172 },
      meters: ["4/4", "optional one-bar 2/4 turn", "optional 3/4 pre-final breath"],
      harmony: "Minor-key verse with pedal tones; lift chorus using relative-major/common-tone motion and stronger dominant preparation.",
      form: ["intro", "verse", "prechorus", "chorus", "verse-2", "chorus-2", "half-time bridge", "solo", "double-chorus", "tag"],
      target_duration_seconds: [185, 235],
    },
    arrangement: [
      { role: "double rhythm guitar", gm_programs: [29, 30], pan: [24, 104], advice: "different voicings/rhythms, not duplicate MIDI" },
      { role: "picked bass", gm: { bank_msb: 0, bank_lsb: 0, program: 34 }, register: "E1–E3" },
      { role: "drum kit", channel: 10, notes: [36, 38, 42, 46, 49, 51], advice: "verse eighths, chorus open hats/rides, half-time bridge" },
      { role: "piano transient support", gm: { bank_msb: 0, bank_lsb: 0, program: 1 }, advice: "chorus attacks and bridge space, not full-time block chords" },
      { role: "string lift", gm: { bank_msb: 0, bank_lsb: 0, program: 48 }, advice: "long chorus counterline below lyric intelligibility band" },
    ],
    groove: { grid_ticks: 120, swing_percent: [50, 52], timing_jitter_ticks: [0, 7], velocity_jitter: [3, 10], advice: "Bass/kick timing should correlate; do not independently randomize every layer." },
    mix: {
      pan: { lead: 64, harmony: [48, 80], guitars: [24, 104], piano: 72, strings: 56 },
      arrangement: "Automate verse-to-chorus gain rather than relying on master limiting; make gaps in 1–4 kHz guitar/piano layers under dense lyrics.",
      delivery: { integrated_lufs: -14, true_peak_dbfs: -1, target_lra_lu: 6 },
    },
  },
  {
    id: "summer-night-air",
    title: "Summer-Night Ethereal Dream Pop",
    uri: "vocaloid://styles/summer-night-air",
    description: "夜風、星光、透明な pad／bell／clean guitar、広い間と呼吸感。",
    tags: ["summer-night", "dream-pop", "ambient", "airy", "6-8", "wide-stereo"],
    status: "production-guidance",
    rendererBoundary: boundary,
    voice: {
      preferredName: "IA_ROCKS",
      componentId: IA_ROCKS_COMPONENT_ID,
      rangeGuidance: "A3–E5, mostly stepwise; use breathy low dynamics and let one or two chorus tones bloom.",
      performance: [
        "Opening 45–72 and BRE 15–38 are color choices, not a blanket preset; compare section previews.",
        "Leave 1/8–1/4 rests between images in the lyric; use melisma on open vowels, not consonants.",
        "Slow pitch arrival and shallow late vibrato suit sustained destinations; avoid constant scoops.",
      ],
    },
    composition: {
      tempo: { intro_bpm: 74, verse_bpm: 82, chorus_bpm: 92, interlude_bpm: 68, final_bpm: 88 },
      meters: ["6/8 core", "4/4 chorus option", "free pickup represented by sparse tempo points"],
      harmony: "Add2/add9/maj7 voicings, pedal fifths, suspended resolution and slow bass motion; preserve a clear melodic anchor.",
      form: ["field-like intro", "verse", "lift", "chorus", "instrumental night-sky break", "verse-2", "wide chorus", "dissolving outro"],
      target_duration_seconds: [200, 260],
    },
    arrangement: [
      { role: "warm pad", gm: { bank_msb: 0, bank_lsb: 0, program: 89 }, register: "C3–C6", articulation: "long inversions with explicit releases" },
      { role: "halo pad", gm: { bank_msb: 0, bank_lsb: 0, program: 94 }, register: "C4–C7", articulation: "very sparse upper color" },
      { role: "music box/celesta", gm_programs: [10, 8], register: "C5–C7", articulation: "motif fragments, avoid continuous eighth-note sparkle" },
      { role: "clean guitar", gm: { bank_msb: 0, bank_lsb: 0, program: 27 }, articulation: "delayed broken voicings and harmonics-like high notes" },
      { role: "fretless or synth bass", gm_programs: [35, 38], register: "E1–C3", articulation: "long roots and fifth approaches" },
      { role: "soft kit", channel: 10, notes: [36, 37, 42, 46, 51, 54, 81], articulation: "side-stick, brushed illusion, sparse cymbal swells/triangle" },
    ],
    groove: { grid_ticks: 160, swing_percent: [50, 58], timing_jitter_ticks: [2, 14], velocity_jitter: [2, 7], advice: "Humanize bells/guitar more than bass and vocal; preserve 6/8 compound accents." },
    mix: {
      pan: { lead: 64, pads: [30, 98], bells: 84, guitar: 42, harmony: [52, 76] },
      arrangement: "Keep the center sparse, high-pass reverbs, and measure mono compatibility; width must not turn into a one-sided result.",
      delivery: { integrated_lufs: -17, true_peak_dbfs: -1.5, target_lra_lu: 10 },
    },
  },
  {
    id: "piano-ballad",
    title: "Piano Vocal Ballad",
    uri: "vocaloid://styles/piano-ballad",
    description: "Narrative-first piano, restrained strings, exposed diction and large section dynamics.",
    tags: ["ballad", "piano", "strings", "narrative", "rubato"],
    status: "production-guidance",
    rendererBoundary: boundary,
    voice: {
      preferredName: "IA_ROCKS",
      componentId: IA_ROCKS_COMPONENT_ID,
      rangeGuidance: "G3–E5 with infrequent climactic F5; avoid staying at the ceiling.",
      performance: ["Prioritize phrase timing and consonant clarity because the arrangement is exposed.", "Use DYN/opening arcs across semantic lines and vibrato only on earned endpoints."],
    },
    composition: { tempo_bpm: [62, 86], meters: ["4/4", "6/8"], harmony: "functional harmony with inversions, suspensions and one late borrowed chord", target_duration_seconds: [190, 260] },
    arrangement: [{ role: "piano", gm: { program: 0 } }, { role: "strings", gm: { program: 48 } }, { role: "cello", gm: { program: 42 } }],
    groove: { timing_jitter_ticks: [0, 12], advice: "Represent rubato as explicit tempo points; never randomize tempo." },
    mix: { delivery: { integrated_lufs: -17, true_peak_dbfs: -1, target_lra_lu: 11 } },
  },
  {
    id: "electro-speed",
    title: "高速 Electro Vocaloid",
    uri: "vocaloid://styles/electro-speed",
    description: "Dense rhythmic lyrics, syncopated synth bass, gated pads and tempo/meter surprises.",
    tags: ["electro", "speed", "dense-lyrics", "syncopation", "synth"],
    status: "production-guidance",
    rendererBoundary: boundary,
    voice: {
      preferredName: "IA_ROCKS",
      componentId: IA_ROCKS_COMPONENT_ID,
      rangeGuidance: "B3–F#5; rapid notes should cluster near the middle of the range.",
      performance: ["Use explicit 1/16–1/32 cells and repeated mora indices for controlled melisma.", "Alternate dense bars with held vowel/rest bars so intelligibility has contrast."],
    },
    composition: { tempo_bpm: [150, 190], meters: ["4/4", "7/8 turnarounds", "2/4 drops"], harmony: "short modal loops, chromatic bass approach and clear chorus anchor", target_duration_seconds: [170, 225] },
    arrangement: [{ role: "synth bass", gm: { program: 38 } }, { role: "saw lead", gm: { program: 81 } }, { role: "polysynth", gm: { program: 90 } }, { role: "electronic kit", channel: 10 }],
    groove: { grid_ticks: 120, swing_percent: [50, 62], timing_jitter_ticks: [0, 4], velocity_jitter: [2, 9], advice: "Keep machine-tight layers tight; humanize only chosen fills and offbeats." },
    mix: { delivery: { integrated_lufs: -14, true_peak_dbfs: -1, target_lra_lu: 5 } },
  },
] as const;

export function stylePaletteSummaries(): StylePaletteSummary[] {
  return STYLE_PALETTES.map(({ id, title, uri, description, tags }) => ({
    id,
    title,
    uri,
    description,
    tags: [...tags],
  }));
}

export function getStylePalette(id: string): StylePalette | undefined {
  return STYLE_PALETTES.find((palette) => palette.id === id);
}
