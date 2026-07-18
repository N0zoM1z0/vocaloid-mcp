import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildSongManifest,
  createSongManifest,
  getSongManifestSection,
  inspectSongManifest,
  loadSongManifest,
  removeSongManifestObjects,
  transformSongManifestEvents,
  upsertSongManifestArrangementTrack,
  upsertSongManifestVocalPart,
} from "../src/song-manifest.js";
import { validateProject } from "../src/vsqx.js";


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function readable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("manifest revisions preserve stable IDs and reject corruption, stale writes, and dangling removal", async (context) => {
  const temporary = await mkdtemp(join(ROOT, ".test-song-manifest-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "stable-song.song.json");

  const created = await createSongManifest({
    outputPath: manifestPath,
    songId: "stable-song",
    slug: "stable-song",
    title: "Stable Song",
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 132 }],
    sections: [
      {
        id: "intro",
        name: "Intro",
        kind: "intro",
        start: { measure: 0, beat: 0 },
        end: { measure: 1, beat: 0 },
      },
      {
        id: "verse-a",
        name: "Verse A",
        kind: "verse",
        start: { measure: 1, beat: 0 },
        end: { measure: 2, beat: 0 },
        energy: 0.62,
      },
    ],
    keyChanges: [{ id: "key-cmaj", position: { measure: 0, beat: 0 }, tonic: "C", mode: "major" }],
    chordChanges: [{
      id: "chord-cmaj-1",
      position: { measure: 0, beat: 0 },
      symbol: "Cmaj",
      duration_ticks: 3840,
    }],
    sampleRate: 44_100,
    gain: 0.18,
    reverb: true,
    chorus: true,
    overwrite: false,
  });
  assert.equal(created.revision, 1);
  assert.match(created.contentHash, /^[a-f0-9]{64}$/u);

  const initial = await inspectSongManifest(manifestPath);
  assert.deepEqual(initial.sections.map((section) => section.id), ["intro", "verse-a"]);

  const corruptCompositionPath = join(temporary, "corrupt-composition.song.json");
  const corruptComposition = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  corruptComposition.title = "Silently modified outside MCP";
  await writeFile(
    corruptCompositionPath,
    `${JSON.stringify(corruptComposition, null, 2)}\n`,
    "utf8",
  );
  await assert.rejects(loadSongManifest(corruptCompositionPath), /composition hash mismatch/u);

  const corruptProvenancePath = join(temporary, "corrupt-provenance.song.json");
  const corruptProvenance = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  corruptProvenance.updated_at = "2030-01-01T00:00:00.000Z";
  await writeFile(
    corruptProvenancePath,
    `${JSON.stringify(corruptProvenance, null, 2)}\n`,
    "utf8",
  );
  await assert.rejects(loadSongManifest(corruptProvenancePath), /content hash mismatch/u);

  await assert.rejects(
    upsertSongManifestVocalPart(
      manifestPath,
      manifestPath,
      999,
      { id: "voice-ia", name: "IA", component_id: "BLRGDDR4M3WM2LC6" },
      { id: "lead", name: "Lead", voice_id: "voice-ia" },
      {
        id: "verse-a-lead",
        section_id: "verse-a",
        name: "Verse A Lead",
        start: { measure: 1, beat: 0 },
        end: { measure: 2, beat: 0 },
        notes: [{
          id: "lead-note-1",
          position: { measure: 1, beat: 0 },
          duration: 480,
          note_number: 60,
          lyric: "ら",
          phonemes: "4 a",
        }],
      },
      true,
    ),
    /Stale manifest revision 999; current revision is 1/u,
  );

  const vocal = await upsertSongManifestVocalPart(
    manifestPath,
    manifestPath,
    1,
    { id: "voice-ia", name: "IA", component_id: "BLRGDDR4M3WM2LC6" },
    { id: "lead", name: "Lead", voice_id: "voice-ia", mixer: { pan: 64, volume: -80 } },
    {
      id: "verse-a-lead",
      section_id: "verse-a",
      name: "Verse A Lead",
      start: { measure: 1, beat: 0 },
      end: { measure: 2, beat: 0 },
      notes: [
        {
          id: "lead-note-1",
          position: { measure: 1, beat: 0 },
          duration: 480,
          note_number: 60,
          lyric: "ら",
          phonemes: "4 a",
        },
        {
          id: "lead-note-2",
          position: { measure: 1, beat: 1 },
          duration: 480,
          note_number: 62,
          lyric: "ら",
          phonemes: "4 a",
        },
      ],
    },
    true,
  );
  assert.equal(vocal.write.revision, 2);
  assert.deepEqual(vocal.summary.sections.map((section) => section.id), ["intro", "verse-a"]);

  const piano = await upsertSongManifestArrangementTrack(
    manifestPath,
    manifestPath,
    2,
    {
      kind: "pitched",
      id: "piano",
      name: "Piano",
      program: 0,
      pan: 52,
      notes: [
        {
          id: "piano-note-1",
          position: { measure: 0, beat: 0 },
          duration: 960,
          note_number: 48,
        },
        {
          id: "piano-note-2",
          position: { measure: 1, beat: 0 },
          duration: 960,
          note_number: 55,
        },
      ],
    },
    true,
  );
  assert.equal(piano.write.revision, 3);

  const drums = await upsertSongManifestArrangementTrack(
    manifestPath,
    manifestPath,
    3,
    {
      kind: "drums",
      id: "drums",
      name: "Drums",
      hits: [
        { id: "kick-1", position: { measure: 0, beat: 0 }, note_number: 36 },
        { id: "snare-1", position: { measure: 0, beat: 2 }, note_number: 38 },
        { id: "kick-2", position: { measure: 1, beat: 0 }, note_number: 36 },
        { id: "snare-2", position: { measure: 1, beat: 2 }, note_number: 38 },
      ],
    },
    true,
  );
  assert.equal(drums.write.revision, 4);

  const transformed = await transformSongManifestEvents(
    manifestPath,
    manifestPath,
    4,
    {
      vocal_track_id: "lead",
      event_ids: ["lead-note-2"],
      targets: ["vocal_notes"],
      transpose: 3,
    },
    true,
  );
  assert.equal(transformed.changed, 1);
  assert.equal(transformed.write.revision, 5);
  const transformedManifest = (await loadSongManifest(manifestPath)).manifest;
  const transformedNotes = transformedManifest.vocal_tracks[0]?.parts[0]?.notes ?? [];
  assert.deepEqual(
    transformedNotes.map((note) => [note.id, note.note_number]),
    [["lead-note-1", 60], ["lead-note-2", 65]],
  );
  assert.deepEqual(transformedManifest.sections.map((section) => section.id), ["intro", "verse-a"]);

  await assert.rejects(
    removeSongManifestObjects(
      manifestPath,
      manifestPath,
      5,
      { object_type: "section", object_ids: ["verse-a"] },
      true,
    ),
    /Cannot remove section verse-a/u,
  );
  assert.equal((await loadSongManifest(manifestPath)).manifest.revision, 5);

  const section = await getSongManifestSection(manifestPath, "verse-a");
  assert.equal(section.vocalTracks[0]?.parts[0]?.id, "verse-a-lead");
  assert.equal(section.arrangementTracks.length, 2);
});

