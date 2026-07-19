#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const SERVER_ENTRYPOINT = join(REPOSITORY_ROOT, "dist", "src", "index.js");
const BUILD_ROOT = join(REPOSITORY_ROOT, "build", "cold-start-songs");
const SONG_DIRECTORY = join(REPOSITORY_ROOT, "artifacts", "songs");
const VSQX_DIRECTORY = join(REPOSITORY_ROOT, "artifacts", "vsqxs");
const CREATIVE_RECORD_DIRECTORY = join(REPOSITORY_ROOT, "artifacts", "creative-records");

const IA_ROCKS_COMPONENT_ID = "BDREB7P2KTWKYDC5";
const DEFAULT_RUN_ID = "tooi-hi-aoi-yoru-ia-20260719-a";
const SONG_ID = "tooi-hi-aoi-yoru-ia-20260719-a";
const SLUG = "tooi-hi-aoi-yoru-ia-20260719-a";
const TITLE = "遠い灯、青い夜";

const LEAD_TRACK_ID = "distant-lights-lead";
const HARMONY_TRACK_ID = "distant-lights-harmony";
const LEAD_PART_ID = "distant-lights-lead-part";
const HARMONY_PART_ID = "distant-lights-harmony-part";
const CHORUS_DIRECTION_ID = "direction-loneliness-into-space";
const FINAL_DIRECTION_ID = "direction-return-with-solitude";
const CHORUS_QUESTION_ID = "question-loneliness-becomes-space";
const FINAL_QUESTION_ID = "question-return-without-erasure";

const IA_ROCKS_VOICE = {
  id: "voice-ia-rocks-distant-lights",
  name: "IA_ROCKS",
  component_id: IA_ROCKS_COMPONENT_ID,
};

function position(measure, beat = 0, tick = 0) {
  return { measure, beat, tick };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseArguments(argv) {
  let runId = DEFAULT_RUN_ID;
  let resume = false;
  for (const argument of argv) {
    if (argument === "--resume") resume = true;
    else if (argument.startsWith("--run-id=")) runId = argument.slice("--run-id=".length);
    else if (argument === "--help" || argument === "-h") {
      console.log([
        "Usage: npm run compose:distant-lights -- [--run-id=<id>] [--resume]",
        "",
        "Creates a complete original IA_ROCKS summer-night song through the canonical",
        "VOCALOID MCP workflow. Every canonical edit is dry-run before write. The local",
        "IA library is never queried at track level; one aggregate/manual summer palette",
        "is read only after the symbolic composition passes preflight.",
      ].join("\n"));
      process.exit(0);
    } else {
      throw new Error(`Unknown argument ${argument}`);
    }
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/u.test(runId)) {
    throw new Error("--run-id must be a stable lowercase ID");
  }
  return { runId, resume };
}

class ProductionMcp {
  constructor() {
    this.client = new Client({ name: "distant-lights-composition-runner", version: "1.0.0" });
    this.transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_ENTRYPOINT],
      cwd: REPOSITORY_ROOT,
      env: { ...process.env, VOCALOID_MCP_PROFILE: "production" },
      stderr: "pipe",
    });
    this.transport.stderr?.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  }

  async connect() {
    await this.client.connect(this.transport);
  }

  async close() {
    await this.transport.close();
  }

  async resource(uri) {
    return this.client.readResource({ uri });
  }

  async call(name, args, options = {}) {
    const label = options.label ?? name;
    if (!options.quiet) console.log(`→ ${label}`);
    const result = await this.client.callTool(
      { name, arguments: { ...args, response_format: "json" } },
      undefined,
      {
        timeout: options.timeout ?? 180_000,
        maxTotalTimeout: options.maxTotalTimeout ?? options.timeout ?? 180_000,
        resetTimeoutOnProgress: true,
        onprogress: (progress) => {
          const total = progress.total ?? 100;
          const percent = total > 0 ? Math.round((progress.progress / total) * 100) : progress.progress;
          console.log(`  ${label}: ${percent}%${progress.message ? ` — ${progress.message}` : ""}`);
        },
      },
    );
    const structured = result.structuredContent;
    if (!structured || structured.ok !== true) {
      const fallback = result.content?.find((entry) => entry.type === "text")?.text;
      const diagnostic = structured?.error?.message ?? structured?.warnings?.join("; ") ?? fallback ?? "unknown MCP failure";
      throw new Error(`${name} failed: ${diagnostic}`);
    }
    if (!options.quiet && structured.warnings?.length) {
      console.log(`  warnings: ${structured.warnings.join(" | ")}`);
    }
    return structured.data;
  }

  async edit(manifestPath, revision, action, fields) {
    const payload = {
      input_path: manifestPath,
      output_path: manifestPath,
      expected_revision: revision,
      overwrite: true,
      ...fields,
    };
    await this.call("vocaloid_edit_song", { action, payload: { ...payload, dry_run: true } }, {
      label: `dry-run ${action}`,
      timeout: 300_000,
      maxTotalTimeout: 300_000,
    });
    const applied = await this.call("vocaloid_edit_song", { action, payload: { ...payload, dry_run: false } }, {
      label: `apply ${action}`,
      timeout: 300_000,
      maxTotalTimeout: 300_000,
    });
    if (!applied.write?.revision) throw new Error(`${action} returned no written revision`);
    return applied.write.revision;
  }
}

const SECTIONS = [
  ["intro", "Intro — ridge air", "intro", 0, 4, 0.18, "The city is present only as distant light; no narrator statement yet."],
  ["verse-1", "Verse 1 — outside the festival", "verse", 4, 12, 0.34, "Turn away from fireworks and discover the town as many small breaths."],
  ["pre-1", "Pre 1 — unseen but warmed", "pre_chorus", 12, 16, 0.50, "Isolation becomes chosen distance rather than disappearance."],
  ["chorus-1", "Chorus 1 — counting lights", "chorus", 16, 24, 0.72, "Let loneliness remain visible while the wide view gives it a transparent container."],
  ["interlude", "Interlude — night field", "interlude", 24, 28, 0.25, "Remove language and let wind, bell, and suspended harmony restore distance."],
  ["verse-2", "Verse 2 — lives in the windows", "verse", 28, 36, 0.42, "Notice other lives without pretending to enter or possess them."],
  ["pre-2", "Pre 2 — singing to the wind", "pre_chorus", 36, 40, 0.59, "Replace social participation with a small private gesture that still reaches outward."],
  ["final-chorus", "Final chorus — road back", "chorus", 40, 48, 0.84, "The town does not answer, but its light makes a return route imaginable."],
  ["instrumental-release", "Instrumental release — afterimage", "interlude", 48, 52, 0.46, "Keep the final chorus glow without adding another claim."],
  ["outro", "Outro — blue descent", "outro", 52, 56, 0.16, "Leave on an open fifth/add9 after motion has already turned toward town."],
].map(([id, name, kind, start, end, energy, description]) => ({
  id,
  name,
  kind,
  start: position(start),
  end: position(end),
  energy,
  description,
}));

const TEMPOS = [
  [0, 76], [4, 82], [12, 86], [16, 90], [24, 72],
  [28, 82], [36, 88], [40, 92], [48, 78], [52, 68],
].map(([measure, bpm]) => ({ position: position(measure), bpm }));

const CHORD_SYMBOLS = [
  "Aadd9", "E/G#", "F#m7", "Dmaj7",
  "Amaj7", "E/G#", "F#m7", "C#m7", "Dmaj7", "A/C#", "Bm7", "Esus4",
  "F#m7", "C#m7", "Dmaj7", "Eadd9",
  "Aadd9", "E/G#", "F#m7", "C#m7", "Dmaj7", "A/C#", "Bm7", "Esus4",
  "F#m(add9)", "Dmaj7", "A/E", "Eadd9",
  "Amaj7", "B/A", "G#m7", "C#sus4", "F#m7", "Dmaj7", "Bm7", "Eadd9",
  "F#m7", "C#m7", "Dmaj7", "Eadd9",
  "Aadd9", "E/G#", "F#m7", "C#m7", "Dmaj7", "A/C#", "Bm7", "Eadd9",
  "F#m(add9)", "Dmaj7", "A/E", "Eadd9",
  "Aadd9", "E/G#", "Dmaj7", "Aadd9",
];

if (CHORD_SYMBOLS.length !== 56) throw new Error("Chord map must cover all 56 measures");

const CHORDS = CHORD_SYMBOLS.map((symbol, measure) => ({
  id: `distant-chord-m${String(measure).padStart(2, "0")}`,
  position: position(measure),
  symbol,
  duration_ticks: 1440,
}));

const LEAD_LINES = [
  { id: "v1-line-1", section: "verse-1", measure: 4, text: "遠い花火は　背中でひらく", reading: "とおいはなびわ せなかでひらく", pitches: [57, 59, 61, 59, 61, 64, 61, 59, 57, 59, 61, 59, 57, 56], splitAfter: 6, focus: [3, 4, 5], intensity: 0.34 },
  { id: "v1-line-2", section: "verse-1", measure: 6, text: "祭りの音を　夜風がほどく", reading: "まつりのおとお よかぜがほどく", pitches: [59, 61, 64, 61, 59, 61, 59, 57, 59, 61, 64, 61, 59, 57], splitAfter: 6, focus: [7, 8, 9], intensity: 0.36 },
  { id: "v1-line-3", section: "verse-1", measure: 8, text: "ガードレールの　向こうに町", reading: "がーどれーるの むこうにまち", pitches: [61, 61, 64, 66, 64, 61, 59, 61, 64, 66, 64, 61, 59], splitAfter: 6, focus: [7, 8, 9], intensity: 0.38 },
  { id: "v1-line-4", section: "verse-1", measure: 10, text: "名もない灯りが　息をしている", reading: "なもないあかりが いきをしている", pitches: [57, 59, 61, 64, 61, 59, 61, 64, 66, 64, 61, 59, 61, 59, 57], splitAfter: 7, focus: [4, 5, 6, 7], intensity: 0.41 },
  { id: "pre1-line-1", section: "pre-1", measure: 12, text: "ここまで来れば　誰にも見えない", reading: "ここまでくれば だれにもみえない", pitches: [59, 61, 64, 61, 64, 66, 64, 61, 64, 66, 68, 66, 64, 66, 68], splitAfter: 6, focus: [11, 12, 13, 14], intensity: 0.52 },
  { id: "pre1-line-2", section: "pre-1", measure: 14, text: "なのにあたたかい　光が残る", reading: "なのにあたたかい ひかりがのこる", pitches: [61, 64, 66, 64, 66, 68, 69, 68, 66, 64, 66, 68, 69, 71, 68], splitAfter: 7, focus: [8, 9, 10, 11], intensity: 0.58 },
  { id: "chorus1-line-1", section: "chorus-1", measure: 16, text: "遠い灯りを　ひとつずつ数えて", reading: "とおいあかりお ひとつずつかぞえて", pitches: [64, 66, 68, 69, 71, 69, 68, 66, 68, 69, 71, 73, 71, 69, 68, 66], splitAfter: 6, focus: [3, 4, 5, 11], intensity: 0.72 },
  { id: "chorus1-line-2", section: "chorus-1", measure: 18, text: "わたしもどこかへ　帰れる気がした", reading: "わたしもどこかえ かえれるきがした", pitches: [64, 66, 68, 69, 68, 66, 64, 66, 68, 69, 73, 71, 69, 68, 66, 64], splitAfter: 7, focus: [8, 9, 10, 11], intensity: 0.73 },
  { id: "chorus1-line-3", section: "chorus-1", measure: 20, text: "何もない夜は　透明な器", reading: "なにもないよるわ とうめいなうつわ", pitches: [61, 64, 66, 68, 66, 64, 61, 64, 66, 68, 69, 71, 69, 68, 66, 64], splitAfter: 7, focus: [8, 9, 10, 11], intensity: 0.70 },
  { id: "chorus1-line-4", section: "chorus-1", measure: 22, text: "さみしさも星のように　置いてゆける", reading: "さみしさもほしのように おいてゆける", pitches: [64, 66, 68, 69, 71, 69, 68, 66, 68, 69, 71, 73, 71, 69, 68, 66, 64], splitAfter: 10, focus: [11, 12, 13, 14, 15, 16], intensity: 0.76 },
  { id: "v2-line-1", section: "verse-2", measure: 28, text: "丘の草むら　風の波になる", reading: "おかのくさむら かぜのなみになる", pitches: [61, 64, 66, 64, 61, 59, 61, 64, 66, 68, 66, 64, 61, 59, 57], splitAfter: 6, focus: [7, 8, 9], intensity: 0.43 },
  { id: "v2-line-2", section: "verse-2", measure: 30, text: "遠いクラクション　川へと流れ", reading: "とおいくらくしょん かわえとながれ", pitches: [59, 61, 64, 66, 64, 61, 59, 61, 64, 66, 68, 66, 64, 61, 59], splitAfter: 7, focus: [3, 4, 5, 6, 7], intensity: 0.45 },
  { id: "v2-line-3", section: "verse-2", measure: 32, text: "知らない窓にも　誰かの明日", reading: "しらないまどにも だれかのあした", pitches: [61, 64, 66, 68, 66, 64, 61, 64, 66, 68, 69, 68, 66, 64, 61], splitAfter: 7, focus: [8, 9, 10, 11], intensity: 0.47 },
  { id: "v2-line-4", section: "verse-2", measure: 34, text: "触れられなくても　消えずに見える", reading: "ふれられなくても きえずにみえる", pitches: [59, 61, 64, 66, 68, 66, 64, 61, 64, 66, 68, 69, 68, 66, 64], splitAfter: 7, focus: [8, 9, 10, 11], intensity: 0.50 },
  { id: "pre2-line-1", section: "pre-2", measure: 36, text: "手を振る代わりに　小さく歌えば", reading: "ておふるかわりに ちいさくうたえば", pitches: [61, 64, 66, 64, 66, 68, 69, 68, 66, 68, 69, 71, 69, 71, 73, 71], splitAfter: 7, focus: [8, 9, 10, 11], intensity: 0.61 },
  { id: "pre2-line-2", section: "pre-2", measure: 38, text: "夜の向こう側　風だけが聞く", reading: "よるのむこうがわ かぜだけがきく", pitches: [64, 66, 68, 69, 68, 66, 68, 69, 71, 73, 71, 69, 68, 66, 68], splitAfter: 7, focus: [8, 9, 10, 11], intensity: 0.65 },
  { id: "final-line-1", section: "final-chorus", measure: 40, text: "遠い灯りは　答えじゃないけど", reading: "とおいあかりわ こたえじゃないけど", pitches: [66, 68, 69, 71, 69, 68, 66, 68, 69, 71, 73, 71, 69, 68, 66], splitAfter: 6, focus: [3, 4, 5], intensity: 0.81 },
  { id: "final-line-2", section: "final-chorus", measure: 42, text: "わたしの輪郭を　やさしく照らした", reading: "わたしのりんかくお やさしくてらした", pitches: [64, 66, 68, 69, 71, 69, 68, 66, 68, 69, 71, 73, 71, 76, 73, 71, 69], splitAfter: 8, focus: [9, 10, 11, 12, 13, 14, 15, 16], intensity: 0.87 },
  { id: "final-line-3", section: "final-chorus", measure: 44, text: "ひとりでいること　ひとりきりじゃない", reading: "ひとりでいること ひとりきりじゃない", pitches: [64, 66, 68, 69, 71, 69, 68, 66, 64, 66, 68, 69, 73, 71, 69, 68], splitAfter: 7, focus: [8, 9, 10, 11, 12, 13, 14, 15], intensity: 0.86 },
  { id: "final-line-4", section: "final-chorus", measure: 46, text: "町へ降りる道が　青くほどける", reading: "まちえおりるみちが あおくほどける", pitches: [61, 64, 66, 68, 69, 71, 69, 68, 66, 73, 71, 69, 68, 66, 64, 64], splitAfter: 8, focus: [9, 10, 11, 12, 13, 14, 15], intensity: 0.84 },
];

