import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { previewSongManifestMutation } from "../src/mutation-preview.js";
import { songIntentHash } from "../src/intent/hash.js";
import {
  addSongManifestReviewNote,
  createSongManifest,
  loadSongManifest,
  recordSongManifestArtifacts,
  setSongManifestCompositionIntent,
  upsertSongManifestArrangementTrack,
  upsertSongManifestSection,
  upsertSongManifestVocalPart,
} from "../src/song-manifest.js";


test("mutation dry-run returns hashes/diff/preflight without changing the canonical file", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-mutation-preview-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "preview-song.song.json");
  await createSongManifest({
    outputPath: manifestPath,
    songId: "preview-song",
    slug: "preview-song",
    title: "Preview Song",
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 120 }],
    sections: [{
      id: "verse",
      name: "Verse",
      kind: "verse",
      start: { measure: 0, beat: 0 },
      end: { measure: 2, beat: 0 },
    }],
    sampleRate: 44_100,
    gain: 0.2,
    reverb: false,
    chorus: false,
    overwrite: false,
  });
  const before = (await loadSongManifest(manifestPath)).manifest;
  const preview = await previewSongManifestMutation(manifestPath, 1, (path) =>
    upsertSongManifestSection(
      path,
      path,
      1,
      {
        id: "verse",
        name: "Verse with Lift",
        kind: "verse",
        start: { measure: 0, beat: 0 },
        end: { measure: 2, beat: 0 },
        energy: 0.65,
      },
      true,
    ));
  assert.equal(preview.dryRun, true);
  assert.equal(preview.predicted.revision, 2);
  assert.deepEqual(preview.changes.sections.modified, ["verse"]);
  assert.notEqual(preview.predicted.compositionHash, before.composition_hash);
  const after = (await loadSongManifest(manifestPath)).manifest;
  assert.equal(after.revision, 1);
  assert.equal(after.content_hash, before.content_hash);
});

