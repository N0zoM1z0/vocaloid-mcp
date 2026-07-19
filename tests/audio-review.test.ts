import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  compareSongAnchorPassageArtifacts,
  compareSongSectionArtifacts,
  renderSongAnchorPassagePreview,
  renderSongSectionPreview,
} from "../src/audio-review.js";
import { analyzeCompositionIntent } from "../src/intent/analyze.js";
import {
  addSongManifestReviewNote,
  createSongManifest,
  fileSha256,
  loadSongManifest,
  recordSongManifestArtifacts,
  setSongManifestCompositionIntent,
  upsertSongManifestVocalPart,
} from "../src/song-manifest.js";


function tone(seconds: number, amplitude: number): Buffer {
  const sampleRate = 44_100;
  const frames = Math.round(seconds * sampleRate);
  const blockAlign = 4;
  const bytes = frames * blockAlign;
  const output = Buffer.alloc(44 + bytes);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(36 + bytes, 4);
  output.write("WAVE", 8, "ascii");
  output.write("fmt ", 12, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(2, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * blockAlign, 28);
  output.writeUInt16LE(blockAlign, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36, "ascii");
  output.writeUInt32LE(bytes, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * 330 * frame) / sampleRate) * amplitude * 32_767);
    output.writeInt16LE(value, 44 + frame * blockAlign);
    output.writeInt16LE(value, 44 + frame * blockAlign + 2);
  }
  return output;
}

test("section preview and loudness-matched A/B retain manifest provenance", async (context) => {
  try {
    await access("/usr/bin/ffmpeg");
  } catch {
    context.skip("FFmpeg is unavailable");
    return;
  }
  const temporary = await mkdtemp(join(process.cwd(), ".test-audio-review-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "review.song.json");
  await createSongManifest({
    outputPath: manifestPath,
    songId: "review-song",
    slug: "review-song",
    title: "Review Song",
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 120 }],
    sections: [
      { id: "verse", name: "Verse", kind: "verse", start: { measure: 0, beat: 0 }, end: { measure: 1, beat: 0 } },
      { id: "chorus", name: "Chorus", kind: "chorus", start: { measure: 1, beat: 0 }, end: { measure: 2, beat: 0 } },
    ],
    sampleRate: 44_100,
    gain: 0.2,
    reverb: false,
    chorus: false,
    overwrite: false,
  });
  const pathA = join(temporary, "a.wav");
  const pathB = join(temporary, "b.wav");
  await Promise.all([writeFile(pathA, tone(7, 0.1)), writeFile(pathB, tone(7, 0.3))]);
  const [digestA, digestB] = await Promise.all([fileSha256(pathA), fileSha256(pathB)]);
  const compositionHash = (await loadSongManifest(manifestPath)).manifest.composition_hash;
  await recordSongManifestArtifacts(manifestPath, 1, compositionHash, [
    {
      id: "master-a",
      role: "master",
      path: pathA,
      ...digestA,
      source_revision: 1,
      source_composition_hash: compositionHash,
      dependencies: ["verse"],
      metadata: { timeline_origin: "project_start" },
      created_at: new Date().toISOString(),
    },
    {
      id: "master-b",
      role: "master",
      path: pathB,
      ...digestB,
      source_revision: 1,
      source_composition_hash: compositionHash,
      dependencies: ["verse"],
      metadata: { timeline_origin: "project_start" },
      created_at: new Date().toISOString(),
    },
  ]);
  const preview = await renderSongSectionPreview({
    manifestPath,
    expectedRevision: 2,
    sourceArtifactId: "master-a",
    sectionId: "verse",
    outputPath: join(temporary, "review-song-verse-preview-r2.wav"),
    handleBeforeSeconds: 0,
    handleAfterSeconds: 0,
    referenceLufs: -16,
    referenceTruePeakDbfs: -1,
  });
  assert.ok(Math.abs(preview.quality.durationSeconds - 2) < 0.02);
  assert.equal(preview.artifact.role, "preview");
  assert.deepEqual(preview.artifact.dependencies, ["master-a", "verse"]);

  const comparison = await compareSongSectionArtifacts({
    manifestPath,
    expectedRevision: 3,
    artifactAId: "master-a",
    artifactBId: "master-b",
    sectionId: "verse",
    outputAPath: join(temporary, "review-song-verse-a-matched-r3.wav"),
    outputBPath: join(temporary, "review-song-verse-b-matched-r3.wav"),
    handleBeforeSeconds: 0,
    handleAfterSeconds: 0,
    referenceTruePeakDbfs: -1,
  });
  assert.ok(Math.abs(comparison.A.after.integratedLufs - comparison.B.after.integratedLufs) <= 0.2);
  assert.equal(comparison.manifestRevision, 4);
  const after = (await loadSongManifest(manifestPath)).manifest;
  assert.equal(after.artifacts.filter((artifact) => artifact.role === "preview").length, 3);
});