const HARMONY_LINES = [
  { id: "harmony-chorus-return", section: "chorus-1", measure: 19, text: "帰れる気がした", reading: "かえれるきがした", pitches: [64, 66, 69, 68, 66, 64, 62, 61], focus: [0, 1, 2, 3] },
  { id: "harmony-chorus-release", section: "chorus-1", measure: 23, text: "置いてゆける", reading: "おいてゆける", pitches: [69, 68, 66, 64, 62, 61], focus: [0, 1, 2, 3, 4, 5] },
  { id: "harmony-final-outline", section: "final-chorus", measure: 43, text: "やさしく照らした", reading: "やさしくてらした", pitches: [66, 68, 69, 68, 73, 69, 68, 66], focus: [4, 5, 6, 7] },
  { id: "harmony-final-road", section: "final-chorus", measure: 47, text: "青くほどける", reading: "あおくほどける", pitches: [69, 68, 66, 64, 62, 61, 61], focus: [0, 1, 2, 3, 4, 5, 6] },
];

function allocateDurations(count, totalTicks, focusIndices) {
  const durations = new Array(count).fill(120);
  let remaining = totalTicks - count * 120;
  if (remaining < 0 || remaining % 120 !== 0) {
    throw new Error(`Cannot allocate ${totalTicks} ticks across ${count} morae`);
  }
  const priorities = [
    ...focusIndices,
    count - 1,
    Math.floor(count * 0.72),
    Math.floor(count * 0.45),
    Math.floor(count * 0.2),
  ].filter((value, index, array) => value >= 0 && value < count && array.indexOf(value) === index);
  let cursor = 0;
  while (remaining > 0) {
    durations[priorities[cursor % priorities.length]] += 120;
    cursor += 1;
    remaining -= 120;
  }
  return durations;
}

function leadNoteSlots(line) {
  const durations = allocateDurations(line.pitches.length, 2520, line.focus);
  const slots = [];
  for (let index = 0; index < line.pitches.length; index += 1) {
    const duration = durations[index];
    const isFocus = line.focus.includes(index);
    slots.push({
      id: `distant-${line.id}-cell-${String(index + 1).padStart(2, "0")}`,
      duration,
      note_number: line.pitches[index],
      gate_percent: duration >= 360 ? 95 : duration >= 240 ? 91 : 84,
      velocity: isFocus ? 58 : line.intensity >= 0.75 ? 66 : 62,
      style: {
        accent: isFocus ? 52 : 42,
        decay: duration >= 360 ? 44 : 56,
        opening: Math.round(48 + line.intensity * 34 + (isFocus ? 5 : 0)),
      },
    });
    if (index === line.splitAfter) {
      slots.push({
        id: `distant-${line.id}-inner-breath`,
        duration: 120,
        rest: true,
        gate_percent: 100,
        velocity: 64,
        style: {},
      });
    }
  }
  slots.push({
    id: `distant-${line.id}-terminal-breath`,
    duration: 240,
    rest: true,
    gate_percent: 100,
    velocity: 64,
    style: {},
  });
  const total = slots.reduce((sum, slot) => sum + slot.duration, 0);
  if (total !== 2880) throw new Error(`${line.id} must span exactly two 6/8 bars, got ${total}`);
  return slots;
}

function harmonyNoteSlots(line) {
  const durations = allocateDurations(line.pitches.length, 1320, line.focus);
  const slots = line.pitches.map((noteNumber, index) => ({
    id: `distant-${line.id}-cell-${String(index + 1).padStart(2, "0")}`,
    duration: durations[index],
    note_number: noteNumber,
    gate_percent: durations[index] >= 240 ? 92 : 84,
    velocity: line.focus.includes(index) ? 55 : 60,
    style: { accent: 38, decay: 50, opening: 54 },
  }));
  slots.push({
    id: `distant-${line.id}-terminal-breath`,
    duration: 120,
    rest: true,
    gate_percent: 100,
    velocity: 64,
    style: {},
  });
  const total = slots.reduce((sum, slot) => sum + slot.duration, 0);
  if (total !== 1440) throw new Error(`${line.id} must span exactly one 6/8 bar, got ${total}`);
  return slots;
}

const VOICINGS = {
  "Aadd9": [57, 64, 71, 73],
  "Amaj7": [57, 61, 68, 71],
  "E/G#": [56, 64, 68, 71],
  "F#m7": [54, 61, 64, 69],
  "F#m(add9)": [54, 61, 68, 69],
  "C#m7": [61, 64, 68, 71],
  "Dmaj7": [50, 57, 61, 66],
  "A/C#": [49, 57, 64, 69],
  "Bm7": [59, 62, 66, 69],
  "Esus4": [52, 57, 59, 64],
  "Eadd9": [52, 59, 66, 68],
  "A/E": [52, 57, 61, 64],
  "B/A": [57, 59, 63, 66],
  "G#m7": [56, 59, 63, 66],
  "C#sus4": [49, 54, 56, 61],
};

const BASS_NOTES = {
  "Aadd9": 33,
  "Amaj7": 33,
  "E/G#": 32,
  "F#m7": 30,
  "F#m(add9)": 30,
  "C#m7": 37,
  "Dmaj7": 38,
  "A/C#": 37,
  "Bm7": 35,
  "Esus4": 28,
  "Eadd9": 28,
  "A/E": 28,
  "B/A": 33,
  "G#m7": 32,
  "C#sus4": 37,
};

for (const symbol of new Set(CHORD_SYMBOLS)) {
  if (!VOICINGS[symbol] || BASS_NOTES[symbol] === undefined) throw new Error(`Missing arrangement mapping for ${symbol}`);
}

function pitchedTrack(id, name, program, volume, pan) {
  return { kind: "pitched", id, name, program, volume, pan, notes: [], patterns: [], placements: [] };
}

function addPitched(track, id, measure, beat, duration, noteNumber, velocity) {
  track.notes.push({ id, position: position(measure, beat), duration, note_number: noteNumber, velocity });
}

function makeArrangement() {
  const pad = pitchedTrack("distant-warm-pad", "Warm Pad — distant town field", 89, 48, 34);
  const electricPiano = pitchedTrack("distant-electric-piano", "Electric Piano — harmonic landmarks", 4, 55, 52);
  const guitar = pitchedTrack("distant-clean-guitar", "Clean Guitar — delayed ridge reflections", 27, 52, 88);
  const bass = pitchedTrack("distant-fretless-bass", "Fretless Bass — slow return path", 35, 58, 64);
  const bell = pitchedTrack("distant-celesta", "Celesta — remote festival afterimage", 10, 46, 82);
  const drums = { kind: "drums", id: "distant-soft-kit", name: "Soft 6/8 Kit — footsteps and air", hits: [], patterns: [], placements: [] };

  const addDrum = (measure, beat, noteNumber, velocity, label) => drums.hits.push({
    id: `distant-drum-m${measure}-${label}-${beat}`,
    position: position(measure, beat),
    note_number: noteNumber,
    velocity,
    duration: 60,
  });

  const bellMotif = [81, 83, 85, 83, 88, 85];
  for (let measure = 0; measure < 56; measure += 1) {
    const symbol = CHORD_SYMBOLS[measure];
    const voicing = VOICINGS[symbol];
    const active = SECTIONS.find((section) => measure >= section.start.measure && measure < section.end.measure);
    const chorus = active?.id === "chorus-1" || active?.id === "final-chorus";
    const sparse = active?.kind === "intro" || active?.kind === "outro" || active?.kind === "interlude";
    const velocity = chorus ? 56 : sparse ? 40 : 48;

    for (const [voiceIndex, noteNumber] of voicing.entries()) {
      addPitched(
        pad,
        `distant-pad-m${measure}-v${voiceIndex}`,
        measure,
        0,
        1320,
        noteNumber + (voiceIndex === 0 && noteNumber < 54 ? 12 : 0),
        velocity + voiceIndex * 2,
      );
    }

    if (measure >= 4 && measure < 52) {
      for (const [index, noteNumber] of [voicing[0], voicing[2]].entries()) {
        addPitched(electricPiano, `distant-ep-m${measure}-a${index}`, measure, 0, 420, noteNumber + 12, chorus ? 65 : 55);
      }
      for (const [index, noteNumber] of [voicing[1], voicing[3]].entries()) {
        addPitched(electricPiano, `distant-ep-m${measure}-b${index}`, measure, 3, 420, noteNumber + 12, chorus ? 63 : 53);
      }
    }

    const guitarActive = (measure >= 12 && measure < 28) || (measure >= 36 && measure < 52);
    if (guitarActive) {
      for (const [index, beat] of [1, 2, 4, 5].entries()) {
        addPitched(
          guitar,
          `distant-guitar-m${measure}-n${index}`,
          measure,
          beat,
          170,
          voicing[(index + 1) % voicing.length] + 12,
          chorus ? 62 : 51,
        );
      }
    }

    if (measure >= 2 && measure < 52) {
      const root = BASS_NOTES[symbol];
      addPitched(bass, `distant-bass-m${measure}-root`, measure, 0, 1080, root, chorus ? 68 : sparse ? 48 : 58);
      if (chorus || active?.kind === "pre_chorus") {
        addPitched(bass, `distant-bass-m${measure}-approach`, measure, 5, 150, root + 7, chorus ? 60 : 52);
      }
    }

    const bellActive = [0, 2, 24, 26, 40, 42, 44, 46, 48, 50, 52, 54].includes(measure);
    if (bellActive) {
      const motifOffset = Math.floor(measure / 2) % bellMotif.length;
      addPitched(bell, `distant-bell-m${measure}-a`, measure, 0, 210, bellMotif[motifOffset], chorus ? 58 : 47);
      addPitched(bell, `distant-bell-m${measure}-b`, measure, 4, 210, bellMotif[(motifOffset + 2) % bellMotif.length], chorus ? 55 : 44);
    }

    if (active?.kind === "intro" || active?.kind === "outro") {
      if (measure % 2 === 0) addDrum(measure, 0, 81, 34, "triangle");
      continue;
    }
    addDrum(measure, 0, 36, chorus ? 74 : sparse ? 43 : 58, "kick");
    addDrum(measure, 3, 37, chorus ? 68 : sparse ? 38 : 52, "sidestick");
    if (chorus) addDrum(measure, 4, 36, 58, "kick2");
    for (let beat = 0; beat < 6; beat += 1) {
      if (sparse && beat % 2 === 1) continue;
      addDrum(measure, beat, beat === 5 && chorus ? 46 : 42, chorus ? 47 + (beat % 2) * 4 : 35 + (beat % 2) * 3, `hat${beat}`);
    }
    if ([16, 40].includes(measure)) addDrum(measure, 0, 51, 63, "ride-entry");
  }
  return [pad, electricPiano, guitar, bass, bell, drums];
}

