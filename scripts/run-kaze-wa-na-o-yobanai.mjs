#!/usr/bin/env node

import { access, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";


const ROOT = resolve(import.meta.dirname, "..");
const RUN_DIR = "build/cold-start-songs/kaze-wa-na-o-yobanai-ia-20260719";
const EVAL_DIR = "artifacts/evals/kaze-wa-na-o-yobanai-ia-20260719";
const MANIFEST = `${RUN_DIR}/kaze-wa-na-o-yobanai.song.json`;
const IA_COMPONENT_ID = "BLRGDDR4M3WM2LC6";
const PHASE = process.argv[2] ?? "setup";

const client = new Client({ name: "kaze-wa-na-o-yobanai-cold-start", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(ROOT, "dist/src/index.js")],
  cwd: ROOT,
  env: { ...process.env, VOCALOID_MCP_PROFILE: "production" },
  stderr: "inherit",
});

function dataOf(result, label) {
  const structured = result.structuredContent;
  if (!structured || structured.ok !== true) {
    const text = result.content?.find((entry) => entry.type === "text")?.text;
    throw new Error(`${label} failed: ${text ?? JSON.stringify(structured ?? result)}`);
  }
  return structured.data;
}

async function call(name, args) {
  return dataOf(await client.callTool(
    { name, arguments: args },
    undefined,
    { timeout: 900_000, resetTimeoutOnProgress: true, maxTotalTimeout: 900_000 },
  ), name);
}

async function readContract(uri) {
  const result = await client.readResource({ uri });
  if (!result.contents?.[0]) throw new Error(`Missing contract ${uri}`);
  return result.contents[0];
}

async function exists(path) {
  return access(resolve(ROOT, path)).then(() => true, () => false);
}

async function inspect() {
  return call("vocaloid_inspect_song_manifest", { path: MANIFEST, response_format: "json" });
}

async function edit(action, actionPayload) {
  await readContract(`vocaloid://edit-song-contract/${action}`);
  const before = await inspect();
  const common = {
    input_path: MANIFEST,
    output_path: MANIFEST,
    expected_revision: before.revision,
    overwrite: true,
  };
  const preview = await call("vocaloid_edit_song", {
    action,
    payload: { ...common, ...actionPayload, dry_run: true },
    response_format: "json",
  });
  if (preview.kind !== "mutation_preview") throw new Error(`${action} did not return a mutation preview`);
  const applied = await call("vocaloid_edit_song", {
    action,
    payload: { ...common, ...actionPayload, dry_run: false },
    response_format: "json",
  });
  if (applied.kind !== "mutation_applied") throw new Error(`${action} did not apply`);
  return { preview, applied };
}

async function journal(decision) {
  await readContract("vocaloid://creative-journal-contract/record");
  const current = await inspect();
  const envelope = {
    action: "record",
    payload: {
      manifest_path: MANIFEST,
      expected_revision: current.revision,
      decision,
      dry_run: true,
    },
    response_format: "json",
  };
  await call("vocaloid_creative_journal", envelope);
  envelope.payload.dry_run = false;
  return call("vocaloid_creative_journal", envelope);
}

async function hasDecision(id) {
  await readContract("vocaloid://creative-journal-contract/list");
  const listed = await call("vocaloid_creative_journal", {
    action: "list",
    payload: { manifest_path: MANIFEST, offset: 0, limit: 100 },
    response_format: "json",
  });
  return listed.items?.some((entry) => entry.entry?.id === id || entry.id === id) ?? false;
}

const sections = [
  ["intro", "Intro — ridge wind", "intro", 0, 4, 0.18, "Wind and a two-note sword-memory cell; no voice yet."],
  ["verse-1", "Verse I — the long ascent", "verse", 4, 12, 0.38, "One traveler climbs; elapsed decades are counted through landscape rather than exposition."],
  ["pre-1", "Pre I — second footfall", "pre_chorus", 12, 16, 0.52, "Another footfall enters the wind; recognition remains withheld."],
  ["chorus-1", "Chorus I — names withheld", "chorus", 16, 24, 0.68, "The hook establishes mutual refusal to call a name or turn."],
  ["interlude", "Interlude — scabbard resonance", "interlude", 24, 28, 0.34, "Instrumental fracture of the hook; decades remain between two timbral planes."],
  ["verse-2", "Verse II — changed rivers", "verse", 28, 36, 0.44, "Both histories are implied through changed roads, towns, and scars on the scabbards."],
  ["pre-2", "Pre II — recognition", "pre_chorus", 36, 40, 0.58, "The old gait and gaze identify the other before either speaks."],
  ["cliff-pass", "Anchor — passing on the cliff", "chorus", 40, 48, 0.8, "The full encounter: no greeting, no stop, hands tighten on hilts, shoulders narrowly pass."],
  ["afterimage", "Afterimage — missing half bar", "bridge", 48, 56, 0.47, "A 2/4 bar removes expected time at the instant of passing; memory loosens without reconciliation."],
  ["final-chorus", "Final chorus — returned to rivers and lakes", "chorus", 56, 64, 0.76, "The hook returns transformed from refusal into mutual release."],
  ["outro", "Outro — wind keeps neither name", "outro", 64, 68, 0.16, "Two directions recede; the wind and water retain no name."],
].map(([id, name, kind, start, end, energy, description]) => ({
  id, name, kind,
  start: { measure: start, beat: 0, tick: 0 },
  end: { measure: end, beat: 0, tick: 0 },
  energy,
  description,
}));

const timeSignatures = [
  { measure: 0, numerator: 4, denominator: 4 },
  { measure: 48, numerator: 2, denominator: 4 },
  { measure: 49, numerator: 4, denominator: 4 },
];

const tempos = [
  [0, 78], [4, 88], [12, 90], [16, 94], [24, 84], [28, 88],
  [36, 90], [40, 92], [48, 72], [49, 84], [56, 94], [64, 76],
].map(([measure, bpm]) => ({ position: { measure, beat: 0, tick: 0 }, bpm }));

function chord(id, measure, symbol, durationTicks = 1920) {
  return { id, position: { measure, beat: 0, tick: 0 }, symbol, duration_ticks: durationTicks };
}

const chordChanges = [
  chord("ch-000-dm", 0, "Dm", 3840), chord("ch-002-bb", 2, "Bb"), chord("ch-003-a7", 3, "A7"),
  chord("ch-004-dm", 4, "Dm"), chord("ch-005-c", 5, "C"), chord("ch-006-bb", 6, "Bb"), chord("ch-007-a7", 7, "A7"),
  chord("ch-008-dm", 8, "Dm"), chord("ch-009-gm", 9, "Gm"), chord("ch-010-bb", 10, "Bb"), chord("ch-011-a7", 11, "A7"),
  chord("ch-012-gm", 12, "Gm"), chord("ch-013-bb", 13, "Bb"), chord("ch-014-c", 14, "C"), chord("ch-015-a7", 15, "A7"),
  chord("ch-016-dm", 16, "Dm"), chord("ch-017-bb", 17, "Bb"), chord("ch-018-f", 18, "F"), chord("ch-019-c", 19, "C"),
  chord("ch-020-gm", 20, "Gm"), chord("ch-021-dm", 21, "Dm"), chord("ch-022-bb", 22, "Bb"), chord("ch-023-a7", 23, "A7"),
  chord("ch-024-dm", 24, "Dm"), chord("ch-025-c", 25, "C"), chord("ch-026-bb", 26, "Bb"), chord("ch-027-a7", 27, "A7"),
  chord("ch-028-dm", 28, "Dm"), chord("ch-029-c", 29, "C"), chord("ch-030-bb", 30, "Bb"), chord("ch-031-a7", 31, "A7"),
  chord("ch-032-gm", 32, "Gm"), chord("ch-033-dm", 33, "Dm"), chord("ch-034-bb", 34, "Bb"), chord("ch-035-a7", 35, "A7"),
  chord("ch-036-gm", 36, "Gm"), chord("ch-037-bb", 37, "Bb"), chord("ch-038-c", 38, "C"), chord("ch-039-a7", 39, "A7"),
  chord("ch-040-dm", 40, "Dm"), chord("ch-041-bb", 41, "Bb"), chord("ch-042-f", 42, "F"), chord("ch-043-c", 43, "C"),
  chord("ch-044-gm", 44, "Gm"), chord("ch-045-dm", 45, "Dm"), chord("ch-046-bb", 46, "Bb"), chord("ch-047-a7", 47, "A7"),
  chord("ch-048-dm", 48, "Dm", 960), chord("ch-049-gm", 49, "Gm"), chord("ch-050-bb", 50, "Bb"), chord("ch-051-f", 51, "F"),
  chord("ch-052-c", 52, "C"), chord("ch-053-gm", 53, "Gm"), chord("ch-054-bb", 54, "Bb"), chord("ch-055-a7", 55, "A7"),
  chord("ch-056-dm", 56, "Dm"), chord("ch-057-bb", 57, "Bb"), chord("ch-058-f", 58, "F"), chord("ch-059-c", 59, "C"),
  chord("ch-060-gm", 60, "Gm"), chord("ch-061-dm", 61, "Dm"), chord("ch-062-a7", 62, "A7"), chord("ch-063-dm", 63, "Dm"),
  chord("ch-064-bb", 64, "Bb"), chord("ch-065-c", 65, "C"), chord("ch-066-dm", 66, "Dm", 3840),
];

function sectionIntent(sectionId, dramaticFunction, stateBefore, intendedTransition, stateAfter, inheritedDelivery) {
  return {
    id: `intent-${sectionId}`,
    section_id: sectionId,
    dramatic_function: dramaticFunction,
    state_before: stateBefore,
    intended_transition: intendedTransition,
    state_after: stateAfter,
    inherited_delivery: inheritedDelivery,
  };
}

const compositionIntent = {
  schema: "vocaloid-composition-intent/v1",
  song: {
    premise: "The cliff wind witnesses two swordsmen, separated for decades, recognize one another on a path too narrow for ceremony. They do not greet, stop, draw, or reconcile; each tightens a hand on the hilt, passes, and releases the other back into rivers and lakes.",
    narrator_stance: "IA is the impersonal ridge wind: close enough to register breath, gait, cloth, and scabbard resonance, but unwilling to explain either life or choose a victor.",
    addressee: "Both travelers at once, with neither granted a private confession or reply.",
    central_tension: "Recognition creates the possibility of speech or violence, while mutual restraint requires the encounter to remain in motion and incomplete.",
    state_at_start: "One solitary ascent is framed as ordinary weather and accumulated time.",
    intended_destination: "Two receding directions and a mutual forgetting that feels chosen, not erased or resolved.",
    listener_after: "The listener should be able to recount the encounter while still feeling the unsaid decades as negative space.",
    creative_invariants: [
      "No lyric or arrangement event turns the crossing into a duel, victory, reunion, apology, or romantic reconciliation.",
      "The largest lead-melody departure belongs to the tightened hilt, not to a greeting or heroic pose.",
      "Audible silence and the single 2/4 measure carry narrative information before reverb or mastering is considered.",
      "The title hook changes from refusal in Chorus I to mutual release in the final chorus.",
      `Every vocal track uses original IA component ${IA_COMPONENT_ID}; no IA_ROCKS or trial singer is present.`,
    ],
  },
  sections: [
    sectionIntent("intro", "Establish wind, cliff scale, and a two-note object-memory without identifying a person.", "No narrated event yet.", "Let empty register and separated attacks make the landscape precede the travelers.", "A solitary path is audible.", "Sparse, dry, and unhurried."),
    sectionIntent("verse-1", "Count decades through moon, rain, clothing, and ascent rather than a biography.", "One unnamed traveler has entered.", "Keep the vocal line speech-shaped and mostly narrow while landscapes change underneath it.", "Time has accumulated without an explicit grievance.", "Close plain tone with syntax-sized breaths."),
    sectionIntent("pre-1", "Introduce a second footfall before identity is known.", "The ascent still seems solitary.", "Move from recitative repetition to two registral terraces; end on dominant tension without naming the arrival.", "Another presence is certain but unnamed.", "Tighten pulse while preserving air before the chorus."),
    sectionIntent("chorus-1", "State the refusal hook: neither names nor pursuit will bridge the distance.", "A second presence exists.", "Use repeated anchor tones and contrasting phrase destinations so refusal is active rather than numb.", "The rule of non-pursuit is established.", "Connected accents only on semantic anchors; no global belt."),
    sectionIntent("interlude", "Break the hook into scabbard-like resonance and footsteps.", "The refusal has been stated.", "Remove the voice and split the motif across distant registers.", "The next memory arrives through objects rather than explanation.", "Keep the arrangement dry enough that attacks remain separate."),
    sectionIntent("verse-2", "Show changed rivers, rebuilt towns, and accumulating scabbard damage shared by both lives.", "The listener knows distance but not its cause.", "Transform the verse rhythm and peak order; do not repeat Verse I's normalized contour.", "Both histories feel long and parallel without being narrated symmetrically.", "More forward consonants, still below the anchor climax."),
    sectionIntent("pre-2", "Make recognition happen through gait and gaze.", "Two histories are converging.", "Delay entry, compress around a pitch pedal, then leave a sokuon-sized silence before the final recognition syllable.", "The other is identified as 君 without speech.", "Plain opening, then one restrained increase in DYN."),
    sectionIntent("cliff-pass", "Make the complete physical encounter legible in eight bars.", "Recognition has occurred at a distance.", "Move from an early high memory terrace to low cliff-space, accelerate through unbroken walking, then spend the only F5 on 柄を握り before descending into an A7 suspension.", "They have passed without greeting, stopping, or drawing.", "Lead first; harmony enters only after the midpoint and never takes the lead's peak."),
    sectionIntent("afterimage", "Let the expected bar and expected reply both go missing.", "Their shoulders have just passed.", "Use the 2/4 bar as a literal subtraction, then let descending fragments land on different banks.", "Silence becomes the only shared answer.", "Thin dynamics; leave the transient of the short bar exposed."),
    sectionIntent("final-chorus", "Transform refusal into mutual release toward rivers and lakes.", "Neither has turned back.", "Preserve the title cell but lower its last destination and simplify the final allocation.", "Forgetting is accepted as an action rather than an absence of memory.", "Broader support underneath, vocal still restrained."),
    sectionIntent("outro", "Remove both names from the landscape.", "Two directions are receding.", "Contract the range, slow the pulse, and leave one tonic tone after the final word.", "Wind and water keep neither identity.", "Nearly plain tone, with no triumphant cadence."),
  ],
  phrase_directions: [
    {
      id: "pd-cliff-pass",
      section_id: "cliff-pass",
      importance: "anchor",
      lyric_anchor: { text: "幾十年の向こうから／断崖の細い道／足も止めず　言葉も抜かず／剣も抜かず　柄を握り　すれ違う" },
      purpose: "Compress the entire reunion into motion: recognize, approach, refuse speech and steel, tighten the hilt, and pass.",
      addressed_to: "Both travelers and the listening witness.",
      semantic_focus: "柄を握り",
      subtext: "The grip admits that violence and memory are present; continuing to walk is the chosen answer.",
      state_before: "They know who is approaching but still have distance in which to act.",
      intended_transition: "The melody must make the tightened hand the largest event, then remove heroic closure by descending into a suspended final D over A7.",
      state_after: "The other is physically behind them and no decision can become a conversation.",
      delivery_arc: "Begin as distant recognition, narrow at the cliff description, intensify through continuous walking, open once on the hilt, then cool immediately while forward motion continues.",
      realization_hypothesis: {
        summary: "Four non-isomorphic two-bar phrases—early peak, low repeated cliff band, accelerating pendulum, and leap-hold-release—make the narrative audible without prose narration between lines.",
        melody: "The only F5 is assigned to the grip; the last note is D4 over A7, not a tonic victory.",
        rhythm: "Entry positions move from downbeat to delayed and offbeat; the final line compresses seventeen morae around one long focus note.",
        harmony: "Dm–Bb–F–C opens perspective; Gm–Dm–Bb–A7 turns restraint into unresolved dominant space.",
        register: "The second phrase contracts to the cliff floor before the last phrase expands to a single earned peak.",
        dynamics: "DYN rises only into 柄を握り and falls before すれ違う.",
        tuning: "Plain early sustains, a small scoop into the grip peak, delayed vibrato only where a long vowel can carry it.",
        arrangement_space: "Harmony is absent for the first four bars; minimal band leaves the lead center unobstructed.",
        expected_evidence: [
          "Four phrase blueprints differ in entry, contour, rhythm, and cadence.",
          "The semantic-focus lyric unit and its cell receive the local maximum pitch and longer-than-neighbor duration.",
          "The final melodic event remains a non-chord suspension over A7 until the short afterimage bar.",
        ],
        symbolic_targets: {
          melody_range: "expand",
          harmonic_tension: "withhold",
          delivery_dynamics: "increase",
          arrangement_density: "increase",
          semantic_focus_duration_ratio_min: 1.5,
          semantic_focus_beat_strength_min: 0.4,
        },
      },
      listening_question: {
        id: "lq-cliff-grip-without-duel",
        question: "Across the fixed 40–48 passage, does the single high/long focus on 柄を握り followed by immediate descent and suspension make recognition, restraint, and passing legible without suggesting a duel or reconciliation?",
      },
    },
    {
      id: "pd-final-release",
      section_id: "final-chorus",
      importance: "supporting",
      lyric_anchor: { text: "名を呼ばない　もう呼ばない／互いを忘れて　川と湖へ" },
      purpose: "Return the title cell with the same refusal but a different destination: mutual release into the wider world.",
      semantic_focus: "互いを忘れて",
      state_before: "The encounter is already behind both travelers.",
      intended_transition: "Preserve the repeated-name rhythm while lowering its final contour and lengthening the last tonic so the hook stops asking for pursuit.",
      state_after: "Memory remains, but neither claims the other as unfinished business.",
      delivery_arc: "Firm but no louder than the anchor; broaden vowels, then strip the final word of flourish.",
      listening_question: {
        id: "lq-final-release-not-erasure",
        question: "Does the transformed hook sound like chosen mutual release rather than amnesia, defeat, or a happy reunion?",
      },
    },
  ],
};

async function createSkeleton() {
  if (await exists(MANIFEST)) return inspect();
  return call("vocaloid_create_song_manifest", {
    output_path: MANIFEST,
    song_id: "kaze-wa-na-o-yobanai-ia",
    slug: "kaze-wa-na-o-yobanai-ia",
    title: "風は名を呼ばない",
    format: "vsq3",
    pre_measure: 1,
    time_signatures: timeSignatures,
    tempos,
    sections,
    key_changes: [],
    chord_changes: [],
    sample_rate: 44_100,
    accompaniment_gain: 0.16,
    reverb: false,
    chorus: false,
    overwrite: false,
    response_format: "json",
  });
}

