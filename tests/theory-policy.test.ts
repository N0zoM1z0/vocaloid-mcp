import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { previewSongManifestMutation } from "../src/mutation-preview.js";
import { preflightSongManifest } from "../src/song-preflight.js";
import {
  createSongManifest,
  loadSongManifest,
  removeSongManifestObjects,
  setSongManifestCompositionGuidance,
  setSongManifestCompositionIntent,
  upsertSongManifestArrangementTrack,
  upsertSongManifestTheoryException,
  upsertSongManifestVocalPart,
} from "../src/song-manifest.js";
import { CompositionGuidanceSchema } from "../src/theory/types.js";


const VOICE = { id: "voice-ia", name: "IA", component_id: "BLRGDDR4M3WM2LC6" } as const;
const TRACK = { id: "lead", name: "Lead", voice_id: "voice-ia" } as const;

function leadPart(highNote = 76) {
  return {
    id: "lead-part",
    section_id: "verse",
    name: "Lead",
    start: { measure: 0, beat: 0 },
    end: { measure: 2, beat: 0 },
    notes: [
      {
        id: "lead-c4",
        position: { measure: 0, beat: 0 },
        duration: 480,
        note_number: 60,
        lyric: "あ",
        phonemes: "a",
      },
      {
        id: "lead-g5",
        position: { measure: 0, beat: 1 },
        duration: 480,
        note_number: highNote,
        lyric: "あ",
        phonemes: "a",
      },
    ],
  };
}

async function createPolicyFixture(path: string, tonic = "C"): Promise<void> {
  await createSongManifest({
    outputPath: path,
    songId: `policy-${tonic.toLowerCase()}`,
    slug: `policy-${tonic.toLowerCase()}`,
    title: `Policy ${tonic}`,
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
    keyChanges: [{ id: "key-main", position: { measure: 0, beat: 0 }, tonic, mode: "major" }],
    chordChanges: [{ id: "chord-c", position: { measure: 0, beat: 0 }, symbol: "C", duration_ticks: 3840 }],
    sampleRate: 44_100,
    gain: 0.2,
    reverb: false,
    chorus: false,
    overwrite: false,
  });
  await upsertSongManifestVocalPart(path, path, 1, VOICE, TRACK, leadPart(), true);
  await upsertSongManifestArrangementTrack(path, path, 2, {
    kind: "pitched",
    id: "piano",
    name: "Piano",
    program: 0,
    notes: [{ id: "piano-c", position: { measure: 0, beat: 0 }, duration: 480, note_number: 48 }],
  }, true);
}

function guidance(
  requiredReviewSeverities: Array<"warning" | "info">,
  intentMode: "off" | "advisory" | "required_for_delivery" = "off",
) {
  return {
    theory_ruleset_id: "core/v1",
    strictness: "balanced" as const,
    harmonic_language: "tonal" as const,
    required_review_severities: requiredReviewSeverities,
    intent_review_policy: {
      mode: intentMode,
      require_song_intent: true,
      require_section_intent: false,
      minimum_anchor_phrases: 0,
      require_current_audition_review: false,
    },
    exceptions: [],
  };
}

