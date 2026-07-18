import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { analyzeCompositionIntent } from "../src/intent/analyze.js";
import { buildAnchorAuditionPlan } from "../src/intent/audition.js";
import { songIntentHash } from "../src/intent/hash.js";
import { currentTechnicalArtifactIds } from "../src/intent/review.js";
import { CompositionIntentSchema, type CompositionIntent } from "../src/intent/types.js";
import {
  addSongManifestReviewNote,
  createSongManifest,
  loadSongManifest,
  recordSongManifestArtifacts,
  setSongManifestCompositionIntent,
  upsertSongManifestArrangementTrack,
  upsertSongManifestPhraseDirection,
  upsertSongManifestVocalPart,
  type ManifestArtifact,
  type SongManifest,
} from "../src/song-manifest.js";


function anchorIntent(): CompositionIntent {
  return CompositionIntentSchema.parse({
    schema: "vocaloid-composition-intent/v1",
    song: {
      premise: "The narrator finally says one name after keeping it out of every earlier sentence.",
      central_tension: "Speaking may end the safety of waiting.",
      state_at_start: "Restrained and indirect.",
      intended_destination: "One direct admission followed by stillness.",
    },
    sections: [{
      id: "intent-chorus",
      section_id: "chorus",
      dramatic_function: "Move from avoidance to one direct address.",
      state_before: "The name remains unsaid.",
      intended_transition: "Tension resolves only after the name is carried through the longest note.",
      state_after: "The admission remains without demanding an answer.",
    }],
    phrase_directions: [{
      id: "anchor-name",
      section_id: "chorus",
      importance: "anchor",
      lyric_anchor: { text: "the phrase that finally says the name" },
      purpose: "Say the name as an admission rather than a call.",
      semantic_focus: "The final name mora.",
      state_before: "The phrase is held close.",
      intended_transition: "Pitch, duration, and dynamics open only at the focus, then the harmony resolves.",
      state_after: "The truth has been spoken once.",
      delivery_arc: "Begin narrow and quiet; lengthen and release the focus without adding a decorative tail.",
      realization_hypothesis: {
        summary: "A rising contour, thinning rhythm, longer focus, rising DYN, and dominant-to-tonic resolution make the release inspectable.",
        melody: "Rise toward the focus.",
        rhythm: "Reduce onsets and lengthen the destination.",
        harmony: "Resolve dominant tension at the focus.",
        dynamics: "Increase only across the phrase.",
        arrangement_space: "Remove density as the focus arrives.",
        symbolic_targets: {
          melody_contour: "rising",
          rhythm_density: "decrease",
          note_duration: "lengthen",
          harmonic_tension: "resolve",
          delivery_dynamics: "increase",
          arrangement_density: "decrease",
          semantic_focus_duration_ratio_min: 1.5,
          semantic_focus_beat_strength_min: 0.9,
        },
      },
      listening_question: {
        id: "question-name",
        question: "Does the final name sound like one restrained admission becoming irreversible?",
      },
      realization_links: {
        event_ids: ["lead-1", "lead-2", "lead-3", "lead-4", "lead-5", "focus-name"],
        semantic_focus_object_ids: ["focus-name"],
        chord_ids: ["chord-g", "chord-c"],
        track_ids: ["lead", "pad"],
      },
    }],
  });
}