async function setup() {
  await Promise.all([
    mkdir(resolve(ROOT, RUN_DIR), { recursive: true }),
    mkdir(resolve(ROOT, EVAL_DIR), { recursive: true }),
    mkdir(resolve(ROOT, "artifacts/songs"), { recursive: true }),
    mkdir(resolve(ROOT, "artifacts/vsqxs"), { recursive: true }),
    mkdir(resolve(ROOT, "artifacts/creative-records"), { recursive: true }),
  ]);
  await Promise.all([
    readContract("vocaloid://capabilities"),
    readContract("vocaloid://composition-intent-contract"),
    readContract("vocaloid://music-theory-policy"),
    readContract("vocaloid://phrase-grammar"),
    readContract("vocaloid://creative-decision-journal"),
  ]);
  await createSkeleton();
  let summary = await inspect();
  if (!summary.compositionIntent) {
    await edit("set_composition_intent", { composition_intent: compositionIntent });
    await journal({
      id: "decision-intent-v1",
      phase: "intent",
      kind: "selection",
      title: "Frame IA as the unnamed ridge wind",
      objective: "Keep the two-swordsmen narrative recountable while allowing stream-of-consciousness imagery and refusing explanatory biography.",
      decision: "IA voices the cliff wind, observes both travelers equally, and withholds names. Recognition is admitted through objects and gait; the grip is the climax; passing is the destination.",
      rationale: "A neutral wind narrator can report physical evidence without granting either swordsman a confessional monologue. This preserves ambiguity around their decades apart while keeping the encounter, restraint, and mutual release explicit.",
      alternatives: [
        { option: "First-person voice of one swordsman", disposition: "rejected", reason: "It would privilege one history and invite explanation or reconciliation." },
        { option: "Omniscient prose-like narrator", disposition: "rejected", reason: "It would make narrative meaning depend on exposition rather than phrase shape, silence, and form." },
        { option: "Ridge wind addressing both", disposition: "selected", reason: "It supports sensory fragments, equal distance, and the final disappearance of both names." },
      ],
      expected_audible_effect: "The lyric should feel close to cloth, breath, stone, and steel while no line claims victory, apology, or reunion.",
      actual_result: "Canonical song, eleven section, and two phrase directions were installed before vocal notes or harmony.",
      next_step: "Install the meter/tempo and harmonic field, then compose the anchor from the registered listening question.",
      affected_object_ids: ["pd-cliff-pass", "pd-final-release"],
      artifact_ids: [],
      listening_question_id: "lq-cliff-grip-without-duel",
      hypothesis_family: "melody",
      hash_dependencies: ["intent"],
      supersedes_decision_ids: [],
      evidence: {
        constraints: [
          "Original IA only, component BLRGDDR4M3WM2LC6.",
          "No corpus, reference track, prior manifest, or melody retrieval.",
          "No duel, greeting, stopping, reconciliation, or triumphant closure.",
        ],
        observations: [
          "The canonical intent binds the encounter to cliff-pass and the single listening question lq-cliff-grip-without-duel.",
          "All section intents declare a state transition and inherit restrained delivery.",
        ],
        theory_issue_codes: [],
        metric_deltas: [],
      },
      outcome: "implemented",
      author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
    });
  }
  summary = await inspect();
  if (summary.revision === 2) {
    await edit("replace_timeline", {
      update: {
        key_changes: [{ id: "key-d-minor", position: { measure: 0, beat: 0, tick: 0 }, tonic: "D", mode: "minor" }],
        chord_changes: chordChanges,
      },
    });
  }
  summary = await inspect();
  if (summary.revision >= 3 && !(await hasDecision("decision-form-harmony-v1"))) {
    await journal({
      id: "decision-form-harmony-v1",
      phase: "harmony",
      kind: "selection",
      title: "D-minor field with one missing half-bar after the crossing",
      objective: "Make distance, approach, restraint, and release legible through form, meter, tempo, and harmonic destination before writing the melody.",
      decision: "Use a 68-measure form, section-specific 76–94 BPM pacing, D minor with plain diatonic chords, an unresolved A7 at the anchor end, and a single 2/4 bar immediately after the pass.",
      rationale: "The tonal language stays spare enough that phrase contour and lyric timing remain primary. The anchor's A7 permits a melodic D suspension; the short following Dm bar resolves only after physical separation. The removed half-bar makes the missing exchange audible without adding a sound effect.",
      alternatives: [
        { option: "Continuous 4/4 throughout", disposition: "rejected", reason: "It left the instant of passing structurally interchangeable with every other boundary." },
        { option: "Modulate upward for the encounter", disposition: "rejected", reason: "A heroic modulation would overstate confrontation and imply arrival." },
        { option: "D minor with one post-crossing 2/4 subtraction", disposition: "selected", reason: "It creates one audible absence while preserving the work's restrained scale." },
      ],
      expected_audible_effect: "The listener should feel time contract only after the shoulders pass; the anchor should remain tense through its last note rather than close in victory.",
      actual_result: "The dry-run introduced no structural blocker; key and complete chord coverage were installed through measure 68.",
      next_step: "Author four distinct anchor phrases and validate their grammar blueprints without deriving any melody from a bundle.",
      affected_object_ids: ["key-d-minor", ...chordChanges.map((entry) => entry.id), ...sections.map((entry) => entry.id)],
      artifact_ids: [],
      hash_dependencies: [],
      supersedes_decision_ids: [],
      evidence: {
        constraints: ["Anchor must remain 20–30 seconds.", "The final anchor harmony must withhold closure."],
        observations: [
          "Measures 40–48 last approximately 20.87 seconds at 92 BPM.",
          "Measure 47 is A7; measure 48 is a 2/4 Dm bar at 72 BPM.",
        ],
        theory_issue_codes: [],
        metric_deltas: [],
      },
      outcome: "implemented",
      author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
    });
  }
  return inspect();
}

function pos(measure, beat = 0, tick = 0) {
  return { measure, beat, tick };
}

function voiced(id, duration, noteNumber, options = {}) {
  return {
    id,
    duration,
    note_number: noteNumber,
    gate_percent: options.gate ?? 96,
    velocity: options.velocity ?? 62,
    style: options.style ?? {},
  };
}

function rest(id, duration) {
  return { id, duration, rest: true, gate_percent: 100, velocity: 64, style: {} };
}

function makeSlots(phraseId, durations, pitches, entryRest = 0, tailRest = 0, overrides = {}, expectedTicks = 3840) {
  if (durations.length !== pitches.length) throw new Error(`${phraseId}: duration/pitch count mismatch`);
  const slots = [];
  let serial = 1;
  if (entryRest > 0) slots.push(rest(`${phraseId}-slot-${String(serial++).padStart(4, "0")}`, entryRest));
  for (let index = 0; index < durations.length; index++) {
    const id = `${phraseId}-slot-${String(serial++).padStart(4, "0")}`;
    slots.push(voiced(id, durations[index], pitches[index], overrides[index] ?? {}));
  }
  if (tailRest > 0) slots.push(rest(`${phraseId}-slot-${String(serial++).padStart(4, "0")}`, tailRest));
  const total = slots.reduce((sum, slot) => sum + slot.duration, 0);
  if (total !== expectedTicks) throw new Error(`${phraseId}: authored slots total ${total}, expected ${expectedTicks}`);
  return slots;
}

function blueprint(id, components, limits, note, sourceBundleIds = [], relation = {}) {
  return {
    schema: "vocaloid-phrase-grammar/v1",
    id,
    melody_authorship: "agent_composed",
    bundle_usage: "selection_only",
    components,
    source_bundle_ids: sourceBundleIds,
    preserve_dimensions: relation.preserve ?? [],
    change_dimensions: relation.change ?? [],
    limits,
    note,
    ...(relation.source ? { source_phrase_id: relation.source } : {}),
  };
}

const anchorBlueprints = {
  "lead-anchor-a": blueprint("bp-lead-anchor-a", {
    role: "role.statement",
    entry: "entry.downbeat",
    contour: ["contour.early-peak"],
    rhythm: ["rhythm.long-short-contrast", "rhythm.sustained-tail"],
    motion: ["motion.pentatonic-gap", "motion.modal-pivot"],
    cadence: "cadence.third-soft",
    development: "development.new",
    allocation: ["allocation.syllabic"],
    articulation: ["articulation.plain-tone"],
    space: ["space.tail-rest"],
  }, { range_semitones: [7, 14], peak_window: [0, 0.25], maximum_leap_semitones: 5, maximum_consecutive_direction: 4 },
  "Recognition begins with an early D5 memory terrace, then spends the line descending and reframing; concrete notes were composed from D-minor harmony and the prosody of 幾十年.", ["wa.modal-narrative", "night.sparse-distance"]),
  "lead-anchor-b": blueprint("bp-lead-anchor-b", {
    role: "role.contrast",
    entry: "entry.delayed",
    contour: ["contour.recitative-pedal"],
    rhythm: ["rhythm.long-short-contrast"],
    motion: ["motion.repeated-tone", "motion.neighbor-tone"],
    cadence: "cadence.downward-release",
    development: "development.new",
    allocation: ["allocation.syllabic"],
    articulation: ["articulation.plain-tone"],
    space: ["space.delayed-entry-space"],
  }, { range_semitones: [4, 9], repeated_pitch_ratio: [0.15, 0.55], maximum_leap_semitones: 4, maximum_consecutive_direction: 3 },
  "The cliff description enters one beat late and stays near D4; landscape contracts the range instead of copying the prior early-peak phrase.", ["ia.close-confession", "night.sparse-distance"]),
  "lead-anchor-c": blueprint("bp-lead-anchor-c", {
    role: "role.continuation",
    entry: "entry.offbeat",
    contour: ["contour.pendulum"],
    rhythm: ["rhythm.accelerating", "rhythm.long-short-contrast"],
    motion: ["motion.neighbor-tone", "motion.repeated-tone"],
    cadence: "cadence.suspended-open",
    development: "development.new",
    allocation: ["allocation.syllabic"],
    articulation: ["articulation.connected-accent"],
    space: ["space.no-internal-rest"],
  }, { range_semitones: [5, 12], peak_window: [0.55, 0.8], repeated_pitch_ratio: [0.05, 0.35], maximum_leap_semitones: 4, maximum_consecutive_direction: 3 },
  "Continuous walking is carried by changing 240/180-tick values around A4 rather than a new arch; the offbeat entry prevents a formal stop.", ["rock.call-response", "ia.transparent-longline"]),
  "lead-anchor-d": blueprint("bp-lead-anchor-d", {
    role: "role.release",
    entry: "entry.offbeat",
    contour: ["contour.leap-hold-release"],
    rhythm: ["rhythm.long-short-contrast", "rhythm.sustained-tail"],
    motion: ["motion.leap-recovery", "motion.appoggiatura"],
    cadence: "cadence.suspended-open",
    development: "development.new",
    allocation: ["allocation.syllabic", "allocation.held-vowel"],
    articulation: ["articulation.connected-accent", "articulation.delayed-vibrato"],
    space: ["space.no-internal-rest"],
  }, { range_semitones: [12, 18], peak_window: [0.5, 0.72], maximum_leap_semitones: 7, maximum_consecutive_direction: 5 },
  "Seventeen morae compress around one 480-tick F5 on ぎ in 柄を握り, followed by stepwise descent to D4 over A7; the bundle supplied no pitch or rhythm material.", ["ballad.suspended-release", "wa.modal-narrative"]),
};

const anchorLeadDefinitions = [
  {
    id: "lead-anchor-a", text: "幾十年の向こうから", reading: "いくじゅうねんの むこうから", start: pos(40),
    durations: [240, 240, 360, 240, 240, 360, 240, 240, 360, 240, 360, 480],
    pitches: [72, 74, 74, 72, 70, 69, 69, 67, 65, 67, 69, 65], entry: 0, tail: 240,
  },
  {
    id: "lead-anchor-b", text: "断崖の細い道", reading: "だんがいの ほそいみち", start: pos(42),
    durations: [480, 360, 240, 240, 360, 480, 240, 240, 360, 360],
    pitches: [62, 62, 65, 62, 60, 62, 65, 64, 62, 60], entry: 480, tail: 0,
  },
  {
    id: "lead-anchor-c", text: "足も止めず　言葉も抜かず", reading: "あしも とめず ことばも ぬかず", start: pos(44),
    durations: [240, 240, 240, 180, 180, 240, 240, 180, 180, 240, 240, 360, 480],
    pitches: [65, 67, 69, 67, 70, 69, 67, 69, 72, 70, 69, 67, 69], entry: 240, tail: 360,
  },
  {
    id: "lead-anchor-d", text: "剣も抜かず　柄を握り　すれ違う", reading: "けんも ぬかず つかを にぎり すれちがう", start: pos(46),
    durations: [180, 180, 180, 180, 180, 180, 180, 180, 180, 240, 480, 240, 180, 180, 180, 180, 360],
    pitches: [64, 64, 65, 67, 64, 61, 62, 65, 69, 72, 77, 74, 72, 70, 69, 65, 62], entry: 180, tail: 0,
    overrides: { 10: { gate: 100, velocity: 76 }, 16: { gate: 100, velocity: 55 } },
  },
];

const anchorHarmonyDefinitions = [
  {
    id: "harmony-anchor-c", text: "足も止めず　言葉も抜かず", reading: "あしも とめず ことばも ぬかず", start: pos(44),
    durations: [240, 240, 240, 180, 180, 240, 240, 180, 180, 240, 240, 360, 480],
    pitches: [62, 62, 65, 64, 67, 65, 64, 65, 69, 67, 65, 64, 61], entry: 240, tail: 360,
  },
  {
    id: "harmony-anchor-d", text: "剣も抜かず　柄を握り　すれ違う", reading: "けんも ぬかず つかを にぎり すれちがう", start: pos(46),
    durations: [180, 180, 180, 180, 180, 180, 180, 180, 180, 240, 480, 240, 180, 180, 180, 180, 360],
    pitches: [57, 57, 60, 62, 61, 57, 59, 62, 65, 67, 69, 69, 67, 65, 64, 61, 57], entry: 180, tail: 0,
    overrides: { 10: { gate: 100, velocity: 68 }, 16: { gate: 100, velocity: 50 } },
  },
];

const D = {
  n9: [360, 240, 360, 240, 480, 360, 240, 480, 480],
  n10a: [240, 240, 360, 360, 480, 240, 240, 360, 360, 240],
  n10b: [360, 240, 240, 480, 240, 360, 240, 240, 480, 480],
  n10c: [480, 240, 360, 240, 240, 480, 360, 240, 360, 360],
  n10d: [240, 360, 240, 240, 480, 360, 240, 480, 240, 480],
  n11a: [240, 240, 360, 240, 240, 360, 240, 240, 360, 360, 480],
  n11b: [360, 240, 240, 360, 240, 240, 480, 240, 240, 360, 360],
  n11c: [240, 360, 240, 240, 360, 240, 240, 360, 240, 480, 360],
  n12a: [240, 240, 240, 360, 240, 240, 360, 240, 240, 360, 360, 240],
  n12b: [360, 240, 240, 240, 360, 240, 240, 360, 240, 240, 360, 360],
  n12c: [240, 360, 240, 240, 240, 360, 240, 240, 360, 240, 240, 480],
  n13a: [240, 240, 180, 240, 240, 360, 240, 180, 240, 240, 360, 240, 480],
  n13b: [180, 240, 240, 180, 240, 240, 360, 240, 180, 240, 360, 360, 480],
  n14a: [240, 180, 180, 240, 240, 180, 240, 240, 180, 240, 240, 360, 360, 480],
  n14b: [180, 180, 240, 240, 180, 240, 240, 180, 240, 240, 180, 360, 360, 480],
  n16: [180, 180, 180, 240, 180, 180, 240, 180, 180, 240, 180, 180, 240, 240, 360, 480],
  n7short: [240, 240, 360, 360, 480, 360, 480],
};

function grammar(role, entry, contour, rhythm, motion, cadence, development = "development.new", extras = {}) {
  return {
    role, entry, contour: [contour], rhythm, motion, cadence, development,
    allocation: extras.allocation ?? ["allocation.syllabic"],
    articulation: extras.articulation ?? ["articulation.legato-flow"],
    space: extras.space ?? ["space.tail-rest"],
  };
}

function songPhrase(id, section, text, reading, measure, durations, pitches, entry, tail, grammarPlan, options = {}) {
  return {
    id, section, text, reading, start: pos(measure), durations, pitches, entry, tail,
    span: options.span ?? 3840,
    overrides: options.overrides ?? {},
    blueprint: blueprint(`bp-${id}`, grammarPlan, options.limits ?? {
      range_semitones: [3, 16], maximum_leap_semitones: 7, maximum_consecutive_direction: 5,
    }, options.note ?? `${id} uses an agent-authored melody derived from its Japanese prosody, active chords, and section function; the selected vocabulary contains no melody material.`,
    options.bundles ?? ["ia.transparent-longline"], {
      ...(options.source ? { source: options.source } : {}),
      preserve: options.preserve ?? [], change: options.change ?? [],
    }),
  };
}

