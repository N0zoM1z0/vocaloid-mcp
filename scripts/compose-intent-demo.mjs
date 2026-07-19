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
const BUILD_ROOT = join(REPOSITORY_ROOT, "build", "intent-demos");
const SONG_DIRECTORY = join(REPOSITORY_ROOT, "artifacts", "songs");
const VSQX_DIRECTORY = join(REPOSITORY_ROOT, "artifacts", "vsqxs");
const IA_ROCKS_COMPONENT_ID = "BDREB7P2KTWKYDC5";
const DEFAULT_RUN_ID = "asa-ga-hodoku-mae-ni-20260719-a";
const SONG_ID = "asa-ga-hodoku-mae-ni";
const SLUG = "asa-ga-hodoku-mae-ni";
const TITLE = "朝がほどく前に";
const SECTION_ID = "anchor-passage";
const DIRECTION_ID = "anchor-unspoken-request";
const LISTENING_QUESTION_ID = "question-request-without-command";
const LEAD_TRACK_ID = "asa-lead";
const HARMONY_TRACK_ID = "asa-harmony";
const LEAD_PART_ID = "asa-lead-part";
const HARMONY_PART_ID = "asa-harmony-part";
const IA_ROCKS_VOICE = {
  id: "voice-ia-rocks",
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
        "Usage: npm run compose:intent-demo -- [--run-id=<id>] [--resume]",
        "",
        "Creates a new 20-30 second IA_ROCKS composition using only the production",
        "VOCALOID MCP. It does not read a corpus, style profile, reference track, or",
        "prior song. Canonical edits are dry-run before write.",
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
    this.client = new Client({ name: "intent-composition-runner", version: "1.0.0" });
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

const CHORDS = [
  ["asa-chord-00-dmadd9", 0, 0, "Dm(add9)", 1920],
  ["asa-chord-01-bbmaj7", 1, 0, "Bbmaj7", 1920],
  ["asa-chord-02-f-over-a", 2, 0, "F/A", 1920],
  ["asa-chord-03-cadd9", 3, 0, "Cadd9", 1920],
  ["asa-chord-04-gm9", 4, 0, "Gm9", 1920],
  ["asa-chord-05-bbmaj9", 5, 0, "Bbmaj9", 1920],
  ["asa-chord-06-a7sus4", 6, 0, "A7sus4", 960],
  ["asa-chord-06-a7b9", 6, 2, "A7(b9)", 960],
  ["asa-chord-07-dmadd9", 7, 0, "Dm(add9)", 1920],
].map(([id, measure, beat, symbol, duration_ticks]) => ({
  id,
  position: position(measure, beat),
  symbol,
  duration_ticks,
}));

const LEAD_IN_SLOTS = [
  [240, 57], [240, 58], [480, 60], [480, 62], [480, 60],
  [480, 57], [480, 58], [480, 60], [240, 57], [240, null],
];

const ANCHOR_SLOTS = [
  [240, 57], [240, 58], [480, 62], [240, 60], [240, 58], [480, 57], [480, 60], [480, 62],
  [480, 64], [960, 65], [480, 64], [960, 62], [960, 62], [960, null],
];

const RELEASE_SLOTS = [
  [240, 57], [240, 57], [480, 62], [480, 61], [480, 64],
  [480, 62], [480, 65], [480, 64], [240, 62], [240, null],
];

const HARMONY_SLOTS = [
  [480, 60], [960, 62], [480, 60], [960, 58], [960, 58],
];

function noteSlots(prefix, values, options = {}) {
  let voicedIndex = 0;
  return values.map(([duration, noteNumber], index) => {
    const rest = noteNumber === null;
    const isFocus = options.focusFrom !== undefined && voicedIndex >= options.focusFrom;
    const slot = {
      id: `${prefix}-cell-${String(index + 1).padStart(2, "0")}`,
      duration,
      rest,
      gate_percent: rest ? 100 : (duration >= 960 ? 96 : 88),
      velocity: rest ? 64 : (isFocus ? 58 : 64),
      style: rest ? {} : {
        accent: isFocus ? 52 : 42,
        decay: duration >= 960 ? 46 : 58,
        opening: isFocus ? 74 : 58,
      },
      ...(rest ? {} : { note_number: noteNumber }),
    };
    if (!rest) voicedIndex += 1;
    return slot;
  });
}

function makePianoTrack() {
  const track = {
    kind: "pitched",
    id: "asa-piano",
    name: "Felt Piano — harmonic breath",
    program: 0,
    volume: 88,
    pan: 54,
    notes: [],
    patterns: [],
    placements: [],
  };
  const voicings = [
    [0, 0, 1800, [50, 57, 64, 65]],
    [1, 0, 1800, [46, 53, 57, 62]],
    [2, 0, 1800, [45, 53, 57, 60]],
    [3, 0, 1800, [48, 55, 62, 64]],
    [4, 0, 1800, [43, 50, 53, 57, 58]],
    [5, 0, 1800, [46, 53, 57, 60, 62]],
    [6, 0, 900, [45, 50, 52, 55]],
    [6, 2, 900, [45, 49, 52, 55, 58]],
    [7, 0, 1800, [50, 57, 64, 65]],
  ];
  for (const [measure, beat, duration, pitches] of voicings) {
    for (const [voiceIndex, note_number] of pitches.entries()) {
      track.notes.push({
        id: `asa-piano-m${measure}-b${beat}-v${voiceIndex + 1}`,
        position: position(measure, beat),
        duration,
        note_number,
        velocity: 44 + voiceIndex * 3 + (measure >= 4 && measure <= 6 ? 5 : 0),
      });
    }
  }
  return track;
}

function makeBassTrack() {
  const roots = [38, 34, 33, 36, 31, 34, 33, 38];
  return {
    kind: "pitched",
    id: "asa-bass",
    name: "Finger Bass — restrained root motion",
    program: 33,
    volume: 90,
    pan: 64,
    notes: roots.flatMap((note_number, measure) => {
      const first = {
        id: `asa-bass-m${measure}-root`,
        position: position(measure),
        duration: measure === 6 ? 900 : 1320,
        note_number,
        velocity: measure < 2 ? 48 : measure < 6 ? 58 : 62,
      };
      if (measure === 6) {
        return [first, {
          id: "asa-bass-m6-dominant",
          position: position(6, 2),
          duration: 900,
          note_number: 33,
          velocity: 64,
        }];
      }
      if (measure === 7) {
        return [first, {
          id: "asa-bass-m7-fifth",
          position: position(7, 3),
          duration: 360,
          note_number: 33,
          velocity: 45,
        }];
      }
      return [first];
    }),
    patterns: [],
    placements: [],
  };
}

function makeDrumTrack() {
  const hits = [];
  const add = (measure, beat, tick, note_number, velocity, label) => hits.push({
    id: `asa-drum-m${measure}-${label}-${beat}-${tick}`,
    position: position(measure, beat, tick),
    note_number,
    velocity,
    duration: 60,
  });
  for (let measure = 0; measure < 8; measure += 1) {
    const lift = measure >= 2 && measure <= 6;
    add(measure, 0, 0, 36, lift ? 62 : 46, "kick");
    add(measure, 2, 0, 37, lift ? 56 : 40, "side");
    const hats = lift ? [0, 1, 2, 3, 4, 5, 6, 7] : [1, 3, 5, 7];
    for (const eighth of hats) {
      add(measure, Math.floor(eighth / 2), eighth % 2 === 0 ? 0 : 240, 42, lift ? 38 + (eighth % 2) * 5 : 31, `hat${eighth}`);
    }
  }
  add(4, 0, 0, 49, 49, "quiet-crash");
  add(6, 3, 240, 46, 42, "open-hat");
  return { kind: "drums", id: "asa-drums", name: "Soft Kit — pulse, not pressure", hits, patterns: [], placements: [] };
}

function effectChains() {
  return [
    {
      id: "asa-lead-chain",
      target_id: LEAD_TRACK_ID,
      effects: [
        { id: "asa-lead-trim", type: "gain", enabled: true, parameters: { gain_db: -2 } },
        { id: "asa-lead-hpf", type: "highpass", enabled: true, parameters: { frequency_hz: 82, q: 0.707, poles: 2 } },
        { id: "asa-lead-comp", type: "compressor", enabled: true, parameters: { threshold_db: -20, ratio: 2.1, attack_ms: 24, release_ms: 170, makeup_db: 1, knee: 3, detection: "rms", mix: 0.72 } },
        { id: "asa-lead-deess", type: "deesser", enabled: true, parameters: { intensity: 0.18, max_deessing: 0.3, frequency_focus: 0.58 } },
        { id: "asa-lead-room", type: "reverb", enabled: true, parameters: { in_gain: 0.82, out_gain: 0.76, delay_ms: 74, decay: 0.18 } },
      ],
    },
    {
      id: "asa-harmony-chain",
      target_id: HARMONY_TRACK_ID,
      effects: [
        { id: "asa-harmony-trim", type: "gain", enabled: true, parameters: { gain_db: -6 } },
        { id: "asa-harmony-hpf", type: "highpass", enabled: true, parameters: { frequency_hz: 110, q: 0.707, poles: 2 } },
        { id: "asa-harmony-comp", type: "compressor", enabled: true, parameters: { threshold_db: -22, ratio: 2.5, attack_ms: 18, release_ms: 210, makeup_db: 0, knee: 3, detection: "rms", mix: 0.78 } },
        { id: "asa-harmony-room", type: "reverb", enabled: true, parameters: { in_gain: 0.78, out_gain: 0.72, delay_ms: 105, decay: 0.24 } },
      ],
    },
    ...[
      ["asa-piano", 8],
      ["asa-bass", 10],
      ["asa-drums", 8],
    ].map(([target_id, gain_db]) => ({
      id: `${target_id}-chain`,
      target_id,
      effects: [{ id: `${target_id}-gain`, type: "gain", enabled: true, parameters: { gain_db } }],
    })),
    {
      id: "asa-mix-bus-chain",
      target_id: "mix-bus",
      effects: [
        { id: "asa-bus-trim", type: "gain", enabled: true, parameters: { gain_db: -2 } },
        { id: "asa-bus-comp", type: "compressor", enabled: true, parameters: { threshold_db: -14, ratio: 1.5, attack_ms: 32, release_ms: 240, makeup_db: 0, knee: 3.5, detection: "rms", mix: 0.48 } },
        { id: "asa-bus-limit", type: "limiter", enabled: true, parameters: { limit_db: -1.8, attack_ms: 5, release_ms: 90 } },
      ],
    },
  ];
}

function currentArtifacts(summary, role) {
  return summary.artifacts.filter((artifact) => (
    artifact.role === role
    && artifact.currentComposition !== false
    && (!['mix', 'delivery'].includes(role) || artifact.currentMix !== false)
  ));
}

function artifactWithBasenamePrefix(summary, role, prefix) {
  return currentArtifacts(summary, role).find((artifact) => basename(artifact.path).startsWith(prefix));
}

async function alignPhrases(mcp) {
  const leadIn = await mcp.call("vocaloid_align_japanese_phrase", {
    text: "薄明かりの窓辺",
    reading: "うすあかりのまどべ",
    phrase_id: "asa-lead-in",
    start: position(0),
    allocation: "sequential",
    note_slots: noteSlots("asa-lead-in", LEAD_IN_SLOTS),
  }, { label: "align lead-in lyric" });
  const anchor = await mcp.call("vocaloid_align_japanese_phrase", {
    text: "まだ行かないでと言えなくて",
    reading: "まだいかないでといえなくて",
    phrase_id: "asa-anchor-line",
    start: position(2),
    allocation: "sequential",
    note_slots: noteSlots("asa-anchor", ANCHOR_SLOTS, { focusFrom: 8 }),
  }, { label: "align anchor lyric" });
  const release = await mcp.call("vocaloid_align_japanese_phrase", {
    text: "ただ名前を呼んだ",
    reading: "ただなまえをよんだ",
    phrase_id: "asa-release-line",
    start: position(6),
    allocation: "sequential",
    note_slots: noteSlots("asa-release", RELEASE_SLOTS),
  }, { label: "align release lyric" });
  const harmony = await mcp.call("vocaloid_align_japanese_phrase", {
    text: "言えなくて",
    reading: "いえなくて",
    phrase_id: "asa-harmony-admission",
    start: position(3, 2),
    allocation: "sequential",
    note_slots: noteSlots("asa-harmony", HARMONY_SLOTS, { focusFrom: 0 }),
  }, { label: "align selective harmony lyric" });
  return { leadIn: leadIn.phrase, anchor: anchor.phrase, release: release.phrase, harmony: harmony.phrase };
}

async function compose(mcp, manifestPath) {
  const created = await mcp.call("vocaloid_create_song_manifest", {
    output_path: manifestPath,
    song_id: SONG_ID,
    slug: SLUG,
    title: TITLE,
    format: "vsq3",
    pre_measure: 1,
    time_signatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: position(0), bpm: 84 }],
    sections: [{
      id: SECTION_ID,
      name: "Anchor Passage",
      kind: "chorus",
      start: position(0),
      end: position(8),
      energy: 0.58,
      description: "A contained admission opens once, then releases without turning into a command.",
    }],
    key_changes: [],
    chord_changes: [],
    sample_rate: 44_100,
    accompaniment_gain: 0.2,
    reverb: true,
    chorus: true,
    overwrite: false,
  });
  let revision = created.revision;

  revision = await mcp.edit(manifestPath, revision, "set_composition_intent", {
    composition_intent: {
      schema: "vocaloid-composition-intent/v1",
      song: {
        premise: "At a dim window before dawn, the narrator wants one person to stay but can only call their name.",
        narrator_stance: "Close, honest, and unwilling to turn longing into leverage.",
        addressee: "One person who may leave when morning arrives.",
        central_tension: "The wish to say 'do not go' must become audible without being delivered as an order.",
        state_at_start: "The narrator hides inside the room and the light.",
        intended_destination: "The unsaid request is understood, yet the other person remains free to leave.",
        listener_after: "The listener should hear both the request and the restraint that stops it becoming a command.",
        creative_invariants: [
          "Restraint must not become emotional flatness.",
          "The semantic focus must be shaped by duration, contour, timbre, and release rather than loudness alone.",
          "Harmony enters only when it clarifies the admission; accompaniment never competes for the sentence.",
        ],
      },
      sections: [{
        id: "intent-anchor-passage",
        section_id: SECTION_ID,
        dramatic_function: "Move from indirect scene-setting into one withheld request, then show the narrator choosing a smaller action.",
        state_before: "The desire is hidden in an image of the window before dawn.",
        intended_transition: "Let the inability to say the request expose the request itself.",
        state_after: "The narrator only calls the addressee's name; the departure is not resolved.",
        inherited_delivery: "Begin speech-close, open over the admission, then fall back into a human-sized ending.",
      }],
      phrase_directions: [{
        id: DIRECTION_ID,
        section_id: SECTION_ID,
        importance: "anchor",
        lyric_anchor: { text: "まだ行かないでと言えなくて" },
        purpose: "Make the desire to ask them to stay unmistakable while preserving the narrator's refusal to command them.",
        addressed_to: "The person at the window before dawn.",
        semantic_focus: "言えなくて — admitting the inability to say the request.",
        subtext: "The request is present because the narrator cannot bring themselves to impose it.",
        state_before: "Longing is disguised as observation.",
        intended_transition: "Expose the request once through an admission, not through force.",
        state_after: "The addressee understands, but is not musically trapped by a triumphant cadence.",
        delivery_arc: "Keep まだ行かないで narrow and speech-close; lengthen and brighten 言えなくて into a small arch, then decrescendo into a two-beat breath.",
        realization_hypothesis: {
          summary: "A stepwise rising arch and longer semantic-focus notes can reveal the request without using a shout or a top-note climax.",
          melody: "Mostly stepwise A3-F4, with no leap used as a demand gesture.",
          rhythm: "Shorter syllables carry the forbidden request; 言えなくて receives roughly twice the local duration budget and is followed by silence.",
          harmony: "Selective lower harmony enters only on 言えなくて, then releases before the final line.",
          register: "The focus stays in the middle of IA_ROCKS rather than at the tessitura ceiling.",
          dynamics: "One moderate opening across the focus, followed by a decrease rather than a victorious landing.",
          tuning: "A shallow late fall on the final focus syllable and slight vibrato only on earned sustains.",
          arrangement_space: "Piano, bass, and soft kit support the harmonic sentence; the center remains clear for diction.",
          expected_evidence: [
            "Semantic-focus note durations exceed the local non-focus median.",
            "The lead contour forms an arch without a large unbalanced leap.",
            "Harmony is absent before the admission and accompaniment register stays below the lead.",
          ],
          symbolic_targets: {
            melody_contour: "arch",
            melody_range: "expand",
            rhythm_density: "decrease",
            note_duration: "lengthen",
            harmonic_tension: "withhold",
            delivery_dynamics: "decrease",
            arrangement_density: "increase",
            semantic_focus_duration_ratio_min: 1.5,
          },
        },
        listening_question: {
          id: LISTENING_QUESTION_ID,
          question: "Can I hear that IA wants this person to stay while the line still sounds like an admission rather than a command?",
        },
      }],
    },
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
        minimum_anchor_phrases: 1,
        require_current_audition_review: false,
      },
      exceptions: [],
    },
  });

  revision = await mcp.edit(manifestPath, revision, "replace_timeline", {
    update: {
      key_changes: [{ id: "asa-key-d-minor", position: position(0), tonic: "D", mode: "minor" }],
      chord_changes: CHORDS,
    },
  });

  const phrases = await alignPhrases(mcp);
  const leadEventIds = [
    ...phrases.leadIn.cells,
    ...phrases.anchor.cells,
    ...phrases.release.cells,
  ].filter((cell) => !cell.rest).map((cell) => cell.id);
  const focusCellIds = phrases.anchor.cells.slice(8, 13).filter((cell) => !cell.rest).map((cell) => cell.id);

  revision = await mcp.edit(manifestPath, revision, "upsert_vocal_part", {
    voice: IA_ROCKS_VOICE,
    track: {
      id: LEAD_TRACK_ID,
      name: `IA_ROCKS Lead — ${TITLE}`,
      comment: "Primary intent-bearing performance; all surface lyrics retain explicit kana provenance.",
      voice_id: IA_ROCKS_VOICE.id,
      mixer: { volume: 0, pan: 64, mute: false, solo: false, send_level: -898, send_enabled: false },
    },
    part: {
      id: LEAD_PART_ID,
      section_id: SECTION_ID,
      name: `${TITLE} Lead`,
      comment: "New theory-first composition; no corpus, style profile, reference track, or prior song was consulted.",
      start: position(0),
      end: position(8),
      notes: [],
      phrases: [phrases.leadIn, phrases.anchor, phrases.release],
      control_curves: [],
      tuning_gestures: [
        {
          id: "asa-lead-dynamics",
          type: "dynamics_arc",
          event_ids: leadEventIds,
          start_value: 50,
          peak_value: 78,
          end_value: 54,
          peak_position: 0.57,
        },
        {
          id: "asa-lead-opening",
          type: "opening_arc",
          event_ids: leadEventIds,
          start_value: 54,
          peak_value: 86,
          end_value: 58,
          peak_position: 0.59,
        },
        {
          id: "asa-focus-vibrato",
          type: "vibrato",
          event_ids: [focusCellIds.at(-1)],
          vibrato_type: 13,
          length_percent: 28,
          depth_start: 20,
          depth_peak: 36,
          depth_end: 24,
          rate_start: 45,
          rate_end: 50,
        },
        {
          id: "asa-focus-release",
          type: "pitch_scoop",
          event_ids: [focusCellIds.at(-1)],
          direction: "fall_away",
          depth_cents: 35,
          duration_percent: 18,
          pitch_bend_sensitivity: 2,
        },
      ],
    },
  });

  revision = await mcp.edit(manifestPath, revision, "upsert_vocal_part", {
    voice: IA_ROCKS_VOICE,
    track: {
      id: HARMONY_TRACK_ID,
      name: `IA_ROCKS Selective Harmony — ${TITLE}`,
      comment: "A lower harmony enters only on the admission; it is not a full-line double.",
      voice_id: IA_ROCKS_VOICE.id,
      mixer: { volume: -90, pan: 76, mute: false, solo: false, send_level: -898, send_enabled: false },
    },
    part: {
      id: HARMONY_PART_ID,
      section_id: SECTION_ID,
      name: `${TITLE} Admission Harmony`,
      comment: "Lower diatonic support on 言えなくて only; exits before the release line.",
      start: position(3, 2),
      end: position(6),
      notes: [],
      phrases: [phrases.harmony],
      control_curves: [],
      tuning_gestures: [{
        id: "asa-harmony-dynamics",
        type: "dynamics_arc",
        event_ids: phrases.harmony.cells.filter((cell) => !cell.rest).map((cell) => cell.id),
        start_value: 42,
        peak_value: 62,
        end_value: 44,
        peak_position: 0.52,
      }],
    },
  });

  for (const track of [makePianoTrack(), makeBassTrack(), makeDrumTrack()]) {
    revision = await mcp.edit(manifestPath, revision, "upsert_arrangement", { track });
  }
  for (const effect_chain of effectChains()) {
    revision = await mcp.edit(manifestPath, revision, "upsert_effect_chain", { effect_chain });
  }

  revision = await mcp.edit(manifestPath, revision, "bind_phrase_realization", {
    phrase_direction_id: DIRECTION_ID,
    realization_links: {
      vocal_phrase_ids: [phrases.anchor.id],
      event_ids: phrases.anchor.cells.filter((cell) => !cell.rest).map((cell) => cell.id),
      semantic_focus_object_ids: focusCellIds,
      tuning_gesture_ids: ["asa-lead-dynamics", "asa-lead-opening", "asa-focus-vibrato", "asa-focus-release"],
      chord_ids: CHORDS.slice(2, 6).map((chord) => chord.id),
      track_ids: [LEAD_TRACK_ID, HARMONY_TRACK_ID, "asa-piano", "asa-bass", "asa-drums"],
    },
  });

  const preflight = await mcp.call("vocaloid_preflight_song", {
    manifest_path: manifestPath,
    artifact_check: "none",
    include_performance_warnings: true,
    check_voice_cache: true,
    allow_unknown_editor: false,
    include_theory_proposals: true,
    max_theory_proposals: 6,
  }, { label: "theory and workflow preflight", timeout: 300_000, maxTotalTimeout: 300_000 });
  if (preflight.counts.errors > 0 || !preflight.readiness.score.ready || !preflight.readiness.build.ready) {
    throw new Error(`Composition preflight blocked: ${JSON.stringify({ counts: preflight.counts, readiness: preflight.readiness, issues: preflight.issues })}`);
  }
  return { revision, preflight };
}