test("fingerprint-bound theory exceptions suppress only the current warning and become structural when its target changes", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-theory-policy-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "policy.song.json");
  await createPolicyFixture(manifestPath);

  const initialManifest = (await loadSongManifest(manifestPath)).manifest;
  const initial = await preflightSongManifest(manifestPath, {
    artifactCheck: "none",
    includePerformanceWarnings: true,
  });
  assert.equal(initial.releasePolicy.enabled, false);
  assert.equal(initial.releasePolicy.ready, true);
  assert.deepEqual(
    initial.theory.issues.filter((issue) => issue.severity === "warning").map((issue) => issue.code),
    ["LARGE_LEAP_UNBALANCED"],
  );

  await setSongManifestCompositionGuidance(manifestPath, manifestPath, 3, guidance(["warning"]), true);
  const withPolicyManifest = (await loadSongManifest(manifestPath)).manifest;
  assert.equal(withPolicyManifest.composition_hash, initialManifest.composition_hash);
  assert.notEqual(withPolicyManifest.content_hash, initialManifest.content_hash);
  const blocked = await preflightSongManifest(manifestPath, {
    artifactCheck: "none",
    includePerformanceWarnings: true,
  });
  const leap = blocked.theory.issues.find((issue) => issue.code === "LARGE_LEAP_UNBALANCED");
  assert.ok(leap);
  assert.equal(blocked.readiness.build.ready, true);
  assert.equal(blocked.releasePolicy.ready, false);
  assert.deepEqual(blocked.releasePolicy.blockers, ["LARGE_LEAP_UNBALANCED"]);

  const exception = {
    id: "exception-large-leap",
    issue_code: leap.code,
    object_ids: leap.objectIds,
    target_fingerprint: leap.targetFingerprint,
    rationale: "Keep this one exposed octave-plus break only after isolated phrase listening.",
    author_type: "agent" as const,
    created_at: "2026-07-19T05:00:00.000Z",
  };
  await upsertSongManifestTheoryException(manifestPath, manifestPath, 4, exception, true);
  const acceptedManifest = (await loadSongManifest(manifestPath)).manifest;
  assert.equal(acceptedManifest.composition_hash, initialManifest.composition_hash);
  const accepted = await preflightSongManifest(manifestPath, {
    artifactCheck: "none",
    includePerformanceWarnings: true,
  });
  assert.equal(accepted.releasePolicy.ready, true);
  assert.equal(accepted.readiness.build.ready, true);
  assert.equal(accepted.theory.issues.some((issue) => issue.code === leap.code), false);
  assert.equal(accepted.theory.ignoredIssues.find((issue) => issue.code === leap.code)?.targetFingerprint, leap.targetFingerprint);

  const preview = await previewSongManifestMutation(manifestPath, 5, (path) =>
    upsertSongManifestVocalPart(path, path, 5, VOICE, TRACK, leadPart(72), true));
  assert.equal(preview.readiness.build.ready, false);
  assert.equal(preview.releasePolicy.ready, false);
  assert.deepEqual(preview.analysisDelta.staleExceptions.map((entry) => entry.id), [exception.id]);
  assert.ok(preview.analysisDelta.introducedIssueCodes.includes("THEORY_EXCEPTION_STALE"));
  assert.ok(preview.analysisDelta.introducedIssueCodes.includes("LARGE_LEAP_UNBALANCED"));
  assert.equal((await loadSongManifest(manifestPath)).manifest.revision, 5);

  await upsertSongManifestVocalPart(manifestPath, manifestPath, 5, VOICE, TRACK, leadPart(72), true);
  const stale = await preflightSongManifest(manifestPath, {
    artifactCheck: "none",
    includePerformanceWarnings: true,
  });
  assert.equal(stale.readiness.build.ready, false);
  assert.ok(stale.readiness.build.blockers.includes("THEORY_EXCEPTION_STALE"));
  assert.deepEqual(stale.theory.staleExceptions.map((entry) => entry.id), [exception.id]);

  await removeSongManifestObjects(manifestPath, manifestPath, 6, {
    object_type: "theory_exception",
    object_ids: [exception.id],
  }, true);
  const removed = await preflightSongManifest(manifestPath, {
    artifactCheck: "none",
    includePerformanceWarnings: true,
  });
  assert.equal(removed.readiness.build.ready, true);
  assert.equal(removed.theory.staleExceptions.length, 0);
  assert.deepEqual(removed.releasePolicy.blockers, ["LARGE_LEAP_UNBALANCED"]);

  await setSongManifestCompositionGuidance(
    manifestPath, manifestPath, 7, guidance([], "required_for_delivery"), true,
  );
  const requiredIntent = await preflightSongManifest(manifestPath, {
    artifactCheck: "none",
    includePerformanceWarnings: true,
  });
  assert.equal(requiredIntent.readiness.build.ready, true);
  assert.equal(requiredIntent.releasePolicy.ready, false);
  assert.deepEqual(requiredIntent.releasePolicy.intent.blockers, ["COMPOSITION_INTENT_REQUIRED"]);

  await setSongManifestCompositionGuidance(manifestPath, manifestPath, 8, guidance([], "advisory"), true);
  const advisoryIntent = await preflightSongManifest(manifestPath, {
    artifactCheck: "none",
    includePerformanceWarnings: true,
  });
  assert.equal(advisoryIntent.releasePolicy.ready, true);
  assert.deepEqual(advisoryIntent.releasePolicy.blockers, []);

  await setSongManifestCompositionIntent(manifestPath, manifestPath, 9, {
    schema: "vocaloid-composition-intent/v1",
    song: {
      premise: "A withheld answer is finally spoken.",
      central_tension: "Speaking changes the relationship.",
      state_at_start: "Withheld.",
      intended_destination: "Direct but restrained.",
    },
    sections: [{
      id: "intent-verse",
      section_id: "verse",
      dramatic_function: "Move from avoidance into one direct answer.",
      state_before: "Avoiding the answer.",
      intended_transition: "Say it once without embellishment.",
      state_after: "The answer is present.",
    }],
    phrase_directions: [{
      id: "anchor-answer",
      section_id: "verse",
      importance: "anchor",
      purpose: "Let IA state the answer directly without turning it into a shout.",
      semantic_focus: "The final mora.",
      state_before: "Held close.",
      intended_transition: "Open once into the answer.",
      state_after: "Direct and still.",
      delivery_arc: "Narrow first, open the focus, then release.",
      listening_question: {
        id: "question-answer",
        question: "Does the answer become direct without sounding like a shout?",
      },
    }],
  }, true);
  await setSongManifestCompositionGuidance(manifestPath, manifestPath, 10, {
    ...guidance([], "required_for_delivery"),
    intent_review_policy: {
      mode: "required_for_delivery",
      require_song_intent: true,
      require_section_intent: true,
      minimum_anchor_phrases: 1,
      require_current_audition_review: true,
    },
  }, true);
  const awaitingListening = await preflightSongManifest(manifestPath, {
    artifactCheck: "none",
    includePerformanceWarnings: true,
  });
  assert.equal(awaitingListening.readiness.build.ready, true);
  assert.equal(awaitingListening.releasePolicy.ready, false);
  assert.ok(awaitingListening.releasePolicy.intent.blockers.includes("CURRENT_INTENT_KEEP_REVIEW_REQUIRED"));
  assert.ok(awaitingListening.releasePolicy.intent.blockers.includes("CURRENT_ANCHOR_AUDITION_LADDER_REQUIRED"));
});