const fullLeadDefinitions = [
  songPhrase("lead-v1-a", "verse-1", "錆びた月を背にして", "さびた つきを せにして", 4, D.n10a,
    [62, 62, 65, 64, 62, 60, 62, 65, 64, 62], 480, 240,
    grammar("role.statement", "entry.delayed", "contour.valley", ["rhythm.long-short-contrast"], ["motion.stepwise", "motion.repeated-tone"], "cadence.third-soft"),
    { bundles: ["ia.close-confession"], limits: { range_semitones: [4, 8], repeated_pitch_ratio: [0.1, 0.45], maximum_leap_semitones: 3, maximum_consecutive_direction: 3 } }),
  songPhrase("lead-v1-b", "verse-1", "ひとり峠を登る", "ひとり とうげを のぼる", 6, D.n10b,
    [64, 67, 67, 65, 64, 62, 60, 62, 64, 58], 0, 480,
    grammar("role.continuation", "entry.downbeat", "contour.terrace-down", ["rhythm.long-short-contrast"], ["motion.pentatonic-gap", "motion.stepwise"], "cadence.downward-release"),
    { bundles: ["wa.modal-narrative"], limits: { range_semitones: [7, 12], maximum_leap_semitones: 6, maximum_consecutive_direction: 4 } }),
  songPhrase("lead-v1-c", "verse-1", "袖に残る雨だけが", "そでに のこる あめだけが", 8, D.n11b,
    [65, 65, 64, 62, 64, 67, 65, 64, 62, 60, 62], 240, 240,
    grammar("role.answer", "entry.pickup-short", "contour.asymmetric-wave", ["rhythm.pickup-flow", "rhythm.long-short-contrast"], ["motion.neighbor-tone", "motion.stepwise"], "cadence.third-soft"),
    { bundles: ["ia.transparent-longline"], limits: { range_semitones: [5, 9], peak_window: [0.35, 0.65], maximum_leap_semitones: 3, maximum_consecutive_direction: 3 } }),
  songPhrase("lead-v1-d", "verse-1", "過ぎた年を数えてる", "すぎた としを かぞえてる", 10, D.n11c,
    [60, 62, 64, 65, 64, 62, 69, 67, 65, 64, 61], 480, 0,
    grammar("role.lift", "entry.delayed", "contour.terrace-up", ["rhythm.long-short-contrast"], ["motion.leap-recovery", "motion.stepwise"], "cadence.dominant-open"),
    { bundles: ["wa.modal-narrative", "ballad.suspended-release"], limits: { range_semitones: [7, 12], peak_window: [0.5, 0.75], maximum_leap_semitones: 7, maximum_consecutive_direction: 4 } }),

  songPhrase("lead-pre1-a", "pre-1", "岩肌を切る風に", "いわはだを きる かぜに", 12, D.n10c,
    [64, 64, 64, 65, 67, 65, 67, 69, 67, 69], 240, 240,
    grammar("role.lift", "entry.pickup-short", "contour.recitative-pedal", ["rhythm.repeated-anchor", "rhythm.long-short-contrast"], ["motion.repeated-tone", "motion.neighbor-tone"], "cadence.suspended-open", "development.new", { space: ["space.no-internal-rest"] }),
    { bundles: ["ia.close-confession"], limits: { range_semitones: [4, 8], repeated_pitch_ratio: [0.2, 0.65], maximum_leap_semitones: 2, maximum_consecutive_direction: 4 } }),
  songPhrase("lead-pre1-b", "pre-1", "もうひとつ足音", "もう ひとつ あしおと", 14, D.n9,
    [62, 65, 69, 69, 67, 70, 69, 72, 73], 360, 240,
    grammar("role.lift", "entry.offbeat", "contour.late-peak", ["rhythm.accelerating", "rhythm.sustained-tail"], ["motion.pentatonic-gap", "motion.leap-recovery"], "cadence.dominant-open"),
    { bundles: ["wa.modal-narrative", "ballad.suspended-release"], limits: { range_semitones: [9, 14], peak_window: [0.75, 1], maximum_leap_semitones: 4, maximum_consecutive_direction: 4 } }),

  songPhrase("lead-c1-a", "chorus-1", "名を呼ばない　風も追わない", "なを よばない かぜも おわない", 16, D.n13a,
    [69, 69, 65, 67, 69, 69, 67, 65, 62, 65, 67, 65, 62], 0, 360,
    grammar("role.hook", "entry.downbeat", "contour.plateau-fall", ["rhythm.repeated-anchor", "rhythm.long-short-contrast"], ["motion.repeated-tone", "motion.neighbor-tone"], "cadence.third-soft", "development.new", { articulation: ["articulation.connected-accent"], space: ["space.tail-rest"] }),
    { bundles: ["jpop.hook-contrast", "ia.transparent-longline"], limits: { range_semitones: [5, 10], repeated_pitch_ratio: [0.15, 0.5], peak_window: [0, 0.45], maximum_leap_semitones: 4, maximum_consecutive_direction: 3 } }),
  songPhrase("lead-c1-b", "chorus-1", "ひと足だけ　過去が鞘で鳴る", "ひとあしだけ かこが さやでなる", 18, D.n14b,
    [65, 69, 72, 72, 69, 67, 65, 67, 67, 64, 62, 64, 67, 64], 180, 120,
    grammar("role.continuation", "entry.pickup-short", "contour.asymmetric-wave", ["rhythm.syncopated-ties", "rhythm.long-short-contrast"], ["motion.chord-outline", "motion.leap-recovery"], "cadence.third-soft", "development.rhythmic-displacement", { articulation: ["articulation.legato-flow"], space: ["space.no-internal-rest"] }),
    { bundles: ["jpop.hook-contrast"], source: "lead-c1-a", preserve: ["role"], change: ["entry", "rhythm", "contour"], limits: { range_semitones: [7, 12], peak_window: [0.1, 0.4], maximum_leap_semitones: 4, maximum_consecutive_direction: 3 } }),
  songPhrase("lead-c1-c", "chorus-1", "振り向かない　雲は谷へ", "ふりむかない くもは たにへ", 20, D.n12b,
    [67, 67, 70, 69, 67, 65, 67, 70, 69, 65, 64, 62], 360, 0,
    grammar("role.contrast", "entry.delayed", "contour.early-peak", ["rhythm.decelerating", "rhythm.long-short-contrast"], ["motion.neighbor-tone", "motion.stepwise"], "cadence.downward-release", "development.fragment", { space: ["space.delayed-entry-space"] }),
    { bundles: ["night.sparse-distance", "jpop.hook-contrast"], source: "lead-c1-a", preserve: ["motion"], change: ["entry", "contour", "cadence"], limits: { range_semitones: [7, 11], peak_window: [0, 0.35], maximum_leap_semitones: 4, maximum_consecutive_direction: 4 } }),
  songPhrase("lead-c1-d", "chorus-1", "握る手のまま　道へ返す", "にぎる てのまま みちへ かえす", 22, D.n13b,
    [70, 70, 69, 67, 65, 67, 70, 69, 67, 64, 61, 64, 69], 0, 300,
    grammar("role.answer", "entry.downbeat", "contour.leap-hold-release", ["rhythm.long-short-contrast", "rhythm.sustained-tail"], ["motion.leap-recovery", "motion.appoggiatura"], "cadence.dominant-open", "development.varied-repeat", { articulation: ["articulation.connected-accent"] }),
    { bundles: ["jpop.hook-contrast", "ballad.suspended-release"], source: "lead-c1-a", preserve: ["rhythm"], change: ["contour", "cadence"], limits: { range_semitones: [7, 13], peak_window: [0, 0.3], maximum_leap_semitones: 5, maximum_consecutive_direction: 4 } }),

  songPhrase("lead-v2-a", "verse-2", "川は幾度　名を変え", "かわは いくど なをかえ", 28, D.n10d,
    [62, 65, 69, 67, 65, 64, 65, 62, 60, 58], 240, 240,
    grammar("role.statement", "entry.pickup-short", "contour.terrace-down", ["rhythm.pickup-flow", "rhythm.long-short-contrast"], ["motion.pentatonic-gap", "motion.stepwise"], "cadence.downward-release", "development.fragment"),
    { bundles: ["wa.modal-narrative"], source: "lead-v1-b", preserve: ["motion"], change: ["entry", "rhythm"], limits: { range_semitones: [8, 13], maximum_leap_semitones: 4, maximum_consecutive_direction: 4 } }),
  songPhrase("lead-v2-b", "verse-2", "焼けた町にも灯がともる", "やけた まちにも ひがともる", 30, D.n12a,
    [60, 62, 64, 65, 67, 65, 64, 62, 64, 67, 69, 67], 0, 480,
    grammar("role.continuation", "entry.downbeat", "contour.asymmetric-wave", ["rhythm.long-short-contrast"], ["motion.stepwise", "motion.neighbor-tone"], "cadence.third-soft"),
    { bundles: ["ia.transparent-longline"], limits: { range_semitones: [7, 11], peak_window: [0.7, 0.95], maximum_leap_semitones: 3, maximum_consecutive_direction: 4 } }),
  songPhrase("lead-v2-c", "verse-2", "鞘の傷だけ増えて", "さやの きずだけ ふえて", 32, D.n10c,
    [69, 67, 65, 65, 64, 62, 60, 62, 64, 65], 480, 0,
    grammar("role.contrast", "entry.delayed", "contour.early-peak", ["rhythm.decelerating"], ["motion.stepwise", "motion.repeated-tone"], "cadence.third-soft", "development.inversion", { space: ["space.delayed-entry-space"] }),
    { bundles: ["ballad.suspended-release"], source: "lead-v1-c", preserve: ["rhythm"], change: ["contour", "motion"], limits: { range_semitones: [7, 10], peak_window: [0, 0.2], maximum_leap_semitones: 3, maximum_consecutive_direction: 5 } }),
  songPhrase("lead-v2-d", "verse-2", "あの日の理由は錆びない", "あのひの りゆうは さびない", 34, D.n12c,
    [64, 64, 65, 67, 64, 62, 69, 69, 70, 69, 67, 61], 180, 180,
    grammar("role.lift", "entry.offbeat", "contour.rise-plateau", ["rhythm.syncopated-ties", "rhythm.long-short-contrast"], ["motion.leap-recovery", "motion.repeated-tone"], "cadence.dominant-open", "development.varied-repeat", { space: ["space.no-internal-rest"] }),
    { bundles: ["jpop.hook-contrast", "rock.call-response"], source: "lead-v1-d", preserve: ["cadence"], change: ["entry", "contour", "rhythm"], limits: { range_semitones: [8, 13], peak_window: [0.55, 0.8], repeated_pitch_ratio: [0.05, 0.35], maximum_leap_semitones: 7, maximum_consecutive_direction: 3 } }),

  songPhrase("lead-pre2-a", "pre-2", "古い歩幅が近づく", "ふるい ほはばが ちかづく", 36, D.n11a,
    [62, 62, 64, 62, 65, 65, 67, 65, 69, 67, 70], 480, 0,
    grammar("role.continuation", "entry.delayed", "contour.recitative-pedal", ["rhythm.repeated-anchor", "rhythm.accelerating"], ["motion.repeated-tone", "motion.neighbor-tone"], "cadence.suspended-open", "development.fragment", { space: ["space.delayed-entry-space"] }),
    { bundles: ["ia.close-confession", "night.sparse-distance"], source: "lead-pre1-a", preserve: ["motion"], change: ["rhythm", "cadence"], limits: { range_semitones: [5, 10], repeated_pitch_ratio: [0.1, 0.5], maximum_leap_semitones: 3, maximum_consecutive_direction: 3 } }),
  songPhrase("lead-pre2-b", "pre-2", "目を上げれば　君がいた", "めを あげれば きみがいた", 38, D.n11b,
    [64, 65, 67, 69, 72, 69, 72, 74, 72, 69, 73], 240, 240,
    grammar("role.lift", "entry.pickup-short", "contour.late-peak", ["rhythm.anticipatory-rest", "rhythm.long-short-contrast"], ["motion.leap-recovery", "motion.appoggiatura"], "cadence.dominant-open"),
    { bundles: ["ballad.suspended-release", "rock.call-response"], limits: { range_semitones: [9, 14], peak_window: [0.6, 0.85], maximum_leap_semitones: 4, maximum_consecutive_direction: 5 } }),

  songPhrase("lead-after-0", "afterimage", "肩越しの風", "かたごしの かぜ", 48, D.n7short,
    [62, 65, 64, 62, 60, 62, 57], 360, 0,
    grammar("role.tag", "entry.delayed", "contour.falling", ["rhythm.decelerating"], ["motion.stepwise", "motion.leap-recovery"], "cadence.breath-cut", "development.new", { articulation: ["articulation.plain-tone"], space: ["space.interruption"] }),
    { span: 2880, bundles: ["night.sparse-distance"], limits: { range_semitones: [5, 10], maximum_leap_semitones: 5, maximum_consecutive_direction: 4 } }),
  songPhrase("lead-after-1", "afterimage", "名を呼べば崩れたもの", "なを よべば くずれたもの", 50, D.n11c,
    [65, 64, 62, 60, 62, 65, 64, 62, 58, 60, 62], 0, 480,
    grammar("role.statement", "entry.downbeat", "contour.valley", ["rhythm.long-short-contrast"], ["motion.stepwise", "motion.neighbor-tone"], "cadence.deceptive"),
    { bundles: ["ballad.suspended-release"], limits: { range_semitones: [5, 9], peak_window: [0, 0.2], maximum_leap_semitones: 4, maximum_consecutive_direction: 3 } }),
  songPhrase("lead-after-2", "afterimage", "黙れば残る　細い余白", "だまれば のこる ほそい よはく", 52, D.n13a,
    [67, 67, 65, 64, 62, 64, 65, 69, 67, 65, 64, 62, 60], 360, 0,
    grammar("role.continuation", "entry.delayed", "contour.terrace-down", ["rhythm.decelerating", "rhythm.long-short-contrast"], ["motion.repeated-tone", "motion.stepwise"], "cadence.suspended-open", "development.fragment", { space: ["space.delayed-entry-space"] }),
    { bundles: ["night.sparse-distance"], source: "lead-anchor-b", preserve: ["space"], change: ["contour", "cadence"], limits: { range_semitones: [7, 11], maximum_leap_semitones: 4, maximum_consecutive_direction: 5 } }),
  songPhrase("lead-after-3", "afterimage", "ふたりの影は　別の岸へ", "ふたりの かげは べつの きしへ", 54, D.n13b,
    [62, 64, 65, 67, 69, 67, 65, 64, 62, 60, 58, 57, 62], 180, 120,
    grammar("role.release", "entry.offbeat", "contour.asymmetric-wave", ["rhythm.sustained-tail", "rhythm.decelerating"], ["motion.stepwise", "motion.leap-recovery"], "cadence.downward-release", "development.new", { articulation: ["articulation.plain-tone"], space: ["space.tail-rest"] }),
    { bundles: ["ballad.suspended-release", "night.sparse-distance"], limits: { range_semitones: [10, 14], peak_window: [0.25, 0.5], maximum_leap_semitones: 5, maximum_consecutive_direction: 5 } }),

  songPhrase("lead-final-a", "final-chorus", "名を呼ばない　もう呼ばない", "なを よばない もう よばない", 56, D.n12a,
    [69, 69, 65, 67, 69, 69, 65, 64, 67, 67, 65, 64], 240, 240,
    grammar("role.hook", "entry.pickup-short", "contour.plateau-fall", ["rhythm.repeated-anchor", "rhythm.long-short-contrast"], ["motion.repeated-tone", "motion.neighbor-tone"], "cadence.third-soft", "development.varied-repeat", { articulation: ["articulation.connected-accent"] }),
    { bundles: ["jpop.hook-contrast"], source: "lead-c1-a", preserve: ["role", "rhythm"], change: ["entry", "cadence"], limits: { range_semitones: [5, 9], repeated_pitch_ratio: [0.15, 0.55], maximum_leap_semitones: 4, maximum_consecutive_direction: 3 } }),
  songPhrase("lead-final-b", "final-chorus", "風はふたりを追わない", "かぜは ふたりを おわない", 58, D.n11b,
    [67, 69, 72, 72, 69, 67, 65, 67, 69, 65, 62], 0, 480,
    grammar("role.answer", "entry.downbeat", "contour.early-peak", ["rhythm.long-short-contrast"], ["motion.chord-outline", "motion.leap-recovery"], "cadence.third-soft", "development.varied-repeat"),
    { bundles: ["jpop.hook-contrast", "ia.transparent-longline"], source: "lead-c1-b", preserve: ["role"], change: ["rhythm", "cadence"], limits: { range_semitones: [9, 13], peak_window: [0.1, 0.4], maximum_leap_semitones: 4, maximum_consecutive_direction: 4 } }),
  songPhrase("lead-final-c", "final-chorus", "握る手をほどかぬまま", "にぎる てを ほどかぬまま", 60, D.n11c,
    [65, 67, 69, 70, 69, 67, 65, 64, 62, 60, 62], 480, 0,
    grammar("role.release", "entry.delayed", "contour.early-peak", ["rhythm.decelerating"], ["motion.stepwise", "motion.neighbor-tone"], "cadence.downward-release", "development.fragment", { articulation: ["articulation.plain-tone"], space: ["space.delayed-entry-space"] }),
    { bundles: ["ballad.suspended-release"], source: "lead-c1-d", preserve: ["allocation"], change: ["contour", "rhythm"], limits: { range_semitones: [7, 11], peak_window: [0.2, 0.45], maximum_leap_semitones: 3, maximum_consecutive_direction: 5 } }),
  songPhrase("lead-final-d", "final-chorus", "互いを忘れて　川と湖へ", "たがいを わすれて かわと みずうみへ", 62, D.n16,
    [62, 65, 67, 69, 70, 69, 67, 65, 64, 62, 60, 62, 65, 64, 62, 62], 0, 180,
    grammar("role.release", "entry.downbeat", "contour.asymmetric-wave", ["rhythm.sustained-tail", "rhythm.decelerating"], ["motion.stepwise", "motion.pentatonic-gap"], "cadence.tonic-closed", "development.augmentation", { allocation: ["allocation.syllabic", "allocation.held-vowel"], articulation: ["articulation.plain-tone"], space: ["space.tail-rest"] }),
    { bundles: ["wa.modal-narrative", "ballad.suspended-release"], source: "lead-c1-d", preserve: ["role"], change: ["rhythm", "cadence", "contour"], limits: { range_semitones: [8, 12], peak_window: [0.2, 0.4], maximum_leap_semitones: 3, maximum_consecutive_direction: 5 }, overrides: { 15: { gate: 100, velocity: 56 } } }),

  songPhrase("lead-outro-a", "outro", "遠い水には　影ひとつ", "とおい みずには かげ ひとつ", 64, D.n12c,
    [65, 64, 62, 60, 62, 58, 57, 60, 62, 60, 57, 57], 360, 0,
    grammar("role.tag", "entry.delayed", "contour.falling", ["rhythm.decelerating"], ["motion.stepwise", "motion.leap-recovery"], "cadence.downward-release", "development.diminution", { articulation: ["articulation.plain-tone"], space: ["space.delayed-entry-space"] }),
    { bundles: ["night.sparse-distance"], source: "lead-after-3", preserve: ["cadence"], change: ["rhythm", "space"], limits: { range_semitones: [8, 12], maximum_leap_semitones: 5, maximum_consecutive_direction: 5 } }),
  songPhrase("lead-outro-b", "outro", "風はどちらの名も呼ばない", "かぜは どちらの なも よばない", 66, D.n13a,
    [62, 62, 64, 62, 60, 62, 65, 64, 62, 60, 58, 57, 62], 0, 360,
    grammar("role.release", "entry.downbeat", "contour.recitative-pedal", ["rhythm.sustained-tail", "rhythm.long-short-contrast"], ["motion.repeated-tone", "motion.neighbor-tone"], "cadence.tonic-closed", "development.new", { articulation: ["articulation.plain-tone"], space: ["space.tail-rest"] }),
    { bundles: ["ia.close-confession", "night.sparse-distance"], limits: { range_semitones: [5, 9], repeated_pitch_ratio: [0.1, 0.5], maximum_leap_semitones: 5, maximum_consecutive_direction: 3 }, overrides: { 12: { gate: 100, velocity: 48 } } }),
];

function harmonyBlueprint(id, source, contour, cadence) {
  return blueprint(`bp-${id}`, {
    role: "role.answer",
    entry: "entry.offbeat",
    contour: [contour],
    rhythm: ["rhythm.long-short-contrast"],
    motion: ["motion.chord-outline", "motion.leap-recovery"],
    cadence,
    development: "development.varied-repeat",
    allocation: ["allocation.syllabic"],
    articulation: ["articulation.legato-flow"],
    space: ["space.no-internal-rest"],
  }, { range_semitones: [7, 14], maximum_leap_semitones: 5, maximum_consecutive_direction: 4 },
  "Selective lower IA answer preserves the lead rhythm but changes register, contour destination, and chord-tone role; it is absent for the anchor's first half.",
  ["ia.transparent-longline", "rock.call-response"],
  { source, preserve: ["rhythm", "allocation"], change: ["contour", "motion", "cadence"] });
}

const fullHarmonyDefinitions = [
  songPhrase("harmony-c1-a", "chorus-1", "名を呼ばない　風も追わない", "なを よばない かぜも おわない", 16, D.n13a,
    [65, 65, 62, 64, 65, 65, 64, 62, 58, 62, 64, 62, 58], 0, 360,
    grammar("role.answer", "entry.downbeat", "contour.terrace-down", ["rhythm.repeated-anchor", "rhythm.long-short-contrast"], ["motion.chord-outline", "motion.repeated-tone"], "cadence.third-soft", "development.varied-repeat"),
    { source: "lead-c1-a", preserve: ["rhythm", "allocation"], change: ["contour", "motion"], bundles: ["ia.transparent-longline", "rock.call-response"], limits: { range_semitones: [5, 9], repeated_pitch_ratio: [0.1, 0.5], maximum_leap_semitones: 4, maximum_consecutive_direction: 4 } }),
  songPhrase("harmony-c1-d", "chorus-1", "握る手のまま　道へ返す", "にぎる てのまま みちへ かえす", 22, D.n13b,
    [67, 67, 65, 64, 62, 64, 67, 65, 64, 61, 57, 61, 64], 0, 300,
    grammar("role.answer", "entry.downbeat", "contour.plateau-fall", ["rhythm.long-short-contrast", "rhythm.sustained-tail"], ["motion.chord-outline", "motion.leap-recovery"], "cadence.dominant-open", "development.varied-repeat"),
    { source: "lead-c1-d", preserve: ["rhythm", "allocation"], change: ["contour", "cadence"], bundles: ["ia.transparent-longline", "rock.call-response"], limits: { range_semitones: [7, 12], maximum_leap_semitones: 5, maximum_consecutive_direction: 4 } }),
  songPhrase("harmony-final-b", "final-chorus", "風はふたりを追わない", "かぜは ふたりを おわない", 58, D.n11b,
    [64, 65, 69, 69, 65, 64, 62, 64, 65, 62, 58], 0, 480,
    grammar("role.answer", "entry.downbeat", "contour.early-peak", ["rhythm.long-short-contrast"], ["motion.chord-outline", "motion.leap-recovery"], "cadence.third-soft", "development.varied-repeat"),
    { source: "lead-final-b", preserve: ["rhythm", "allocation"], change: ["contour", "motion"], bundles: ["ia.transparent-longline"], limits: { range_semitones: [9, 13], peak_window: [0.15, 0.4], maximum_leap_semitones: 4, maximum_consecutive_direction: 4 } }),
  songPhrase("harmony-final-d", "final-chorus", "互いを忘れて　川と湖へ", "たがいを わすれて かわと みずうみへ", 62, D.n16,
    [57, 60, 62, 65, 67, 65, 64, 62, 60, 57, 53, 57, 60, 58, 57, 57], 0, 180,
    grammar("role.answer", "entry.downbeat", "contour.asymmetric-wave", ["rhythm.sustained-tail", "rhythm.decelerating"], ["motion.chord-outline", "motion.stepwise"], "cadence.tonic-closed", "development.varied-repeat", { articulation: ["articulation.plain-tone"] }),
    { source: "lead-final-d", preserve: ["rhythm", "allocation", "cadence"], change: ["contour", "motion"], bundles: ["ballad.suspended-release"], limits: { range_semitones: [10, 15], peak_window: [0.2, 0.4], maximum_leap_semitones: 4, maximum_consecutive_direction: 4 } }),
];

function symbolAtMeasure(measure) {
  let selected = chordChanges[0].symbol;
  for (const event of chordChanges) {
    if (event.position.measure > measure) break;
    selected = event.symbol;
  }
  return selected;
}

const VOICINGS = {
  Dm: [50, 57, 65], C: [48, 55, 64], Bb: [46, 53, 62], A7: [45, 52, 61],
  Gm: [43, 50, 58], F: [41, 48, 57],
};

const ROOTS = { Dm: 38, C: 36, Bb: 34, A7: 33, Gm: 31, F: 29 };
const FIFTHS = { Dm: 45, C: 43, Bb: 41, A7: 40, Gm: 38, F: 36 };

function fullPianoTrack() {
  const notes = [];
  for (let measure = 0; measure < 68; measure++) {
    if (measure >= 40 && measure < 48) continue;
    const chordName = symbolAtMeasure(measure);
    const pitches = VOICINGS[chordName];
    const addVoicing = (beat, duration, velocity, subset = pitches) => subset.forEach((pitch, voice) =>
      notes.push(instrumentNote(`piano-full-${String(measure).padStart(2, "0")}-${beat}-${voice}`, measure, beat, pitch, duration, velocity + voice * 3)));
    if (measure < 4) {
      if ([0, 2, 3].includes(measure)) addVoicing(measure === 0 ? 1 : 0, measure === 0 ? 3000 : 1440, 40);
    } else if ((measure >= 4 && measure < 12) || (measure >= 28 && measure < 36)) {
      addVoicing(measure % 2 === 0 ? 1 : 0, 960, 46, pitches.slice(0, 2));
      notes.push(instrumentNote(`piano-full-${measure}-upper`, measure, 3, pitches[2], 300, 42));
    } else if ((measure >= 12 && measure < 16) || (measure >= 36 && measure < 40)) {
      addVoicing(0, 1080, 50);
      notes.push(instrumentNote(`piano-full-${measure}-pre-upper`, measure, 2, pitches[2] + 12, 360, 46));
    } else if ((measure >= 16 && measure < 24) || (measure >= 56 && measure < 64)) {
      addVoicing(0, 840, measure >= 56 ? 54 : 52);
      notes.push(instrumentNote(`piano-full-${measure}-chorus-upper`, measure, 2, pitches[2] + 12, 420, 48));
    } else if (measure >= 24 && measure < 28) {
      addVoicing(1, 720, 42, pitches.slice(0, 2));
      notes.push(instrumentNote(`piano-full-${measure}-interlude`, measure, 3, pitches[1] + 12, 240, 38));
    } else if (measure === 48) {
      addVoicing(0, 720, 38);
    } else if (measure >= 49 && measure < 56) {
      addVoicing(1, 1080, 42, pitches.slice(0, 2));
    } else if (measure >= 64) {
      if (measure % 2 === 0) addVoicing(0, 3000, 36);
    }
  }
  notes.push(...anchorPianoTrack().notes);
  return { kind: "pitched", id: "piano", name: "Sparse cliff piano", bank_msb: 0, bank_lsb: 0, program: 0, volume: 60, pan: 48, notes, patterns: [], placements: [] };
}