test("intent-first dry-run compares theory/evidence and predicts listening-review staleness", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-mutation-intent-delta-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "intent-delta.song.json");
  await createSongManifest({
    outputPath: manifestPath,
    songId: "intent-delta",
    slug: "intent-delta",
    title: "Intent Delta",
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 120 }],
    sections: [{
      id: "chorus",
      name: "Chorus",
      kind: "chorus",
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
  const track = { id: "lead", name: "Lead", voice_id: voice.id };
  const risingPart = {
    id: "anchor-part",
    section_id: "chorus",
    name: "Anchor",
    start: { measure: 4, beat: 0 },
    end: { measure: 6, beat: 0 },
    notes: [
      { id: "anchor-a", position: { measure: 4, beat: 0 }, duration: 480, note_number: 60, lyric: "な", phonemes: "n a" },
      { id: "anchor-focus", position: { measure: 4, beat: 1 }, duration: 480, note_number: 67, lyric: "い", phonemes: "i" },
    ],
  };
  await upsertSongManifestVocalPart(manifestPath, manifestPath, 1, voice, track, risingPart, true);
  await upsertSongManifestArrangementTrack(manifestPath, manifestPath, 2, {
    kind: "pitched",
    id: "piano",
    name: "Piano",
    program: 0,
    notes: [{ id: "piano-c", position: { measure: 0, beat: 0 }, duration: 480, note_number: 48 }],
  }, true);
  await setSongManifestCompositionIntent(manifestPath, manifestPath, 3, {
    schema: "vocaloid-composition-intent/v1",
    song: {
      premise: "One withheld answer becomes direct.",
      central_tension: "Speaking changes the relationship.",
      state_at_start: "Withheld.",
      intended_destination: "Direct but restrained.",
    },
    sections: [{
      id: "intent-chorus",
      section_id: "chorus",
      dramatic_function: "Deliver the answer.",
      state_before: "Avoiding it.",
      intended_transition: "Move into one direct phrase.",
      state_after: "The answer is audible.",
    }],
    phrase_directions: [{
      id: "anchor-answer",
      section_id: "chorus",
      importance: "anchor",
      purpose: "Let the answer rise into focus without becoming a shout.",
      semantic_focus: "The final mora.",
      state_before: "Held close.",
      intended_transition: "Rise once into the answer.",
      state_after: "Direct and still.",
      delivery_arc: "Narrow first note, open the focus, then stop.",
      realization_hypothesis: {
        summary: "A rising two-note contour carries the answer.",
        symbolic_targets: { melody_contour: "rising" },
      },
      listening_question: {
        id: "question-answer",
        question: "Does the answer become direct without sounding like a shout?",
      },
      realization_links: {
        event_ids: ["anchor-a", "anchor-focus"],
        semantic_focus_object_ids: ["anchor-focus"],
      },
    }],
  }, true);
  const withIntent = (await loadSongManifest(manifestPath)).manifest;
  const intentHash = songIntentHash(withIntent.composition_intent!);
  const previewArtifact = (id: string, layer: string, digit: string) => ({
    id,
    role: "preview" as const,
    path: `/tmp/${id}.wav`,
    sha256: digit.repeat(64),
    bytes: 4096,
    source_revision: withIntent.revision,
    source_composition_hash: withIntent.composition_hash,
    dependencies: [],
    metadata: {
      audition_kind: "anchor_passage",
      audition_layer: layer,
      phrase_direction_id: "anchor-answer",
      listening_question_id: "question-answer",
      intent_hash: intentHash,
      passage_duration_seconds: 25,
    },
    created_at: "2026-07-19T02:00:00.000Z",
  });
  await recordSongManifestArtifacts(manifestPath, 4, withIntent.composition_hash, [
    previewArtifact("preview-solo", "lead_solo", "1"),
    previewArtifact("preview-harmony", "lead_harmony", "2"),
    previewArtifact("preview-minimal", "minimal_band", "3"),
  ]);
  const withArtifacts = (await loadSongManifest(manifestPath)).manifest;
  await addSongManifestReviewNote(manifestPath, 5, {
    id: "review-answer",
    author_type: "human",
    author_name: "listener",
    observation: "The rise makes the answer direct without turning it into a shout.",
    section_id: "chorus",
    object_ids: ["anchor-answer", "anchor-a", "anchor-focus"],
    artifact_ids: ["preview-minimal"],
    intent_fidelity: {
      review_kind: "intent_fidelity",
      phrase_direction_id: "anchor-answer",
      listening_question_id: "question-answer",
      intent_hash: songIntentHash(withArtifacts.composition_intent!),
      composition_hash: withArtifacts.composition_hash,
      artifact_id: "preview-minimal",
      artifact_sha256: "3".repeat(64),
      outcome: "keep",
    },
  });
  const canonicalBefore = (await loadSongManifest(manifestPath)).manifest;

  const preview = await previewSongManifestMutation(manifestPath, 6, (path) =>
    upsertSongManifestVocalPart(path, path, 6, voice, track, {
      ...risingPart,
      notes: [
        risingPart.notes[0]!,
        { ...risingPart.notes[1]!, note_number: 47 },
      ],
    }, true));

  assert.equal(preview.creativeReadiness.status, "incomplete");
  assert.equal(preview.analysisDelta.creativeStatus.before, "ready");
  assert.equal(preview.analysisDelta.creativeReviewWouldBecomeStale, true);
  assert.deepEqual(preview.analysisDelta.creativeReviewTransitions.map((entry) => entry.before), ["current_keep"]);
  assert.ok(preview.analysisDelta.creativeReviewTransitions[0]?.staleReasons.includes("COMPOSITION_HASH_MISMATCH"));
  const contourDelta = preview.analysisDelta.changedIntentEvidence.find((entry) => entry.feature === "melody.contour");
  assert.equal(contourDelta?.before?.relation, "supports");
  assert.equal(contourDelta?.after?.relation, "contradicts");
  assert.ok(preview.analysisDelta.introducedIssueCodes.includes("LARGE_LEAP_UNBALANCED"));
  assert.ok(preview.analysisDelta.changedMetrics.some((entry) => entry.id.startsWith("melody.")));
  assert.deepEqual(preview.analysisDelta.staleExceptions, []);

  const canonicalAfter = (await loadSongManifest(manifestPath)).manifest;
  assert.equal(canonicalAfter.revision, canonicalBefore.revision);
  assert.equal(canonicalAfter.content_hash, canonicalBefore.content_hash);
});