test("manifest build creates verified stereo backing, valid VSQX, and artifact provenance", async (context) => {
  if (!(await readable("/usr/bin/fluidsynth")) || !(await readable("/usr/share/sounds/sf2/FluidR3_GM.sf2"))) {
    context.skip("FluidSynth and the default GM SoundFont are unavailable");
    return;
  }
  const temporary = await mkdtemp(join(ROOT, ".test-song-manifest-build-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "buildable-song.song.json");
  await createSongManifest({
    outputPath: manifestPath,
    songId: "buildable-song",
    slug: "buildable-song",
    title: "Buildable Song",
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 120 }],
    sections: [{
      id: "verse",
      name: "Verse",
      kind: "verse",
      start: { measure: 0, beat: 0 },
      end: { measure: 1, beat: 0 },
    }],
    sampleRate: 44_100,
    gain: 0.18,
    reverb: true,
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
      id: "verse-lead",
      section_id: "verse",
      name: "Verse Lead",
      start: { measure: 0, beat: 0 },
      end: { measure: 1, beat: 0 },
      notes: [{
        id: "lead-note",
        position: { measure: 0, beat: 0 },
        duration: 480,
        note_number: 60,
        lyric: "ら",
        phonemes: "4 a",
      }],
    },
    true,
  );
  await upsertSongManifestArrangementTrack(
    manifestPath,
    manifestPath,
    2,
    {
      kind: "pitched",
      id: "piano",
      name: "Piano",
      program: 0,
      notes: [
        { id: "piano-c", position: { measure: 0, beat: 0 }, duration: 480, note_number: 60 },
        { id: "piano-e", position: { measure: 0, beat: 1 }, duration: 480, note_number: 64 },
        { id: "piano-g", position: { measure: 0, beat: 2 }, duration: 480, note_number: 67 },
        { id: "piano-c2", position: { measure: 0, beat: 3 }, duration: 480, note_number: 72 },
      ],
    },
    true,
  );

  const backingPath = join(temporary, "buildable-song-backing-r3.wav");
  const projectPath = join(temporary, "buildable-song-r3.vsqx");
  const result = await buildSongManifest({
    manifestPath,
    expectedRevision: 3,
    backingOutputPath: backingPath,
    projectOutputPath: projectPath,
  });
  assert.equal(result.sourceRevision, 3);
  assert.equal(result.manifestRevision, 4);
  assert.equal(result.backing.channels, 2);
  assert.equal(result.backing.silent, false);
  assert.equal(result.validation.valid, true);
  assert.match(result.backing.sha256, /^[a-f0-9]{64}$/u);
  assert.match(result.project.sha256, /^[a-f0-9]{64}$/u);

  const validation = await validateProject(projectPath);
  assert.equal(validation.valid, true);
  const finalManifest = (await loadSongManifest(manifestPath)).manifest;
  assert.equal(finalManifest.revision, 4);
  assert.deepEqual(finalManifest.artifacts.map((artifact) => artifact.role), ["backing", "vsqx"]);
  assert.deepEqual(finalManifest.artifacts.map((artifact) => artifact.source_revision), [3, 3]);
  assert.deepEqual(finalManifest.artifacts[1]?.dependencies, ["backing-r3"]);
});