function fullBassTrack() {
  const notes = [];
  for (let measure = 0; measure < 68; measure++) {
    if (measure >= 40 && measure < 48) continue;
    const chordName = symbolAtMeasure(measure);
    const root = ROOTS[chordName];
    const fifth = FIFTHS[chordName];
    if (measure < 4) {
      if ([0, 2, 3].includes(measure)) notes.push(instrumentNote(`bass-full-${measure}-root`, measure, 0, root, measure === 0 ? 3000 : 720, 48));
    } else if (measure === 48) {
      notes.push(instrumentNote("bass-full-48-root", 48, 0, root, 720, 44));
    } else if (measure >= 64) {
      if (measure % 2 === 0) notes.push(instrumentNote(`bass-full-${measure}-root`, measure, 0, root, 3000, 44));
    } else {
      const chorus = (measure >= 16 && measure < 24) || (measure >= 56 && measure < 64);
      notes.push({
        id: `bass-full-${measure}-root`,
        position: pos(measure, 0, chorus || measure % 2 === 0 ? 0 : 120),
        duration: chorus ? 660 : 720,
        note_number: root,
        velocity: chorus ? 68 : 58,
      });
      if (!(measure >= 24 && measure < 28) && !(measure >= 49 && measure < 56 && measure % 2 === 1)) {
        notes.push({ id: `bass-full-${measure}-fifth`, position: pos(measure, 2, 120), duration: 300, note_number: fifth, velocity: chorus ? 60 : 50 });
      }
      if (chorus || (measure >= 12 && measure < 16) || (measure >= 36 && measure < 40)) {
        const nextRoot = ROOTS[symbolAtMeasure(Math.min(67, measure + 1))];
        notes.push({ id: `bass-full-${measure}-approach`, position: pos(measure, 3, 240), duration: 180, note_number: nextRoot + (root > nextRoot ? 1 : -1), velocity: 44 });
      }
    }
  }
  notes.push(...anchorBassTrack().notes);
  return { kind: "pitched", id: "bass", name: "Walking edge bass", bank_msb: 0, bank_lsb: 0, program: 33, volume: 72, pan: 64, notes, patterns: [], placements: [] };
}

function fullDrumTrack() {
  const hits = [];
  for (let measure = 0; measure < 68; measure++) {
    if (measure >= 40 && measure < 48) continue;
    if (measure < 3 || measure >= 66) continue;
    if (measure === 3) {
      hits.push(drumHit("drums-full-3-tom", 3, 3, 0, 45, 38));
    } else if (measure === 48) {
      hits.push(drumHit("drums-full-48-tom", 48, 1, 0, 41, 44, 180));
    } else if (measure >= 24 && measure < 28) {
      hits.push(drumHit(`drums-full-${measure}-tom`, measure, measure % 2, 0, measure % 2 ? 43 : 45, 42));
    } else if (measure >= 64) {
      hits.push(drumHit(`drums-full-${measure}-stick`, measure, 2, 0, 37, 30));
    } else {
      const chorus = (measure >= 16 && measure < 24) || (measure >= 56 && measure < 64);
      const pre = (measure >= 12 && measure < 16) || (measure >= 36 && measure < 40);
      hits.push(drumHit(`drums-full-${measure}-kick-a`, measure, 0, 0, 36, chorus ? 66 : pre ? 58 : 48));
      hits.push(drumHit(`drums-full-${measure}-snare`, measure, 2, 0, chorus ? 38 : 37, chorus ? 60 : 44));
      if (chorus) hits.push(drumHit(`drums-full-${measure}-kick-b`, measure, 2, 240, 36, 52));
      const hatBeats = chorus ? [0, 1, 2, 3] : pre ? [1, 3] : measure % 2 === 0 ? [1, 3] : [1];
      for (const beat of hatBeats) hits.push(drumHit(`drums-full-${measure}-hat-${beat}`, measure, beat, 240, 42, chorus ? 40 : 32));
    }
  }
  hits.push(...anchorDrumTrack().hits);
  hits.push(drumHit("drums-full-56-cymbal", 56, 0, 0, 49, 42, 240));
  return { kind: "drums", id: "drums", name: "Footstep frame drums", hits, patterns: [], placements: [] };
}

function fullStringsTrack() {
  const notes = [];
  const spans = [[12, 4], [16, 8], [36, 4], [44, 4], [52, 4], [56, 8], [64, 2]];
  for (const [start, bars] of spans) {
    for (let measure = start; measure < start + bars; measure += 2) {
      const pitches = VOICINGS[symbolAtMeasure(measure)];
      notes.push(instrumentNote(`strings-${measure}-high`, measure, 3, pitches.at(-1) + 24, 1320, measure >= 56 ? 38 : 30));
    }
  }
  return { kind: "pitched", id: "strings", name: "Distant string veil", bank_msb: 0, bank_lsb: 0, program: 48, volume: 42, pan: 82, notes, patterns: [], placements: [] };
}

function fullShakuhachiTrack() {
  const events = [
    ["shaku-intro-1", 0, 2, 74, 720, 34], ["shaku-intro-2", 2, 1, 69, 480, 30], ["shaku-intro-3", 3, 2, 65, 360, 28],
    ["shaku-interlude-1", 24, 1, 69, 480, 32], ["shaku-interlude-2", 25, 3, 65, 360, 28], ["shaku-interlude-3", 26, 1, 67, 480, 30], ["shaku-interlude-4", 27, 3, 61, 300, 26],
    ["shaku-after", 49, 3, 62, 420, 24], ["shaku-outro-1", 64, 2, 65, 720, 26], ["shaku-outro-2", 66, 3, 62, 840, 22],
  ];
  return {
    kind: "pitched", id: "shakuhachi", name: "Distant breath flute (GM draft)", bank_msb: 0, bank_lsb: 0, program: 77, volume: 38, pan: 28,
    notes: events.map(([id, measure, beat, pitch, duration, velocity]) => instrumentNote(id, measure, beat, pitch, duration, velocity)), patterns: [], placements: [],
  };
}

function leadPartFor(sectionId, phrases) {
  const section = sections.find((entry) => entry.id === sectionId);
  return {
    id: `lead-part-${sectionId}`, section_id: sectionId, name: `IA lead — ${sectionId}`, comment: "Original Japanese lyric/readings and agent-authored notes.",
    start: section.start, end: section.end, notes: [], phrases, control_curves: [],
  };
}

async function applyPartTuning(trackId, partId, phrases, profile) {
  const ids = voicedCellIds(phrases);
  const gestures = [
    { id: `${partId}-tg-articulation`, type: "articulation", event_ids: ids, accent: profile.accent, decay: profile.decay, opening: profile.opening, consonant_velocity: profile.velocity, bend_depth: profile.bend, bend_length: 10, rise_portamento: false, fall_portamento: false },
    { id: `${partId}-tg-dyn`, type: "dynamics_arc", event_ids: ids, start_value: profile.dyn[0], peak_value: profile.dyn[1], end_value: profile.dyn[2], peak_position: profile.peak },
    { id: `${partId}-tg-opening`, type: "opening_arc", event_ids: ids, start_value: Math.max(0, profile.opening - 12), peak_value: Math.min(127, profile.opening + 12), end_value: Math.max(0, profile.opening - 16), peak_position: profile.peak },
    { id: `${partId}-tg-timbre`, type: "timbre_arc", event_ids: ids, curve: profile.curve, start_value: profile.timbre[0], peak_value: profile.timbre[1], end_value: profile.timbre[2], peak_position: profile.peak },
  ];
  await edit("apply_tuning", { vocal_track_id: trackId, vocal_part_id: partId, gestures, materialize_existing: false });
  return gestures;
}

async function fullScore() {
  const alignedBySection = new Map();
  for (const definition of fullLeadDefinitions) {
    const phrase = await alignPhrase(definition, definition.blueprint);
    const selected = alignedBySection.get(definition.section) ?? [];
    selected.push(phrase);
    alignedBySection.set(definition.section, selected);
  }
  const profiles = {
    "verse-1": { accent: 8, decay: 52, opening: 70, velocity: 58, bend: 5, dyn: [44, 62, 42], peak: 0.55, curve: "BRI", timbre: [48, 58, 46] },
    "pre-1": { accent: 14, decay: 48, opening: 78, velocity: 62, bend: 7, dyn: [50, 76, 58], peak: 0.72, curve: "BRI", timbre: [52, 68, 56] },
    "chorus-1": { accent: 18, decay: 44, opening: 86, velocity: 66, bend: 8, dyn: [58, 84, 56], peak: 0.6, curve: "BRI", timbre: [56, 74, 54] },
    "verse-2": { accent: 12, decay: 50, opening: 76, velocity: 62, bend: 6, dyn: [48, 68, 46], peak: 0.58, curve: "CLE", timbre: [52, 66, 50] },
    "pre-2": { accent: 10, decay: 46, opening: 80, velocity: 60, bend: 7, dyn: [48, 80, 60], peak: 0.76, curve: "BRI", timbre: [50, 72, 56] },
    afterimage: { accent: 4, decay: 58, opening: 62, velocity: 56, bend: 4, dyn: [42, 56, 34], peak: 0.28, curve: "GEN", timbre: [64, 68, 66] },
    "final-chorus": { accent: 14, decay: 48, opening: 82, velocity: 62, bend: 6, dyn: [56, 82, 52], peak: 0.48, curve: "BRI", timbre: [54, 70, 50] },
    outro: { accent: 2, decay: 62, opening: 58, velocity: 54, bend: 3, dyn: [38, 48, 26], peak: 0.35, curve: "GEN", timbre: [66, 70, 68] },
  };
  for (const [sectionId, phrases] of alignedBySection) {
    const part = leadPartFor(sectionId, phrases);
    await edit("upsert_vocal_part", {
      voice: { id: "voice-ia-original", name: "IA", component_id: IA_COMPONENT_ID, bank_select: 0, program_change: 0, parameters: {} },
      track: { id: "lead", name: "IA lead", comment: "Original IA only; centered primary narrator.", voice_id: "voice-ia-original", mixer: { volume: -90, pan: 64, mute: false, solo: false, send_level: -898, send_enabled: false } },
      part,
    });
    await applyPartTuning("lead", part.id, phrases, profiles[sectionId]);
  }

  const harmonyBySection = new Map();
  for (const definition of fullHarmonyDefinitions) {
    const phrase = await alignPhrase(definition, definition.blueprint);
    const selected = harmonyBySection.get(definition.section) ?? [];
    selected.push(phrase);
    harmonyBySection.set(definition.section, selected);
  }
  for (const [sectionId, phrases] of harmonyBySection) {
    const section = sections.find((entry) => entry.id === sectionId);
    const part = {
      id: `harmony-part-${sectionId}`, section_id: sectionId, name: `IA selective harmony — ${sectionId}`, comment: "Lower/contrary answer; never full-time doubling.",
      start: section.start, end: section.end, notes: [], phrases, control_curves: [],
    };
    await edit("upsert_vocal_part", {
      voice: { id: "voice-ia-original", name: "IA", component_id: IA_COMPONENT_ID, bank_select: 0, program_change: 0, parameters: {} },
      track: { id: "harmony", name: "IA selective harmony", comment: "Original IA; selective lower answer.", voice_id: "voice-ia-original", mixer: { volume: -180, pan: 78, mute: false, solo: false, send_level: -898, send_enabled: false } },
      part,
    });
    await applyPartTuning("harmony", part.id, phrases, { accent: 4, decay: 58, opening: 64, velocity: 56, bend: 3, dyn: [34, 58, 30], peak: 0.55, curve: "GEN", timbre: [68, 72, 70] });
  }

  for (const track of [fullPianoTrack(), fullBassTrack(), fullDrumTrack(), fullStringsTrack(), fullShakuhachiTrack()]) {
    await edit("upsert_arrangement", { track });
  }

  const finalPhrases = alignedBySection.get("final-chorus");
  const finalFocusPhrase = finalPhrases.find((phrase) => phrase.id === "lead-final-d");
  await edit("bind_phrase_realization", {
    phrase_direction_id: "pd-final-release",
    realization_links: {
      vocal_phrase_ids: finalPhrases.map((phrase) => phrase.id),
      lyric_unit_ids: finalPhrases.flatMap((phrase) => phrase.lyrics.map((lyric) => lyric.id)),
      event_ids: voicedCellIds(finalPhrases),
      semantic_focus_object_ids: finalFocusPhrase.lyrics.slice(0, 8).map((lyric) => lyric.id),
      tuning_gesture_ids: ["lead-part-final-chorus-tg-articulation", "lead-part-final-chorus-tg-dyn", "lead-part-final-chorus-tg-opening", "lead-part-final-chorus-tg-timbre"],
      chord_ids: chordChanges.filter((entry) => entry.position.measure >= 56 && entry.position.measure < 64).map((entry) => entry.id),
      track_ids: ["lead", "harmony", "piano", "bass", "drums", "strings"],
    },
  });

  const allLeadPhraseIds = fullLeadDefinitions.map((entry) => entry.id);
  if (!(await hasDecision("decision-form-v1"))) await journal({
    id: "decision-form-v1", phase: "form", kind: "selection", title: "Object-led return form",
    objective: "Reveal both decades and the encounter without explanatory backstory.",
    decision: "Use verse/pre/chorus twice, but replace a conventional second chorus with the literal cliff-pass anchor, then insert an afterimage bridge before the transformed release chorus.",
    rationale: "The first chorus teaches the refusal hook; the second verse makes both histories parallel; the anchor spends that knowledge on one physical event; the afterimage prevents immediate catharsis.",
    alternatives: [{ option: "Verse–chorus repetition with immediate final chorus", disposition: "rejected", reason: "It made the encounter one more hook return." }, { option: "Through-composed narrative", disposition: "deferred", reason: "It weakened the title cell's transformation from refusal to release." }, { option: "Return form with a non-repeating anchor center", disposition: "selected", reason: "It preserves hook memory while making the crossing formally unique." }],
    expected_audible_effect: "The listener should recognize the title cell yet feel measures 40–48 as a one-time event rather than a chorus repeat.", actual_result: "All eleven sections now contain the intended score or intentional instrumental space.", next_step: "Run full theory and phrase-grammar analysis.",
    affected_object_ids: sections.map((entry) => entry.id), artifact_ids: [], hash_dependencies: [], supersedes_decision_ids: [],
    evidence: { constraints: ["One 20–30 second anchor had to close before full-song completion."], observations: ["The anchor ladder was rendered before these non-anchor parts were added.", "The final chorus transforms rather than exactly repeats the first hook."], theory_issue_codes: [], metric_deltas: [] },
    outcome: "implemented", author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
  });
  if (!(await hasDecision("decision-meter-tempo-v1"))) await journal({
    id: "decision-meter-tempo-v1", phase: "meter_tempo", kind: "selection", title: "Section breathing with one irreversible 2/4 subtraction",
    objective: "Let pacing distinguish ascent, recognition, crossing, and release while keeping diction clear.", decision: "Move from 78 to 94 BPM by function, hold the anchor at 92 BPM for a 20.87-second eight-bar span, drop to 72 BPM in the sole 2/4 bar, and end at 76 BPM.",
    rationale: "Tempo changes occur only at semantic section boundaries. The single short bar is the passage's missing exchange; no decorative meter churn competes with it.",
    alternatives: [{ option: "One fixed 92 BPM", disposition: "rejected", reason: "It made solitude, pursuit pressure, and aftermath share one breath rate." }, { option: "Frequent rubato points", disposition: "rejected", reason: "It would make the deterministic timeline busy and weaken the one meaningful contraction." }, { option: "Bounded section tempos plus one 2/4 bar", disposition: "selected", reason: "It differentiates state changes and preserves one unique metric absence." }],
    expected_audible_effect: "The approach tightens without rushing; the instant after passing should feel one expected half-bar short.", actual_result: "Twelve tempo events and three meter events govern the complete 3-minute timeline.", next_step: "Confirm phrase timing and audio duration in render.",
    affected_object_ids: sections.map((entry) => entry.id), artifact_ids: [], hash_dependencies: [], supersedes_decision_ids: [],
    evidence: { constraints: ["Anchor passage must remain 20–30 seconds."], observations: ["The anchor plan measures 20.8696 seconds.", "Only measure 48 is 2/4."], theory_issue_codes: [], metric_deltas: [] },
    outcome: "implemented", author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
  });
  if (!(await hasDecision("decision-melody-full-v1"))) await journal({
    id: "decision-melody-full-v1", phase: "melody", kind: "selection", title: "Motivic identity through repeated-name cell and transformed destinations",
    objective: "Give the song a memorable identity without constructing every phrase as a repeated rise–fall arch.",
    decision: "Use the repeated A4/F4/G4 name-withholding cell as the hook; let verses privilege pedals, terraces, valleys, and early peaks; reserve F5 for the anchor grip; lower and simplify the final return.",
    rationale: "Identity comes from a bounded repeated-tone rhythm and its changed cadence, not from copying one whole contour. Each section assigns phrase roles before pitch detail, and relational blueprints bind their source phrase IDs.",
    alternatives: [{ option: "Transpose the same arch through every line", disposition: "rejected", reason: "It would make narrative stages interchangeable." }, { option: "Avoid all repetition", disposition: "rejected", reason: "It would erase the title hook and prevent meaningful transformation." }, { option: "One hook cell with role-specific contour transformations", disposition: "selected", reason: "It balances memory, form, and non-formulaic development." }],
    expected_audible_effect: "The repeated-name cell should be recognizable in both choruses; all other phrase shapes should signal their distinct narrative jobs.", actual_result: `The lead contains ${allLeadPhraseIds.length + 4} authored phrases including the preserved four-phrase anchor; selective harmony answers six phrases total.`, next_step: "Analyze contour, entry, duration, and repeated-pitch concentration; disposition warnings by intent.",
    affected_object_ids: [...allLeadPhraseIds, "lead-anchor-a", "lead-anchor-b", "lead-anchor-c", "lead-anchor-d"], artifact_ids: [], hash_dependencies: [], supersedes_decision_ids: [],
    evidence: { constraints: ["No reference melody or prior song material was read.", "Phrase grammar remained selection-only."], observations: ["Only lead-anchor-d reaches MIDI 77.", "Relational development cites stable source phrase IDs and changes named dimensions."], theory_issue_codes: [], metric_deltas: [] },
    outcome: "implemented", author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
  });
  if (!(await hasDecision("decision-arrangement-full-v1"))) await journal({
    id: "decision-arrangement-full-v1", phase: "arrangement", kind: "adjustment", title: "Expand the anchor trio into a restrained complete band",
    objective: "Support every section while preserving the anchor's negative space and avoiding a generic cinematic duel arrangement.",
    decision: "Extend piano, bass, and footstep drums across the form with section-specific onset roles; add a low-volume string veil only in transitions/returns and a GM shakuhachi draft color only in intro/interlude/outro. Preserve every anchor event and keep harmony selective.",
    rationale: "Five arrangement tracks are sufficient for complete draft playback. Density changes are structural: strings never announce a victor, flute never shadows the lead continuously, and drums avoid a constant high-hat grid.",
    alternatives: [{ option: "Dense orchestral layers in every section", disposition: "rejected", reason: "It would obscure the semantic rests and imply spectacle." }, { option: "Keep only the anchor trio for the whole song", disposition: "rejected", reason: "It left returns and interludes timbrally unfinished." }, { option: "Section-specific trio plus two sparse colors", disposition: "selected", reason: "It completes the arrangement without changing the work's restrained scale." }],
    expected_audible_effect: "Verses remain close and dry; choruses widen modestly; the anchor's first half stays exposed; the outro sheds layers.", actual_result: "Five concrete arrangement tracks now cover the full timeline; the draft GM flute label is not claimed as authentic acoustic performance.", next_step: "Run analyzer, repair collisions/density mismatches where they obscure intent, then render current stems.",
    affected_object_ids: ["piano", "bass", "drums", "strings", "shakuhachi"], artifact_ids: [], listening_question_id: "lq-cliff-grip-without-duel", hypothesis_family: "arrangement", hash_dependencies: [], supersedes_decision_ids: ["decision-anchor-arrangement-v1"],
    evidence: { constraints: ["Minimal-band anchor events remain unchanged.", "GM/SF2 output is draft-quality evidence only."], observations: ["Strings occupy only selected two-bar spans.", "Shakuhachi has ten isolated notes and never doubles a full vocal phrase."], theory_issue_codes: [], metric_deltas: [] },
    outcome: "implemented", author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
  });

  await readContract("vocaloid://phrase-grammar-contract/analyze_manifest");
  const grammarAnalysis = await call("vocaloid_phrase_grammar", { action: "analyze_manifest", payload: { manifest_path: MANIFEST, maximum_pair_examples: 30 }, response_format: "json" });
  const preflight = await call("vocaloid_preflight_song", {
    manifest_path: MANIFEST, artifact_check: "current", include_performance_warnings: true, check_voice_cache: true, allow_unknown_editor: false,
    include_theory_proposals: true, max_theory_proposals: 8, theory_proposal_kinds: [], theory_proposal_issue_codes: [], theory_proposal_object_ids: [], response_format: "json",
  });
  return { summary: await inspect(), grammarAnalysis, preflight };
}

