import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import { analyzeManifestPhraseGrammar } from "../src/phrase-grammar-analysis.js";
import {
  PHRASE_GRAMMAR_COMPONENTS,
  PhraseGrammarBlueprintSchema,
  type PhraseGrammarBlueprint,
  listPhraseGrammar,
  phraseGrammarIndex,
  validatePhraseGrammarBlueprint,
} from "../src/phrase-grammar.js";
import {
  createSongManifest,
  loadSongManifest,
  upsertSongManifestVocalPart,
} from "../src/song-manifest.js";


const ROOT = resolve(".");

function blueprint(): PhraseGrammarBlueprint {
  return {
    schema: "vocaloid-phrase-grammar/v1" as const,
    id: "grammar.fixture-phrase",
    melody_authorship: "agent_composed",
    bundle_usage: "selection_only",
    components: {
      role: "role.statement",
      entry: "entry.downbeat",
      contour: ["contour.arch"],
      rhythm: ["rhythm.syllabic-even"],
      motion: ["motion.stepwise"],
      cadence: "cadence.downward-release",
      development: "development.new",
      allocation: ["allocation.syllabic"],
      articulation: ["articulation.legato-flow"],
      space: ["space.tail-rest"],
    },
    source_bundle_ids: ["ia.transparent-longline"],
    preserve_dimensions: [],
    change_dimensions: ["contour", "rhythm"],
    limits: { stepwise_ratio: [0.2, 0.7] as [number, number] },
  };
}

test("phrase grammar exposes bounded components, bundles, and strict blueprints", () => {
  const index = phraseGrammarIndex();
  assert.equal(index.schema, "vocaloid-phrase-grammar/v1");
  assert.ok(index.total_components >= 70);
  assert.ok(index.bundles.length >= 8);
  assert.equal(new Set(PHRASE_GRAMMAR_COMPONENTS.map((entry) => entry.id)).size, PHRASE_GRAMMAR_COMPONENTS.length);

  const contour = listPhraseGrammar({ category: "contour", offset: 0, limit: 100 });
  assert.ok(contour.items.length >= 12);
  assert.ok(contour.items.every((entry) => entry.category === "contour"));
  const rocks = listPhraseGrammar({ bundleId: "ia.rocks-forward", offset: 0, limit: 100 });
  assert.equal(rocks.bundle?.id, "ia.rocks-forward");
  assert.ok(rocks.items.some((entry) => entry.id === "contour.leap-hold-release"));

  const validation = validatePhraseGrammarBlueprint(blueprint());
  assert.equal(validation.valid, true);
  assert.equal(validation.blueprint.id, "grammar.fixture-phrase");
  assert.ok(validation.selected_components.some((entry) => entry.id === "motion.stepwise"));

  assert.throws(
    () => PhraseGrammarBlueprintSchema.parse({
      ...blueprint(),
      components: { ...blueprint().components, contour: ["contour.unknown"] },
    }),
    /Unknown phrase-grammar component contour\.unknown/u,
  );
  assert.throws(
    () => PhraseGrammarBlueprintSchema.parse({
      ...blueprint(),
      components: {
        ...blueprint().components,
        articulation: ["articulation.legato-flow", "articulation.detached"],
      },
    }),
    /Select detached or legato-flow/u,
  );
});

test("phrase grammar analysis detects homogeneous phrase construction without mutating theory preflight", async (context) => {
  const temporary = await mkdtemp(join(ROOT, ".test-phrase-grammar-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "phrase-grammar.song.json");
  await createSongManifest({
    outputPath: manifestPath,
    songId: "phrase-grammar-song",
    slug: "phrase-grammar-song",
    title: "Phrase Grammar Song",
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 120 }],
    sections: [{ id: "verse", name: "Verse", kind: "verse", start: { measure: 0, beat: 0 }, end: { measure: 8, beat: 0 } }],
    keyChanges: [{ id: "key-c", position: { measure: 0, beat: 0 }, tonic: "C", mode: "major" }],
    chordChanges: [{ id: "chord-c", position: { measure: 0, beat: 0 }, symbol: "C", duration_ticks: 15_360 }],
    sampleRate: 44_100,
    gain: 0.2,
    reverb: false,
    chorus: false,
    overwrite: false,
  });
  const pitches = [60, 62, 64, 65, 64, 62];
  const phrases = Array.from({ length: 8 }, (_, phraseIndex) => ({
    id: `phrase-${phraseIndex}`,
    start: { measure: phraseIndex, beat: 0, tick: 0 },
    allocation: "sequential" as const,
    lyrics: pitches.map((_, lyricIndex) => ({
      id: `phrase-${phraseIndex}-lyric-${lyricIndex}`,
      lyric: "あ",
      phonemes: "a",
      phoneme_locked: true,
    })),
    cells: pitches.map((noteNumber, cellIndex) => ({
      id: `phrase-${phraseIndex}-cell-${cellIndex}`,
      duration: 240,
      rest: false,
      note_number: noteNumber,
      gate_percent: 100,
      velocity: 64,
      style: {},
    })),
    ...(phraseIndex === 0 ? { grammar_blueprint: blueprint() } : {}),
  }));
  await upsertSongManifestVocalPart(
    manifestPath,
    manifestPath,
    1,
    { id: "voice-ia", name: "IA", component_id: "BLRGDDR4M3WM2LC6" },
    { id: "lead", name: "Lead", voice_id: "voice-ia" },
    {
      id: "lead-part",
      section_id: "verse",
      name: "Lead Part",
      start: { measure: 0, beat: 0 },
      end: { measure: 8, beat: 0 },
      notes: [],
      phrases,
    },
    true,
  );
  const manifest = (await loadSongManifest(manifestPath)).manifest;
  assert.equal(manifest.vocal_tracks[0]?.parts[0]?.phrases[0]?.grammar_blueprint?.id, "grammar.fixture-phrase");
  const before = structuredClone(manifest);
  const report = analyzeManifestPhraseGrammar(manifest, { maximumPairExamples: 4 });
  assert.deepEqual(manifest, before);
  assert.equal(report.summary.phrases, 8);
  assert.equal(report.summary.blueprints, 1);
  const codes = new Set(report.findings.map((finding) => finding.code));
  assert.ok(codes.has("PHRASE_ENTRY_HOMOGENEITY"));
  assert.ok(codes.has("PHRASE_MOTION_OVERCONCENTRATED"));
  assert.ok(codes.has("PHRASE_CONTOUR_CLUSTER_HIGH"));
  assert.ok(codes.has("PHRASE_RHYTHM_FINGERPRINT_NARROW"));
  assert.ok(codes.has("GRAMMAR_LIMIT_MISMATCH"));
});
