import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { previewSongManifestMutation } from "../src/mutation-preview.js";
import {
  createSongManifest,
  loadSongManifest,
  upsertSongManifestSection,
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