async function createRealizationFixture(path: string): Promise<SongManifest> {
  await createSongManifest({
    outputPath: path,
    songId: "intent-realization-song",
    slug: "intent-realization-song",
    title: "Intent Realization Song",
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 120 }],
    sections: [{
      id: "chorus",
      name: "First Chorus",
      kind: "chorus",
      start: { measure: 0, beat: 0 },
      end: { measure: 16, beat: 0 },
    }],
    keyChanges: [{ id: "key-c", position: { measure: 0, beat: 0 }, tonic: "C", mode: "major" }],
    chordChanges: [
      { id: "chord-g", position: { measure: 4, beat: 0 }, symbol: "G7", duration_ticks: 1920 },
      { id: "chord-c", position: { measure: 5, beat: 0 }, symbol: "C", duration_ticks: 3840 },
    ],
    sampleRate: 44_100,
    gain: 0.2,
    reverb: false,
    chorus: false,
    overwrite: false,
  });
  await upsertSongManifestVocalPart(
    path,
    path,
    1,
    { id: "voice-ia", name: "IA", component_id: "BLRGDDR4M3WM2LC6" },
    { id: "lead", name: "Lead", voice_id: "voice-ia" },
    {
      id: "anchor-part",
      section_id: "chorus",
      name: "Anchor Lead",
      start: { measure: 4, beat: 0 },
      end: { measure: 8, beat: 0 },
      notes: [
        { id: "lead-1", position: { measure: 4, beat: 0 }, duration: 240, note_number: 60, lyric: "ま", phonemes: "m a" },
        { id: "lead-2", position: { measure: 4, beat: 1 }, duration: 240, note_number: 60, lyric: "だ", phonemes: "d a" },
        { id: "lead-3", position: { measure: 4, beat: 2 }, duration: 240, note_number: 62, lyric: "い", phonemes: "i" },
        { id: "lead-4", position: { measure: 5, beat: 0 }, duration: 480, note_number: 64, lyric: "え", phonemes: "e" },
        { id: "lead-5", position: { measure: 5, beat: 2 }, duration: 480, note_number: 67, lyric: "な", phonemes: "n a" },
        { id: "focus-name", position: { measure: 6, beat: 0 }, duration: 960, note_number: 72, lyric: "い", phonemes: "i" },
      ],
      control_curves: [{
        id: "dyn-anchor",
        curve: "DYN",
        points: [
          { id: "dyn-start", position: { measure: 4, beat: 0 }, value: 40 },
          { id: "dyn-end", position: { measure: 6, beat: 1 }, value: 90 },
        ],
      }],
    },
    true,
  );
  await upsertSongManifestArrangementTrack(path, path, 2, {
    kind: "pitched",
    id: "pad",
    name: "Sparse Pad",
    program: 88,
    notes: [
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `pad-dense-${index}`,
        position: { measure: 4, beat: index % 4 },
        duration: 240,
        note_number: 48 + index % 3 * 4,
      })),
      { id: "pad-release", position: { measure: 6, beat: 0 }, duration: 480, note_number: 60 },
    ],
  }, true);
  await setSongManifestCompositionIntent(path, path, 3, anchorIntent(), true);
  return (await loadSongManifest(path)).manifest;
}

function auditionArtifact(
  manifest: SongManifest,
  id: string,
  layer: string,
  sha256: string,
): ManifestArtifact {
  return {
    id,
    role: "preview",
    path: `/tmp/${id}.wav`,
    sha256,
    bytes: 4096,
    source_revision: manifest.revision,
    source_composition_hash: manifest.composition_hash,
    dependencies: [],
    metadata: {
      audition_kind: "anchor_passage",
      audition_layer: layer,
      phrase_direction_id: "anchor-name",
      listening_question_id: "question-name",
      intent_hash: songIntentHash(manifest.composition_intent!),
      passage_duration_seconds: 25,
    },
    created_at: "2026-07-19T01:00:00.000Z",
  };
}