function effectChains() {
  return [
    {
      id: "distant-lead-chain",
      target_id: LEAD_TRACK_ID,
      effects: [
        { id: "distant-lead-trim", type: "gain", enabled: true, parameters: { gain_db: -1.5 } },
        { id: "distant-lead-hpf", type: "highpass", enabled: true, parameters: { frequency_hz: 82, q: 0.707, poles: 2 } },
        { id: "distant-lead-presence", type: "equalizer", enabled: true, parameters: { frequency_hz: 3100, q: 1.1, gain_db: 1.2, mix: 0.75 } },
        { id: "distant-lead-comp", type: "compressor", enabled: true, parameters: { threshold_db: -21, ratio: 2.0, attack_ms: 28, release_ms: 190, makeup_db: 0.8, knee: 3, detection: "rms", mix: 0.70 } },
        { id: "distant-lead-deess", type: "deesser", enabled: true, parameters: { intensity: 0.16, max_deessing: 0.28, frequency_focus: 0.60 } },
        { id: "distant-lead-room", type: "reverb", enabled: true, parameters: { in_gain: 0.80, out_gain: 0.72, delay_ms: 118, decay: 0.29 } },
      ],
    },
    {
      id: "distant-harmony-chain",
      target_id: HARMONY_TRACK_ID,
      effects: [
        { id: "distant-harmony-trim", type: "gain", enabled: true, parameters: { gain_db: -7 } },
        { id: "distant-harmony-hpf", type: "highpass", enabled: true, parameters: { frequency_hz: 116, q: 0.707, poles: 2 } },
        { id: "distant-harmony-comp", type: "compressor", enabled: true, parameters: { threshold_db: -23, ratio: 2.4, attack_ms: 22, release_ms: 220, makeup_db: 0, knee: 3, detection: "rms", mix: 0.75 } },
        { id: "distant-harmony-room", type: "reverb", enabled: true, parameters: { in_gain: 0.76, out_gain: 0.68, delay_ms: 154, decay: 0.35 } },
      ],
    },
    {
      id: "distant-pad-chain",
      target_id: "distant-warm-pad",
      effects: [
        { id: "distant-pad-trim", type: "gain", enabled: true, parameters: { gain_db: -6 } },
        { id: "distant-pad-hpf", type: "highpass", enabled: true, parameters: { frequency_hz: 128, q: 0.707, poles: 2 } },
        { id: "distant-pad-room", type: "reverb", enabled: true, parameters: { in_gain: 0.70, out_gain: 0.65, delay_ms: 176, decay: 0.38 } },
      ],
    },
    {
      id: "distant-ep-chain",
      target_id: "distant-electric-piano",
      effects: [
        { id: "distant-ep-gain", type: "gain", enabled: true, parameters: { gain_db: 1.5 } },
        { id: "distant-ep-hpf", type: "highpass", enabled: true, parameters: { frequency_hz: 92, q: 0.707, poles: 2 } },
        { id: "distant-ep-room", type: "reverb", enabled: true, parameters: { in_gain: 0.78, out_gain: 0.70, delay_ms: 86, decay: 0.20 } },
      ],
    },
    {
      id: "distant-guitar-chain",
      target_id: "distant-clean-guitar",
      effects: [
        { id: "distant-guitar-trim", type: "gain", enabled: true, parameters: { gain_db: -1 } },
        { id: "distant-guitar-hpf", type: "highpass", enabled: true, parameters: { frequency_hz: 138, q: 0.707, poles: 2 } },
        { id: "distant-guitar-delay", type: "delay", enabled: true, parameters: { delay_ms: 240, decay: 0.13 } },
      ],
    },
    {
      id: "distant-bass-chain",
      target_id: "distant-fretless-bass",
      effects: [
        { id: "distant-bass-gain", type: "gain", enabled: true, parameters: { gain_db: 3 } },
        { id: "distant-bass-lpf", type: "lowpass", enabled: true, parameters: { frequency_hz: 3600, q: 0.707, poles: 2 } },
        { id: "distant-bass-comp", type: "compressor", enabled: true, parameters: { threshold_db: -20, ratio: 2.2, attack_ms: 35, release_ms: 210, makeup_db: 1, knee: 3, detection: "rms", mix: 0.78 } },
      ],
    },
    {
      id: "distant-bell-chain",
      target_id: "distant-celesta",
      effects: [
        { id: "distant-bell-trim", type: "gain", enabled: true, parameters: { gain_db: -5 } },
        { id: "distant-bell-hpf", type: "highpass", enabled: true, parameters: { frequency_hz: 420, q: 0.707, poles: 2 } },
        { id: "distant-bell-room", type: "reverb", enabled: true, parameters: { in_gain: 0.72, out_gain: 0.64, delay_ms: 188, decay: 0.42 } },
      ],
    },
    {
      id: "distant-drums-chain",
      target_id: "distant-soft-kit",
      effects: [
        { id: "distant-drums-gain", type: "gain", enabled: true, parameters: { gain_db: 1.5 } },
        { id: "distant-drums-comp", type: "compressor", enabled: true, parameters: { threshold_db: -18, ratio: 1.8, attack_ms: 24, release_ms: 160, makeup_db: 0.5, knee: 3, detection: "rms", mix: 0.58 } },
      ],
    },
    {
      id: "distant-mix-bus-chain",
      target_id: "mix-bus",
      effects: [
        { id: "distant-bus-trim", type: "gain", enabled: true, parameters: { gain_db: -4 } },
        { id: "distant-bus-comp", type: "compressor", enabled: true, parameters: { threshold_db: -15, ratio: 1.45, attack_ms: 38, release_ms: 260, makeup_db: 0, knee: 3.5, detection: "rms", mix: 0.42 } },
        { id: "distant-bus-limit", type: "limiter", enabled: true, parameters: { limit_db: -2.0, attack_ms: 5, release_ms: 100 } },
      ],
    },
  ];
}

function allVoicedEventIds(phrases) {
  return phrases.flatMap((phrase) => phrase.cells.filter((cell) => !cell.rest).map((cell) => cell.id));
}

function phraseById(phrases, id) {
  const phrase = phrases.find((candidate) => candidate.id === `distant-${id}`);
  if (!phrase) throw new Error(`Missing aligned phrase ${id}`);
  return phrase;
}

function selectedEventIds(phrase, zeroBasedIndices) {
  const cells = phrase.cells.filter((cell) => !cell.rest);
  return zeroBasedIndices.map((index) => {
    if (!cells[index]) throw new Error(`Missing voiced cell ${index} in ${phrase.id}`);
    return cells[index].id;
  });
}

function staticVoicedIdsForLeadSections(sectionIds) {
  return LEAD_LINES.filter((line) => sectionIds.includes(line.section))
    .flatMap((line) => leadNoteSlots(line).filter((slot) => !slot.rest).map((slot) => slot.id));
}

function finalAnchorRealizationLinks() {
  const anchorLines = LEAD_LINES.filter((line) => ["pre-2", "final-chorus"].includes(line.section));
  const finalLine = LEAD_LINES.find((line) => line.id === "final-line-4");
  return {
    vocal_phrase_ids: [
      ...anchorLines.map((line) => `distant-${line.id}`),
      "distant-harmony-final-outline",
      "distant-harmony-final-road",
    ],
    event_ids: staticVoicedIdsForLeadSections(["pre-2", "final-chorus"]),
    semantic_focus_object_ids: finalLine.focus.map((index) => `distant-final-line-4-cell-${String(index + 1).padStart(2, "0")}`),
    tuning_gesture_ids: ["distant-pre2-dyn", "distant-final-dyn", "distant-final-opening", "distant-final-brightness", "distant-blue-up-into", "distant-final-fall-away", "distant-final-focus-articulation"],
    chord_ids: CHORDS.slice(36, 48).map((chord) => chord.id),
    track_ids: [LEAD_TRACK_ID, HARMONY_TRACK_ID, ...makeArrangement().map((track) => track.id)],
  };
}

async function alignPhrases(mcp) {
  const leadPhrases = [];
  for (const line of LEAD_LINES) {
    if (line.pitches.length < 1) throw new Error(`${line.id} has no melody`);
    const aligned = await mcp.call("vocaloid_align_japanese_phrase", {
      text: line.text,
      reading: line.reading,
      phrase_id: `distant-${line.id}`,
      start: position(line.measure),
      allocation: "sequential",
      note_slots: leadNoteSlots(line),
      affricate_mode: "position",
      g_mode: "plosive",
    }, { label: `align ${line.id}` });
    const voicedCount = aligned.phrase.cells.filter((cell) => !cell.rest).length;
    if (voicedCount !== line.pitches.length) {
      throw new Error(`${line.id} expected ${line.pitches.length} voiced cells, got ${voicedCount}`);
    }
    leadPhrases.push(aligned.phrase);
  }

  const harmonyPhrases = [];
  for (const line of HARMONY_LINES) {
    const aligned = await mcp.call("vocaloid_align_japanese_phrase", {
      text: line.text,
      reading: line.reading,
      phrase_id: `distant-${line.id}`,
      start: position(line.measure),
      allocation: "sequential",
      note_slots: harmonyNoteSlots(line),
      affricate_mode: "position",
      g_mode: "plosive",
    }, { label: `align ${line.id}` });
    harmonyPhrases.push(aligned.phrase);
  }
  return { leadPhrases, harmonyPhrases };
}

