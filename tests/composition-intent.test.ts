import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { songIntentHash } from "../src/intent/hash.js";
import {
  CompositionIntentSchema,
  IntentFidelityReviewBasisSchema,
  type CompositionIntent,
} from "../src/intent/types.js";
import { diffManifestSnapshots } from "../src/manifest-history.js";
import {
  addSongManifestReviewNote,
  bindSongManifestPhraseRealization,
  createSongManifest,
  inspectSongManifest,
  loadSongManifest,
  recordSongManifestArtifacts,
  setSongManifestCompositionIntent,
  transformSongManifestEvents,
  upsertSongManifestPhraseDirection,
  upsertSongManifestSectionIntent,
  upsertSongManifestVocalPart,
} from "../src/song-manifest.js";


const PREVIEW_SHA = "b".repeat(64);

function anchorIntent(overrides: Partial<CompositionIntent["phrase_directions"][number]> = {}): CompositionIntent {
  return CompositionIntentSchema.parse({
    schema: "vocaloid-composition-intent/v1",
    song: {
      premise: "A voice finally admits that waiting has changed what home means.",
      narrator_stance: "Close and restrained, speaking after a long silence.",
      addressee: "The person who did not return.",
      central_tension: "Wanting an answer while fearing that an answer will end the memory.",
      state_at_start: "Protecting the memory by saying almost nothing.",
      intended_destination: "Choosing to say the name once, without demanding a reply.",
      listener_after: "The release should feel small but irreversible.",
      creative_invariants: ["The hook must release only on the semantic focus."],
    },
    sections: [{
      id: "intent-section-chorus",
      section_id: "chorus",
      dramatic_function: "Turn private waiting into one direct utterance.",
      state_before: "The narrator still hides behind remembered scenery.",
      intended_transition: "The first direct address breaks the protective distance.",
      state_after: "The absence is acknowledged without being solved.",
      contrast_with_previous: "Wider register, but less lyrical decoration than the verse.",
      inherited_delivery: "Hold back until the final content word, then release without belting.",
    }],
    phrase_directions: [{
      id: "direction-chorus-hook",
      section_id: "chorus",
      importance: "anchor",
      lyric_anchor: { text: "the line containing the addressee's name" },
      purpose: "Say the name as an admission, not as a call for an answer.",
      addressed_to: "The absent addressee.",
      semantic_focus: "The name and the vowel that carries its release.",
      subtext: "The narrator knows no answer is coming.",
      state_before: "The sentence is still being held inside.",
      intended_transition: "Restraint gives way once, then immediately becomes stillness.",
      state_after: "The truth has been spoken and cannot be taken back.",
      delivery_arc: "Narrow and close at first; delay the push and vibrato until the focus, then release the tail cleanly.",
      realization_hypothesis: {
        summary: "Keep the first cells narrow and short, then lengthen and lift only the focus event.",
        melody: "A compact contour expands by one clear interval at the focus.",
        rhythm: "Leave consonant space and a short rest after the release.",
        expected_evidence: ["The focus event is longer than the phrase median."],
      },
      listening_question: {
        id: "question-chorus-hook",
        question: "Does the name sound like a restrained admission that becomes irreversible?",
      },
      ...overrides,
    }],
  });
}

async function createIntentTestManifest(path: string): Promise<void> {
  await createSongManifest({
    outputPath: path,
    songId: "intent-song",
    slug: "intent-song",
    title: "Intent Song",
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 108 }],
    sections: [{
      id: "chorus",
      name: "First Chorus",
      kind: "chorus",
      start: { measure: 0, beat: 0 },
      end: { measure: 2, beat: 0 },
    }],
    chordChanges: [{
      id: "chord-chorus-c",
      position: { measure: 0, beat: 0 },
      symbol: "Cmaj7",
      duration_ticks: 3840,
    }],
    sampleRate: 44_100,
    gain: 0.2,
    reverb: false,
    chorus: false,
    overwrite: false,
  });
}

