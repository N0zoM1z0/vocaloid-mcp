import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { previewSongManifestMutation } from "../src/mutation-preview.js";
import {
  createSongManifest,
  loadSongManifest,
  setSongManifestCompositionIntent,
  transformSongManifestEvents,
  upsertSongManifestVocalPart,
} from "../src/song-manifest.js";
import { analyzeManifestTheory } from "../src/theory/analyze.js";
import { proposeTheoryRepairs, type TheoryProposalKind } from "../src/theory/proposals.js";


async function proposalFixture(directory: string): Promise<string> {
  const manifestPath = join(directory, "proposal-fixture.song.json");
  await createSongManifest({
    outputPath: manifestPath,
    songId: "proposal-fixture",
    slug: "proposal-fixture",
    title: "Proposal Fixture",
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 120 }],
    sections: [{
      id: "song",
      name: "Song",
      kind: "custom",
      start: { measure: 0, beat: 0 },
      end: { measure: 16, beat: 0 },
    }],
    keyChanges: [{ id: "key-c", position: { measure: 0, beat: 0 }, tonic: "C", mode: "major" }],
    chordChanges: [{ id: "chord-c", position: { measure: 0, beat: 0 }, symbol: "C", duration_ticks: 30_720 }],
    sampleRate: 44_100,
    gain: 0.2,
    reverb: false,
    chorus: false,
    overwrite: false,
  });
  const voice = { id: "voice-ia", name: "IA", component_id: "BLRGDDR4M3WM2LC6" };
  const longHighRun = Array.from({ length: 28 }, (_, index) => ({
    id: `run-${index.toString().padStart(2, "0")}`,
    position: { measure: 1 + Math.floor(index / 4), beat: index % 4 },
    duration: 480,
    note_number: 84,
    lyric: "あ",
    phonemes: "a",
    phoneme_locked: true,
  }));
  await upsertSongManifestVocalPart(
    manifestPath,
    manifestPath,
    1,
    voice,
    { id: "lead", name: "Lead", voice_id: voice.id },
    {
      id: "lead-part",
      section_id: "song",
      name: "Lead Part",
      start: { measure: 0, beat: 0 },
      end: { measure: 12, beat: 0 },
      notes: [
        { id: "lead-start", position: { measure: 0, beat: 0 }, duration: 480, note_number: 60, lyric: "こ", phonemes: "k o", phoneme_locked: true },
        { id: "lead-leap", position: { measure: 0, beat: 1 }, duration: 480, note_number: 72, lyric: "え", phonemes: "e", phoneme_locked: true },
        ...longHighRun,
        { id: "lead-color", position: { measure: 9, beat: 0 }, duration: 480, note_number: 61, lyric: "い", phonemes: "i", phoneme_locked: true },
        { id: "lead-cross", position: { measure: 10, beat: 0 }, duration: 480, note_number: 60, lyric: "あ", phonemes: "a", phoneme_locked: true },
        { id: "lead-clash", position: { measure: 10, beat: 1 }, duration: 480, note_number: 60, lyric: "う", phonemes: "M", phoneme_locked: true },
        { id: "lead-upper-reference", position: { measure: 10, beat: 2 }, duration: 480, note_number: 60, lyric: "え", phonemes: "e", phoneme_locked: true },
      ],
    },
    true,
  );
  await upsertSongManifestVocalPart(
    manifestPath,
    manifestPath,
    2,
    voice,
    { id: "harmony", name: "Harmony", voice_id: voice.id },
    {
      id: "harmony-part",
      section_id: "song",
      name: "Harmony Part",
      start: { measure: 10, beat: 0 },
      end: { measure: 11, beat: 0 },
      notes: [
        { id: "harmony-cross", position: { measure: 10, beat: 0 }, duration: 480, note_number: 59, lyric: "あ", phonemes: "a", phoneme_locked: true },
        { id: "harmony-clash", position: { measure: 10, beat: 1 }, duration: 480, note_number: 61, lyric: "う", phonemes: "M", phoneme_locked: true },
        { id: "harmony-upper-reference", position: { measure: 10, beat: 2 }, duration: 480, note_number: 72, lyric: "え", phonemes: "e", phoneme_locked: true },
      ],
    },
    true,
  );
  await setSongManifestCompositionIntent(manifestPath, manifestPath, 3, {
    schema: "vocaloid-composition-intent/v1",
    song: {
      premise: "A withheld thought becomes audible.",
      central_tension: "Directness could become force.",
      state_at_start: "Held close.",
      intended_destination: "Clear but restrained.",
    },
    sections: [{
      id: "intent-song",
      section_id: "song",
      dramatic_function: "Move from restraint to one clear arrival.",
      state_before: "Held close.",
      intended_transition: "Let one leap reveal the thought.",
      state_after: "Clear but restrained.",
    }],
    phrase_directions: [{
      id: "anchor-thought",
      section_id: "song",
      importance: "anchor",
      purpose: "Let the arrival become clear without turning into a shout.",
      semantic_focus: "The arrival vowel.",
      state_before: "Held close.",
      intended_transition: "Rise once into clarity.",
      state_after: "Direct and still.",
      delivery_arc: "Narrow opening, one clear arrival, then release.",
      listening_question: {
        id: "question-thought",
        question: "Does the thought become clear without sounding like a shout?",
      },
      realization_links: {
        event_ids: ["lead-start", "lead-leap"],
        semantic_focus_object_ids: ["lead-leap"],
        track_ids: ["lead"],
      },
    }],
  }, true);
  return manifestPath;
}