function compositionIntent() {
  return {
    schema: "vocaloid-composition-intent/v1",
    song: {
      premise: "On a summer night, IA stands on a ridge beyond the city festival, turns her back on the distant fireworks, and watches the town breathe below.",
      narrator_stance: "Alone by choice for this moment, observant and transparent rather than abandoned.",
      addressee: "The town below, and indirectly the narrator's own place within it.",
      central_tension: "Distance makes the narrator feel empty and lonely, yet the same distance reveals connection without demanding participation.",
      state_at_start: "The festival is behind her and the town is only an unreachable field of lights.",
      intended_destination: "The lights do not answer, but they make a path back to ordinary life imaginable while solitude remains intact.",
      listener_after: "Leave the listener with cool air and open distance: a little lonely, but lighter and able to return.",
      creative_invariants: [
        "Do not turn the image into pure grief or a triumphant cure for loneliness.",
        "Distance and silence must remain audible through rests, open voicings, and selective harmony.",
        "Fireworks stay behind the narrator; the emotional focus is the town's small continuous lights.",
        "IA delivery grows by opening and duration, not by constant scoops, vibrato, or loudness.",
      ],
    },
    sections: SECTIONS.map((section) => ({
      id: `intent-${section.id}`,
      section_id: section.id,
      dramatic_function: section.description,
      state_before: section.id === "intro" ? "The scene has not yet chosen a meaning." : `The song arrives from ${section.id === "verse-1" ? "the distant festival" : "the previous image"}.`,
      intended_transition: section.description,
      state_after: section.id === "outro" ? "The narrator is moving toward town while the blue night remains open." : "The next section inherits a little more connection without losing distance.",
      contrast_with_previous: section.id === "intro" ? "None; this is the empty field." : "Change density, register, or lyric perspective while retaining the same cool night air.",
      inherited_delivery: section.kind === "chorus" ? "Wider vowels and register, but still clear and unforced." : section.kind === "verse" ? "Speech-close, stepwise, with audible breaths." : "Sparse and patient.",
    })),
    phrase_directions: [
      {
        id: CHORUS_DIRECTION_ID,
        section_id: "chorus-1",
        importance: "anchor",
        lyric_anchor: { text: "さみしさも星のように　置いてゆける" },
        purpose: "Let IA acknowledge loneliness directly, then place it into the night as one visible object rather than sink into grief.",
        addressed_to: "The lights below and the self standing outside them.",
        semantic_focus: "置いてゆける — the possibility of setting loneliness down without denying it.",
        subtext: "Nothing has solved the distance; the view simply makes it spacious enough to carry.",
        state_before: "Loneliness feels like an empty interior.",
        intended_transition: "Transform emptiness into transparent capacity by lengthening and releasing the final image.",
        state_after: "Loneliness is still present but no longer fills the whole field.",
        delivery_arc: "Begin the line in the same clear middle register, widen through 星のように, then lengthen and gently descend across 置いてゆける with selective lower harmony.",
        realization_hypothesis: {
          summary: "A high point before the final clause, followed by longer descending morae, quieter release, and selective harmony can make spaciousness audible without a victorious cadence.",
          melody: "Arch to C#5, then stepwise descent to E4.",
          rhythm: "An internal breath separates the image from the action; final focus morae receive the duration budget.",
          harmony: "Lower harmony enters only on the action 置いてゆける and ends on an open dominant-to-tonic edge.",
          register: "The peak stays below the later final-chorus E5 so this is discovery, not conclusion.",
          dynamics: "Moderate bloom, then decrease into the breath.",
          tuning: "One late slight vibrato and shallow fall-away only after the semantic action is established.",
          arrangement_space: "Pad and bass sustain the field while bell and guitar avoid the center of the sentence.",
          expected_evidence: [
            "The semantic-focus cells are longer than the phrase median.",
            "Harmony is absent from the first image and present only on 置いてゆける.",
            "The final contour descends after the phrase peak and leaves a terminal rest.",
          ],
          symbolic_targets: {
            melody_contour: "arch",
            melody_range: "expand",
            rhythm_density: "decrease",
            note_duration: "lengthen",
            harmonic_tension: "withhold",
            delivery_dynamics: "decrease",
            arrangement_density: "stable",
            semantic_focus_duration_ratio_min: 1.35,
          },
        },
        listening_question: {
          id: CHORUS_QUESTION_ID,
          question: "Does the chorus let loneliness remain visible while turning it into spaciousness rather than pure grief?",
        },
      },
      {
        id: FINAL_DIRECTION_ID,
        section_id: "final-chorus",
        importance: "anchor",
        lyric_anchor: { text: "町へ降りる道が　青くほどける" },
        purpose: "Make returning to town feel possible without claiming that solitude was a mistake or has disappeared.",
        addressed_to: "The town below and the narrator's next step.",
        semantic_focus: "青くほどける — the road appears gradually in the same blue night that held the solitude.",
        subtext: "There is no answer from the town; motion becomes possible because the narrator can now see a route.",
        state_before: "The narrator recognizes connection but remains stationary on the ridge.",
        intended_transition: "Use one recovered leap into 青 followed by a long descent to turn gaze into movement.",
        state_after: "The narrator can descend while keeping the night and loneliness as part of the self.",
        delivery_arc: "Gather the phrase quietly, leap once into 青, then relax stepwise with opening, BRI, and DYN all decreasing toward an open E ending and long instrumental release.",
        realization_hypothesis: {
          summary: "A single prepared fifth into 青, immediate stepwise recovery, late fall-away, and four bars without lyrics can imply motion without emotional closure.",
          melody: "Rising preparation, one fifth at the semantic focus, then stepwise recovery to E4.",
          rhythm: "The second half receives longer notes and a terminal breath; no lyric repeats after it.",
          harmony: "Selective lower harmony joins only the blue-road clause; the outro returns to Aadd9 rather than a plain triad.",
          register: "Final chorus owns the song's E5 ceiling one line earlier; the last line descends from C#5.",
          dynamics: "Final-section peak occurs before the last word, followed by a controlled decrease.",
          tuning: "Shallow up-into on 青 and a small fall-away on the last mora, with no blanket vibrato.",
          arrangement_space: "Full layers support the leap, then lyrics stop and the arrangement dissolves for eight bars.",
          expected_evidence: [
            "The leap is followed by contrary stepwise recovery.",
            "The focus cells are linked to DYN/opening/BRI and pitch gestures that are materialized in VSQX.",
            "No vocal event follows the final terminal breath.",
          ],
          symbolic_targets: {
            melody_contour: "arch",
            melody_range: "expand",
            rhythm_density: "decrease",
            note_duration: "lengthen",
            harmonic_tension: "withhold",
            delivery_dynamics: "decrease",
            arrangement_density: "decrease",
            semantic_focus_duration_ratio_min: 1.30,
          },
        },
        listening_question: {
          id: FINAL_QUESTION_ID,
          question: "Does the final descent make returning to town feel possible without erasing the solitude that came before it?",
        },
      },
    ],
  };
}

async function compose(mcp, manifestPath) {
  const created = await mcp.call("vocaloid_create_song_manifest", {
    output_path: manifestPath,
    song_id: SONG_ID,
    slug: SLUG,
    title: TITLE,
    format: "vsq3",
    pre_measure: 1,
    time_signatures: [{ measure: 0, numerator: 6, denominator: 8 }],
    tempos: TEMPOS,
    sections: SECTIONS,
    key_changes: [],
    chord_changes: [],
    sample_rate: 44_100,
    accompaniment_gain: 0.16,
    reverb: false,
    chorus: false,
    overwrite: false,
  }, { label: "create canonical summer-night skeleton" });
  let revision = created.revision;

  revision = await mcp.edit(manifestPath, revision, "set_composition_intent", {
    composition_intent: compositionIntent(),
  });

  revision = await mcp.edit(manifestPath, revision, "set_composition_guidance", {
    composition_guidance: {
      theory_ruleset_id: "core/v1",
      strictness: "balanced",
      harmonic_language: "tonal",
      required_review_severities: [],
      intent_review_policy: {
        mode: "advisory",
        require_song_intent: true,
        require_section_intent: true,
        minimum_anchor_phrases: 2,
        require_current_audition_review: false,
      },
      exceptions: [],
    },
  });

  revision = await mcp.edit(manifestPath, revision, "replace_timeline", {
    update: {
      key_changes: [{ id: "distant-key-a-major", position: position(0), tonic: "A", mode: "major" }],
      chord_changes: CHORDS,
    },
  });

  const { leadPhrases, harmonyPhrases } = await alignPhrases(mcp);
  const leadEvents = allVoicedEventIds(leadPhrases);
  const harmonyEvents = allVoicedEventIds(harmonyPhrases);
  const chorusAnchor = phraseById(leadPhrases, "chorus1-line-4");
  const finalAnchor = phraseById(leadPhrases, "final-line-4");
  const finalPeakPhrase = phraseById(leadPhrases, "final-line-2");

  revision = await mcp.edit(manifestPath, revision, "upsert_vocal_part", {
    voice: IA_ROCKS_VOICE,
    track: {
      id: LEAD_TRACK_ID,
      name: `IA_ROCKS Lead — ${TITLE}`,
      comment: "Original Japanese lyric and melody; explicit readings, morae, phonemes, and gesture materialization remain inspectable.",
      voice_id: IA_ROCKS_VOICE.id,
      mixer: { volume: 0, pan: 64, mute: false, solo: false, send_level: -898, send_enabled: false },
    },
    part: {
      id: LEAD_PART_ID,
      name: `${TITLE} Lead`,
      comment: "Cold-start composition from the supplied brief; no reference track, local song identity, or retrieved melody/lyrics were used.",
      start: position(4),
      end: position(48),
      notes: [],
      phrases: leadPhrases,
      control_curves: [],
      tuning_gestures: [],
    },
  });

  const bySection = (sectionId) => allVoicedEventIds(
    LEAD_LINES.filter((line) => line.section === sectionId).map((line) => phraseById(leadPhrases, line.id)),
  );
  const chorusFocus = selectedEventIds(chorusAnchor, LEAD_LINES.find((line) => line.id === "chorus1-line-4").focus);
  const finalFocus = selectedEventIds(finalAnchor, LEAD_LINES.find((line) => line.id === "final-line-4").focus);
  const finalPeakEvents = selectedEventIds(finalPeakPhrase, [12, 13, 14]);
  const leadGestures = [
    { id: "distant-verse1-dyn", type: "dynamics_arc", event_ids: bySection("verse-1"), start_value: 46, peak_value: 60, end_value: 49, peak_position: 0.62 },
    { id: "distant-pre1-dyn", type: "dynamics_arc", event_ids: bySection("pre-1"), start_value: 50, peak_value: 70, end_value: 58, peak_position: 0.70 },
    { id: "distant-chorus1-dyn", type: "dynamics_arc", event_ids: bySection("chorus-1"), start_value: 56, peak_value: 82, end_value: 61, peak_position: 0.66 },
    { id: "distant-verse2-dyn", type: "dynamics_arc", event_ids: bySection("verse-2"), start_value: 48, peak_value: 64, end_value: 52, peak_position: 0.60 },
    { id: "distant-pre2-dyn", type: "dynamics_arc", event_ids: bySection("pre-2"), start_value: 54, peak_value: 76, end_value: 63, peak_position: 0.72 },
    { id: "distant-final-dyn", type: "dynamics_arc", event_ids: bySection("final-chorus"), start_value: 61, peak_value: 90, end_value: 57, peak_position: 0.58 },
    { id: "distant-chorus-opening", type: "opening_arc", event_ids: bySection("chorus-1"), start_value: 56, peak_value: 84, end_value: 62, peak_position: 0.64 },
    { id: "distant-final-opening", type: "opening_arc", event_ids: bySection("final-chorus"), start_value: 60, peak_value: 94, end_value: 58, peak_position: 0.56 },
    { id: "distant-verse-breath", type: "timbre_arc", event_ids: [...bySection("verse-1"), ...bySection("verse-2")], curve: "BRE", start_value: 22, peak_value: 38, end_value: 26 },
    { id: "distant-chorus-brightness", type: "timbre_arc", event_ids: bySection("chorus-1"), curve: "BRI", start_value: 52, peak_value: 69, end_value: 56 },
    { id: "distant-final-brightness", type: "timbre_arc", event_ids: bySection("final-chorus"), curve: "BRI", start_value: 56, peak_value: 78, end_value: 58 },
    { id: "distant-chorus-release-vibrato", type: "vibrato", event_ids: [chorusFocus.at(-2)], vibrato_type: 13, length_percent: 30, depth_start: 18, depth_peak: 34, depth_end: 22, rate_start: 43, rate_end: 48 },
    { id: "distant-final-peak-vibrato", type: "vibrato", event_ids: [finalPeakEvents[1]], vibrato_type: 13, length_percent: 34, depth_start: 20, depth_peak: 40, depth_end: 26, rate_start: 44, rate_end: 50 },
    { id: "distant-chorus-fall-away", type: "pitch_scoop", event_ids: [chorusFocus.at(-1)], direction: "fall_away", depth_cents: 28, duration_percent: 18, pitch_bend_sensitivity: 2 },
    { id: "distant-blue-up-into", type: "pitch_scoop", event_ids: [finalFocus[0]], direction: "up_into", depth_cents: 34, duration_percent: 20, pitch_bend_sensitivity: 2 },
    { id: "distant-final-fall-away", type: "pitch_scoop", event_ids: [finalFocus.at(-1)], direction: "fall_away", depth_cents: 30, duration_percent: 22, pitch_bend_sensitivity: 2 },
    { id: "distant-final-focus-articulation", type: "articulation", event_ids: finalFocus, accent: 48, decay: 46, opening: 76, consonant_velocity: 58, fall_portamento: true },
  ];
  revision = await mcp.edit(manifestPath, revision, "apply_tuning", {
    vocal_track_id: LEAD_TRACK_ID,
    vocal_part_id: LEAD_PART_ID,
    gestures: leadGestures,
  });

  revision = await mcp.edit(manifestPath, revision, "upsert_vocal_part", {
    voice: IA_ROCKS_VOICE,
    track: {
      id: HARMONY_TRACK_ID,
      name: `IA_ROCKS Selective Harmony — ${TITLE}`,
      comment: "Lower diatonic support appears only on return/release clauses, not as full-line mechanical doubling.",
      voice_id: IA_ROCKS_VOICE.id,
      mixer: { volume: -80, pan: 76, mute: false, solo: false, send_level: -898, send_enabled: false },
    },
    part: {
      id: HARMONY_PART_ID,
      name: `${TITLE} Selective Harmony`,
      comment: "Four one-bar responses reinforce possibility and release, then leave before the instrumental afterimage.",
      start: position(19),
      end: position(48),
      notes: [],
      phrases: harmonyPhrases,
      control_curves: [],
      tuning_gestures: [],
    },
  });

  revision = await mcp.edit(manifestPath, revision, "apply_tuning", {
    vocal_track_id: HARMONY_TRACK_ID,
    vocal_part_id: HARMONY_PART_ID,
    gestures: [
      { id: "distant-harmony-dyn", type: "dynamics_arc", event_ids: harmonyEvents, start_value: 40, peak_value: 61, end_value: 42, peak_position: 0.70 },
      { id: "distant-harmony-opening", type: "opening_arc", event_ids: harmonyEvents, start_value: 46, peak_value: 64, end_value: 48, peak_position: 0.62 },
      { id: "distant-harmony-darkness", type: "timbre_arc", event_ids: harmonyEvents, curve: "BRI", start_value: 44, peak_value: 54, end_value: 42 },
    ],
  });

  const arrangement = makeArrangement();
  for (const track of arrangement) {
    revision = await mcp.edit(manifestPath, revision, "upsert_arrangement", { track });
  }
  for (const effect_chain of effectChains()) {
    revision = await mcp.edit(manifestPath, revision, "upsert_effect_chain", { effect_chain });
  }
  for (const section_dynamic of [
    { id: "distant-final-lead-lift", section_id: "final-chorus", target_id: LEAD_TRACK_ID, gain_db: 0.8, ramp_ms: 900 },
    { id: "distant-outro-pad-fall", section_id: "outro", target_id: "distant-warm-pad", gain_db: -3.0, ramp_ms: 1800 },
    { id: "distant-interlude-bus-breath", section_id: "interlude", target_id: "mix-bus", gain_db: -1.2, ramp_ms: 1200 },
  ]) {
    revision = await mcp.edit(manifestPath, revision, "upsert_section_dynamic", { section_dynamic });
  }

  revision = await mcp.edit(manifestPath, revision, "bind_phrase_realization", {
    phrase_direction_id: CHORUS_DIRECTION_ID,
    realization_links: {
      vocal_phrase_ids: [chorusAnchor.id, "distant-harmony-chorus-release"],
      lyric_unit_ids: chorusAnchor.lyrics.slice(11).map((lyric) => lyric.id),
      event_ids: allVoicedEventIds([chorusAnchor]),
      semantic_focus_object_ids: chorusFocus,
      tuning_gesture_ids: ["distant-chorus1-dyn", "distant-chorus-opening", "distant-chorus-brightness", "distant-chorus-release-vibrato", "distant-chorus-fall-away"],
      chord_ids: CHORDS.slice(22, 24).map((chord) => chord.id),
      track_ids: [LEAD_TRACK_ID, HARMONY_TRACK_ID, "distant-warm-pad", "distant-electric-piano", "distant-fretless-bass", "distant-soft-kit"],
    },
  });

  revision = await mcp.edit(manifestPath, revision, "bind_phrase_realization", {
    phrase_direction_id: FINAL_DIRECTION_ID,
    realization_links: finalAnchorRealizationLinks(),
  });

  const preflight = await mcp.call("vocaloid_preflight_song", {
    manifest_path: manifestPath,
    artifact_check: "none",
    include_performance_warnings: true,
    check_voice_cache: true,
    allow_unknown_editor: false,
    include_theory_proposals: true,
    max_theory_proposals: 6,
  }, { label: "intent/theory/note-allocation/arrangement preflight", timeout: 300_000, maxTotalTimeout: 300_000 });
  if (preflight.counts.errors > 0 || !preflight.readiness.score.ready || !preflight.readiness.build.ready) {
    throw new Error(`Composition preflight blocked: ${JSON.stringify({ counts: preflight.counts, readiness: preflight.readiness, issues: preflight.issues })}`);
  }

  const aggregateStyle = await mcp.resource("vocaloid://styles/summer-night-air");
  const styleText = aggregateStyle.contents?.find((entry) => "text" in entry)?.text;
  if (!styleText) throw new Error("Summer-night aggregate/manual style resource is unavailable after composition");
  const styleObservation = JSON.parse(styleText);
  return {
    revision,
    preflight,
    leadPhraseCount: leadPhrases.length,
    harmonyPhraseCount: harmonyPhrases.length,
    leadEventCount: leadEvents.length,
    harmonyEventCount: harmonyEvents.length,
    arrangementTrackIds: arrangement.map((track) => track.id),
    aggregateStyleObservation: {
      id: styleObservation.id,
      status: styleObservation.status,
      rendererBoundary: styleObservation.rendererBoundary,
      observedAfterSymbolicPreflight: true,
      use: "Broad range/arrangement/mix sanity check only; no note, chord, lyric, intent, or track-level corpus data consumed.",
    },
  };
}