async function verifyVoice(mcp) {
  const readiness = await mcp.call("vocaloid_host_readiness", {
    include_expired_voice_records: false,
    allow_unknown_editor: false,
  }, { label: "inspect VOCALOID host readiness" });
  if (readiness.editorLease) throw new Error(`VOCALOID Editor is leased by ${readiness.editorLease.requestId}`);
  if (readiness.verifiedComponentIds.includes(IA_ROCKS_COMPONENT_ID)) return readiness;
  const probe = await mcp.call("vocaloid_probe_voice", {
    component_id: IA_ROCKS_COMPONENT_ID,
    force: true,
    timeout_seconds: 120,
    allow_unknown_editor: false,
  }, { label: "verify IA_ROCKS synthesis", timeout: 240_000, maxTotalTimeout: 240_000 });
  if (probe.record.status !== "verified") {
    throw new Error(`IA_ROCKS probe status ${probe.record.status}: ${probe.record.reason}`);
  }
  return probe;
}

async function buildAndRender(mcp, manifestPath, runDirectory, initialSummary) {
  let summary = initialSummary;
  let projectArtifact = currentArtifacts(summary, "vsqx").at(-1);
  if (!projectArtifact) {
    const sourceRevision = summary.revision;
    const built = await mcp.call("vocaloid_build_song_manifest", {
      manifest_path: manifestPath,
      expected_revision: sourceRevision,
      backing_output_path: join(runDirectory, `${SLUG}-backing-r${sourceRevision}.wav`),
      project_output_path: join(runDirectory, `${SLUG}-project-r${sourceRevision}.vsqx`),
    }, { label: `build accompaniment and VSQX r${sourceRevision}`, timeout: 900_000, maxTotalTimeout: 900_000 });
    projectArtifact = built.artifacts.find((artifact) => artifact.role === "vsqx");
    if (!projectArtifact || !built.validation.valid || built.backing.silent) {
      throw new Error("Build did not return a valid VSQX and non-silent backing");
    }
    summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
  }

  await verifyVoice(mcp);
  const stemsDirectory = join(runDirectory, "stems");
  await mkdir(stemsDirectory, { recursive: true });
  let instrumentArtifacts = currentArtifacts(summary, "instrument_stem");
  if (instrumentArtifacts.length < 3) {
    await mcp.call("vocaloid_render_instrument_stems", {
      manifest_path: manifestPath,
      expected_revision: summary.revision,
      output_directory: stemsDirectory,
      preserve_pan: true,
      include_renderer_effects: true,
    }, { label: "render piano, bass, and drum stems", timeout: 1_200_000, maxTotalTimeout: 1_200_000 });
    summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
    instrumentArtifacts = currentArtifacts(summary, "instrument_stem");
  }

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
    }, { label: `render IA_ROCKS ${trackId}`, timeout: 650_000, maxTotalTimeout: 650_000 });
    summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_500));
  }

  const vocalArtifacts = currentArtifacts(summary, "vocal_stem");
  const leadArtifact = vocalArtifacts.find((artifact) => artifact.metadata?.track_id === LEAD_TRACK_ID);
  const harmonyArtifact = vocalArtifacts.find((artifact) => artifact.metadata?.track_id === HARMONY_TRACK_ID);
  if (!leadArtifact || !harmonyArtifact) throw new Error("Missing current lead or harmony vocal stem");

  const vocalMixBasename = `${SLUG}-lead-harmony-r${summary.revision}.wav`;
  let vocalMixArtifact = artifactWithBasenamePrefix(summary, "mix", `${SLUG}-lead-harmony-r`);
  if (!vocalMixArtifact) {
    const vocalMix = await mcp.call("vocaloid_render_stem_mix", {
      manifest_path: manifestPath,
      expected_revision: summary.revision,
      stem_artifact_ids: [leadArtifact.id, harmonyArtifact.id],
      output_path: join(runDirectory, vocalMixBasename),
      sample_rate: 44_100,
      bit_depth: 24,
      reference_lufs: -16,
      reference_true_peak_dbfs: -1.5,
      timeout_seconds: 900,
    }, { label: "mix lead plus selective harmony", timeout: 1_000_000, maxTotalTimeout: 1_000_000 });
    vocalMixArtifact = vocalMix.artifact;
    summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
  }

  const minimalMixBasename = `${SLUG}-minimal-band-r${summary.revision}.wav`;
  let minimalMixArtifact = artifactWithBasenamePrefix(summary, "mix", `${SLUG}-minimal-band-r`);
  if (!minimalMixArtifact) {
    const minimalMix = await mcp.call("vocaloid_render_stem_mix", {
      manifest_path: manifestPath,
      expected_revision: summary.revision,
      stem_artifact_ids: [
        leadArtifact.id,
        harmonyArtifact.id,
        ...instrumentArtifacts.map((artifact) => artifact.id),
      ],
      output_path: join(runDirectory, minimalMixBasename),
      sample_rate: 44_100,
      bit_depth: 24,
      reference_lufs: -16,
      reference_true_peak_dbfs: -1.5,
      timeout_seconds: 900,
    }, { label: "mix intent-first minimal band", timeout: 1_000_000, maxTotalTimeout: 1_000_000 });
    if (minimalMix.quality.sampleClipping || minimalMix.quality.channels !== 2) {
      throw new Error(`Minimal-band mix failed hard QC: ${JSON.stringify(minimalMix.quality)}`);
    }
    minimalMixArtifact = minimalMix.artifact;
    summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
  }

  const previews = {};
  for (const [layer, sourceArtifact] of [
    ["lead_solo", leadArtifact],
    ["lead_harmony", vocalMixArtifact],
    ["minimal_band", minimalMixArtifact],
  ]) {
    const outputBasename = `${SLUG}-${layer}-preview-r${summary.revision}.wav`;
    let artifact = artifactWithBasenamePrefix(summary, "preview", `${SLUG}-${layer}-preview-r`);
    if (!artifact) {
      const preview = await mcp.call("vocaloid_review_audio", {
        action: "anchor_preview",
        manifest_path: manifestPath,
        expected_revision: summary.revision,
        source_artifact_id: sourceArtifact.id,
        phrase_direction_id: DIRECTION_ID,
        audition_layer: layer,
        output_path: join(runDirectory, outputBasename),
        target_duration_seconds: 25,
        reference_lufs: -16,
        reference_true_peak_dbfs: -1.5,
      }, { label: `save ${layer} intent preview`, timeout: 600_000, maxTotalTimeout: 600_000 });
      artifact = preview.artifact;
      summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
    }
    previews[layer] = artifact;
  }

  const existingAbA = artifactWithBasenamePrefix(summary, "preview", `${SLUG}-harmony-ab-a-r`);
  const existingAbB = artifactWithBasenamePrefix(summary, "preview", `${SLUG}-harmony-ab-b-r`);
  let ab;
  if (existingAbA && existingAbB) {
    ab = {
      reused: true,
      A: { sourceArtifactId: leadArtifact.id, outputPath: existingAbA.path },
      B: { sourceArtifactId: vocalMixArtifact.id, outputPath: existingAbB.path },
    };
  } else {
    const abAPath = join(runDirectory, `${SLUG}-harmony-ab-a-r${summary.revision}.wav`);
    const abBPath = join(runDirectory, `${SLUG}-harmony-ab-b-r${summary.revision}.wav`);
    ab = await mcp.call("vocaloid_review_audio", {
      action: "compare_anchor_ab",
      manifest_path: manifestPath,
      expected_revision: summary.revision,
      artifact_a_id: leadArtifact.id,
      artifact_b_id: vocalMixArtifact.id,
      phrase_direction_id: DIRECTION_ID,
      audition_layer: "lead_harmony",
      hypothesis_family: "harmony",
      output_a_path: abAPath,
      output_b_path: abBPath,
      target_duration_seconds: 25,
      match_lufs: -18,
      reference_true_peak_dbfs: -1.5,
    }, { label: "render loudness-matched harmony A/B", timeout: 600_000, maxTotalTimeout: 600_000 });
    summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
  }

  const finalPath = join(SONG_DIRECTORY, `${SLUG}-${basename(dirname(manifestPath))}-final.wav`);
  let deliveryArtifact = currentArtifacts(summary, "delivery").find((artifact) => artifact.path === finalPath);
  let delivery;
  if (!deliveryArtifact) {
    delivery = await mcp.call("vocaloid_master_manifest_delivery", {
      manifest_path: manifestPath,
      expected_revision: summary.revision,
      source_artifact_id: minimalMixArtifact.id,
      output_path: finalPath,
      target_lufs: -16,
      target_true_peak_dbfs: -1.5,
      target_loudness_range_lu: 8,
      allow_clipped_source: false,
    }, { label: "master listening delivery", timeout: 900_000, maxTotalTimeout: 900_000 });
    deliveryArtifact = delivery.artifact;
    summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
  }

  const finalAnalysis = await mcp.call("vocaloid_analyze_wav", {
    path: deliveryArtifact.path,
    target_lufs: -16,
    target_true_peak_dbfs: -1.5,
  }, { label: "independent final WAV QC", timeout: 300_000, maxTotalTimeout: 300_000 });
  if (finalAnalysis.channels !== 2 || finalAnalysis.sampleClipping || finalAnalysis.clippedSampleValues > 0) {
    throw new Error(`Final delivery failed hard QC: ${JSON.stringify(finalAnalysis)}`);
  }

  await mkdir(VSQX_DIRECTORY, { recursive: true });
  const publishedVsqxPath = join(VSQX_DIRECTORY, `${SLUG}-${basename(dirname(manifestPath))}-demo.vsqx`);
  if (!(await exists(publishedVsqxPath))) {
    await copyFile(projectArtifact.path, publishedVsqxPath, fsConstants.COPYFILE_EXCL);
  }
  const [sourceVsqx, publishedVsqx] = await Promise.all([
    readFile(projectArtifact.path),
    readFile(publishedVsqxPath),
  ]);
  if (!sourceVsqx.equals(publishedVsqx)) throw new Error("Published VSQX differs from current project artifact");

  return {
    summary,
    projectArtifact,
    leadArtifact,
    harmonyArtifact,
    vocalMixArtifact,
    minimalMixArtifact,
    previews,
    ab,
    deliveryArtifact,
    finalAnalysis,
    publishedVsqxPath,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!(await exists(SERVER_ENTRYPOINT))) throw new Error(`Missing ${SERVER_ENTRYPOINT}; run npm run build first`);
  const runDirectory = join(BUILD_ROOT, options.runId);
  const manifestPath = join(runDirectory, `${options.runId}.song.json`);
  await mkdir(BUILD_ROOT, { recursive: true });
  if (await exists(manifestPath)) {
    if (!options.resume) throw new Error(`Manifest already exists: ${manifestPath}; use --resume or a new --run-id`);
  } else {
    await mkdir(runDirectory, { recursive: false });
  }
  await mkdir(SONG_DIRECTORY, { recursive: true });

  const mcp = new ProductionMcp();
  await mcp.connect();
  try {
    let composeResult;
    if (await exists(manifestPath)) {
      composeResult = { resumed: true };
    } else {
      composeResult = await compose(mcp, manifestPath);
    }
    const summary = await mcp.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { quiet: true });
    const rendered = await buildAndRender(mcp, manifestPath, runDirectory, summary);
    const reportPath = join(runDirectory, `${options.runId}-run-report.json`);
    const report = {
      schema: "vocaloid-intent-composition-demo/v1",
      generated_at: new Date().toISOString(),
      run_id: options.runId,
      title: TITLE,
      manifest_path: manifestPath,
      manifest_revision: rendered.summary.revision,
      composition_hash: rendered.summary.compositionHash,
      intent_hash: rendered.summary.intentHash,
      listening_question: "Can I hear that IA wants this person to stay while the line still sounds like an admission rather than a command?",
      isolation: {
        corpus_access: "not_used",
        style_profile_access: "not_used",
        reference_track_access: "not_used",
        prior_song_access: "not_used",
      },
      compose: composeResult,
      delivery: rendered.deliveryArtifact,
      final_analysis: rendered.finalAnalysis,
      vsqx_path: rendered.publishedVsqxPath,
      previews: rendered.previews,
      harmony_ab: rendered.ab,
      review_status: "awaiting_user_listening",
      renderer_boundary: "IA_ROCKS vocals use the original Editor. Piano, bass, and drum timbres use the bundled FluidR3 GM draft renderer.",
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log("\n=== Composition ready for listening ===");
    console.log(`Final WAV: ${rendered.deliveryArtifact.path}`);
    console.log(`VSQX: ${rendered.publishedVsqxPath}`);
    console.log(`Lead solo preview: ${rendered.previews.lead_solo.path}`);
    console.log(`Lead + harmony preview: ${rendered.previews.lead_harmony.path}`);
    console.log(`Minimal-band preview: ${rendered.previews.minimal_band.path}`);
    console.log(`Harmony A/B: ${rendered.ab.A.outputPath} | ${rendered.ab.B.outputPath}`);
    console.log(`Report: ${reportPath}`);
  } finally {
    await mcp.close();
  }
}

main().catch((error) => {
  console.error(`intent composition failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
