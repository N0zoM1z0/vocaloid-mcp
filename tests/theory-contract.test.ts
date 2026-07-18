import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { diffManifestSnapshots } from "../src/manifest-history.js";
import {
  createSongManifest,
  inspectSongManifest,
  loadSongManifest,
  songCompositionHash,
  songManifestHash,
  songMixHash,
  SongManifestSchema,
} from "../src/song-manifest.js";
import {
  CompositionGuidanceSchema,
  TheoryIssueSchema,
  TheoryReportSchema,
} from "../src/theory/types.js";


const HASH = "a".repeat(64);

test("theory contracts are strict, typed, and reject ambiguous exception targets", () => {
  const guidance = CompositionGuidanceSchema.parse({
    theory_ruleset_id: "core/v1",
    strictness: "balanced",
    harmonic_language: "tonal",
    required_review_severities: ["warning"],
    style_profile: {
      id: "ia-rock-balanced",
      version: "2026.07.19",
      pinned_at: "2026-07-19T00:00:00.000Z",
    },
    exceptions: [{
      id: "exception-suspension-1",
      issue_code: "SUSTAINED_NON_CHORD_TONE_UNRESOLVED",
      object_ids: ["lead-note-1"],
      target_fingerprint: HASH,
      rationale: "Intentional prepared suspension resolving in the following cell.",
      author_type: "agent",
      created_at: "2026-07-19T00:00:00.000Z",
    }],
  });
  assert.equal(guidance.style_profile?.id, "ia-rock-balanced");
  assert.throws(
    () => CompositionGuidanceSchema.parse({
      ...guidance,
      required_review_severities: ["warning", "warning"],
    }),
    /must not contain duplicates/u,
  );
  assert.throws(
    () => CompositionGuidanceSchema.parse({
      ...guidance,
      exceptions: [{ ...guidance.exceptions[0], object_ids: ["lead-note-1", "lead-note-1"] }],
    }),
    /repeats an object ID/u,
  );

  const issue = TheoryIssueSchema.parse({
    code: "KEY_INVALID",
    ruleVersion: "1.0.0",
    severity: "error",
    confidence: 1,
    domain: "key",
    message: "The declared key cannot be parsed.",
    objectIds: ["key-change-1"],
    targetFingerprint: HASH,
    evidence: [{
      level: "symbolic_exact",
      source: "manifest.harmony.key_changes",
      confidence: 1,
      details: { tonic: "H", mode: "major" },
    }],
    suggestedRepairs: [],
  });
  const report = TheoryReportSchema.parse({
    schema: "vocaloid-theory-report/v1",
    rulesetId: "core/v1",
    rulesetHash: HASH,
    manifestRevision: 1,
    compositionHash: HASH,
    scope: { kind: "whole" },
    coverage: { key: 1 },
    summary: { errors: 1, warnings: 0, info: 0 },
    metrics: [],
    issues: [issue],
    ignoredIssues: [],
    staleExceptions: [],
  });
  assert.equal(report.issues[0]?.code, "KEY_INVALID");
  assert.throws(
    () => TheoryIssueSchema.parse({ ...issue, unexpected: true }),
    /Unrecognized key/u,
  );
});

test("optional composition guidance changes only content hash and remains absent from legacy manifests", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-theory-contract-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const legacyPath = join(temporary, "legacy.song.json");
  await createSongManifest({
    outputPath: legacyPath,
    songId: "legacy-guidance",
    slug: "legacy-guidance",
    title: "Legacy Guidance",
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
    keyChanges: [{ id: "key-c", position: { measure: 0, beat: 0 }, tonic: "C", mode: "major" }],
    sampleRate: 44_100,
    gain: 0.2,
    reverb: false,
    chorus: false,
    overwrite: false,
  });
  const legacyRaw = JSON.parse(await readFile(legacyPath, "utf8")) as Record<string, unknown>;
  const legacy = (await loadSongManifest(legacyPath)).manifest;
  assert.equal(Object.hasOwn(legacyRaw, "composition_guidance"), false);
  assert.equal(Object.hasOwn(legacy, "composition_guidance"), false);
  assert.equal(songManifestHash(legacy), legacy.content_hash);

  const guidance = CompositionGuidanceSchema.parse({
    theory_ruleset_id: "core/v1",
    strictness: "balanced",
    harmonic_language: "tonal",
    required_review_severities: ["warning"],
    exceptions: [{
      id: "exception-key-color",
      issue_code: "STYLE_FEATURE_OUTLIER",
      object_ids: ["key-c"],
      target_fingerprint: HASH,
      rationale: "Keep the modal-color inflection for the lyric turn.",
      author_type: "human",
      created_at: "2026-07-19T00:00:00.000Z",
    }],
  });
  const guidedWithoutNewContentHash = SongManifestSchema.parse({
    ...legacy,
    composition_guidance: guidance,
  });
  assert.equal(songCompositionHash(guidedWithoutNewContentHash), legacy.composition_hash);
  assert.equal(songMixHash(guidedWithoutNewContentHash), legacy.mix_hash);
  const guidedContentHash = songManifestHash(guidedWithoutNewContentHash);
  assert.notEqual(guidedContentHash, legacy.content_hash);

  const guidedPath = join(temporary, "guided.song.json");
  await writeFile(
    guidedPath,
    `${JSON.stringify({ ...guidedWithoutNewContentHash, content_hash: guidedContentHash }, null, 2)}\n`,
    "utf8",
  );
  const guided = (await loadSongManifest(guidedPath)).manifest;
  assert.equal(guided.composition_hash, legacy.composition_hash);
  assert.equal(guided.mix_hash, legacy.mix_hash);
  assert.equal(guided.composition_guidance?.theory_ruleset_id, "core/v1");
  const summary = await inspectSongManifest(guidedPath);
  assert.equal(summary.compositionGuidance?.exceptions[0]?.issueCode, "STYLE_FEATURE_OUTLIER");

  const diff = await diffManifestSnapshots(legacyPath, guidedPath);
  assert.equal(diff.compositionChanged, false);
  assert.equal(diff.mixChanged, false);
  assert.deepEqual(diff.domains.guidance.added, ["composition-guidance"]);

  const invalidPath = join(temporary, "invalid-target.song.json");
  const invalidGuidance = {
    ...guidance,
    exceptions: [{ ...guidance.exceptions[0], object_ids: ["missing-object"] }],
  };
  const invalid = SongManifestSchema.parse({ ...legacy, composition_guidance: invalidGuidance });
  await writeFile(
    invalidPath,
    `${JSON.stringify({ ...invalid, content_hash: songManifestHash(invalid) }, null, 2)}\n`,
    "utf8",
  );
  await assert.rejects(loadSongManifest(invalidPath), /references unknown object missing-object/u);
});
