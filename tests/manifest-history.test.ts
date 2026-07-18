import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { diffManifestSnapshots, listManifestHistory } from "../src/manifest-history.js";
import {
  addSongManifestReviewNote,
  createSongManifest,
  loadSongManifest,
  resolveSongManifestReviewNote,
  restoreSongManifestSnapshot,
} from "../src/song-manifest.js";


test("review notes, music-aware history diff, and monotonic restore remain provenance-safe", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-manifest-history-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "history-song.song.json");
  await createSongManifest({
    outputPath: manifestPath,
    songId: "history-song",
    slug: "history-song",
    title: "History Song",
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
  const initial = (await loadSongManifest(manifestPath)).manifest;
  await addSongManifestReviewNote(manifestPath, 1, {
    id: "review-verse-space",
    author_type: "human",
    author_name: "listener",
    observation: "The second half needs more space before the final phrase.",
    section_id: "verse",
    object_ids: ["verse"],
  });
  const withOpen = (await loadSongManifest(manifestPath)).manifest;
  assert.equal(withOpen.revision, 2);
  assert.equal(withOpen.composition_hash, initial.composition_hash);
  assert.equal(withOpen.review_notes?.[0]?.status, "open");
  await resolveSongManifestReviewNote(
    manifestPath,
    2,
    "review-verse-space",
    "Added a deliberate half-bar rest in the planned revision.",
  );

  const history = await listManifestHistory(manifestPath);
  assert.equal(history.invalid.length, 0);
  assert.deepEqual([...new Set(history.entries.map((entry) => entry.revision))].sort(), [1, 2, 3]);
  const revision1 = history.entries.find((entry) => entry.revision === 1);
  assert.ok(revision1);
  const diff = await diffManifestSnapshots(revision1.path, manifestPath);
  assert.equal(diff.compositionChanged, false);
  assert.deepEqual(diff.domains.review_notes.added, ["review-verse-space"]);

  const restored = await restoreSongManifestSnapshot(manifestPath, revision1.path, 3);
  assert.equal(restored.write.revision, 4);
  assert.equal(restored.restoredFrom.revision, 1);
  const current = (await loadSongManifest(manifestPath)).manifest;
  assert.equal(current.revision, 4);
  assert.equal(current.parent_hash, history.entries.find((entry) => entry.current)?.contentHash);
  assert.deepEqual(current.review_notes, []);
});