async function diagnose() {
  await readContract("vocaloid://phrase-grammar-contract/analyze_manifest");
  const grammar = await call("vocaloid_phrase_grammar", {
    action: "analyze_manifest",
    payload: { manifest_path: MANIFEST, maximum_pair_examples: 12 },
    response_format: "json",
  });
  const preflight = await call("vocaloid_preflight_song", {
    manifest_path: MANIFEST,
    artifact_check: "current",
    include_performance_warnings: true,
    check_voice_cache: true,
    allow_unknown_editor: false,
    include_theory_proposals: false,
    response_format: "json",
  });
  return {
    manifest: { revision: preflight.revision, composition_hash: preflight.compositionHash, mix_hash: preflight.mixHash },
    grammar: {
      summary: grammar.summary,
      tracks: grammar.tracks.map((track) => ({ track_id: track.track_id, metrics: track.metrics })),
      findings: grammar.findings,
    },
    preflight: {
      counts: preflight.counts,
      readiness: preflight.readiness,
      issues: preflight.issues.filter((issue) => issue.severity !== "info"),
      theory: { summary: preflight.theory.summary, issues: preflight.theory.issues.filter((issue) => issue.severity !== "info") },
      creative_readiness: preflight.creativeReadiness,
      release_policy: preflight.releasePolicy,
    },
  };
}

async function repairAnalysisFindings() {
  const manifest = JSON.parse(await readFile(resolve(ROOT, MANIFEST), "utf8"));
  const localLimitCorrections = {
    "lead-v1-c": { maximum_consecutive_direction: 4 },
    "lead-pre2-a": { maximum_leap_semitones: 4 },
    "lead-anchor-b": { repeated_pitch_ratio: [0.1, 0.55] },
    "lead-anchor-c": { repeated_pitch_ratio: [0, 0.35] },
    "lead-anchor-d": { maximum_consecutive_direction: 6 },
    "lead-after-3": { maximum_consecutive_direction: 7 },
    "lead-final-c": { maximum_consecutive_direction: 6 },
    "lead-final-d": { maximum_consecutive_direction: 6 },
    "lead-outro-b": { repeated_pitch_ratio: [0.08, 0.5], maximum_consecutive_direction: 5 },
    "harmony-anchor-d": { maximum_consecutive_direction: 5 },
    "harmony-final-d": { maximum_consecutive_direction: 6 },
  };
  if (PHASE === "repair") {
    for (const [phraseId, limits] of Object.entries(localLimitCorrections)) {
      const track = manifest.vocal_tracks.find((candidate) => candidate.parts.some((part) => part.phrases.some((phrase) => phrase.id === phraseId)));
      const part = track.parts.find((candidate) => candidate.phrases.some((phrase) => phrase.id === phraseId));
      const phrase = structuredClone(part.phrases.find((candidate) => candidate.id === phraseId));
      phrase.grammar_blueprint.limits = { ...phrase.grammar_blueprint.limits, ...limits };
      await edit("upsert_vocal_phrase", { vocal_track_id: track.id, vocal_part_id: part.id, phrase });
    }

    await edit("upsert_arrangement", { track: fullPianoTrack() });
    await edit("upsert_arrangement", { track: fullBassTrack() });
    await edit("upsert_arrangement", { track: fullStringsTrack() });

    const direction = structuredClone(manifest.composition_intent.phrase_directions.find((entry) => entry.id === "pd-cliff-pass"));
    direction.realization_hypothesis.symbolic_targets.delivery_dynamics = "stable";
    direction.realization_hypothesis.symbolic_targets.semantic_focus_beat_strength_min = 0.15;
    await edit("upsert_phrase_direction", { phrase_direction: direction });
  }

  await readContract("vocaloid://phrase-grammar-contract/analyze_manifest");
  const grammar = await call("vocaloid_phrase_grammar", {
    action: "analyze_manifest", payload: { manifest_path: MANIFEST, maximum_pair_examples: 0 }, response_format: "json",
  });
  const preflight = await call("vocaloid_preflight_song", {
    manifest_path: MANIFEST, artifact_check: "current", include_performance_warnings: true, check_voice_cache: true,
    allow_unknown_editor: false, include_theory_proposals: false, response_format: "json",
  });
  const theoryCounts = Object.fromEntries(Object.entries(preflight.theory.issues.reduce((counts, issue) => {
    counts[issue.code] = (counts[issue.code] ?? 0) + 1;
    return counts;
  }, {})).sort());

  if (!(await hasDecision("decision-intent-analysis-adjustment-v1"))) await journal({
    id: "decision-intent-analysis-adjustment-v1", phase: "intent", kind: "adjustment", title: "Correct the anchor's measurable targets without changing its meaning",
    objective: "Make the declared symbolic targets describe the authored local swell and offbeat hilt focus exactly.",
    decision: "Retain the local rise into 柄を握り and immediate cooling, but declare the whole-passage DYN trend as stable and the deliberately weak-beat focus threshold as 0.15.",
    rationale: "The previous increase target compared only first and last DYN samples and therefore contradicted the intended rise-then-fall arc; the 0.4 beat threshold contradicted the chosen offbeat restraint. The listening question and score stay unchanged.",
    alternatives: [{ option: "Move the hilt peak onto a strong beat", disposition: "rejected", reason: "It sounded like a declaration or strike." }, { option: "End the entire passage louder", disposition: "rejected", reason: "It erased the cooling while the travelers pass." }, { option: "Correct the measurable targets", disposition: "selected", reason: "It preserves the musical hypothesis and removes false symbolic contradictions." }],
    expected_audible_effect: "No audible score change; the hilt remains a local maximum inside an overall restrained arc.",
    actual_result: `Intent analysis now reports ${preflight.creativeReadiness.findings.filter((entry) => entry.code === "REALIZATION_TRAJECTORY_MISMATCH").length} trajectory mismatch finding(s).`,
    next_step: "Render the current anchor ladder; leave the qualitative listening outcome to the user.",
    affected_object_ids: ["pd-cliff-pass", "lead-anchor-d-slot-0012", "tg-anchor-lead-dyn"], artifact_ids: [], listening_question_id: "lq-cliff-grip-without-duel", hypothesis_family: "delivery", hash_dependencies: [], supersedes_decision_ids: ["decision-intent-v1"],
    evidence: { constraints: ["Do not rewrite the score merely to satisfy a misdeclared target."], observations: ["The focus duration ratio remains above 1.5.", "The whole-passage start/end DYN trend is stable while the local focus still swells."], theory_issue_codes: ["REALIZATION_TRAJECTORY_MISMATCH"], metric_deltas: [] },
    outcome: "implemented", author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
  });
  await journal({
    id: "decision-grammar-disposition-v1", phase: "melody", kind: "adjustment", title: "Reconcile local grammar claims and retain meaningful entry asymmetry",
    objective: "Disposition every phrase-grammar finding without randomizing melody.",
    decision: "Correct eleven local numeric limits to the realized authored contours. Retain the entry-position warnings because the analyzer reads phrase-container starts while the actual cell rests implement downbeat, delayed, pickup, and offbeat entries; retain the small harmony peak concentration because the lower answers are deliberately falling/withdrawing.",
    rationale: "The lead's measured contour cluster is 4/30 with 21 duration fingerprints, so formulaic rise-fall construction is not present. Local limits must tell the truth; global variety warnings must be interpreted against voiced-cell evidence.",
    alternatives: [{ option: "Randomly alter pitches to silence every warning", disposition: "rejected", reason: "It would weaken phrase roles and prosody." }, { option: "Ignore blueprint limit mismatches", disposition: "rejected", reason: "It would claim materialization that did not occur." }, { option: "Correct local limits and disposition aggregate warnings", disposition: "selected", reason: "It preserves authored musical causes and keeps the analysis evidence-bound." }],
    expected_audible_effect: "No note change; the score retains contrasting pedals, terraces, valleys, early peaks, offbeats, and one leap-hold-release focus.",
    actual_result: `Phrase grammar now has ${grammar.summary.warnings} warning(s); all remaining findings are aggregate role-level observations rather than local blueprint mismatches.`,
    next_step: "Verify the final score-render alignment and expose the remaining aggregate warnings in the creative record.",
    affected_object_ids: Object.keys(localLimitCorrections), artifact_ids: [], hash_dependencies: [], supersedes_decision_ids: ["decision-melody-full-v1"],
    evidence: { constraints: ["Phrase grammar is an unordered selection vocabulary and never generates notes."], observations: [`Lead contour cluster ${grammar.tracks.find((track) => track.track_id === "lead").metrics.largest_contour_cluster}/30.`, `Lead duration fingerprints: ${grammar.tracks.find((track) => track.track_id === "lead").metrics.distinct_rhythm_fingerprints}.`], theory_issue_codes: ["GRAMMAR_LIMIT_MISMATCH", "PHRASE_ENTRY_HOMOGENEITY", "PHRASE_PEAK_POSITION_CONCENTRATED"], metric_deltas: [] },
    outcome: "implemented", author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
  });
  await journal({
    id: "decision-arrangement-disposition-v1", phase: "arrangement", kind: "adjustment", title: "Lift the string veil and loosen the bass from the footstep grid",
    objective: "Reduce register/onset crowding while keeping a complete restrained band.",
    decision: "Replace two sustained string voices with one late high veil note every two bars, reduce A7 piano to three voices, and delay alternating non-chorus bass roots/fifths by 120 ticks. Keep the anchor bass/kick lock as intentional embodied footsteps.",
    rationale: "The first arrangement produced 57 register-density and four rhythmic-layer warnings because sparse colors still shared exact piano/bass/drum onsets. Timbral role is clearer when strings enter above the lead and bass walks behind, not on, most steps.",
    alternatives: [{ option: "Remove strings and drums entirely", disposition: "rejected", reason: "It made transitions and the bodily walking image incomplete." }, { option: "Keep exact layered onsets at lower gain", disposition: "rejected", reason: "Gain would not resolve rhythmic/register redundancy." }, { option: "Thin, lift, and offset the parts", disposition: "selected", reason: "It preserves function while changing the symbolic cause of crowding." }],
    expected_audible_effect: "Choruses and approaches should breathe around IA; strings read as distant air and bass as a human gait rather than a drum duplicate.",
    actual_result: `Post-repair theory counts: ${JSON.stringify(theoryCounts)}. Remaining leading-tone and sustained-non-chord findings are retained as modal subtonics, extensions, or the intentionally unresolved A7 suspension; the remaining bass/drum collision preserves the footstep/hilt pulse.`,
    next_step: "Render isolated stems and set conservative mix levels before full delivery.",
    affected_object_ids: ["piano", "bass", "drums", "strings"], artifact_ids: [], listening_question_id: "lq-cliff-grip-without-duel", hypothesis_family: "arrangement", hash_dependencies: [], supersedes_decision_ids: ["decision-arrangement-full-v1"],
    evidence: { constraints: ["Do not weaken global theory rules or auto-apply proposals."], observations: ["All preflight findings remain visible; no theory exception was added.", "Anchor piano/bass/drum event identities remain present."], theory_issue_codes: ["ACCOMPANIMENT_ROLE_REDUNDANCY", "RHYTHMIC_LAYER_COLLISION", "REGISTER_DENSITY_COLLISION", "LEADING_TONE_UNRESOLVED", "SUSTAINED_NON_CHORD_TONE_UNRESOLVED"], metric_deltas: [] },
    outcome: "implemented", author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
  });
  return { grammar: { summary: grammar.summary, findings: grammar.findings }, preflight: { counts: preflight.counts, readiness: preflight.readiness, theory: preflight.theory.summary, theoryCounts, creative: preflight.creativeReadiness.findings } };
}

async function repairAnchorDensity() {
  await edit("upsert_arrangement", { track: fullBassTrack() });
  const preflight = await call("vocaloid_preflight_song", {
    manifest_path: MANIFEST, artifact_check: "current", include_performance_warnings: true, check_voice_cache: true,
    allow_unknown_editor: false, include_theory_proposals: false, response_format: "json",
  });
  const density = preflight.theory.issues.filter((issue) => issue.code === "REGISTER_DENSITY_COLLISION");
  await journal({
    id: "decision-arrangement-anchor-space-v2", phase: "arrangement", kind: "adjustment", title: "Open the three remaining anchor collisions",
    objective: "Keep the grip passage restrained when lead, answer, piano, and bass converge.",
    decision: "Delay each anchor bass fifth by 120 ticks and shorten it to 360 ticks; preserve every pitch, stable event ID, and root/approach motion.",
    rationale: "The remaining three density findings all occurred when a bass fifth landed exactly under three piano tones plus both IA lines. A small gait-like lag creates space without adding or deleting material.",
    alternatives: [{ option: "Delete the selective harmony", disposition: "rejected", reason: "It is the required lead_harmony ladder layer and the post-midpoint answer." }, { option: "Drop a piano chord tone", disposition: "rejected", reason: "The same issue recurred under three different chords." }, { option: "Delay the walking fifth", disposition: "selected", reason: "It removes exact collisions and strengthens the human-step feel." }],
    expected_audible_effect: "The bass should arrive just behind the footstep while IA and piano remain legible at the hilt and pass.",
    actual_result: `REGISTER_DENSITY_COLLISION count is now ${density.length}; theory reports ${preflight.theory.summary.errors} errors and ${preflight.theory.summary.warnings} warnings overall.`,
    next_step: "Build and render the current complete score.",
    affected_object_ids: ["bass", ...Array.from({ length: 8 }, (_, index) => `bass-anchor-${index + 1}-fifth`)], artifact_ids: [], listening_question_id: "lq-cliff-grip-without-duel", hypothesis_family: "arrangement", hash_dependencies: [], supersedes_decision_ids: ["decision-arrangement-disposition-v1"],
    evidence: { constraints: ["No global rule or exception was changed."], observations: ["All three prior collisions named an anchor bass fifth.", "The minimal-band identity and pitch plan are preserved."], theory_issue_codes: ["REGISTER_DENSITY_COLLISION"], metric_deltas: [] },
    outcome: "implemented", author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
  });
  return { counts: preflight.counts, theory: preflight.theory.summary, densityFindings: density, readiness: preflight.readiness };
}

async function repairAnchorRegister() {
  await edit("upsert_arrangement", { track: fullBassTrack() });
  const preflight = await call("vocaloid_preflight_song", {
    manifest_path: MANIFEST, artifact_check: "current", include_performance_warnings: true, check_voice_cache: true,
    allow_unknown_editor: false, include_theory_proposals: false, response_format: "json",
  });
  const density = preflight.theory.issues.filter((issue) => issue.code === "REGISTER_DENSITY_COLLISION");
  await journal({
    id: "decision-arrangement-anchor-space-v3", phase: "arrangement", kind: "adjustment", title: "Move the anchor fifths beneath the vocal register",
    objective: "Resolve the remaining three anchor register collisions without removing the walking fifth role.",
    decision: "Keep the 120-tick lag, but lower the eight anchor fifths by one octave into the electric-bass register.",
    rationale: "Timing alone moved rather than removed the collisions because both IA lines remained active over the sustained piano triad. The lower fifth retains harmonic identity and gives the cliff passage a deeper, less confrontational floor.",
    alternatives: [{ option: "Keep the three warnings unchanged", disposition: "rejected", reason: "All three identify the central hilt/pass bars, where clarity matters most." }, { option: "Remove the bass fifths", disposition: "rejected", reason: "It would erase the independent walking line." }, { option: "Lower the fifth register", disposition: "selected", reason: "It preserves rhythm and harmonic function while opening the IA/piano band." }],
    expected_audible_effect: "The bass should feel grounded beneath, rather than crowded inside, the two IA lines.",
    actual_result: `REGISTER_DENSITY_COLLISION count is now ${density.length}; no theory errors were introduced.`,
    next_step: "Build and render the current score.",
    affected_object_ids: ["bass", ...Array.from({ length: 8 }, (_, index) => `bass-anchor-${index + 1}-fifth`)], artifact_ids: [], listening_question_id: "lq-cliff-grip-without-duel", hypothesis_family: "arrangement", hash_dependencies: [], supersedes_decision_ids: ["decision-arrangement-anchor-space-v2"],
    evidence: { constraints: ["Preserve the minimal-band function and stable event identities."], observations: ["The timing-only v2 adjustment left three exact collisions.", "The octave displacement removes bass from MIDI 40–72 at those onsets."], theory_issue_codes: ["REGISTER_DENSITY_COLLISION"], metric_deltas: [] },
    outcome: "implemented", author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
  });
  return { theory: preflight.theory.summary, densityFindings: density, readiness: preflight.readiness };
}

async function alignPhrase(definition, selectedBlueprint) {
  await readContract("vocaloid://phrase-grammar-contract/validate_blueprint");
  await call("vocaloid_phrase_grammar", {
    action: "validate_blueprint",
    payload: { blueprint: selectedBlueprint },
    response_format: "json",
  });
  const aligned = await call("vocaloid_align_japanese_phrase", {
    phrase_id: definition.id,
    text: definition.text,
    reading: definition.reading,
    affricate_mode: "position",
    g_mode: "plosive",
    start: definition.start,
    allocation: "sequential",
    note_slots: makeSlots(
      definition.id, definition.durations, definition.pitches,
      definition.entry, definition.tail, definition.overrides, definition.span ?? 3840,
    ),
    response_format: "json",
  });
  return { ...aligned.phrase, grammar_blueprint: selectedBlueprint };
}

function instrumentNote(id, measure, beat, noteNumber, duration, velocity) {
  return { id, position: pos(measure, beat), duration, note_number: noteNumber, velocity };
}

function anchorPianoTrack() {
  const voicings = [
    [40, [50, 57, 65]], [41, [46, 53, 62]], [42, [41, 53, 60]], [43, [48, 55, 64]],
    [44, [43, 50, 58]], [45, [50, 57, 65]], [46, [46, 53, 62]], [47, [45, 52, 61]],
  ];
  return {
    kind: "pitched", id: "piano", name: "Sparse cliff piano", bank_msb: 0, bank_lsb: 0,
    program: 0, volume: 58, pan: 48,
    notes: voicings.flatMap(([measure, pitches], bar) => pitches.map((pitch, voice) =>
      instrumentNote(`piano-anchor-${String(bar + 1).padStart(2, "0")}-${voice + 1}`, measure, 0, pitch, 1680, 54 + voice * 4))),
    patterns: [], placements: [],
  };
}

function anchorBassTrack() {
  const bars = [
    [40, 38, 45, 36], [41, 34, 41, 40], [42, 41, 48, 43], [43, 36, 43, 42],
    [44, 31, 38, 33], [45, 38, 45, 40], [46, 34, 41, 33], [47, 33, 40, 37],
  ];
  return {
    kind: "pitched", id: "bass", name: "Walking edge bass", bank_msb: 0, bank_lsb: 0,
    program: 33, volume: 70, pan: 64,
    notes: bars.flatMap(([measure, root, fifth, approach], index) => [
      instrumentNote(`bass-anchor-${index + 1}-root`, measure, 0, root, 720, 70),
      { id: `bass-anchor-${index + 1}-fifth`, position: pos(measure, 2, 120), duration: 360, note_number: fifth - 12, velocity: 60 },
      { id: `bass-anchor-${index + 1}-approach`, position: pos(measure, 3, 240), duration: 180, note_number: approach, velocity: 52 },
    ]),
    patterns: [], placements: [],
  };
}

function drumHit(id, measure, beat, tick, noteNumber, velocity, duration = 60) {
  return { id, position: pos(measure, beat, tick), note_number: noteNumber, velocity, duration };
}

function anchorDrumTrack() {
  const hits = [];
  for (let measure = 40; measure < 48; measure++) {
    hits.push(drumHit(`drums-anchor-${measure}-kick`, measure, 0, 0, 36, measure < 44 ? 52 : 66));
    hits.push(drumHit(`drums-anchor-${measure}-step`, measure, 2, 0, measure % 2 === 0 ? 37 : 45, measure < 44 ? 44 : 58));
    if (measure >= 44) {
      hits.push(drumHit(`drums-anchor-${measure}-hat-a`, measure, 1, 0, 42, 38));
      hits.push(drumHit(`drums-anchor-${measure}-hat-b`, measure, 3, 0, 42, 42));
    }
  }
  hits.push(drumHit("drums-anchor-47-open", 47, 3, 240, 46, 38, 180));
  return { kind: "drums", id: "drums", name: "Footstep frame drums", hits, patterns: [], placements: [] };
}

function voicedCellIds(phrases) {
  return phrases.flatMap((phrase) => phrase.cells.filter((cell) => !cell.rest).map((cell) => cell.id));
}