function currentArtifacts(summary, role) {
  return summary.artifacts.filter((artifact) => (
    artifact.role === role
    && artifact.currentComposition !== false
    && (!["mix", "delivery"].includes(role) || artifact.currentMix !== false)
  ));
}

function artifactWithPathPrefix(summary, role, prefix) {
  return currentArtifacts(summary, role).find((artifact) => basename(artifact.path).startsWith(prefix));
}

function artifactRevision(artifact) {
  const revision = artifact.sourceRevision ?? artifact.source_revision;
  if (!Number.isInteger(revision)) throw new Error(`Artifact ${artifact.id} has no source revision`);
  return revision;
}

async function verifyVoice(mcp) {
  const readiness = await mcp.call("vocaloid_host_readiness", {
    include_expired_voice_records: false,
    allow_unknown_editor: false,
  }, { label: "verify host readiness" });
  if (readiness.editorLease) throw new Error(`VOCALOID Editor is leased by ${readiness.editorLease.requestId}`);
  if (readiness.verifiedComponentIds.includes(IA_ROCKS_COMPONENT_ID)) return readiness;
  const probe = await mcp.call("vocaloid_probe_voice", {
    component_id: IA_ROCKS_COMPONENT_ID,
    force: true,
    timeout_seconds: 120,
    allow_unknown_editor: false,
  }, { label: "probe IA_ROCKS with original Editor", timeout: 240_000, maxTotalTimeout: 240_000 });
  if (probe.record.status !== "verified") throw new Error(`IA_ROCKS probe failed: ${probe.record.reason}`);
  return probe;
}

async function verifyTuningMaterialization(mcp, manifestPath) {
  const section = await mcp.call("vocaloid_get_song_section", {
    path: manifestPath,
    section_id: "final-chorus",
  }, { label: "inspect gesture materialization", quiet: true });
  const tracks = section.vocalTracks.filter((track) => [LEAD_TRACK_ID, HARMONY_TRACK_ID].includes(track.id));
  const evidence = [];
  for (const track of tracks) {
    for (const part of track.parts) {
      const declared = (part.tuning_gestures ?? []).map((gesture) => gesture.id).sort();
      const materialized = [...(part.materialized_tuning_gesture_ids ?? [])].sort();
      const missing = declared.filter((id) => !materialized.includes(id));
      if (missing.length > 0) throw new Error(`Unmaterialized gestures in ${part.id}: ${missing.join(", ")}`);
      evidence.push({ trackId: track.id, partId: part.id, declared, materialized });
    }
  }
  if (evidence.length !== 2) throw new Error(`Expected two materialized vocal parts, got ${evidence.length}`);
  return evidence;
}

async function inspectNativeVsqx(vsqxPath) {
  const xml = await readFile(vsqxPath, "utf8");
  const count = (pattern) => [...xml.matchAll(pattern)].length;
  const evidence = {
    noteCount: count(/<note>/gu),
    controlCount: count(/<mCtrl>/gu),
    dyn: count(/<attr id="DYN">/gu),
    bre: count(/<attr id="BRE">/gu),
    bri: count(/<attr id="BRI">/gu),
    pit: count(/<attr id="PIT">/gu),
    pbs: count(/<attr id="PBS">/gu),
    nonzeroVibratoLength: count(/<attr id="vibLen">(?:[1-9][0-9]*)<\/attr>/gu),
    slightVibratoType: count(/<attr id="vibType">13<\/attr>/gu),
    iaRocksComponentOccurrences: count(new RegExp(IA_ROCKS_COMPONENT_ID, "gu")),
    mutedVocalUnits: count(/<mute>1<\/mute>/gu),
    soloVocalUnits: count(/<solo>1<\/solo>/gu),
  };
  if (evidence.noteCount < 250 || evidence.controlCount === 0 || evidence.dyn === 0
    || evidence.bre === 0 || evidence.bri === 0 || evidence.pit === 0 || evidence.pbs === 0
    || evidence.nonzeroVibratoLength === 0 || evidence.slightVibratoType === 0
    || evidence.iaRocksComponentOccurrences < 1) {
    throw new Error(`VSQX lacks required native score/tuning/voice evidence: ${JSON.stringify(evidence)}`);
  }
  return evidence;
}