test("composition-intent schemas are strict, bounded, and hash the declared target", () => {
  const intent = anchorIntent();
  assert.match(songIntentHash(intent), /^[a-f0-9]{64}$/u);
  assert.notEqual(
    songIntentHash(intent),
    songIntentHash(anchorIntent({ purpose: "Ask the absent person to answer immediately." })),
  );
  assert.throws(
    () => CompositionIntentSchema.parse({ ...intent, unknown_contract_field: true }),
    /Unrecognized key/u,
  );
  assert.throws(
    () => CompositionIntentSchema.parse({
      ...intent,
      phrase_directions: [
        intent.phrase_directions[0],
        { ...intent.phrase_directions[0], id: "direction-two" },
      ],
    }),
    /Duplicate composition-intent ID question-chorus-hook/u,
  );
  assert.throws(
    () => CompositionIntentSchema.parse({
      ...intent,
      phrase_directions: [{
        ...intent.phrase_directions[0],
        realization_links: {},
      }],
    }),
    /requires at least one linked object/u,
  );
  assert.throws(
    () => CompositionIntentSchema.parse({
      ...intent,
      phrase_directions: [{
        ...intent.phrase_directions[0],
        realization_hypothesis: {
          summary: "An empty machine target must not imply evidence.",
          symbolic_targets: {},
        },
      }],
    }),
    /symbolic_targets requires at least one measurable target/u,
  );
  assert.throws(
    () => IntentFidelityReviewBasisSchema.parse({
      review_kind: "intent_fidelity",
      phrase_direction_id: "direction-chorus-hook",
      listening_question_id: "question-chorus-hook",
      intent_hash: "a".repeat(64),
      composition_hash: "b".repeat(64),
      artifact_id: "preview-b",
      artifact_sha256: "c".repeat(64),
      comparison_artifact_ids: ["preview-a"],
      comparison_artifacts: [{ artifact_id: "preview-a", artifact_sha256: "d".repeat(64) }],
      outcome: "keep",
    }),
    /digest-bound comparison_artifacts/u,
  );
});

test("an optional intent changes content/history and intent hash without staling score or mix", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-composition-intent-hash-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "intent-hash.song.json");
  await createIntentTestManifest(manifestPath);
  const legacyRaw = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  const legacy = (await loadSongManifest(manifestPath)).manifest;
  assert.equal(Object.hasOwn(legacyRaw, "composition_intent"), false);

  const result = await setSongManifestCompositionIntent(
    manifestPath,
    manifestPath,
    1,
    anchorIntent(),
    true,
  );
  const withIntent = (await loadSongManifest(manifestPath)).manifest;
  assert.equal(result.write.revision, 2);
  assert.equal(withIntent.composition_hash, legacy.composition_hash);
  assert.equal(withIntent.mix_hash, legacy.mix_hash);
  assert.notEqual(withIntent.content_hash, legacy.content_hash);
  assert.equal(songIntentHash(withIntent.composition_intent!), result.summary.intentHash);
  assert.equal(result.summary.compositionIntent?.coverage.sections, 1);
  assert.equal(result.summary.compositionIntent?.coverage.anchorPhrases, 1);
  assert.equal(result.summary.compositionIntent?.coverage.realizationLinks, 0);

  assert.ok(result.write.backupPath);
  const diff = await diffManifestSnapshots(result.write.backupPath, manifestPath);
  assert.equal(diff.compositionChanged, false);
  assert.equal(diff.mixChanged, false);
  assert.deepEqual(diff.domains.intent.added, [
    "composition-intent/song",
    "direction-chorus-hook",
    "intent-section-chorus",
  ]);
  assert.equal(diff.to.intentHash, result.summary.intentHash);

  const changedSectionIntent = {
    ...withIntent.composition_intent!.sections[0]!,
    intended_transition: "The direct address arrives one breath later and leaves more silence.",
  };
  const sectionUpdate = await upsertSongManifestSectionIntent(
    manifestPath,
    manifestPath,
    2,
    changedSectionIntent,
    true,
  );
  assert.equal(sectionUpdate.write.compositionHash, legacy.composition_hash);
  assert.notEqual(sectionUpdate.summary.intentHash, result.summary.intentHash);

  await assert.rejects(
    setSongManifestCompositionIntent(
      manifestPath,
      manifestPath,
      3,
      {
        ...anchorIntent(),
        sections: [{ ...anchorIntent().sections[0]!, section_id: "missing-section" }],
      },
      true,
    ),
    /INTENT_SECTION_REFERENCE_INVALID/u,
  );
  assert.equal((await loadSongManifest(manifestPath)).manifest.revision, 3);
});