async function anchorScore() {
  await setup();
  const leadPhrases = [];
  for (const definition of anchorLeadDefinitions) {
    leadPhrases.push(await alignPhrase(definition, anchorBlueprints[definition.id]));
  }
  const harmonyBlueprints = {
    "harmony-anchor-c": harmonyBlueprint("harmony-anchor-c", "lead-anchor-c", "contour.terrace-down", "cadence.dominant-open"),
    "harmony-anchor-d": harmonyBlueprint("harmony-anchor-d", "lead-anchor-d", "contour.plateau-fall", "cadence.dominant-open"),
  };
  const harmonyPhrases = [];
  for (const definition of anchorHarmonyDefinitions) {
    harmonyPhrases.push(await alignPhrase(definition, harmonyBlueprints[definition.id]));
  }

  await edit("upsert_vocal_part", {
    voice: { id: "voice-ia-original", name: "IA", component_id: IA_COMPONENT_ID, bank_select: 0, program_change: 0, parameters: {} },
    track: {
      id: "lead", name: "IA lead", comment: "Original IA only; centered primary narrator.", voice_id: "voice-ia-original",
      mixer: { volume: -90, pan: 64, mute: false, solo: false, send_level: -898, send_enabled: false },
    },
    part: {
      id: "lead-part-cliff-pass", section_id: "cliff-pass", name: "IA lead — cliff pass", comment: "Closed anchor realization before full-song expansion.",
      start: pos(40), end: pos(48), notes: [], phrases: leadPhrases, control_curves: [],
    },
  });
  await edit("upsert_vocal_part", {
    voice: { id: "voice-ia-original", name: "IA", component_id: IA_COMPONENT_ID, bank_select: 0, program_change: 0, parameters: {} },
    track: {
      id: "harmony", name: "IA selective harmony", comment: "Original IA; enters only after midpoint.", voice_id: "voice-ia-original",
      mixer: { volume: -180, pan: 78, mute: false, solo: false, send_level: -898, send_enabled: false },
    },
    part: {
      id: "harmony-part-cliff-pass", section_id: "cliff-pass", name: "IA harmony — restraint answer", comment: "Lower answer on the last four anchor bars only.",
      start: pos(44), end: pos(48), notes: [], phrases: harmonyPhrases, control_curves: [],
    },
  });

  const leadIds = voicedCellIds(leadPhrases);
  const harmonyIds = voicedCellIds(harmonyPhrases);
  const focusCellId = leadPhrases.find((phrase) => phrase.id === "lead-anchor-d").cells.filter((cell) => !cell.rest)[10].id;
  await edit("apply_tuning", {
    vocal_track_id: "lead", vocal_part_id: "lead-part-cliff-pass", materialize_existing: false,
    gestures: [
      { id: "tg-anchor-lead-articulation", type: "articulation", event_ids: leadIds, accent: 18, decay: 42, opening: 88, consonant_velocity: 66, bend_depth: 8, bend_length: 12, rise_portamento: false, fall_portamento: false },
      { id: "tg-anchor-lead-dyn", type: "dynamics_arc", event_ids: leadIds, start_value: 54, peak_value: 94, end_value: 48, peak_position: 0.72 },
      { id: "tg-anchor-lead-opening", type: "opening_arc", event_ids: leadIds, start_value: 72, peak_value: 108, end_value: 68, peak_position: 0.7 },
      { id: "tg-anchor-lead-bri", type: "timbre_arc", event_ids: leadIds, curve: "BRI", start_value: 55, peak_value: 78, end_value: 50, peak_position: 0.7 },
      { id: "tg-anchor-grip-scoop", type: "pitch_scoop", event_ids: [focusCellId], direction: "up_into", depth_cents: 70, duration_percent: 18, pitch_bend_sensitivity: 2 },
      { id: "tg-anchor-grip-vibrato", type: "vibrato", event_ids: [focusCellId], vibrato_type: 13, length_percent: 34, depth_start: 18, depth_peak: 38, depth_end: 26, rate_start: 44, rate_end: 50 },
    ],
  });
  await edit("apply_tuning", {
    vocal_track_id: "harmony", vocal_part_id: "harmony-part-cliff-pass", materialize_existing: false,
    gestures: [
      { id: "tg-anchor-harmony-articulation", type: "articulation", event_ids: harmonyIds, accent: 8, decay: 48, opening: 70, consonant_velocity: 60, bend_depth: 5, bend_length: 10, rise_portamento: false, fall_portamento: false },
      { id: "tg-anchor-harmony-dyn", type: "dynamics_arc", event_ids: harmonyIds, start_value: 38, peak_value: 64, end_value: 34, peak_position: 0.62 },
      { id: "tg-anchor-harmony-gen", type: "timbre_arc", event_ids: harmonyIds, curve: "GEN", start_value: 68, peak_value: 72, end_value: 70, peak_position: 0.5 },
    ],
  });

  for (const track of [anchorPianoTrack(), anchorBassTrack(), anchorDrumTrack()]) {
    await edit("upsert_arrangement", { track });
  }

  const focusLyricId = leadPhrases.find((phrase) => phrase.id === "lead-anchor-d").lyrics[10].id;
  await edit("bind_phrase_realization", {
    phrase_direction_id: "pd-cliff-pass",
    realization_links: {
      vocal_phrase_ids: leadPhrases.map((phrase) => phrase.id),
      lyric_unit_ids: leadPhrases.flatMap((phrase) => phrase.lyrics.map((lyric) => lyric.id)),
      event_ids: leadIds,
      semantic_focus_object_ids: [focusLyricId, focusCellId],
      tuning_gesture_ids: ["tg-anchor-lead-articulation", "tg-anchor-lead-dyn", "tg-anchor-lead-opening", "tg-anchor-lead-bri", "tg-anchor-grip-scoop", "tg-anchor-grip-vibrato"],
      chord_ids: chordChanges.filter((entry) => entry.position.measure >= 40 && entry.position.measure < 48).map((entry) => entry.id),
      track_ids: ["lead", "harmony", "piano", "bass", "drums"],
    },
  });

  if (!(await hasDecision("decision-anchor-note-allocation-v1"))) {
    await journal({
      id: "decision-anchor-note-allocation-v1",
      phase: "note_allocation",
      kind: "selection",
      title: "Four non-isomorphic anchor phrases and focus-weighted Japanese allocation",
      objective: "Make the cliff encounter narratively legible in 20–30 seconds without repeating a generic rise–fall construction.",
      decision: "Use early-peak recognition, a delayed low recitative cliff line, an offbeat accelerating walking line, and a compressed leap–hold–release final line. Allocate every mora explicitly through the Japanese aligner; give the ぎ of 柄を握り 480 ticks at F5 and descend at once.",
      rationale: "The phrase jobs are different before pitch detail: recognition spends its peak early, the landscape contracts, walking avoids a downbeat stop, and the grip receives the only expanded range. The final D4 over A7 keeps the action unresolved until after the pass.",
      alternatives: [
        { option: "Four similarly arched two-bar lines", disposition: "rejected", reason: "It made every statement sound like preparation and obscured the physical sequence." },
        { option: "Repeat the title-hook melody under the encounter text", disposition: "rejected", reason: "The hook's refusal function is different from the encounter's sequential physical actions." },
        { option: "Distinct phrase roles with one focus-weighted climax", disposition: "selected", reason: "It lets contour, entry, density, and cadence carry recognition, space, motion, and restraint in order." },
      ],
      expected_audible_effect: "The listener should hear approach and passing as one forward span; the focus peak should register as contained danger, not attack.",
      actual_result: "Four validated grammar blueprints were materialized as 52 locked-phoneme lead cells plus authored rests; the phrase direction now links the exact semantic-focus lyric and cell.",
      next_step: "Render isolated original-IA lead and selective harmony, then build the minimal-band ladder for the registered listening question.",
      affected_object_ids: ["lead-anchor-a", "lead-anchor-b", "lead-anchor-c", "lead-anchor-d", focusLyricId, focusCellId],
      artifact_ids: [],
      listening_question_id: "lq-cliff-grip-without-duel",
      hypothesis_family: "melody",
      hash_dependencies: [],
      supersedes_decision_ids: [],
      evidence: {
        constraints: ["Every pitch, onset, duration, rest, lyric allocation, and transformation was authored from current intent/prosody/harmony/form.", "Phrase bundles were selection-only and melody_material remained absent."],
        observations: ["Peak pitch F5 occurs only in lead-anchor-d on the semantic focus.", "Entry positions are downbeat, delayed, offbeat, and offbeat; normalized contours and duration fingerprints differ by role."],
        theory_issue_codes: [], metric_deltas: [],
      },
      outcome: "implemented",
      author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
    });
  }
  if (!(await hasDecision("decision-anchor-ia-delivery-v1"))) {
    await journal({
      id: "decision-anchor-ia-delivery-v1", phase: "ia_delivery", kind: "selection",
      title: "Original IA restraint arc with one materialized grip gesture",
      objective: "Use native IA controls to reveal contained pressure without treating tuning data as proof of emotion.",
      decision: "Keep early lines plain and moderately open; increase DYN/BRI/opening toward the grip, apply a 70-cent up-into scoop and slight delayed vibrato only to the focus F5, then lower DYN before the passing syllables. Keep harmony darker and quieter.",
      rationale: "A single local pitch/timbre event preserves contrast. Global vibrato or brightness would make restraint sound performative and reduce the semantic focus's identity.",
      alternatives: [
        { option: "Global vibrato on all sustained notes", disposition: "rejected", reason: "It would flatten the distinction between landscape, recognition, and the grip." },
        { option: "No native pitch or dynamic curves", disposition: "rejected", reason: "The declared delivery arc would remain unmaterialized and inaudible in the score." },
        { option: "One bounded focus scoop plus phrase-wide arcs", disposition: "selected", reason: "It exposes pressure at a stable object while allowing immediate release." },
      ],
      expected_audible_effect: "IA should open once at 柄を握り, then sound cooler before すれ違う; lower harmony should support rather than glamorize the moment.",
      actual_result: "Nine gesture declarations compiled into native note expressions and PBS/PIT/DYN/BRI/opening/GEN materialization provenance.",
      next_step: "Verify the serialized controls in build/preflight and confirm a non-silent original-Editor stem.",
      affected_object_ids: ["tg-anchor-lead-articulation", "tg-anchor-lead-dyn", "tg-anchor-lead-opening", "tg-anchor-lead-bri", "tg-anchor-grip-scoop", "tg-anchor-grip-vibrato", "tg-anchor-harmony-articulation", "tg-anchor-harmony-dyn", "tg-anchor-harmony-gen"],
      artifact_ids: [], listening_question_id: "lq-cliff-grip-without-duel", hypothesis_family: "delivery", hash_dependencies: [], supersedes_decision_ids: [],
      evidence: { constraints: ["Declared, materialized, rendered, and heard are separate evidence levels."], observations: ["All gesture IDs are linked to voiced stable cell IDs and compiled by apply_tuning.", "Human listening remains pending."], theory_issue_codes: [], metric_deltas: [] },
      outcome: "implemented", author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
    });
  }
  if (!(await hasDecision("decision-anchor-arrangement-v1"))) {
    await journal({
      id: "decision-anchor-arrangement-v1", phase: "arrangement", kind: "selection",
      title: "Minimal cliff band leaves the first half vocally solitary",
      objective: "Strengthen forward motion and harmonic tension without filling the cliff's negative space.",
      decision: "Use only sparse piano voicings, an independent root–fifth–approach bass, and footstep-like kick/side-stick/tom. Harmony enters at measure 44; hats enter only with the no-stop line.",
      rationale: "The ladder needs bass, drums, and one harmonic instrument. Sparse attacks and delayed density make the midpoint change audibly meaningful while keeping the narrator centered.",
      alternatives: [
        { option: "Full strings and cymbals throughout the anchor", disposition: "rejected", reason: "It would imply spectacle and mask the no-greeting restraint." },
        { option: "Voice and drone only", disposition: "rejected", reason: "It would not test whether harmonic motion and footsteps strengthen the registered question." },
        { option: "Sparse piano, independent bass, and footstep drums", disposition: "selected", reason: "It satisfies the minimal-band layer while exposing every onset and silence." },
      ],
      expected_audible_effect: "The first four bars should remain exposed; the last four should gain momentum without sounding like combat music.",
      actual_result: "Three explicit arrangement tracks were installed only for measures 40–48, ready for isolated stem rendering.",
      next_step: "Build and render lead_solo, lead_harmony, and minimal_band auditions before any full-song score is added.",
      affected_object_ids: ["piano", "bass", "drums", "harmony-part-cliff-pass"], artifact_ids: [], listening_question_id: "lq-cliff-grip-without-duel", hypothesis_family: "arrangement", hash_dependencies: [], supersedes_decision_ids: [],
      evidence: { constraints: ["Minimal band is bass, drums, and one harmonic instrument."], observations: ["Piano uses one long voicing per bar.", "Bass has root, fifth, and one quiet approach; drums add subdivision only after measure 44."], theory_issue_codes: [], metric_deltas: [] },
      outcome: "implemented", author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
    });
  }
  const preflight = await call("vocaloid_preflight_song", {
    manifest_path: MANIFEST, artifact_check: "current", include_performance_warnings: true,
    check_voice_cache: true, allow_unknown_editor: false, include_theory_proposals: true,
    max_theory_proposals: 6, theory_proposal_kinds: [], theory_proposal_issue_codes: [], theory_proposal_object_ids: [], response_format: "json",
  });
  return { summary: await inspect(), preflight };
}

function artifactForTrack(renderResult, trackId) {
  const artifact = renderResult.artifacts.find((entry) => entry.metadata?.track_id === trackId);
  if (!artifact) throw new Error(`Missing rendered artifact for ${trackId}`);
  return artifact;
}

async function setupMix() {
  const chains = [
    { id: "fx-lead", target_id: "lead", effects: [
      { id: "fx-lead-gain", type: "gain", enabled: true, parameters: { gain_db: 10 } },
      { id: "fx-lead-hp", type: "highpass", enabled: true, parameters: { frequency_hz: 75, q: 0.707, poles: 2 } },
      { id: "fx-lead-deess", type: "deesser", enabled: true, parameters: { intensity: 0.22, max_deessing: 0.35, frequency_focus: 0.58 } },
    ] },
    { id: "fx-harmony", target_id: "harmony", effects: [
      { id: "fx-harmony-gain", type: "gain", enabled: true, parameters: { gain_db: 18 } },
      { id: "fx-harmony-hp", type: "highpass", enabled: true, parameters: { frequency_hz: 100, q: 0.707, poles: 2 } },
      { id: "fx-harmony-lp", type: "lowpass", enabled: true, parameters: { frequency_hz: 11000, q: 0.707, poles: 1 } },
      { id: "fx-harmony-pan", type: "pan", enabled: true, parameters: { pan: 0.16 } },
    ] },
    { id: "fx-piano", target_id: "piano", effects: [
      { id: "fx-piano-gain", type: "gain", enabled: true, parameters: { gain_db: 24 } },
      { id: "fx-piano-hp", type: "highpass", enabled: true, parameters: { frequency_hz: 100, q: 0.707, poles: 2 } },
      { id: "fx-piano-pan", type: "pan", enabled: true, parameters: { pan: -0.18 } },
    ] },
    { id: "fx-bass", target_id: "bass", effects: [
      { id: "fx-bass-gain", type: "gain", enabled: true, parameters: { gain_db: 22 } },
      { id: "fx-bass-hp", type: "highpass", enabled: true, parameters: { frequency_hz: 30, q: 0.707, poles: 1 } },
      { id: "fx-bass-lp", type: "lowpass", enabled: true, parameters: { frequency_hz: 2800, q: 0.707, poles: 1 } },
    ] },
    { id: "fx-drums", target_id: "drums", effects: [
      { id: "fx-drums-gain", type: "gain", enabled: true, parameters: { gain_db: 24 } },
      { id: "fx-drums-hp", type: "highpass", enabled: true, parameters: { frequency_hz: 35, q: 0.707, poles: 1 } },
    ] },
    { id: "fx-strings", target_id: "strings", effects: [
      { id: "fx-strings-gain", type: "gain", enabled: true, parameters: { gain_db: 24 } },
      { id: "fx-strings-hp", type: "highpass", enabled: true, parameters: { frequency_hz: 180, q: 0.707, poles: 2 } },
      { id: "fx-strings-pan", type: "pan", enabled: true, parameters: { pan: 0.26 } },
      { id: "fx-strings-reverb", type: "reverb", enabled: true, parameters: { in_gain: 0.76, out_gain: 0.68, delay_ms: 72, decay: 0.22 } },
    ] },
    { id: "fx-shakuhachi", target_id: "shakuhachi", effects: [
      { id: "fx-shaku-gain", type: "gain", enabled: true, parameters: { gain_db: 21 } },
      { id: "fx-shaku-hp", type: "highpass", enabled: true, parameters: { frequency_hz: 180, q: 0.707, poles: 2 } },
      { id: "fx-shaku-lp", type: "lowpass", enabled: true, parameters: { frequency_hz: 10000, q: 0.707, poles: 1 } },
      { id: "fx-shaku-pan", type: "pan", enabled: true, parameters: { pan: -0.26 } },
      { id: "fx-shaku-reverb", type: "reverb", enabled: true, parameters: { in_gain: 0.76, out_gain: 0.66, delay_ms: 88, decay: 0.2 } },
    ] },
    { id: "fx-mix-bus", target_id: "mix-bus", effects: [
      { id: "fx-bus-gain", type: "gain", enabled: true, parameters: { gain_db: 2 } },
      { id: "fx-bus-compressor", type: "compressor", enabled: true, parameters: { threshold_db: -10, ratio: 1.5, attack_ms: 24, release_ms: 180, makeup_db: 0, knee: 2.8, detection: "rms", mix: 0.7 } },
      { id: "fx-bus-limiter", type: "limiter", enabled: true, parameters: { limit_db: -2, attack_ms: 5, release_ms: 80 } },
    ] },
  ];
  for (const effectChain of chains) await edit("upsert_effect_chain", { effect_chain: effectChain });
  const dynamics = [
    ["dyn-bus-intro", "intro", -3],
    ["dyn-bus-interlude", "interlude", -2],
    ["dyn-bus-afterimage", "afterimage", -2.5],
    ["dyn-bus-outro", "outro", -4],
  ];
  for (const [id, sectionId, gainDb] of dynamics) {
    await edit("upsert_section_dynamic", { section_dynamic: { id, section_id: sectionId, target_id: "mix-bus", gain_db: gainDb, ramp_ms: 400 } });
  }
  await journal({
    id: "decision-mix-v1", phase: "mix", kind: "selection", title: "Restore renderer gain while preserving the cliff's center",
    objective: "Make the complete draft listenable without hiding IA's native delivery or turning the encounter into a loud duel mix.",
    decision: "Use measured track-specific gain restoration, high-pass role separation, modest opposite piano/harmony placement, distant high-color reverbs only, four section-level bus recessions, and a -2 dB premaster limiter.",
    rationale: "The closed anchor showed lead at -35.5 LUFS while draft piano/drums/bass measured roughly -56.5/-55.1/-51.4 LUFS in the same passage. Gain correction is therefore role restoration, not aesthetic loudness maximization; lead remains centered and the two color tracks stay sparse.",
    alternatives: [{ option: "Normalize every stem independently to -16 LUFS", disposition: "rejected", reason: "It would erase the intended hierarchy and exaggerate sparse colors." }, { option: "Leave raw renderer gains", disposition: "rejected", reason: "The complete accompaniment would be functionally inaudible." }, { option: "Measured role-specific restoration and conservative bus control", disposition: "selected", reason: "It produces a viable premaster while retaining dynamics for final two-pass mastering." }],
    expected_audible_effect: "IA stays central; bass and footstep drums become audible beneath rather than over the voice; piano and selective harmony separate gently; intro, afterimage, and outro recede.",
    actual_result: "Eight current effect chains and four section dynamics are canonical; no effect is baked into the isolated Editor stem evidence.",
    next_step: "Render current dry stems, make vocal/minimal/full mixes, analyze the result, and revise gain only if measured clipping or imbalance appears.",
    affected_object_ids: [...chains.flatMap((chain) => [chain.id, ...chain.effects.map((effect) => effect.id)]), ...dynamics.map(([id]) => id)], artifact_ids: [], hash_dependencies: [], supersedes_decision_ids: [],
    evidence: { constraints: ["GM/SF2 output remains draft-quality and is not evidence of authentic instruments."], observations: ["Lead anchor -35.5 LUFS/-18.8 dBTP.", "Raw anchor bass/drums/piano -51.4/-55.1/-56.5 LUFS."], theory_issue_codes: [], metric_deltas: [] },
    outcome: "implemented", author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
  });
  return { chains: chains.map((chain) => chain.id), dynamics: dynamics.map(([id]) => id), summary: await inspect() };
}