test("intent realization evidence stays measurable and cannot self-approve listening", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-intent-realization-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const path = join(temporary, "intent-realization.song.json");
  const manifest = await createRealizationFixture(path);
  const report = analyzeCompositionIntent(manifest);
  assert.equal(report.status, "awaiting_listening");
  assert.equal(report.counts.boundAnchorPhrases, 1);
  assert.equal(report.counts.semanticFocusBoundAnchors, 1);
  const anchor = report.directions[0]!;
  assert.deepEqual(anchor.inheritedFrom, ["song", "intent-chorus"]);
  const targeted = anchor.evidence.filter((entry) => [
    "melody.contour",
    "rhythm.onset_density_trajectory",
    "rhythm.note_duration_trajectory",
    "harmony.tension_trajectory",
    "delivery.dynamic_trajectory",
    "arrangement.density_trajectory",
    "semantic_focus.duration_ratio",
    "semantic_focus.beat_strength",
  ].includes(entry.feature));
  assert.equal(targeted.length, 8);
  assert.ok(targeted.every((entry) => entry.relation === "supports"), JSON.stringify(targeted, null, 2));
  assert.equal(anchor.review.state, "missing");
  assert.ok(report.findings.some((entry) => entry.code === "INTENT_REVIEW_MISSING"));
  assert.doesNotMatch(JSON.stringify(report), /emotional[_-]?quality[_-]?score/iu);

  const plan = buildAnchorAuditionPlan(manifest, "anchor-name", 25);
  assert.equal(plan.passage.targetDurationMet, true);
  assert.ok(plan.passage.durationSeconds >= 24.9 && plan.passage.durationSeconds <= 25.1);
  assert.deepEqual(plan.stages.slice(0, 3).map((stage) => stage.layer), [
    "lead_solo",
    "lead_harmony",
    "minimal_band",
  ]);

  const hashes = ["1", "2", "3", "4", "5"].map((value) => value.repeat(64));
  await recordSongManifestArtifacts(path, 4, manifest.composition_hash, [
    auditionArtifact(manifest, "audition-lead", "lead_solo", hashes[0]!),
    auditionArtifact(manifest, "audition-harmony", "lead_harmony", hashes[1]!),
    auditionArtifact(manifest, "audition-minimal", "minimal_band", hashes[2]!),
    auditionArtifact(manifest, "audition-ab-a", "full_layers", hashes[3]!),
    auditionArtifact(manifest, "audition-ab-b", "full_layers", hashes[4]!),
  ]);
  const withArtifacts = (await loadSongManifest(path)).manifest;
  await addSongManifestReviewNote(path, 5, {
    id: "review-anchor-ab",
    author_type: "human",
    author_name: "listener",
    observation: "Muting the extra pad leaves the admission clearer, so the pad should be removed.",
    section_id: "chorus",
    object_ids: ["anchor-name", "pad"],
    artifact_ids: ["audition-ab-a", "audition-ab-b"],
    intent_fidelity: {
      review_kind: "intent_fidelity",
      phrase_direction_id: "anchor-name",
      listening_question_id: "question-name",
      intent_hash: songIntentHash(withArtifacts.composition_intent!),
      composition_hash: withArtifacts.composition_hash,
      artifact_id: "audition-ab-b",
      artifact_sha256: hashes[4]!,
      comparison_artifacts: [{ artifact_id: "audition-ab-a", artifact_sha256: hashes[3]! }],
      hypothesis_family: "arrangement",
      layer_assessment: {
        audition_layer: "full_layers",
        contribution: "no_audible_loss_when_muted",
        action: "remove",
        track_ids: ["pad"],
      },
      outcome: "keep",
    },
  });
  const reviewed = analyzeCompositionIntent((await loadSongManifest(path)).manifest);
  assert.equal(reviewed.status, "ready");
  assert.equal(reviewed.counts.humanConfirmedAnchors, 1);
  assert.equal(reviewed.directions[0]?.review.layerAssessment?.action, "remove");
  assert.equal(reviewed.directions[0]?.review.layerAssessment?.contribution, "no_audible_loss_when_muted");

  const current = (await loadSongManifest(path)).manifest;
  await recordSongManifestArtifacts(path, 6, current.composition_hash, [{
    ...current.artifacts.find((artifact) => artifact.id === "audition-ab-a")!,
    sha256: "6".repeat(64),
  }]);
  const digestChanged = analyzeCompositionIntent((await loadSongManifest(path)).manifest);
  assert.equal(digestChanged.status, "awaiting_listening");
  assert.deepEqual(
    digestChanged.directions[0]?.review.staleReasons,
    ["COMPARISON_ARTIFACT_DIGEST_MISMATCH"],
  );

  const beforeMismatch = (await loadSongManifest(path)).manifest;
  const direction = beforeMismatch.composition_intent?.phrase_directions[0];
  assert.ok(direction);
  await upsertSongManifestPhraseDirection(path, path, 7, {
    ...direction,
    realization_hypothesis: {
      ...direction.realization_hypothesis!,
      symbolic_targets: {
        ...direction.realization_hypothesis!.symbolic_targets!,
        melody_contour: "falling",
      },
    },
  }, true);
  const mismatched = analyzeCompositionIntent((await loadSongManifest(path)).manifest);
  assert.equal(mismatched.status, "incomplete");
  assert.ok(mismatched.findings.some((entry) => entry.code === "REALIZATION_TRAJECTORY_MISMATCH"));
  assert.equal(
    mismatched.directions[0]?.evidence.find((entry) => entry.feature === "melody.contour")?.relation,
    "contradicts",
  );
});

test("audition currentness follows mix dependencies instead of composition hash alone", () => {
  const compositionHash = "a".repeat(64);
  const mixHash = "b".repeat(64);
  const artifacts = [
    {
      id: "mix-current",
      role: "mix",
      sha256: "1".repeat(64),
      source_composition_hash: compositionHash,
      dependencies: [],
      metadata: { source_mix_hash: mixHash },
    },
    {
      id: "preview-dependent",
      role: "preview",
      sha256: "2".repeat(64),
      source_composition_hash: compositionHash,
      dependencies: ["mix-current", "anchor-name"],
      metadata: {},
    },
  ];
  assert.deepEqual(
    [...currentTechnicalArtifactIds(artifacts, compositionHash, mixHash)].sort(),
    ["mix-current", "preview-dependent"],
  );
  assert.deepEqual(
    [...currentTechnicalArtifactIds(artifacts, compositionHash, "c".repeat(64))],
    [],
  );
});