async function renderArtifacts(mcp, manifestPath, runDirectory, initialSummary) {
  let summary = initialSummary;
  const currentManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const finalDirection = currentManifest.composition_intent?.phrase_directions
    ?.find((direction) => direction.id === FINAL_DIRECTION_ID);
  if ((finalDirection?.realization_links?.vocal_phrase_ids?.length ?? 0) < 8) {
    const revision = await mcp.edit(manifestPath, summary.revision, "bind_phrase_realization", {
      phrase_direction_id: FINAL_DIRECTION_ID,
      realization_links: finalAnchorRealizationLinks(),
    });
    if (revision <= summary.revision) throw new Error("Final anchor scope migration did not advance revision");
    summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
  }
  const balanceManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const hasBalancedInstrumentalSections = balanceManifest.mix?.section_dynamics
    ?.some((dynamic) => dynamic.id === "distant-intro-bus-presence" && dynamic.gain_db === 14);
  if (!hasBalancedInstrumentalSections) {
    for (const section_dynamic of [
      { id: "distant-intro-bus-presence", section_id: "intro", target_id: "mix-bus", gain_db: 14, ramp_ms: 1400 },
      { id: "distant-interlude-bus-breath", section_id: "interlude", target_id: "mix-bus", gain_db: 10, ramp_ms: 1200 },
      { id: "distant-release-bus-presence", section_id: "instrumental-release", target_id: "mix-bus", gain_db: 10, ramp_ms: 1400 },
      { id: "distant-outro-bus-presence", section_id: "outro", target_id: "mix-bus", gain_db: 14, ramp_ms: 1800 },
    ]) {
      await mcp.edit(manifestPath, summary.revision, "upsert_section_dynamic", { section_dynamic });
      summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
    }
  }
  let projectArtifact = currentArtifacts(summary, "vsqx").at(-1);
  if (!projectArtifact) {
    const revision = summary.revision;
    const built = await mcp.call("vocaloid_build_song_manifest", {
      manifest_path: manifestPath,
      expected_revision: revision,
      backing_output_path: join(runDirectory, `${SLUG}-backing-r${revision}.wav`),
      project_output_path: join(runDirectory, `${SLUG}-project-r${revision}.vsqx`),
    }, { label: `build VSQX and backing r${revision}`, timeout: 900_000, maxTotalTimeout: 900_000 });
    if (!built.validation.valid || built.backing.silent || built.backing.channels !== 2) {
      throw new Error(`Build validation failed: ${JSON.stringify({ validation: built.validation, backing: built.backing })}`);
    }
    projectArtifact = built.artifacts.find((artifact) => artifact.role === "vsqx");
    if (!projectArtifact) throw new Error("Build returned no VSQX artifact");
    summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
  }

  const materialization = await verifyTuningMaterialization(mcp, manifestPath);
  await verifyVoice(mcp);
  const stemsDirectory = join(runDirectory, "stems");
  await mkdir(stemsDirectory, { recursive: true });

  let instrumentArtifacts = currentArtifacts(summary, "instrument_stem");
  if (instrumentArtifacts.length < 6) {
    await mcp.call("vocaloid_render_instrument_stems", {
      manifest_path: manifestPath,
      expected_revision: summary.revision,
      output_directory: stemsDirectory,
      preserve_pan: true,
      include_renderer_effects: false,
    }, { label: "render six dry instrument stems", timeout: 1_200_000, maxTotalTimeout: 1_200_000 });
    summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
    instrumentArtifacts = currentArtifacts(summary, "instrument_stem");
  }
  if (instrumentArtifacts.length !== 6) throw new Error(`Expected 6 current instrument stems, got ${instrumentArtifacts.length}`);

  for (const trackId of [LEAD_TRACK_ID, HARMONY_TRACK_ID]) {
    const existing = currentArtifacts(summary, "vocal_stem").find((artifact) => artifact.metadata?.track_id === trackId);
    if (existing) continue;
    await mcp.call("vocaloid_render_vocal_stems", {
      manifest_path: manifestPath,
      expected_revision: summary.revision,
      project_artifact_id: projectArtifact.id,
      output_directory: stemsDirectory,
      vocal_track_ids: [trackId],
      center_pan: false,
      dry: true,
      allow_pre_send_adjustment: true,
      timeout_seconds: 600,
    }, { label: `render original-Editor ${trackId}`, timeout: 680_000, maxTotalTimeout: 680_000 });
    summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
  }

  const vocalArtifacts = currentArtifacts(summary, "vocal_stem");
  const leadArtifact = vocalArtifacts.find((artifact) => artifact.metadata?.track_id === LEAD_TRACK_ID);
  const harmonyArtifact = vocalArtifacts.find((artifact) => artifact.metadata?.track_id === HARMONY_TRACK_ID);
  if (!leadArtifact || !harmonyArtifact) throw new Error("Missing current lead/harmony Editor stems");

  const vocalAnalyses = {};
  for (const [label, artifact] of [["lead", leadArtifact], ["harmony", harmonyArtifact]]) {
    const outputPath = join(runDirectory, `${SLUG}-${label}-final-chorus.vocal-analysis.json`);
    const existing = currentArtifacts(summary, "analysis").find((candidate) => candidate.path === outputPath);
    if (existing) {
      vocalAnalyses[label] = { artifact: existing, reused: true };
      continue;
    }
    const analysisEventIds = label === "lead"
      ? LEAD_LINES.filter((line) => line.section === "final-chorus")
        .flatMap((line) => leadNoteSlots(line).filter((slot) => !slot.rest).map((slot) => slot.id))
      : HARMONY_LINES.filter((line) => line.section === "final-chorus")
        .flatMap((line) => harmonyNoteSlots(line).filter((slot) => !slot.rest).map((slot) => slot.id));
    vocalAnalyses[label] = await mcp.call("vocaloid_analyze_vocal_stem", {
      manifest_path: manifestPath,
      expected_revision: summary.revision,
      stem_artifact_id: artifact.id,
      output_path: outputPath,
      event_ids: analysisEventIds,
      pitch_tolerance_cents: 100,
      onset_tolerance_ms: 150,
      offset_tolerance_ms: 220,
      timeline_offset_seconds: 0,
    }, { label: `analyze ${label} score versus Editor stem`, timeout: 420_000, maxTotalTimeout: 420_000 });
    summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
  }

  let vocalMixArtifact = artifactWithPathPrefix(summary, "mix", `${SLUG}-lead-harmony-`);
  if (!vocalMixArtifact) {
    const vocalMix = await mcp.call("vocaloid_render_stem_mix", {
      manifest_path: manifestPath,
      expected_revision: summary.revision,
      stem_artifact_ids: [leadArtifact.id, harmonyArtifact.id],
      output_path: join(runDirectory, `${SLUG}-lead-harmony-r${summary.revision}.wav`),
      sample_rate: 44_100,
      bit_depth: 24,
      reference_lufs: -18,
      reference_true_peak_dbfs: -1.5,
      timeout_seconds: 900,
    }, { label: "mix lead plus selective harmony", timeout: 1_000_000, maxTotalTimeout: 1_000_000 });
    vocalMixArtifact = vocalMix.artifact;
    summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
  }

  const minimalTrackIds = new Set(["distant-electric-piano", "distant-fretless-bass", "distant-soft-kit"]);
  const minimalInstrumentArtifacts = instrumentArtifacts.filter((artifact) => minimalTrackIds.has(artifact.metadata?.track_id));
  if (minimalInstrumentArtifacts.length !== 3) throw new Error("Could not identify the three minimal-band instrument stems");
  let minimalMixArtifact = artifactWithPathPrefix(summary, "mix", `${SLUG}-minimal-band-`);
  if (!minimalMixArtifact) {
    const minimalMix = await mcp.call("vocaloid_render_stem_mix", {
      manifest_path: manifestPath,
      expected_revision: summary.revision,
      stem_artifact_ids: [leadArtifact.id, harmonyArtifact.id, ...minimalInstrumentArtifacts.map((artifact) => artifact.id)],
      output_path: join(runDirectory, `${SLUG}-minimal-band-r${summary.revision}.wav`),
      sample_rate: 44_100,
      bit_depth: 24,
      reference_lufs: -17,
      reference_true_peak_dbfs: -1.5,
      timeout_seconds: 900,
    }, { label: "mix anchor minimal band", timeout: 1_000_000, maxTotalTimeout: 1_000_000 });
    if (minimalMix.quality.sampleClipping || minimalMix.quality.channels !== 2) throw new Error("Minimal mix failed hard QC");
    minimalMixArtifact = minimalMix.artifact;
    summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
  }

  let fullMixArtifact = artifactWithPathPrefix(summary, "mix", `${SLUG}-full-mix-`);
  if (!fullMixArtifact) {
    const fullMix = await mcp.call("vocaloid_render_stem_mix", {
      manifest_path: manifestPath,
      expected_revision: summary.revision,
      stem_artifact_ids: [leadArtifact.id, harmonyArtifact.id, ...instrumentArtifacts.map((artifact) => artifact.id)],
      output_path: join(runDirectory, `${SLUG}-full-mix-r${summary.revision}.wav`),
      sample_rate: 44_100,
      bit_depth: 24,
      reference_lufs: -17,
      reference_true_peak_dbfs: -1.5,
      timeout_seconds: 900,
    }, { label: "mix complete six-layer arrangement", timeout: 1_000_000, maxTotalTimeout: 1_000_000 });
    if (fullMix.quality.sampleClipping || fullMix.quality.channels !== 2) throw new Error(`Full mix failed hard QC: ${JSON.stringify(fullMix.quality)}`);
    fullMixArtifact = fullMix.artifact;
    summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
  }

  const previews = {};
  for (const [layer, source] of [
    ["lead_solo", leadArtifact],
    ["lead_harmony", vocalMixArtifact],
    ["minimal_band", minimalMixArtifact],
    ["full_layers", fullMixArtifact],
  ]) {
    let artifact = artifactWithPathPrefix(summary, "preview", `${SLUG}-${layer}-anchor-`);
    if (!artifact) {
      const preview = await mcp.call("vocaloid_review_audio", {
        action: "anchor_preview",
        manifest_path: manifestPath,
        expected_revision: summary.revision,
        source_artifact_id: source.id,
        phrase_direction_id: FINAL_DIRECTION_ID,
        audition_layer: layer,
        output_path: join(runDirectory, `${SLUG}-${layer}-anchor-r${summary.revision}.wav`),
        target_duration_seconds: 25,
        reference_lufs: -18,
        reference_true_peak_dbfs: -1.5,
      }, { label: `render ${layer} anchor preview`, timeout: 600_000, maxTotalTimeout: 600_000 });
      artifact = preview.artifact;
      summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
    }
    previews[layer] = artifact;
  }

  let arrangementAb = {
    A: artifactWithPathPrefix(summary, "preview", `${SLUG}-arrangement-ab-a-`),
    B: artifactWithPathPrefix(summary, "preview", `${SLUG}-arrangement-ab-b-`),
  };
  if (!arrangementAb.A || !arrangementAb.B) {
    arrangementAb = await mcp.call("vocaloid_review_audio", {
      action: "compare_anchor_ab",
      manifest_path: manifestPath,
      expected_revision: summary.revision,
      artifact_a_id: minimalMixArtifact.id,
      artifact_b_id: fullMixArtifact.id,
      phrase_direction_id: FINAL_DIRECTION_ID,
      audition_layer: "full_layers",
      hypothesis_family: "arrangement",
      output_a_path: join(runDirectory, `${SLUG}-arrangement-ab-a-r${summary.revision}.wav`),
      output_b_path: join(runDirectory, `${SLUG}-arrangement-ab-b-r${summary.revision}.wav`),
      target_duration_seconds: 25,
      match_lufs: -19,
      reference_true_peak_dbfs: -1.5,
    }, { label: "render loudness-matched minimal/full arrangement A/B", timeout: 600_000, maxTotalTimeout: 600_000 });
    summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
  }

  const deliveryRevision = artifactRevision(fullMixArtifact);
  const finalWavPath = join(SONG_DIRECTORY, `${SLUG}-r${deliveryRevision}-final.wav`);
  let deliveryArtifact = currentArtifacts(summary, "delivery").find((artifact) => artifact.path === finalWavPath);
  if (!deliveryArtifact) {
    const delivery = await mcp.call("vocaloid_master_manifest_delivery", {
      manifest_path: manifestPath,
      expected_revision: summary.revision,
      source_artifact_id: fullMixArtifact.id,
      output_path: finalWavPath,
      target_lufs: -17,
      target_true_peak_dbfs: -1.5,
      target_loudness_range_lu: 10,
      allow_clipped_source: false,
    }, { label: "master final full-song delivery", timeout: 900_000, maxTotalTimeout: 900_000 });
    deliveryArtifact = delivery.artifact;
    summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
  }

  const finalAnalysis = await mcp.call("vocaloid_analyze_wav", {
    path: deliveryArtifact.path,
    target_lufs: -17,
    target_true_peak_dbfs: -1.5,
  }, { label: "independent final WAV analysis", timeout: 300_000, maxTotalTimeout: 300_000 });
  if (finalAnalysis.silent || finalAnalysis.channels !== 2 || finalAnalysis.sampleClipping
    || finalAnalysis.clippedSampleValues > 0 || finalAnalysis.peak <= 0 || finalAnalysis.rms <= 0) {
    throw new Error(`Final WAV failed audibility/QC: ${JSON.stringify(finalAnalysis)}`);
  }

  await mkdir(VSQX_DIRECTORY, { recursive: true });
  const publishedVsqxPath = join(VSQX_DIRECTORY, `${SLUG}-r${deliveryRevision}-final.vsqx`);
  if (!(await exists(publishedVsqxPath))) {
    await copyFile(projectArtifact.path, publishedVsqxPath, fsConstants.COPYFILE_EXCL);
  }
  const [sourceVsqx, publishedVsqx] = await Promise.all([readFile(projectArtifact.path), readFile(publishedVsqxPath)]);
  if (!sourceVsqx.equals(publishedVsqx)) throw new Error("Published final VSQX differs from current canonical project artifact");
  const nativeVsqx = await inspectNativeVsqx(publishedVsqxPath);

  const finalPreflight = await mcp.call("vocaloid_preflight_song", {
    manifest_path: manifestPath,
    artifact_check: "current",
    include_performance_warnings: true,
    check_voice_cache: true,
    allow_unknown_editor: false,
    include_theory_proposals: false,
  }, { label: "final current-artifact preflight", timeout: 300_000, maxTotalTimeout: 300_000 });
  if (finalPreflight.counts.errors > 0 || !finalPreflight.readiness.delivery.ready) {
    throw new Error(`Final preflight failed: ${JSON.stringify({ counts: finalPreflight.counts, readiness: finalPreflight.readiness })}`);
  }

  return {
    summary,
    projectArtifact,
    materialization,
    instrumentArtifacts,
    leadArtifact,
    harmonyArtifact,
    vocalAnalyses,
    vocalMixArtifact,
    minimalMixArtifact,
    fullMixArtifact,
    previews,
    arrangementAb,
    deliveryArtifact,
    finalAnalysis,
    finalPreflight,
    publishedVsqxPath,
    nativeVsqx,
  };
}