test("phrase intent can precede notes, bindings are checked, and reviews stale on intent or score changes", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-composition-intent-review-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "intent-review.song.json");
  await createIntentTestManifest(manifestPath);
  await setSongManifestCompositionIntent(manifestPath, manifestPath, 1, anchorIntent(), true);
  const planned = (await loadSongManifest(manifestPath)).manifest;
  assert.equal(planned.composition_intent?.phrase_directions[0]?.realization_links, undefined);

  await upsertSongManifestVocalPart(
    manifestPath,
    manifestPath,
    2,
    { id: "voice-ia", name: "IA", component_id: "BLRGDDR4M3WM2LC6" },
    { id: "lead", name: "Lead", voice_id: "voice-ia" },
    {
      id: "chorus-lead",
      section_id: "chorus",
      name: "Chorus Lead",
      start: { measure: 0, beat: 0 },
      end: { measure: 2, beat: 0 },
      notes: [{
        id: "hook-note",
        position: { measure: 0, beat: 0 },
        duration: 960,
        note_number: 67,
        lyric: "な",
        phonemes: "n a",
      }],
    },
    true,
  );
  await assert.rejects(
    bindSongManifestPhraseRealization(
      manifestPath,
      manifestPath,
      3,
      "direction-chorus-hook",
      { event_ids: ["missing-note"] },
      true,
    ),
    /INTENT_REALIZATION_REFERENCE_INVALID/u,
  );
  assert.equal((await loadSongManifest(manifestPath)).manifest.revision, 3);

  await bindSongManifestPhraseRealization(
    manifestPath,
    manifestPath,
    3,
    "direction-chorus-hook",
    {
      event_ids: ["hook-note"],
      semantic_focus_object_ids: ["hook-note"],
      chord_ids: ["chord-chorus-c"],
      track_ids: ["lead"],
    },
    true,
  );
  const bound = (await loadSongManifest(manifestPath)).manifest;
  assert.equal(bound.revision, 4);
  assert.deepEqual(
    bound.composition_intent?.phrase_directions[0]?.realization_links?.event_ids,
    ["hook-note"],
  );

  await recordSongManifestArtifacts(manifestPath, 4, bound.composition_hash, [{
    id: "preview-hook",
    role: "preview",
    path: join(temporary, "hook-preview.wav"),
    sha256: PREVIEW_SHA,
    bytes: 4096,
    source_revision: 4,
    source_composition_hash: bound.composition_hash,
    dependencies: [],
    metadata: { section_id: "chorus" },
    created_at: "2026-07-19T00:00:00.000Z",
  }]);
  const withArtifact = (await loadSongManifest(manifestPath)).manifest;
  const reviewBasis = {
    review_kind: "intent_fidelity" as const,
    phrase_direction_id: "direction-chorus-hook",
    listening_question_id: "question-chorus-hook",
    intent_hash: songIntentHash(withArtifact.composition_intent!),
    composition_hash: withArtifact.composition_hash,
    artifact_id: "preview-hook",
    artifact_sha256: PREVIEW_SHA,
    outcome: "keep" as const,
  };
  await addSongManifestReviewNote(manifestPath, 5, {
    id: "review-hook-intent",
    author_type: "human",
    author_name: "listener",
    observation: "The delayed release makes the name feel admitted rather than called out.",
    section_id: "chorus",
    object_ids: ["direction-chorus-hook"],
    artifact_ids: ["preview-hook"],
    intent_fidelity: reviewBasis,
  });
  const accepted = await inspectSongManifest(manifestPath);
  assert.equal(accepted.reviewNotes[0]?.intentFidelity?.current, true);
  assert.equal(accepted.reviewNotes[0]?.intentFidelity?.accepted, true);
  assert.deepEqual(accepted.reviewNotes[0]?.intentFidelity?.reasons, []);

  const current = (await loadSongManifest(manifestPath)).manifest;
  const direction = current.composition_intent?.phrase_directions[0];
  assert.ok(direction);
  await upsertSongManifestPhraseDirection(
    manifestPath,
    manifestPath,
    6,
    { ...direction, purpose: "Call the name urgently and demand an answer." },
    true,
  );
  const intentChanged = await inspectSongManifest(manifestPath);
  assert.equal(intentChanged.artifacts[0]?.currentComposition, true);
  assert.equal(intentChanged.reviewNotes[0]?.intentFidelity?.current, false);
  assert.deepEqual(
    intentChanged.reviewNotes[0]?.intentFidelity?.reasons,
    ["INTENT_HASH_MISMATCH"],
  );
  await assert.rejects(
    addSongManifestReviewNote(manifestPath, 7, {
      id: "review-stale-basis",
      author_type: "agent",
      author_name: "audition-agent",
      observation: "This must not be accepted against an old artistic question state.",
      intent_fidelity: reviewBasis,
    }),
    /INTENT_HASH_MISMATCH/u,
  );

  await transformSongManifestEvents(
    manifestPath,
    manifestPath,
    7,
    {
      vocal_track_id: "lead",
      event_ids: ["hook-note"],
      targets: ["vocal_notes"],
      transpose: 2,
    },
    true,
  );
  const scoreChanged = await inspectSongManifest(manifestPath);
  assert.equal(scoreChanged.artifacts[0]?.currentComposition, false);
  assert.deepEqual(
    scoreChanged.reviewNotes[0]?.intentFidelity?.reasons,
    ["INTENT_HASH_MISMATCH", "COMPOSITION_HASH_MISMATCH", "ARTIFACT_NOT_CURRENT"],
  );
});