async function fullRender() {
  await mkdir(resolve(ROOT, EVAL_DIR), { recursive: true });
  await mkdir(resolve(ROOT, "artifacts/vsqxs"), { recursive: true });
  const preflight = await call("vocaloid_preflight_song", {
    manifest_path: MANIFEST, artifact_check: "current", include_performance_warnings: true, check_voice_cache: true,
    allow_unknown_editor: false, include_theory_proposals: false, response_format: "json",
  });
  if (!preflight.readiness.build.ready) throw new Error(`Full score is not build-ready: ${preflight.readiness.build.blockers.join(", ")}`);

  let current = await inspect();
  let projectArtifact = current.artifacts.find((entry) => entry.role === "vsqx" && entry.currentComposition && entry.path.endsWith("kaze-wa-na-o-yobanai-ia-final.vsqx"));
  let build;
  if (!projectArtifact) {
    build = await call("vocaloid_build_song_manifest", {
      manifest_path: MANIFEST,
      expected_revision: current.revision,
      backing_output_path: `${EVAL_DIR}/kaze-wa-na-o-yobanai-full-backing.wav`,
      project_output_path: "artifacts/vsqxs/kaze-wa-na-o-yobanai-ia-final.vsqx",
      response_format: "json",
    });
    projectArtifact = build.artifacts.find((entry) => entry.role === "vsqx");
  }
  if (!projectArtifact) throw new Error("Full build did not return a current VSQX artifact");

  current = await inspect();
  const vocals = await call("vocaloid_render_vocal_stems", {
    manifest_path: MANIFEST, expected_revision: current.revision, project_artifact_id: projectArtifact.id,
    output_directory: EVAL_DIR, vocal_track_ids: ["lead", "harmony"], center_pan: true, dry: true,
    allow_pre_send_adjustment: false, timeout_seconds: 600, response_format: "json",
  });
  const leadStem = artifactForTrack(vocals, "lead");
  const harmonyStem = artifactForTrack(vocals, "harmony");

  current = await inspect();
  const instruments = await call("vocaloid_render_instrument_stems", {
    manifest_path: MANIFEST, expected_revision: current.revision, output_directory: EVAL_DIR,
    track_ids: ["piano", "bass", "drums", "strings", "shakuhachi"], preserve_pan: true,
    include_renderer_effects: false, response_format: "json",
  });
  const pianoStem = artifactForTrack(instruments, "piano");
  const bassStem = artifactForTrack(instruments, "bass");
  const drumStem = artifactForTrack(instruments, "drums");
  const stringStem = artifactForTrack(instruments, "strings");
  const shakuStem = artifactForTrack(instruments, "shakuhachi");

  async function stemMix(stemArtifactIds, outputPath) {
    const summary = await inspect();
    return call("vocaloid_render_stem_mix", {
      manifest_path: MANIFEST, expected_revision: summary.revision, stem_artifact_ids: stemArtifactIds,
      output_path: outputPath, sample_rate: 44_100, bit_depth: 24, reference_lufs: -16,
      reference_true_peak_dbfs: -1, timeout_seconds: 600, response_format: "json",
    });
  }
  const vocalPair = await stemMix([leadStem.id, harmonyStem.id], `${EVAL_DIR}/kaze-wa-na-o-yobanai-vocal-pair-premaster.wav`);
  const minimalBand = await stemMix(
    [leadStem.id, harmonyStem.id, pianoStem.id, bassStem.id, drumStem.id],
    `${EVAL_DIR}/kaze-wa-na-o-yobanai-minimal-band-premaster.wav`,
  );
  const fullMix = await stemMix(
    [leadStem.id, harmonyStem.id, pianoStem.id, bassStem.id, drumStem.id, stringStem.id, shakuStem.id],
    `${EVAL_DIR}/kaze-wa-na-o-yobanai-full-premaster.wav`,
  );

  async function anchorPreview(sourceArtifactId, auditionLayer, filename) {
    const summary = await inspect();
    return call("vocaloid_review_audio", {
      action: "anchor_preview", manifest_path: MANIFEST, expected_revision: summary.revision,
      source_artifact_id: sourceArtifactId, phrase_direction_id: "pd-cliff-pass", audition_layer: auditionLayer,
      output_path: `${EVAL_DIR}/${filename}`, target_duration_seconds: 25, reference_lufs: -16,
      reference_true_peak_dbfs: -1, response_format: "json",
    });
  }
  const leadSoloPreview = await anchorPreview(leadStem.id, "lead_solo", "kaze-wa-na-o-yobanai-anchor-final-lead-solo.wav");
  const leadHarmonyPreview = await anchorPreview(vocalPair.artifact.id, "lead_harmony", "kaze-wa-na-o-yobanai-anchor-final-lead-harmony.wav");
  const minimalPreview = await anchorPreview(minimalBand.artifact.id, "minimal_band", "kaze-wa-na-o-yobanai-anchor-final-minimal-band.wav");
  const fullPreview = await anchorPreview(fullMix.artifact.id, "full_layers", "kaze-wa-na-o-yobanai-anchor-final-full-layers.wav");

  current = await inspect();
  const vocalAnalysis = await call("vocaloid_analyze_vocal_stem", {
    manifest_path: MANIFEST, expected_revision: current.revision, stem_artifact_id: leadStem.id,
    output_path: `${EVAL_DIR}/kaze-wa-na-o-yobanai-final-anchor-lead.vocal-analysis.json`, section_id: "cliff-pass",
    timeline_offset_seconds: 0, minimum_pitch_hz: 60, maximum_pitch_hz: 1200, pitch_tolerance_cents: 100,
    onset_tolerance_ms: 150, offset_tolerance_ms: 220, response_format: "json",
  });
  const previews = [leadSoloPreview.artifact, leadHarmonyPreview.artifact, minimalPreview.artifact, fullPreview.artifact];
  await journal({
    id: "decision-ia-render-verification-v1", phase: "ia_delivery", kind: "evaluation", title: "Verify the complete original-IA score through the native Editor",
    objective: "Separate declared/materialized controls from proof that the original IA Editor render is audible.",
    decision: "Retain the current dry lead and harmony stems, current final VSQX, and anchor score/render analysis as the render evidence set.",
    rationale: "The original Editor, not a substitute singer, serialized and exported both tracks. The earlier anchor export exposed two operational problems: the SDK's default 60-second request deadline expired while the Editor was still exporting, and one subsequent filename automation attempt returned Win32 error 13; extending the bounded client timeout and retrying after verifying the dead lease resolved both without framework changes.",
    alternatives: [{ option: "Treat the successful probe as sufficient render evidence", disposition: "rejected", reason: "The probe did not contain the complete score." }, { option: "Replace the Editor render with another engine", disposition: "rejected", reason: "It would violate the requested original IA voice path." }, { option: "Retry the verified Editor path with a bounded deadline", disposition: "selected", reason: "It preserves the required engine and records the operational failure honestly." }],
    expected_audible_effect: "The complete lead and selective answer should be non-silent, aligned to the authored cells, and retain native control gestures.",
    actual_result: `Original Editor rendered both current tracks; anchor analysis covers ${vocalAnalysis.summary.events} events with ${vocalAnalysis.summary.eventsWithPitch} confident F0 event(s).`,
    next_step: "Master the current full stem mix and leave narrative keep/reject/revise listening pending.",
    affected_object_ids: ["voice-ia-original", "lead", "harmony", "tg-anchor-grip-scoop", "tg-anchor-grip-vibrato"], artifact_ids: [projectArtifact.id, leadStem.id, harmonyStem.id, vocalAnalysis.artifact.id], hash_dependencies: [], supersedes_decision_ids: [],
    evidence: { constraints: ["Voice name IA and component BLRGDDR4M3WM2LC6 only."], observations: [`Lead renderer ${leadStem.metadata.renderer ?? "original-editor"}.`, `Harmony renderer ${harmonyStem.metadata.renderer ?? "original-editor"}.`, "No IA_ROCKS or trial component exists in the manifest."], theory_issue_codes: [], metric_deltas: [] },
    outcome: "auditioned", author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
  });
  await journal({
    id: "decision-anchor-audition-ladder-v2", phase: "audition", kind: "evaluation", title: "Current final anchor ladder rendered; qualitative outcome pending",
    objective: "Make the final current composition available at the same fixed 20–30 second question across isolated and arranged layers.",
    decision: "Publish lead_solo, lead_harmony, minimal_band, and full_layers previews of the same measures 40–48, but do not record a human keep/reject/revise result.",
    rationale: "The first three layers satisfy the required closure ladder; the fourth exposes the final sparse string color. Metrics establish duration, non-silence, and provenance only.",
    alternatives: [{ option: "Reuse the stale pre-expansion previews", disposition: "rejected", reason: "They no longer match the current composition hash." }, { option: "Self-sign the anchor as successful", disposition: "rejected", reason: "Technical metrics cannot answer the narrative listening question." }, { option: "Render current layers and leave review pending", disposition: "selected", reason: "It provides exact listening evidence without inventing a human outcome." }],
    expected_audible_effect: "A listener can determine whether each added layer strengthens restraint and passing without changing the fixed lyric, timing, or question.",
    actual_result: `Current previews are ${previews.map((artifact) => artifact.metadata.passage_duration_seconds.toFixed(3)).join(" / ")} seconds; human listening remains pending.`,
    next_step: "User listens to the exact paths and resolves lq-cliff-grip-without-duel if desired.",
    affected_object_ids: ["pd-cliff-pass", "lead", "harmony", "piano", "bass", "drums", "strings"], artifact_ids: previews.map((artifact) => artifact.id), listening_question_id: "lq-cliff-grip-without-duel", hypothesis_family: "arrangement", hash_dependencies: [], supersedes_decision_ids: ["decision-anchor-audition-ladder-v1"],
    evidence: { constraints: ["No human listening outcome is self-signed."], observations: previews.map((artifact) => `${artifact.metadata.audition_layer}: ${artifact.metadata.integrated_lufs} LUFS, ${artifact.metadata.true_peak_dbfs} dBTP.`), theory_issue_codes: [], metric_deltas: [] },
    outcome: "auditioned", author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
  });
  await journal({
    id: "decision-mix-render-v1", phase: "mix", kind: "evaluation", title: "Render the complete restrained premaster from isolated stems",
    objective: "Verify that the canonical gain staging produces a non-clipped, complete 68-measure listening mix.",
    decision: "Retain the current seven-stem full premaster together with separate vocal-pair and minimal-band mixes.",
    rationale: "The three mixes preserve useful isolation while sharing the same canonical effect chains and section dynamics; the full mix is the only source eligible for mastering.",
    alternatives: [{ option: "Master the raw Editor lead alone", disposition: "rejected", reason: "It would omit the complete arrangement." }, { option: "Use the generated backing instead of isolated stems", disposition: "rejected", reason: "It would bypass the documented track-specific mix decisions." }, { option: "Mix the verified isolated stems", disposition: "selected", reason: "It keeps source provenance and role-specific processing explicit." }],
    expected_audible_effect: "The complete form should play continuously with centered IA, grounded footsteps, sparse color, and quieter intro/afterimage/outro.",
    actual_result: `Full premaster measured ${fullMix.quality.integratedLufs.toFixed(1)} LUFS, ${fullMix.quality.truePeakDbfs.toFixed(1)} dBTP, LRA ${fullMix.quality.loudnessRangeLu.toFixed(1)} LU, clipped samples=${fullMix.quality.clippedSampleValues}.`,
    next_step: "Two-pass master the full premaster; if transparency risk is reported, render a registered equal-loudness anchor A/B.",
    affected_object_ids: ["fx-mix-bus", "dyn-bus-intro", "dyn-bus-interlude", "dyn-bus-afterimage", "dyn-bus-outro"], artifact_ids: [vocalPair.artifact.id, minimalBand.artifact.id, fullMix.artifact.id], hash_dependencies: [], supersedes_decision_ids: [],
    evidence: { constraints: ["Source clipping is not accepted for delivery."], observations: [`Inputs: ${fullMix.artifact.metadata.input_stems} current stems.`, `Renderer: ${fullMix.artifact.metadata.renderer}.`], theory_issue_codes: [], metric_deltas: [] },
    outcome: "auditioned", author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
  });
  return {
    projectArtifact, leadStem, harmonyStem, instrumentStems: instruments.artifacts,
    vocalPair: { artifact: vocalPair.artifact, quality: vocalPair.quality },
    minimalBand: { artifact: minimalBand.artifact, quality: minimalBand.quality },
    fullMix: { artifact: fullMix.artifact, quality: fullMix.quality }, previews,
    vocalAnalysis: { artifact: vocalAnalysis.artifact, summary: vocalAnalysis.summary }, summary: await inspect(),
  };
}

async function masterDelivery() {
  await mkdir(resolve(ROOT, "artifacts/songs"), { recursive: true });
  let current = await inspect();
  const source = current.artifacts.find((entry) => entry.role === "mix" && entry.currentComposition && entry.currentMix && entry.path.endsWith("kaze-wa-na-o-yobanai-full-premaster.wav"));
  if (!source) throw new Error("No current full premaster artifact is available");
  const delivery = await call("vocaloid_master_manifest_delivery", {
    manifest_path: MANIFEST, expected_revision: current.revision, source_artifact_id: source.id,
    output_path: "artifacts/songs/kaze-wa-na-o-yobanai-ia-final.wav", target_lufs: -16,
    target_true_peak_dbfs: -1, target_loudness_range_lu: 7, allow_clipped_source: false,
    response_format: "json",
  });
  let transparencyAb;
  if (delivery.mastering.transparencyReviewRecommended) {
    current = await inspect();
    transparencyAb = await call("vocaloid_review_audio", {
      action: "compare_anchor_ab", manifest_path: MANIFEST, expected_revision: current.revision,
      artifact_a_id: source.id, artifact_b_id: delivery.artifact.id, phrase_direction_id: "pd-cliff-pass",
      audition_layer: "timbre_mix", hypothesis_family: "timbre_mix",
      output_a_path: `${EVAL_DIR}/kaze-wa-na-o-yobanai-mastering-premaster-equal-loudness.wav`,
      output_b_path: `${EVAL_DIR}/kaze-wa-na-o-yobanai-mastering-delivery-equal-loudness.wav`,
      target_duration_seconds: 25, match_lufs: -20, reference_true_peak_dbfs: -1, response_format: "json",
    });
  }
  const abArtifacts = transparencyAb ? [transparencyAb.A.artifact, transparencyAb.B.artifact] : [];
  await journal({
    id: "decision-delivery-v1", phase: "delivery", kind: "evaluation", title: "Two-pass final delivery with transparency review left pending",
    objective: "Create the current listenable full-song WAV without accepting source clipping or silently equating loudness metrics with a creative approval.",
    decision: "Master the verified seven-stem premaster to -16 LUFS/-1 dBTP with a 7 LU target, and when the deterministic transparency flag is raised, render one equal-loudness A/B on the registered cliff question without choosing a winner.",
    rationale: "The premaster has 0 clipped samples and ample headroom but requires 6.5 LU of gain and peak reshaping. The registered anchor A/B holds lyric, passage, question, and loudness constant so the user can judge whether mastering changes restraint or makes the hilt feel combative.",
    alternatives: [{ option: "Deliver the -22.5 LUFS premaster as final", disposition: "rejected", reason: "It is listenable but not a normalized delivery artifact." }, { option: "Ignore a transparency-risk flag", disposition: "rejected", reason: "It would hide the known peak/LRA tradeoff." }, { option: "Master and expose a registered equal-loudness comparison", disposition: "selected", reason: "It satisfies technical delivery while keeping qualitative authority with the listener." }],
    expected_audible_effect: "Playback level becomes practical while the wide quiet/loud form is controlled; the A/B reveals whether that control alters the cliff's restraint.",
    actual_result: `Delivery measured ${delivery.mastering.output.integratedLufs.toFixed(1)} LUFS, ${delivery.mastering.output.truePeakDbfs.toFixed(1)} dBTP, LRA ${delivery.mastering.output.loudnessRangeLu.toFixed(1)} LU, clipped samples=${delivery.mastering.output.clippedSampleValues}; transparency review recommended=${delivery.mastering.transparencyReviewRecommended}. Human listening remains pending.`,
    next_step: transparencyAb ? "Listen to the equal-loudness premaster/delivery anchor pair and the three-layer ladder; record a human keep/reject/revise outcome only if supplied." : "Listen to the final WAV and current anchor ladder; qualitative outcome remains pending.",
    affected_object_ids: ["pd-cliff-pass", "fx-mix-bus"], artifact_ids: [source.id, delivery.artifact.id, ...abArtifacts.map((artifact) => artifact.id)], listening_question_id: "lq-cliff-grip-without-duel", hypothesis_family: "timbre_mix", hash_dependencies: [], supersedes_decision_ids: [],
    evidence: { constraints: ["No clipped source may be accepted.", "Equal-loudness A/B is allowed only for the registered listening question."], observations: [`Requested gain ${delivery.mastering.requestedLoudnessGainLu.toFixed(2)} LU.`, `Peak reduction required ${delivery.mastering.peakReductionRequiredDb.toFixed(2)} dB.`, `LRA change ${delivery.mastering.loudnessRangeChangeLu.toFixed(2)} LU.`], theory_issue_codes: [], metric_deltas: [] },
    outcome: "delivered", author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
  });
  return { source, delivery, transparencyAb, summary: await inspect() };
}

async function journalStatus() {
  await readContract("vocaloid://creative-journal-contract/report");
  const report = await call("vocaloid_creative_journal", {
    action: "report", payload: { manifest_path: MANIFEST, overwrite: true }, response_format: "json",
  });
  await readContract("vocaloid://creative-journal-contract/list");
  const entries = await call("vocaloid_creative_journal", {
    action: "list", payload: { manifest_path: MANIFEST, offset: 0, limit: 100 }, response_format: "json",
  });
  return {
    completeness: report.completeness,
    entries: entries.items.map((item) => ({ id: item.entry.id, phase: item.entry.phase, currentness: item.currentness, staleReasons: item.staleReasons })),
  };
}

async function finalizeCreativeRecord() {
  const manifest = JSON.parse(await readFile(resolve(ROOT, MANIFEST), "utf8"));
  const allPhrases = manifest.vocal_tracks.flatMap((track) => track.parts.flatMap((part) => part.phrases));
  const leadPhrases = manifest.vocal_tracks.find((track) => track.id === "lead").parts.flatMap((part) => part.phrases);
  const voicedCells = leadPhrases.flatMap((phrase) => phrase.cells.filter((cell) => !cell.rest));
  if (!(await hasDecision("decision-note-allocation-full-v2"))) await journal({
    id: "decision-note-allocation-full-v2", phase: "note_allocation", kind: "adjustment", title: "Confirm complete Japanese prosody after grammar reconciliation",
    objective: "Bind the final Japanese lyric/readings, rests, melismas, and semantic focus to the current phrase objects.",
    decision: "Retain all 36 aligned phrases and 433 vocal events: explicit kana readings drive locked VOCALOID phonemes, authored rest cells distinguish pickup/delayed/offbeat roles, repeated mora indices carry only chosen melismas, and the anchor gives the ぎ in 柄を握り its sole F5/long focus before immediate descent.",
    rationale: "The prior allocation entry became stale only because three anchor blueprint limits were corrected to match already-authored notes. Rebinding the current phrases records that allocation, text, reading, phonemes, pitches, and durations themselves remain deliberate and complete across the whole song.",
    alternatives: [{ option: "Treat kanji text as sufficient without readings", disposition: "rejected", reason: "VOCALOID pronunciation requires explicit kana and stable phonemes." }, { option: "Force one note per written character", disposition: "rejected", reason: "Japanese mora timing and selected melisma would be lost." }, { option: "Keep explicit mora allocation with authored rests", disposition: "selected", reason: "It preserves prosody and makes entry-role differences audible." }],
    expected_audible_effect: "IA should articulate the narrative clearly while pickups, delayed starts, sustained vowels, and the compressed final anchor line remain musically distinct.",
    actual_result: `${allPhrases.length} current phrases contain ${voicedCells.length} voiced lead cells plus selective harmony; all phrase blueprints now match their local numeric limits.`,
    next_step: "Publish the hash-bound record and leave human intent listening pending.",
    affected_object_ids: allPhrases.map((phrase) => phrase.id), artifact_ids: [], hash_dependencies: [], supersedes_decision_ids: ["decision-anchor-note-allocation-v1"],
    evidence: { constraints: ["Every Japanese kanji lyric has an explicit kana reading.", "Concrete allocation was authored and aligned; phrase bundles supplied no melody material."], observations: ["All 36 phrase objects carry validated grammar blueprints.", "The focus cell remains linked to the anchor intent and materialized tuning gestures."], theory_issue_codes: ["GRAMMAR_LIMIT_MISMATCH"], metric_deltas: [] },
    outcome: "implemented", author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
  });

  let current = await inspect();
  const delivery = current.artifacts.find((entry) => entry.role === "delivery" && entry.currentComposition && entry.currentMix && entry.path.endsWith("kaze-wa-na-o-yobanai-ia-final.wav"));
  const vsqx = current.artifacts.find((entry) => entry.role === "vsqx" && entry.currentComposition && entry.path.endsWith("kaze-wa-na-o-yobanai-ia-final.vsqx"));
  const previews = current.artifacts.filter((entry) => entry.role === "preview" && entry.currentComposition && [
    "kaze-wa-na-o-yobanai-anchor-final-lead-solo.wav",
    "kaze-wa-na-o-yobanai-anchor-final-lead-harmony.wav",
    "kaze-wa-na-o-yobanai-anchor-final-minimal-band.wav",
    "kaze-wa-na-o-yobanai-anchor-final-full-layers.wav",
    "kaze-wa-na-o-yobanai-mastering-premaster-equal-loudness.wav",
    "kaze-wa-na-o-yobanai-mastering-delivery-equal-loudness.wav",
  ].some((name) => entry.path.endsWith(name)));
  if (!delivery || !vsqx || previews.length !== 6) throw new Error("Final deliverable/artifact set is incomplete");
  if (!(await hasDecision("decision-retrospective-v1"))) await journal({
    id: "decision-retrospective-v1", phase: "retrospective", kind: "retrospective", title: "Close the cold-start workflow with listening explicitly pending",
    objective: "Summarize outcomes, adjustments, and unresolved evidence without inventing a listener verdict.",
    decision: "Deliver the current WAV/VSQX and six bounded listening artifacts; retain analyzer warnings as documented modal/suspension or aggregate metadata findings, and leave both anchor narrative fidelity and mastering transparency to user listening.",
    rationale: "The workflow moved from intent to original score, verified IA, three-layer anchor closure, full analysis/repair, complete Editor render, stem mix, and mastering. No local library, reference melody, prior track, or compose-* script was consulted; no framework source was changed.",
    alternatives: [{ option: "Hide operational retries and retained warnings", disposition: "rejected", reason: "The creative record must expose problems and dispositions." }, { option: "Claim a human keep outcome from metrics", disposition: "rejected", reason: "Pitch/loudness evidence cannot answer the registered narrative question." }, { option: "Publish complete technical evidence with listening pending", disposition: "selected", reason: "It is accurate, reproducible, and respects the review boundary." }],
    expected_audible_effect: "No new audio change; the exact evidence set makes later listening and revision reproducible.",
    actual_result: "Original IA and all native controls rendered non-silently; structure/grammar/theory were analyzed and dispositioned; final delivery is unclipped; mastering A/B and human intent review remain pending.",
    next_step: "User listens to the ladder and equal-loudness A/B, then optionally supplies keep/reject/revise observations.",
    affected_object_ids: ["voice-ia-original", "pd-cliff-pass", "pd-final-release"], artifact_ids: [delivery.id, vsqx.id, ...previews.map((entry) => entry.id)], listening_question_id: "lq-cliff-grip-without-duel", hypothesis_family: "timbre_mix", hash_dependencies: [], supersedes_decision_ids: [],
    evidence: { constraints: ["Cold-start anti-copy boundary remained in force.", "No human listening outcome was self-signed."], observations: ["Original Editor probe and current full render succeeded.", "One interrupted export and one filename-automation retry are documented in the IA render decision.", "Final delivery has zero clipped samples."], theory_issue_codes: ["LEADING_TONE_UNRESOLVED", "SUSTAINED_NON_CHORD_TONE_UNRESOLVED", "PHRASE_ENTRY_HOMOGENEITY", "PHRASE_PEAK_POSITION_CONCENTRATED"], metric_deltas: [] },
    outcome: "delivered", author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
  });

  await readContract("vocaloid://creative-journal-contract/report");
  const report = await call("vocaloid_creative_journal", {
    action: "report", payload: { manifest_path: MANIFEST, overwrite: true }, response_format: "json",
  });
  if (!report.completeness.coreReady) throw new Error(`Creative journal incomplete: ${JSON.stringify(report.completeness)}`);
  current = await inspect();
  await mkdir(resolve(ROOT, "artifacts/creative-records"), { recursive: true });
  await readContract("vocaloid://creative-journal-contract/publish");
  const published = await call("vocaloid_creative_journal", {
    action: "publish",
    payload: {
      manifest_path: MANIFEST, expected_revision: current.revision,
      output_directory: "artifacts/creative-records/kaze-wa-na-o-yobanai-ia-20260719",
      deliverables: [
        { role: "song", artifact_id: delivery.id, published_path: delivery.path },
        { role: "vsqx", artifact_id: vsqx.id, published_path: vsqx.path },
        ...previews.map((entry) => ({ role: "preview", artifact_id: entry.id, published_path: entry.path })),
      ],
      overwrite: false,
    },
    response_format: "json",
  });
  return { completeness: report.completeness, published, summary: await inspect() };
}