function journalDecisions(rendered, composeResult) {
  const currentIssueCodes = [...new Set(rendered.finalPreflight.issues.map((issue) => issue.code))].sort();
  const common = {
    kind: "selection",
    alternatives: [],
    supersedes_decision_ids: [],
    outcome: "implemented",
    author: { type: "agent", name: "codex-cold-start-distant-lights" },
  };
  return [
    {
      ...common,
      id: "distant-decision-intent-v1",
      phase: "intent",
      title: "Hold loneliness and connection in the same distant view",
      objective: "Translate the user's summer-night ridge image into a falsifiable creative direction before choosing notes.",
      decision: "IA turns away from festival fireworks and addresses the town's ordinary lights; distance remains lonely, but it also reveals a possible route back.",
      rationale: "The town can offer connection without answering or curing the narrator, preserving the requested emptiness, distance, transparency, and non-pure-sadness.",
      alternatives: [{ option: "Make the fireworks the emotional climax", disposition: "rejected", reason: "It would pull the song back toward the festival rather than the distant town and private ridge." }],
      expected_audible_effect: "Cool open space, a visible ache, and a final sense of motion rather than collapse.",
      actual_result: "The canonical song/section/anchor intent preserves two questions: loneliness becoming space, and return becoming possible without erasure.",
      affected_object_ids: ["chorus-1", "final-chorus", CHORUS_DIRECTION_ID, FINAL_DIRECTION_ID],
      artifact_ids: [],
      listening_question_id: FINAL_QUESTION_ID,
      hash_dependencies: ["intent", "composition"],
      evidence: { constraints: ["Intent was authored before score and before reading the optional summer palette."], observations: ["Ten section intents and two anchor phrase directions are current."], theory_issue_codes: [], metric_deltas: [] },
    },
    {
      ...common,
      id: "distant-decision-form-v1",
      phase: "form",
      title: "Use a 56-bar view-turn-return form",
      objective: "Give the scene a complete narrative movement without overstating resolution.",
      decision: "Intro → verse/pre → chorus → field interlude → altered verse/pre → final chorus → eight lyric-free release bars.",
      rationale: "The middle interlude restores literal distance; the long post-vocal release lets the final road image become motion instead of a repeated slogan.",
      alternatives: [{ option: "Repeat the final chorus once more", disposition: "rejected", reason: "Another lyric cycle would turn the quiet decision to descend into an anthem." }],
      expected_audible_effect: "A complete two-minute song with clear expansion and a dissolving afterimage.",
      actual_result: `Current manifest has ${SECTIONS.length} contiguous semantic sections and full form coverage.`,
      affected_object_ids: SECTIONS.map((section) => section.id),
      artifact_ids: [],
      hash_dependencies: ["composition"],
      evidence: { constraints: ["No section is filler; each changes viewpoint, density, or action."], observations: ["Vocal writing ends at bar 48; the song continues to bar 56."], theory_issue_codes: currentIssueCodes.filter((code) => code.includes("SECTION") || code.includes("FORM")), metric_deltas: [] },
    },
    {
      ...common,
      id: "distant-decision-meter-tempo-v1",
      phase: "meter_tempo",
      title: "Keep compound 6/8 while breathing between 68 and 92 BPM",
      objective: "Create floating distance without losing a walkable pulse back toward town.",
      decision: "Use 6/8 throughout; verses sit near 82, choruses reach 90/92, and interlude/outro fall to 72/68 at exact section boundaries.",
      rationale: "Compound grouping supports wind-like flow and two-bar Japanese sentences; bounded tempo changes create perspective without a meter gimmick.",
      alternatives: [{ option: "Switch choruses to 4/4", disposition: "rejected", reason: "A meter switch made the chorus feel like a separate pop declaration rather than the same night opening wider." }],
      expected_audible_effect: "The song floats but still has two large steps per bar and a readable return arc.",
      actual_result: "One 6/8 meter and ten section-boundary tempo events are encoded in the manifest and VSQX.",
      affected_object_ids: SECTIONS.map((section) => section.id),
      artifact_ids: [rendered.projectArtifact.id],
      hash_dependencies: ["composition"],
      evidence: { constraints: ["All phrase and arrangement patterns remain compatible with compound meter."], observations: ["Every lead line spans exactly two 6/8 measures including an internal and terminal breath."], theory_issue_codes: currentIssueCodes.filter((code) => code.includes("METER") || code.includes("RHYTHM")), metric_deltas: [] },
    },
    {
      ...common,
      id: "distant-decision-harmony-v1",
      phase: "harmony",
      title: "Balance A-major light with unresolved add9/maj7 distance",
      objective: "Avoid the one-to-one equation of loneliness with minor while retaining harmonic ache and transparency.",
      decision: "Use A major with add9/maj7, slash-bass descents, suspended E, an F#-minor interior, and one B/A→G#m7→C#sus4 color turn before the second verse resolves back through F#m.",
      rationale: "Major provides town light; sevenths, ninths, inversions, and withheld suspensions prevent cheerfulness or hard closure.",
      alternatives: [{ option: "Write the whole song in F# natural minor", disposition: "rejected", reason: "It made sadness the default meaning instead of letting loneliness coexist with warmth." }],
      expected_audible_effect: "Luminous stability with a gentle downward bass horizon and no triumphant cadence.",
      actual_result: "All 56 measures have exact chord coverage; pad, electric piano, guitar, and bass derive from explicit voicing/bass decisions.",
      affected_object_ids: ["distant-key-a-major", ...CHORDS.map((chord) => chord.id)],
      artifact_ids: [],
      hash_dependencies: ["composition"],
      evidence: { constraints: ["No corpus-derived chord continuation and no single four-chord loop is the whole form."], observations: ["The final harmony is Aadd9, not a plain root-position triad."], theory_issue_codes: currentIssueCodes.filter((code) => code.includes("CHORD") || code.includes("TONE") || code.includes("LEADING")), metric_deltas: [] },
    },
    {
      ...common,
      id: "distant-decision-melody-v1",
      phase: "melody",
      title: "Reserve the E5 ceiling and one recovered leap for the decision to return",
      objective: "Give the 20 lyric lines independent contour while keeping IA_ROCKS clear and unforced.",
      decision: "Keep verses near A3–G#4, open chorus 1 to C#5, touch E5 once on やさしく照らした, and use one fifth into 青 followed by immediate stepwise descent.",
      rationale: "Register hierarchy and recovery make the final chorus structurally meaningful; most motion remains stepwise for diction and transparency.",
      alternatives: [{ option: "Peak on the word さみしさ", disposition: "rejected", reason: "It would center pain rather than the later ability to set it down." }],
      expected_audible_effect: "A restrained verse voice, a wider first realization, then one earned final opening that relaxes rather than wins.",
      actual_result: `The lead contains ${composeResult.leadEventCount} original voiced mora events across ${composeResult.leadPhraseCount} phrases in A3–E5.`,
      affected_object_ids: LEAD_LINES.map((line) => `distant-${line.id}`),
      artifact_ids: [rendered.projectArtifact.id],
      hash_dependencies: ["composition"],
      evidence: { constraints: ["No retrieved or copied melody/motif was used."], observations: ["The final leap is bound to the final anchor and followed by contrary stepwise recovery."], theory_issue_codes: currentIssueCodes.filter((code) => code.includes("LEAP") || code.includes("TESSITURA") || code.includes("SCALE")), metric_deltas: [] },
    },
    {
      ...common,
      id: "distant-decision-note-allocation-v1",
      phase: "note_allocation",
      title: "Make every Japanese mora explicit and spend time on semantic actions",
      objective: "Preserve original surface lyrics, explicit readings, V3 phonemes, breath windows, and focus duration as separate evidence.",
      decision: "Align one voiced cell per mora, use 120-tick minimum values, insert an internal 120-tick breath at the written image boundary, and keep 240 ticks after every two-bar line; allocate remaining duration to each line's semantic focus.",
      rationale: "The allocation favors intelligibility and meaning without forcing decorative melisma or inventing phonemes.",
      alternatives: [{ option: "Use uniform eighth-note syllables", disposition: "rejected", reason: "Uniform allocation flattened the difference between images and actions such as 置いてゆける and 青くほどける." }],
      expected_audible_effect: "Japanese phrasing remains articulated while focus words occupy visibly and audibly more time.",
      actual_result: `${composeResult.leadEventCount} lead and ${composeResult.harmonyEventCount} harmony mora events retain explicit linguistic provenance; no small-っ fallback or hidden kanji reading is present.`,
      affected_object_ids: [...LEAD_LINES.map((line) => `distant-${line.id}`), ...HARMONY_LINES.map((line) => `distant-${line.id}`)],
      artifact_ids: [rendered.projectArtifact.id],
      hash_dependencies: ["composition"],
      evidence: { constraints: ["All kanji readings were supplied explicitly; no standalone sokuon token was invented."], observations: ["Every phrase ends with a rest and every displayed lyric remains separate from normalized kana/phonemes."], theory_issue_codes: currentIssueCodes.filter((code) => code.includes("MORA") || code.includes("CONSONANT") || code.includes("BREATH") || code.includes("MELISMA")), metric_deltas: [] },
    },
    {
      ...common,
      id: "distant-decision-ia-delivery-v1",
      phase: "ia_delivery",
      title: "Materialize sectional opening with selective pitch and vibrato gestures",
      objective: "Make IA delivery serve the lyric while proving native VSQX materialization and actual Editor synthesis separately.",
      decision: "Use six sectional DYN arcs, chorus-only opening/BRI arcs, verse BRE color, two slight vibratos, and three shallow pitch gestures; the final blue-road focus receives articulation and then decreases.",
      rationale: "Sparse gestures preserve diction and make the two semantic releases distinct; continuous vibrato or scoops would make the entire performance equally marked.",
      alternatives: [{ option: "Apply a single full-song expressive preset", disposition: "rejected", reason: "It would hide phrase intent and repeat the declaration-without-materialization failure the framework now guards against." }],
      expected_audible_effect: "IA opens at chorus destinations, retains cool air in verses, and loosens the final mora without theatrical pitch bending.",
      actual_result: `Manifest materialization matches every declared gesture; native VSQX has ${rendered.nativeVsqx.controlCount} mCtrl, ${rendered.nativeVsqx.dyn} DYN, ${rendered.nativeVsqx.bre} BRE, ${rendered.nativeVsqx.bri} BRI, ${rendered.nativeVsqx.pit} PIT, ${rendered.nativeVsqx.pbs} PBS, and ${rendered.nativeVsqx.nonzeroVibratoLength} nonzero vibrato notes. Original Editor produced current non-silent lead/harmony stems.`,
      affected_object_ids: [LEAD_PART_ID, HARMONY_PART_ID, "distant-final-dyn", "distant-final-opening", "distant-final-brightness", "distant-blue-up-into", "distant-final-fall-away"],
      artifact_ids: [rendered.projectArtifact.id, rendered.leadArtifact.id, rendered.harmonyArtifact.id],
      listening_question_id: FINAL_QUESTION_ID,
      hypothesis_family: "delivery",
      hash_dependencies: ["composition"],
      evidence: { constraints: ["Declared, materialized, rendered, and heard are four separate evidence levels."], observations: ["Compiler provenance, native XML controls, and original-Editor stem digests are all current; human listening is not self-signed."], theory_issue_codes: currentIssueCodes.filter((code) => code.includes("VIBRATO") || code.includes("SCOOP") || code.includes("TUNING")), metric_deltas: [{ id: "native.mctrl", before: 0, after: rendered.nativeVsqx.controlCount }] },
    },
    {
      ...common,
      id: "distant-decision-harmony-vocals-v1",
      phase: "harmony_vocals",
      title: "Answer only the four clauses that admit return or release",
      objective: "Use harmony as a second perspective without making private observation sound collective or certain.",
      decision: "Place lower diatonic harmony only on 帰れる気がした, 置いてゆける, やさしく照らした, and 青くほどける; keep it right of center and substantially below the lead.",
      rationale: "Selective entry makes possibility audible while the rest of the song remains one solitary voice.",
      alternatives: [{ option: "Double both choruses throughout", disposition: "rejected", reason: "It removed space and made the chorus sound more certain than the lyric." }],
      expected_audible_effect: "A distant second presence appears only when the narrator can imagine an action, then disappears before the afterimage.",
      actual_result: `${composeResult.harmonyPhraseCount} selective harmony phrases and ${composeResult.harmonyEventCount} notes are present, materialized, unmuted, and rendered as an isolated current stem.`,
      affected_object_ids: [HARMONY_TRACK_ID, HARMONY_PART_ID, ...HARMONY_LINES.map((line) => `distant-${line.id}`)],
      artifact_ids: [rendered.harmonyArtifact.id],
      hash_dependencies: ["composition", "mix"],
      evidence: { constraints: ["Harmony may strengthen only explicit semantic actions."], observations: ["No harmony phrase exists in verses, pre-choruses, intro, or outro."], theory_issue_codes: currentIssueCodes.filter((code) => code.includes("VOCAL_HARMONY") || code.includes("VOICE_")), metric_deltas: [] },
    },
    {
      ...common,
      id: "distant-decision-arrangement-v1",
      phase: "arrangement",
      title: "Build a transparent six-role night field around the vocal",
      objective: "Create distance, town light, pulse, and a return path while protecting IA's center and consonants.",
      decision: "Use warm pad (field), electric piano (harmonic landmarks), clean guitar (delayed reflections), fretless bass (route), celesta (remote afterimage), and a soft 6/8 kit (footsteps/air).",
      rationale: "Each layer has a distinct role, register, pan, and entry pattern; no continuous countermelody competes with the lyric.",
      alternatives: [{ option: "Add strings and a high counter-melody in the final chorus", disposition: "rejected", reason: "The added density obscured the road image and exceeded what the draft GM renderer could represent credibly." }],
      expected_audible_effect: "Wide but centered space: slow harmonic air, small points of light, and enough low pulse to make descent possible.",
      actual_result: "Six current dry stereo instrument stems were rendered, and separate minimal/full arrangement anchor previews plus a loudness-matched A/B were saved for listening.",
      affected_object_ids: composeResult.arrangementTrackIds,
      artifact_ids: [...rendered.instrumentArtifacts.map((artifact) => artifact.id), rendered.minimalMixArtifact.id, rendered.fullMixArtifact.id],
      listening_question_id: FINAL_QUESTION_ID,
      hypothesis_family: "arrangement",
      hash_dependencies: ["composition", "mix"],
      evidence: { constraints: ["FluidSynth/GM names are draft arrangement roles, not claims of authentic acoustic performance."], observations: ["Minimal and full layers share the same composition/question and have loudness-matched 25-second A/B artifacts."], theory_issue_codes: currentIssueCodes.filter((code) => code.includes("ARRANGEMENT") || code.includes("REGISTER") || code.includes("DENSITY") || code.includes("RHYTHMIC")), metric_deltas: [] },
    },
    {
      ...common,
      id: "distant-decision-mix-delivery-v1",
      phase: "delivery",
      kind: "evaluation",
      title: "Deliver a current, non-silent, hash-linked stereo master without self-approving the listening question",
      objective: "Bind canonical score, Editor vocals, instrument stems, deterministic mix, final master, QC, and creative record into one reproducible handoff.",
      decision: "Mix all current isolated stems with explicit track/bus effects and section automation, master to -17 LUFS/-1.5 dBTP targets, independently analyze, and publish the byte-identical current VSQX beside the WAV.",
      rationale: "Objective validation can prove structure, tuning materialization, audibility, clipping safety, and provenance; it cannot decide whether the intended loneliness/return transition succeeds to a listener.",
      alternatives: [{ option: "Mark the anchor keep from symbolic/audio metrics", disposition: "rejected", reason: "The repository explicitly forbids an analyzer or agent from manufacturing human listening acceptance." }],
      expected_audible_effect: "A playable two-minute IA song with transparent dynamics and no clipped samples.",
      actual_result: `Final: ${rendered.finalAnalysis.durationSeconds.toFixed(3)} s, ${rendered.finalAnalysis.integratedLufs.toFixed(1)} LUFS, ${rendered.finalAnalysis.truePeakDbfs.toFixed(2)} dBTP, stereo, ${rendered.finalAnalysis.clippedSampleValues} clipped sample values. Human intent-fidelity listening remains pending.`,
      affected_object_ids: ["final-chorus", FINAL_DIRECTION_ID],
      artifact_ids: [rendered.deliveryArtifact.id, rendered.projectArtifact.id, rendered.fullMixArtifact.id],
      listening_question_id: FINAL_QUESTION_ID,
      outcome: "delivered",
      hash_dependencies: ["intent", "composition", "mix"],
      evidence: { constraints: ["Technical success is not a human keep decision."], observations: ["Final preflight has zero errors, current delivery dependencies, and matching final WAV/VSQX digests."], theory_issue_codes: currentIssueCodes, metric_deltas: [] },
    },
    {
      ...common,
      id: "distant-decision-section-balance-v2",
      phase: "arrangement",
      kind: "adjustment",
      title: "Raise the lyric-free night field without flattening distance",
      objective: "Correct instrumental sections that measured close to inaudible while retaining a large, intentional contrast from the choruses.",
      decision: "Use explicit mix-bus section dynamics of +14 dB intro, +10 dB interlude, +10 dB instrumental release, and +14 dB outro; leave vocal-section balances and all source stems unchanged.",
      rationale: "The first master measured intro/outro around -46/-51 LUFS and interludes around -37 LUFS, so the intended empty field risked disappearing on normal playback. Section-bound automation preserves structure and provenance better than hidden normalization.",
      alternatives: [{ option: "Compress the entire master more aggressively", disposition: "rejected", reason: "Global compression would reduce vocal phrasing and chorus openness to solve a problem confined to four lyric-free sections." }],
      expected_audible_effect: "Wind, pad, bell, and the road afterimage remain clearly quieter than vocals but are audible as intentional space rather than silence.",
      actual_result: `The adjusted current full mix was rebuilt from unchanged stems and mastered independently; final LRA is ${rendered.finalAnalysis.loudnessRangeLu.toFixed(1)} LU with no clipped samples.`,
      affected_object_ids: ["distant-intro-bus-presence", "distant-interlude-bus-breath", "distant-release-bus-presence", "distant-outro-bus-presence"],
      artifact_ids: [rendered.fullMixArtifact.id, rendered.minimalMixArtifact.id],
      listening_question_id: FINAL_QUESTION_ID,
      hypothesis_family: "arrangement",
      supersedes_decision_ids: ["distant-decision-arrangement-v1"],
      hash_dependencies: ["mix"],
      evidence: { constraints: ["Do not use hidden normalization; keep the user's requested emptiness and distance."], observations: ["Only semantic section gains changed; composition hash and all raw stem digests remained current."], theory_issue_codes: [], metric_deltas: [{ id: "audio.loudness_range_lu", before: 22.8, after: rendered.finalAnalysis.loudnessRangeLu }] },
    },
    {
      ...common,
      id: "distant-decision-harmony-vocals-v2",
      phase: "harmony_vocals",
      kind: "adjustment",
      title: "Keep the four selective harmony answers independent of section-bus balance",
      objective: "Make the journal currentness model reflect that the later lyric-free section gain change did not alter vocal harmony composition, tuning, or rendering.",
      decision: "Retain the same lower harmony only on 帰れる気がした, 置いてゆける, やさしく照らした, and 青くほどける; bind this decision to the unchanged composition and current isolated harmony stem, not to unrelated mix-bus gain.",
      rationale: "The first harmony record depended on the whole mix hash and became stale when only intro/interlude/release/outro bus levels changed. The musical decision and its rendered evidence remain byte-identical.",
      alternatives: [{ option: "Re-record the unchanged harmony decision against the new mix hash", disposition: "rejected", reason: "That would preserve an accidental coupling and make every unrelated balance revision invalidate a composition-level choice." }],
      expected_audible_effect: "The distant second voice still appears only where the lyric imagines release or return, with no new doubling elsewhere.",
      actual_result: `${composeResult.harmonyPhraseCount} selective phrases and ${composeResult.harmonyEventCount} harmony notes remain materialized and the current isolated Editor stem retains SHA-256 ${rendered.harmonyArtifact.sha256}.`,
      affected_object_ids: [HARMONY_TRACK_ID, HARMONY_PART_ID, ...HARMONY_LINES.map((line) => `distant-${line.id}`)],
      artifact_ids: [rendered.harmonyArtifact.id],
      supersedes_decision_ids: ["distant-decision-harmony-vocals-v1"],
      hash_dependencies: ["composition"],
      evidence: { constraints: ["Unrelated mix automation must not invalidate a composition-level vocal-harmony choice."], observations: ["Harmony event fingerprints and the isolated Editor stem digest did not change across the section-balance revision."], theory_issue_codes: currentIssueCodes.filter((code) => code.includes("VOCAL_HARMONY") || code.includes("VOICE_")), metric_deltas: [] },
    },
    {
      ...common,
      id: "distant-decision-mix-delivery-v2",
      phase: "delivery",
      kind: "adjustment",
      title: "Publish the section-balanced immutable delivery pair",
      objective: "Replace the first technically valid but over-contrasted delivery in the current creative record without overwriting its bytes.",
      decision: "Create a new revision-bearing final WAV and matching-basename VSQX publication, rerun current-artifact preflight and independent audio QC, and make the creative package point only to the new current pair.",
      rationale: "Immutable paths preserve the first render for comparison while the package and hashes unambiguously identify the improved current delivery.",
      alternatives: [{ option: "Overwrite the first final WAV in place", disposition: "rejected", reason: "Repository delivery policy forbids silent replacement of a same-name artifact with different bytes." }],
      expected_audible_effect: "The complete song remains transparent and dynamic, with lyric-free passages now present on ordinary playback.",
      actual_result: `Current final: ${rendered.finalAnalysis.durationSeconds.toFixed(3)} s, ${rendered.finalAnalysis.integratedLufs.toFixed(1)} LUFS, ${rendered.finalAnalysis.loudnessRangeLu.toFixed(1)} LU LRA, ${rendered.finalAnalysis.truePeakDbfs.toFixed(2)} dBTP, ${rendered.finalAnalysis.clippedSampleValues} clipped values. Human listening remains pending.`,
      affected_object_ids: ["final-chorus", FINAL_DIRECTION_ID, "distant-intro-bus-presence", "distant-release-bus-presence"],
      artifact_ids: [rendered.deliveryArtifact.id, rendered.projectArtifact.id, rendered.fullMixArtifact.id],
      listening_question_id: FINAL_QUESTION_ID,
      outcome: "delivered",
      supersedes_decision_ids: ["distant-decision-mix-delivery-v1"],
      hash_dependencies: ["intent", "composition", "mix"],
      evidence: { constraints: ["Technical evidence still does not constitute a human keep decision."], observations: ["The current creative-record index binds the new delivery and byte-identical score project by SHA-256."], theory_issue_codes: currentIssueCodes, metric_deltas: [{ id: "audio.loudness_range_lu", before: 22.8, after: rendered.finalAnalysis.loudnessRangeLu }] },
    },
  ];
}