test("bounded theory proposals cover the five A4 families deterministically without mutating input", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-theory-proposals-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = await proposalFixture(temporary);
  const manifest = (await loadSongManifest(manifestPath)).manifest;
  const before = JSON.stringify(manifest);
  const theory = analyzeManifestTheory(manifest);
  const expected: Array<[string, TheoryProposalKind]> = [
    ["VOICE_CROSSING", "voicing"],
    ["SUSTAINED_NON_CHORD_TONE_UNRESOLVED", "harmony"],
    ["LARGE_LEAP_UNBALANCED", "repair"],
    ["VOCAL_TESSITURA_STRAIN", "diatonic_transpose"],
    ["PHRASE_WITHOUT_BREATH", "breath"],
  ];
  const codes = new Set(theory.issues.map((issue) => issue.code));
  for (const [code, kind] of expected) {
    assert.ok(codes.has(code), `fixture should emit ${code}`);
    const first = proposeTheoryRepairs(manifest, { maxCandidates: 3, issueCodes: [code] }, theory);
    const second = proposeTheoryRepairs(manifest, { maxCandidates: 3, issueCodes: [code] }, theory);
    assert.deepEqual(second, first);
    assert.ok(first.candidates.some((candidate) => candidate.kind === kind), `${code} should yield ${kind}`);
    assert.ok(first.candidates.length <= 3);
    assert.ok(first.candidates.every((candidate) => candidate.apply.requiredDryRun));
    assert.ok(first.candidates.every((candidate) => candidate.predictedDelta.verification === "vocaloid_edit_song_dry_run"));
  }
  assert.equal(JSON.stringify(manifest), before);
  const broad = proposeTheoryRepairs(manifest, { maxCandidates: 8 }, theory);
  const perDirection = broad.candidates.filter((candidate) =>
    candidate.listeningCheck.phraseDirectionId === "anchor-thought");
  assert.ok(perDirection.length <= 3);
  assert.equal(broad.constraints.maxCandidatesPerPhraseDirection, 3);
});