test("structural theory errors cannot be excepted and duplicate exact exception targets are rejected", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-theory-policy-structural-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "structural.song.json");
  await createPolicyFixture(manifestPath, "H");
  const report = await preflightSongManifest(manifestPath, {
    artifactCheck: "none",
    includePerformanceWarnings: true,
  });
  const invalidKey = report.theory.issues.find((issue) => issue.code === "KEY_INVALID");
  assert.ok(invalidKey);
  await setSongManifestCompositionGuidance(manifestPath, manifestPath, 3, guidance([]), true);
  await assert.rejects(
    upsertSongManifestTheoryException(manifestPath, manifestPath, 4, {
      id: "exception-invalid-key",
      issue_code: invalidKey.code,
      object_ids: invalidKey.objectIds,
      target_fingerprint: invalidKey.targetFingerprint,
      rationale: "This must be rejected because the key declaration cannot be interpreted.",
      author_type: "agent",
      created_at: "2026-07-19T05:10:00.000Z",
    }, true),
    /STRUCTURAL_ERROR_NOT_EXCEPTABLE/u,
  );

  const duplicateTarget = {
    issue_code: "LARGE_LEAP_UNBALANCED",
    object_ids: ["lead", "lead-part", "lead-c4", "lead-g5"],
    target_fingerprint: "a".repeat(64),
    rationale: "Fixture duplicate target.",
    author_type: "agent" as const,
    created_at: "2026-07-19T05:15:00.000Z",
  };
  const duplicate = CompositionGuidanceSchema.safeParse({
    ...guidance([]),
    exceptions: [
      { id: "exception-a", ...duplicateTarget },
      { id: "exception-b", ...duplicateTarget },
    ],
  });
  assert.equal(duplicate.success, false);
  assert.match(JSON.stringify(duplicate.error?.issues), /same exact issue state/u);
});