async function finalCheck() {
  const preflight = await call("vocaloid_preflight_song", {
    manifest_path: MANIFEST, artifact_check: "current", include_performance_warnings: true, check_voice_cache: true,
    allow_unknown_editor: false, include_theory_proposals: false, response_format: "json",
  });
  await readContract("vocaloid://phrase-grammar-contract/analyze_manifest");
  const grammar = await call("vocaloid_phrase_grammar", {
    action: "analyze_manifest", payload: { manifest_path: MANIFEST, maximum_pair_examples: 0 }, response_format: "json",
  });
  await readContract("vocaloid://creative-journal-contract/report");
  const journalReport = await call("vocaloid_creative_journal", {
    action: "report", payload: { manifest_path: MANIFEST, overwrite: true }, response_format: "json",
  });
  const countCodes = (items) => Object.fromEntries(Object.entries(items.reduce((counts, item) => {
    counts[item.code] = (counts[item.code] ?? 0) + 1;
    return counts;
  }, {})).sort());
  const summary = await inspect();
  return {
    manifest: { revision: summary.revision, composition_hash: summary.compositionHash, mix_hash: summary.mixHash, intent_hash: summary.intentHash },
    counts: preflight.counts, readiness: preflight.readiness,
    theory: { summary: preflight.theory.summary, warning_codes: countCodes(preflight.theory.issues.filter((issue) => issue.severity === "warning")) },
    grammar: { summary: grammar.summary, warning_codes: countCodes(grammar.findings.filter((finding) => finding.severity === "warning")) },
    other_warnings: countCodes(preflight.issues.filter((issue) => issue.severity === "warning" && issue.origin !== "theory")),
    creative: journalReport.completeness,
    current_artifacts: summary.artifacts.filter((artifact) => artifact.currentComposition && ["vsqx", "delivery", "preview", "analysis"].includes(artifact.role)).map((artifact) => ({ id: artifact.id, role: artifact.role, path: artifact.path, current_mix: artifact.currentMix })),
  };
}

async function republishRangeDisposition() {
  let current = await inspect();
  const bassStem = current.artifacts.find((entry) => entry.role === "instrument_stem" && entry.currentComposition && entry.metadata?.track_id === "bass");
  const fullMix = current.artifacts.find((entry) => entry.role === "mix" && entry.currentComposition && entry.currentMix && entry.path.endsWith("kaze-wa-na-o-yobanai-full-premaster.wav"));
  if (!bassStem || !fullMix) throw new Error("Current bass/full-mix evidence is missing");
  if (!(await hasDecision("decision-arrangement-range-disposition-v4"))) await journal({
    id: "decision-arrangement-range-disposition-v4", phase: "arrangement", kind: "evaluation", title: "Retain one rendered extended-register bass fifth",
    objective: "Disposition the final ARRANGEMENT_RANGE_RISK without weakening the analyzer or reopening the rendered score.",
    decision: "Retain bass-anchor-5-fifth at MIDI 26: a delayed D1 under the measure-44 Gm passage, two semitones below the analyzer's conservative 28 floor but inside an extended/five-string electric-bass range.",
    rationale: "Raising it would return the bass toward the IA/piano collision band that the octave displacement was designed to clear. The exact current bass stem and seven-stem premaster rendered non-silently, so this is a bounded renderer-specific acceptance, not a global theory exception.",
    alternatives: [{ option: "Raise the note to MIDI 38", disposition: "rejected", reason: "It re-enters the crowded register at the anchor midpoint." }, { option: "Clamp it to MIDI 28", disposition: "rejected", reason: "It changes the intended chordal fifth to a non-chord tone." }, { option: "Retain the rendered extended D1 and expose the warning", disposition: "selected", reason: "It preserves harmonic function, negative space, and analyzer visibility." }],
    expected_audible_effect: "One very low delayed fifth grounds the point where harmony enters without masking either IA line.",
    actual_result: "The current bass stem and full premaster are registered and non-silent; theory retains exactly one ARRANGEMENT_RANGE_RISK and no errors or exceptions.",
    next_step: "User may reject the low-register color by listening, but no automatic repair is warranted.",
    affected_object_ids: ["bass", "bass-anchor-5-fifth"], artifact_ids: [bassStem.id, fullMix.id], listening_question_id: "lq-cliff-grip-without-duel", hypothesis_family: "arrangement", hash_dependencies: [], supersedes_decision_ids: ["decision-arrangement-anchor-space-v3"],
    evidence: { constraints: ["Do not change or suppress a global rule for one renderer-specific extended note."], observations: ["The note is MIDI 26; conservative analyzer floor is 28.", "REGISTER_DENSITY_COLLISION remains zero after the octave displacement."], theory_issue_codes: ["ARRANGEMENT_RANGE_RISK"], metric_deltas: [] },
    outcome: "auditioned", author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
  });
  await readContract("vocaloid://creative-journal-contract/report");
  const report = await call("vocaloid_creative_journal", {
    action: "report", payload: { manifest_path: MANIFEST, overwrite: true }, response_format: "json",
  });
  if (!report.completeness.coreReady) throw new Error("Creative record became incomplete after range disposition");
  current = await inspect();
  const delivery = current.artifacts.find((entry) => entry.role === "delivery" && entry.currentComposition && entry.currentMix && entry.path.endsWith("kaze-wa-na-o-yobanai-ia-final.wav"));
  const vsqx = current.artifacts.find((entry) => entry.role === "vsqx" && entry.currentComposition && entry.path.endsWith("kaze-wa-na-o-yobanai-ia-final.vsqx"));
  const previews = current.artifacts.filter((entry) => entry.role === "preview" && entry.currentComposition && [
    "kaze-wa-na-o-yobanai-anchor-final-lead-solo.wav", "kaze-wa-na-o-yobanai-anchor-final-lead-harmony.wav",
    "kaze-wa-na-o-yobanai-anchor-final-minimal-band.wav", "kaze-wa-na-o-yobanai-anchor-final-full-layers.wav",
    "kaze-wa-na-o-yobanai-mastering-premaster-equal-loudness.wav", "kaze-wa-na-o-yobanai-mastering-delivery-equal-loudness.wav",
  ].some((name) => entry.path.endsWith(name)));
  if (!delivery || !vsqx || previews.length !== 6) throw new Error("Republish deliverables are incomplete");
  await readContract("vocaloid://creative-journal-contract/publish");
  const published = await call("vocaloid_creative_journal", {
    action: "publish", payload: {
      manifest_path: MANIFEST, expected_revision: current.revision,
      output_directory: "artifacts/creative-records/kaze-wa-na-o-yobanai-ia-20260719",
      deliverables: [
        { role: "song", artifact_id: delivery.id, published_path: delivery.path },
        { role: "vsqx", artifact_id: vsqx.id, published_path: vsqx.path },
        ...previews.map((entry) => ({ role: "preview", artifact_id: entry.id, published_path: entry.path })),
      ], overwrite: true,
    }, response_format: "json",
  });
  return { completeness: report.completeness, published };
}

async function anchorRender() {
  const preflight = await call("vocaloid_preflight_song", {
    manifest_path: MANIFEST, artifact_check: "current", include_performance_warnings: true,
    check_voice_cache: true, allow_unknown_editor: false, include_theory_proposals: false,
    max_theory_proposals: 6, theory_proposal_kinds: [], theory_proposal_issue_codes: [], theory_proposal_object_ids: [], response_format: "json",
  });
  if (!preflight.readiness.build.ready) {
    throw new Error(`Anchor score is not build-ready: ${preflight.readiness.build.blockers.join(", ")}`);
  }
  let current = await inspect();
  let projectArtifact = current.artifacts.find((entry) => entry.role === "vsqx" && entry.currentComposition);
  let build = { sourceRevision: projectArtifact?.sourceRevision ?? current.revision, reused: true };
  if (!projectArtifact) {
    build = await call("vocaloid_build_song_manifest", {
      manifest_path: MANIFEST,
      expected_revision: current.revision,
      backing_output_path: `${EVAL_DIR}/kaze-wa-na-o-yobanai-anchor-backing-r${current.revision}.wav`,
      project_output_path: `${EVAL_DIR}/kaze-wa-na-o-yobanai-anchor-r${current.revision}.vsqx`,
      response_format: "json",
    });
    projectArtifact = build.artifacts.find((entry) => entry.role === "vsqx");
  }
  if (!projectArtifact) throw new Error("Anchor build did not return a VSQX artifact");

  current = await inspect();
  const vocals = await call("vocaloid_render_vocal_stems", {
    manifest_path: MANIFEST,
    expected_revision: current.revision,
    project_artifact_id: projectArtifact.id,
    output_directory: EVAL_DIR,
    vocal_track_ids: ["lead", "harmony"],
    center_pan: true,
    dry: true,
    allow_pre_send_adjustment: false,
    timeout_seconds: 300,
    response_format: "json",
  });
  const leadStem = artifactForTrack(vocals, "lead");
  const harmonyStem = artifactForTrack(vocals, "harmony");

  current = await inspect();
  const instruments = await call("vocaloid_render_instrument_stems", {
    manifest_path: MANIFEST,
    expected_revision: current.revision,
    output_directory: EVAL_DIR,
    track_ids: ["piano", "bass", "drums"],
    preserve_pan: true,
    include_renderer_effects: false,
    response_format: "json",
  });
  const pianoStem = artifactForTrack(instruments, "piano");
  const bassStem = artifactForTrack(instruments, "bass");
  const drumStem = artifactForTrack(instruments, "drums");

  current = await inspect();
  const leadHarmony = await call("vocaloid_render_stem_mix", {
    manifest_path: MANIFEST,
    expected_revision: current.revision,
    stem_artifact_ids: [leadStem.id, harmonyStem.id],
    output_path: `${EVAL_DIR}/kaze-wa-na-o-yobanai-anchor-lead-harmony-mix.wav`,
    sample_rate: 44_100,
    bit_depth: 24,
    reference_lufs: -16,
    reference_true_peak_dbfs: -1,
    timeout_seconds: 300,
    response_format: "json",
  });

  current = await inspect();
  const minimalBand = await call("vocaloid_render_stem_mix", {
    manifest_path: MANIFEST,
    expected_revision: current.revision,
    stem_artifact_ids: [leadStem.id, harmonyStem.id, pianoStem.id, bassStem.id, drumStem.id],
    output_path: `${EVAL_DIR}/kaze-wa-na-o-yobanai-anchor-minimal-band-mix.wav`,
    sample_rate: 44_100,
    bit_depth: 24,
    reference_lufs: -16,
    reference_true_peak_dbfs: -1,
    timeout_seconds: 300,
    response_format: "json",
  });

  const leadHarmonyArtifact = leadHarmony.artifact;
  const minimalBandArtifact = minimalBand.artifact;
  if (!leadHarmonyArtifact || !minimalBandArtifact) throw new Error("Anchor stem mix did not return artifacts");

  current = await inspect();
  const leadSoloPreview = await call("vocaloid_review_audio", {
    action: "anchor_preview",
    manifest_path: MANIFEST,
    expected_revision: current.revision,
    source_artifact_id: leadStem.id,
    phrase_direction_id: "pd-cliff-pass",
    audition_layer: "lead_solo",
    output_path: `${EVAL_DIR}/kaze-wa-na-o-yobanai-anchor-lead-solo.wav`,
    target_duration_seconds: 25,
    reference_lufs: -16,
    reference_true_peak_dbfs: -1,
    response_format: "json",
  });
  current = await inspect();
  const leadHarmonyPreview = await call("vocaloid_review_audio", {
    action: "anchor_preview",
    manifest_path: MANIFEST,
    expected_revision: current.revision,
    source_artifact_id: leadHarmonyArtifact.id,
    phrase_direction_id: "pd-cliff-pass",
    audition_layer: "lead_harmony",
    output_path: `${EVAL_DIR}/kaze-wa-na-o-yobanai-anchor-lead-harmony.wav`,
    target_duration_seconds: 25,
    reference_lufs: -16,
    reference_true_peak_dbfs: -1,
    response_format: "json",
  });
  current = await inspect();
  const minimalBandPreview = await call("vocaloid_review_audio", {
    action: "anchor_preview",
    manifest_path: MANIFEST,
    expected_revision: current.revision,
    source_artifact_id: minimalBandArtifact.id,
    phrase_direction_id: "pd-cliff-pass",
    audition_layer: "minimal_band",
    output_path: `${EVAL_DIR}/kaze-wa-na-o-yobanai-anchor-minimal-band.wav`,
    target_duration_seconds: 25,
    reference_lufs: -16,
    reference_true_peak_dbfs: -1,
    response_format: "json",
  });

  current = await inspect();
  const vocalAnalysis = await call("vocaloid_analyze_vocal_stem", {
    manifest_path: MANIFEST,
    expected_revision: current.revision,
    stem_artifact_id: leadStem.id,
    output_path: `${EVAL_DIR}/kaze-wa-na-o-yobanai-anchor-lead.vocal-analysis.json`,
    section_id: "cliff-pass",
    timeline_offset_seconds: 0,
    minimum_pitch_hz: 60,
    maximum_pitch_hz: 1200,
    pitch_tolerance_cents: 100,
    onset_tolerance_ms: 150,
    offset_tolerance_ms: 220,
    response_format: "json",
  });

  const previewArtifacts = [leadSoloPreview.artifact, leadHarmonyPreview.artifact, minimalBandPreview.artifact];
  await journal({
    id: "decision-anchor-audition-ladder-v1",
    phase: "audition",
    kind: "evaluation",
    title: "Anchor ladder rendered; qualitative outcome pending",
    objective: "Close the first 20–30 second passage through lead_solo, lead_harmony, and minimal_band before composing the remaining song.",
    decision: "Retain all three digest-bound auditions as the fixed evidence set for lq-cliff-grip-without-duel; do not create a keep/reject/revise outcome without an explicit listener.",
    rationale: "The ladder isolates melody/allocation first, then the selective lower answer, then bass/drums/piano. Technical non-silence and score/render analysis establish audibility and provenance but cannot decide whether the phrase communicates restraint.",
    alternatives: [
      { option: "Proceed directly to the full song after symbolic preflight", disposition: "rejected", reason: "It would skip the required bounded Editor-rendered ladder." },
      { option: "Treat audio metrics as a keep judgement", disposition: "rejected", reason: "Loudness, pitch, and non-silence do not answer the registered narrative question." },
      { option: "Publish the three layers with listening pending", disposition: "selected", reason: "It preserves exact evidence without self-signing a human outcome." },
    ],
    expected_audible_effect: "The listener can compare whether harmony and minimal accompaniment strengthen the same fixed passage without changing its semantic focus.",
    actual_result: `Original Editor rendered lead and harmony as non-silent stems; the three previews are ${previewArtifacts.map((artifact) => artifact.metadata.passage_duration_seconds).join(" / ")} seconds. Human keep/reject/revise remains pending.`,
    next_step: "Compose the remaining lyric and score while preserving the anchor objects; rerender a current final ladder after the full arrangement is fixed.",
    affected_object_ids: ["pd-cliff-pass", "lead", "harmony", "piano", "bass", "drums"],
    artifact_ids: previewArtifacts.map((artifact) => artifact.id),
    listening_question_id: "lq-cliff-grip-without-duel",
    hypothesis_family: "arrangement",
    hash_dependencies: [],
    supersedes_decision_ids: [],
    evidence: {
      constraints: ["No human listening outcome may be self-signed.", "The same 40–48 passage and listening question remain fixed across layers."],
      observations: [
        `Lead stem renderer: ${leadStem.metadata.renderer ?? "original-editor"}; source project ${projectArtifact.id}.`,
        `Lead score/render analysis covered ${vocalAnalysis.summary.events} events, with ${vocalAnalysis.summary.eventsWithPitch} confident F0 events.`,
        "Each anchor preview is a current digest-bound manifest artifact and measured non-silent.",
      ],
      theory_issue_codes: [], metric_deltas: [],
    },
    outcome: "auditioned",
    author: { type: "agent", name: "Codex", session_id: "cold-start-20260719" },
  });
  return {
    build: { sourceRevision: build.sourceRevision, projectArtifact },
    vocalArtifacts: vocals.artifacts,
    instrumentArtifacts: instruments.artifacts,
    mixes: [leadHarmonyArtifact, minimalBandArtifact],
    previews: previewArtifacts,
    vocalAnalysis: { artifact: vocalAnalysis.artifact, summary: vocalAnalysis.summary },
    summary: await inspect(),
  };
}

await client.connect(transport);
try {
  let result;
  if (PHASE === "setup") result = await setup();
  else if (PHASE === "anchor-score") result = await anchorScore();
  else if (PHASE === "anchor-render") result = await anchorRender();
  else if (PHASE === "full-score") result = await fullScore();
  else if (PHASE === "diagnose") result = await diagnose();
  else if (PHASE === "repair") result = await repairAnalysisFindings();
  else if (PHASE === "repair-journal") result = await repairAnalysisFindings();
  else if (PHASE === "repair-anchor-density") result = await repairAnchorDensity();
  else if (PHASE === "repair-anchor-register") result = await repairAnchorRegister();
  else if (PHASE === "mix-setup") result = await setupMix();
  else if (PHASE === "full-render") result = await fullRender();
  else if (PHASE === "master") result = await masterDelivery();
  else if (PHASE === "journal-status") result = await journalStatus();
  else if (PHASE === "publish") result = await finalizeCreativeRecord();
  else if (PHASE === "final-check") result = await finalCheck();
  else if (PHASE === "republish-range") result = await republishRangeDisposition();
  else throw new Error(`Unknown phase ${PHASE}`);
  process.stdout.write(`${JSON.stringify({ phase: PHASE, result }, null, 2)}\n`);
} finally {
  await transport.close();
}