test("proposal alternatives preserve the declared phrase question and stay revision/hash bound", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-theory-proposal-intent-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = await proposalFixture(temporary);
  const manifest = (await loadSongManifest(manifestPath)).manifest;
  const report = proposeTheoryRepairs(manifest, {
    maxCandidates: 3,
    issueCodes: ["LARGE_LEAP_UNBALANCED"],
    objectIds: ["lead-leap"],
  });
  assert.ok(report.candidates.length >= 1);
  assert.equal(new Set(report.candidates.map((candidate) => candidate.hypothesis.groupId)).size, 1);
  assert.equal(new Set(report.candidates.map((candidate) => candidate.listeningCheck.question)).size, 1);
  for (const candidate of report.candidates) {
    assert.equal(candidate.listeningCheck.questionSource, "composition_intent");
    assert.equal(candidate.listeningCheck.phraseDirectionId, "anchor-thought");
    assert.equal(candidate.listeningCheck.listeningQuestionId, "question-thought");
    assert.equal(candidate.listeningCheck.question, "Does the thought become clear without sounding like a shout?");
    assert.equal(candidate.apply.expectedRevision, manifest.revision);
    assert.equal(candidate.apply.compositionHash, manifest.composition_hash);
  }
});

test("a generated transform blueprint is accepted by the existing dry-run path and leaves canonical data unchanged", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-theory-proposal-preview-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = await proposalFixture(temporary);
  const before = (await loadSongManifest(manifestPath)).manifest;
  const candidate = proposeTheoryRepairs(before, {
    maxCandidates: 3,
    issueCodes: ["LARGE_LEAP_UNBALANCED"],
    objectIds: ["lead-leap"],
  }).candidates.find((entry) => entry.apply.strategy === "transform_events");
  if (!candidate || candidate.apply.strategy !== "transform_events") {
    assert.fail("expected a transform_events proposal");
  }
  const transform = candidate.apply.transform;
  const preview = await previewSongManifestMutation(manifestPath, before.revision, (path) =>
    transformSongManifestEvents(path, path, before.revision, transform, true));
  assert.equal(preview.dryRun, true);
  assert.ok(preview.totalChanges > 0);
  assert.ok(preview.analysisDelta.resolvedIssueCodes.includes("LARGE_LEAP_UNBALANCED"));

  const crossingCandidate = proposeTheoryRepairs(before, {
    maxCandidates: 3,
    issueCodes: ["VOICE_CROSSING"],
    objectIds: ["harmony-cross"],
  }).candidates.find((entry) => entry.apply.strategy === "transform_events");
  if (!crossingCandidate || crossingCandidate.apply.strategy !== "transform_events") {
    assert.fail("expected a crossing transform proposal");
  }
  const crossingTransform = crossingCandidate.apply.transform;
  const crossingPreview = await previewSongManifestMutation(manifestPath, before.revision, (path) =>
    transformSongManifestEvents(path, path, before.revision, crossingTransform, true));
  assert.ok(crossingPreview.analysisDelta.resolvedIssueCodes.includes("VOICE_CROSSING"));
  const after = (await loadSongManifest(manifestPath)).manifest;
  assert.equal(after.revision, before.revision);
  assert.equal(after.content_hash, before.content_hash);
});

test("proposal filters, candidate budgets, and source-report freshness are enforced", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-theory-proposal-bounds-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = await proposalFixture(temporary);
  const manifest = (await loadSongManifest(manifestPath)).manifest;
  const filtered = proposeTheoryRepairs(manifest, {
    maxCandidates: 3,
    kinds: ["breath"],
    issueCodes: ["LARGE_LEAP_UNBALANCED"],
  });
  assert.equal(filtered.candidates.length, 0);
  assert.equal(filtered.unproposedIssues[0]?.reason, "filtered_kind");
  assert.throws(() => proposeTheoryRepairs(manifest, { maxCandidates: 2 }), /at least 3|Too small/u);
  const stale = analyzeManifestTheory(manifest);
  stale.compositionHash = "f".repeat(64);
  assert.throws(() => proposeTheoryRepairs(manifest, {}, stale), /does not match/u);
});