async function publishCreativeRecord(mcp, manifestPath, runId, rendered, composeResult) {
  const existing = await mcp.call("vocaloid_creative_journal", {
    action: "list",
    payload: { manifest_path: manifestPath, offset: 0, limit: 100 },
  }, { quiet: true });
  const existingIds = new Set(existing.items.map((item) => item.entry.id));
  for (const decision of journalDecisions(rendered, composeResult)) {
    if (existingIds.has(decision.id)) continue;
    await mcp.call("vocaloid_creative_journal", {
      action: "record",
      payload: {
        manifest_path: manifestPath,
        expected_revision: rendered.summary.revision,
        decision,
        dry_run: false,
      },
    }, { label: `record ${decision.phase} decision` });
  }
  const report = await mcp.call("vocaloid_creative_journal", {
    action: "report",
    payload: { manifest_path: manifestPath, overwrite: true },
  }, { label: "write full creative decision report" });
  const published = await mcp.call("vocaloid_creative_journal", {
    action: "publish",
    payload: {
      manifest_path: manifestPath,
      expected_revision: rendered.summary.revision,
      output_directory: join(CREATIVE_RECORD_DIRECTORY, runId),
      deliverables: [
        { role: "song", artifact_id: rendered.deliveryArtifact.id },
        { role: "vsqx", artifact_id: rendered.projectArtifact.id, published_path: rendered.publishedVsqxPath },
      ],
      overwrite: true,
    },
  }, { label: "publish hash-bound creative record package" });
  return { report, published };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!(await exists(SERVER_ENTRYPOINT))) throw new Error(`Missing ${SERVER_ENTRYPOINT}; run npm run build first`);
  const runDirectory = join(BUILD_ROOT, options.runId);
  const manifestPath = join(runDirectory, `${options.runId}.song.json`);
  await mkdir(BUILD_ROOT, { recursive: true });
  await mkdir(SONG_DIRECTORY, { recursive: true });
  await mkdir(VSQX_DIRECTORY, { recursive: true });
  await mkdir(CREATIVE_RECORD_DIRECTORY, { recursive: true });
  if (await exists(manifestPath)) {
    if (!options.resume) throw new Error(`Manifest already exists: ${manifestPath}; use --resume or a new --run-id`);
  } else {
    await mkdir(runDirectory, { recursive: false });
  }

  const mcp = new ProductionMcp();
  await mcp.connect();
  try {
    let composeResult;
    if (await exists(manifestPath)) {
      const storedReportPath = join(runDirectory, `${options.runId}-composition-stage.json`);
      if (!(await exists(storedReportPath))) throw new Error(`Cannot resume without ${storedReportPath}`);
      composeResult = JSON.parse(await readFile(storedReportPath, "utf8"));
    } else {
      composeResult = await compose(mcp, manifestPath);
      await writeFile(join(runDirectory, `${options.runId}-composition-stage.json`), `${JSON.stringify(composeResult, null, 2)}\n`, "utf8");
    }

    const summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
    const rendered = await renderArtifacts(mcp, manifestPath, runDirectory, summary);
    const creativeRecord = await publishCreativeRecord(mcp, manifestPath, options.runId, rendered, composeResult);
    const report = {
      schema: "vocaloid-cold-start-song-run/v1",
      generated_at: new Date().toISOString(),
      run_id: options.runId,
      song_id: SONG_ID,
      title: TITLE,
      manifest_path: manifestPath,
      manifest_revision: rendered.summary.revision,
      content_hash: rendered.summary.contentHash,
      intent_hash: rendered.summary.intentHash,
      composition_hash: rendered.summary.compositionHash,
      mix_hash: rendered.summary.mixHash,
      original_authorship: {
        lyrics: "New Japanese lyrics authored for this run.",
        melody: "New explicit note sequence authored for this run.",
        harmony: "New 56-measure harmonic timeline authored for this run.",
        arrangement: "New six-role arrangement authored for this run.",
        track_level_corpus_access: "not_used",
        reference_identity_access: "not_used",
        retrieval_or_copying: "not_used",
        aggregate_style_observation: composeResult.aggregateStyleObservation,
      },
      creative_questions: [
        compositionIntent().phrase_directions[0].listening_question,
        compositionIntent().phrase_directions[1].listening_question,
      ],
      technical_status: {
        final_preflight_errors: rendered.finalPreflight.counts.errors,
        final_preflight_warnings: rendered.finalPreflight.counts.warnings,
        score_ready: rendered.finalPreflight.readiness.score.ready,
        build_ready: rendered.finalPreflight.readiness.build.ready,
        render_ready: rendered.finalPreflight.readiness.render.ready,
        mix_ready: rendered.finalPreflight.readiness.mix.ready,
        delivery_ready: rendered.finalPreflight.readiness.delivery.ready,
        human_listening_status: "pending",
      },
      materialization: rendered.materialization,
      native_vsqx: rendered.nativeVsqx,
      vocal_analysis: rendered.vocalAnalyses,
      final_audio: rendered.finalAnalysis,
      artifacts: {
        final_wav: rendered.deliveryArtifact,
        final_vsqx_source: rendered.projectArtifact,
        final_vsqx_published_path: rendered.publishedVsqxPath,
        full_mix: rendered.fullMixArtifact,
        lead_stem: rendered.leadArtifact,
        harmony_stem: rendered.harmonyArtifact,
        instrument_stems: rendered.instrumentArtifacts,
        previews: rendered.previews,
        arrangement_ab: rendered.arrangementAb,
      },
      creative_record: creativeRecord,
    };
    const reportPath = join(runDirectory, `${options.runId}-run-report.json`);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({
      ok: true,
      title: TITLE,
      manifestPath,
      finalWavPath: rendered.deliveryArtifact.path,
      finalVsqxPath: rendered.publishedVsqxPath,
      creativeRecordDirectory: creativeRecord.published.outputDirectory,
      reportPath,
      revision: rendered.summary.revision,
      compositionHash: rendered.summary.compositionHash,
      mixHash: rendered.summary.mixHash,
      finalAnalysis: rendered.finalAnalysis,
      nativeVsqx: rendered.nativeVsqx,
      humanListeningStatus: "pending",
    }, null, 2));
  } finally {
    await mcp.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