test("anchor audition ladder preserves one question across 20-30 second layers and A/B", async (context) => {
  try {
    await access("/usr/bin/ffmpeg");
  } catch {
    context.skip("FFmpeg is unavailable");
    return;
  }
  const temporary = await mkdtemp(join(process.cwd(), ".test-anchor-audio-review-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "anchor-review.song.json");
  await createSongManifest({
    outputPath: manifestPath,
    songId: "anchor-review-song",
    slug: "anchor-review-song",
    title: "Anchor Review Song",
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
    sampleRate: 44_100,
    gain: 0.2,
    reverb: false,
    chorus: false,
    overwrite: false,
  });
  await upsertSongManifestVocalPart(
    manifestPath,
    manifestPath,
    1,
    { id: "voice-ia", name: "IA", component_id: "BLRGDDR4M3WM2LC6" },
    { id: "lead", name: "Lead", voice_id: "voice-ia" },
    {
      id: "anchor-part",
      section_id: "chorus",
      name: "Anchor",
      start: { measure: 7, beat: 0 },
      end: { measure: 10, beat: 0 },
      notes: [
        { id: "anchor-start", position: { measure: 8, beat: 0 }, duration: 480, note_number: 64, lyric: "な", phonemes: "n a" },
        { id: "anchor-focus", position: { measure: 9, beat: 0 }, duration: 960, note_number: 69, lyric: "い", phonemes: "i" },
      ],
    },
    true,
  );
  await setSongManifestCompositionIntent(manifestPath, manifestPath, 2, {
    schema: "vocaloid-composition-intent/v1",
    song: {
      premise: "One withheld name is finally spoken.",
      central_tension: "Speaking ends the protection of silence.",
      state_at_start: "Withholding.",
      intended_destination: "One direct admission.",
    },
    sections: [{
      id: "intent-chorus",
      section_id: "chorus",
      dramatic_function: "Make the first direct address.",
      state_before: "Indirect.",
      intended_transition: "Release only on the name.",
      state_after: "Admitted.",
    }],
    phrase_directions: [{
      id: "anchor-name",
      section_id: "chorus",
      importance: "anchor",
      purpose: "Say the name as an admission.",
      semantic_focus: "The final mora.",
      state_before: "Held back.",
      intended_transition: "Open once.",
      state_after: "Stillness.",
      delivery_arc: "Restrained start, one sustained release.",
      listening_question: {
        id: "question-name",
        question: "Does the name feel like one restrained admission rather than a call?",
      },
      realization_links: {
        event_ids: ["anchor-start", "anchor-focus"],
        semantic_focus_object_ids: ["anchor-focus"],
        track_ids: ["lead"],
      },
    }],
  }, true);
  const sourceAPath = join(temporary, "source-a.wav");
  const sourceBPath = join(temporary, "source-b.wav");
  await Promise.all([
    writeFile(sourceAPath, tone(34, 0.1)),
    writeFile(sourceBPath, tone(34, 0.25)),
  ]);
  const [sourceADigest, sourceBDigest] = await Promise.all([
    fileSha256(sourceAPath),
    fileSha256(sourceBPath),
  ]);
  const beforeSources = (await loadSongManifest(manifestPath)).manifest;
  await recordSongManifestArtifacts(manifestPath, 3, beforeSources.composition_hash, [
    {
      id: "source-a",
      role: "master",
      path: sourceAPath,
      ...sourceADigest,
      source_revision: 3,
      source_composition_hash: beforeSources.composition_hash,
      dependencies: [],
      metadata: { timeline_origin: "song_start" },
      created_at: new Date().toISOString(),
    },
    {
      id: "source-b",
      role: "master",
      path: sourceBPath,
      ...sourceBDigest,
      source_revision: 3,
      source_composition_hash: beforeSources.composition_hash,
      dependencies: [],
      metadata: { timeline_origin: "song_start" },
      created_at: new Date().toISOString(),
    },
  ]);
  const layers = [
    ["lead_solo", "source-a"],
    ["lead_harmony", "source-b"],
    ["minimal_band", "source-a"],
  ] as const;
  let expectedRevision = 4;
  for (const [layer, sourceArtifactId] of layers) {
    const preview = await renderSongAnchorPassagePreview({
      manifestPath,
      expectedRevision,
      sourceArtifactId,
      phraseDirectionId: "anchor-name",
      auditionLayer: layer,
      outputPath: join(temporary, `${layer}.wav`),
      targetDurationSeconds: 25,
      referenceLufs: -16,
      referenceTruePeakDbfs: -1,
    });
    assert.ok(preview.quality.durationSeconds >= 24.9 && preview.quality.durationSeconds <= 25.1);
    assert.equal(preview.artifact.metadata.listening_question_id, "question-name");
    expectedRevision += 1;
  }
  const comparison = await compareSongAnchorPassageArtifacts({
    manifestPath,
    expectedRevision,
    artifactAId: "source-a",
    artifactBId: "source-b",
    phraseDirectionId: "anchor-name",
    auditionLayer: "full_layers",
    hypothesisFamily: "delivery",
    outputAPath: join(temporary, "anchor-a-matched.wav"),
    outputBPath: join(temporary, "anchor-b-matched.wav"),
    targetDurationSeconds: 25,
    referenceTruePeakDbfs: -1,
  });
  assert.ok(Math.abs(comparison.A.after.integratedLufs - comparison.B.after.integratedLufs) <= 0.2);
  assert.equal(comparison.reviewBinding.listening_question_id, "question-name");
  assert.equal(comparison.reviewBinding.hypothesis_family, "delivery");
  assert.equal(comparison.A.artifact?.metadata.comparison_kind, "single_question_ab");
  assert.equal(comparison.B.artifact?.metadata.intent_hash, comparison.reviewBinding.intent_hash);

  const beforeReview = (await loadSongManifest(manifestPath)).manifest;
  const creativeBeforeReview = analyzeCompositionIntent(beforeReview);
  assert.equal(creativeBeforeReview.status, "awaiting_listening");
  assert.equal(creativeBeforeReview.counts.currentRequiredLadders, 1);
  await addSongManifestReviewNote(manifestPath, expectedRevision + 1, {
    id: "review-anchor-delivery",
    author_type: "human",
    author_name: "listener",
    observation: "B answers the registered question more clearly; the release stays restrained.",
    section_id: "chorus",
    object_ids: ["anchor-name"],
    artifact_ids: [comparison.A.artifact!.id, comparison.B.artifact!.id],
    intent_fidelity: {
      review_kind: "intent_fidelity",
      phrase_direction_id: comparison.reviewBinding.phrase_direction_id,
      listening_question_id: comparison.reviewBinding.listening_question_id,
      intent_hash: comparison.reviewBinding.intent_hash,
      composition_hash: comparison.reviewBinding.composition_hash,
      artifact_id: comparison.reviewBinding.B.artifact_id,
      artifact_sha256: comparison.reviewBinding.B.artifact_sha256,
      comparison_artifacts: [comparison.reviewBinding.A],
      hypothesis_family: comparison.reviewBinding.hypothesis_family,
      outcome: "keep",
    },
  });
  const creativeAfterReview = analyzeCompositionIntent((await loadSongManifest(manifestPath)).manifest);
  assert.equal(creativeAfterReview.status, "ready");
  assert.equal(creativeAfterReview.counts.humanConfirmedAnchors, 1);
});
