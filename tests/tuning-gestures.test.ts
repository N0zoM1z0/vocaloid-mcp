import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { alignJapanesePhrase } from "../src/japanese.js";
import {
  applySongManifestTuningGestures,
  buildSongManifest,
  createSongManifest,
  loadSongManifest,
  upsertSongManifestArrangementTrack,
  upsertSongManifestVocalPart,
  upsertSongManifestVocalPhrase,
} from "../src/song-manifest.js";
import { listControlPoints, listNotes, validateProject } from "../src/vsqx.js";


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function readable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("upserts an aligned phrase and compiles stable-ID tuning gestures into native VSQX expression", async (context) => {
  if (!(await readable("/usr/bin/fluidsynth")) || !(await readable("/usr/share/sounds/sf2/FluidR3_GM.sf2"))) {
    context.skip("FluidSynth and the default GM SoundFont are unavailable");
    return;
  }
  const temporary = await mkdtemp(join(ROOT, ".test-tuning-gestures-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifestPath = join(temporary, "gesture-song.song.json");

  await createSongManifest({
    outputPath: manifestPath,
    songId: "gesture-song",
    slug: "gesture-song",
    title: "Gesture Song",
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 128 }],
    sections: [{
      id: "verse",
      name: "Verse",
      kind: "verse",
      start: { measure: 0, beat: 0 },
      end: { measure: 1, beat: 0 },
    }],
    sampleRate: 44_100,
    gain: 0.18,
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

  const aligned = alignJapanesePhrase({
    text: "きゃら",
    phrase_id: "jp-phrase",
    start: { measure: 0, beat: 1 },
    note_slots: [
      { id: "jp-cell-1", duration: 240, note_number: 62 },
      { id: "jp-cell-2", duration: 240, note_number: 64 },
    ],
  });
  const phraseWrite = await upsertSongManifestVocalPhrase(
    manifestPath,
    manifestPath,
    2,
    "lead",
    "verse-lead",
    aligned.phrase,
    true,
  );
  assert.equal(phraseWrite.write.revision, 3);

  const gestureWrite = await applySongManifestTuningGestures(
    manifestPath,
    manifestPath,
    3,
    "lead",
    "verse-lead",
    [
      {
        id: "crisp-entry",
        type: "articulation",
        event_ids: ["lead-note", "jp-cell-1"],
        accent: 74,
        decay: 42,
        opening: 108,
        consonant_velocity: 82,
        rise_portamento: true,
      },
      {
        id: "tail-vibrato",
        type: "vibrato",
        event_ids: ["jp-cell-2"],
        vibrato_type: 13,
        length_percent: 58,
        depth_start: 20,
        depth_peak: 55,
        depth_end: 40,
        rate_start: 44,
        rate_end: 52,
      },
      {
        id: "lead-scoop",
        type: "pitch_scoop",
        event_ids: ["lead-note"],
        direction: "up_into",
        depth_cents: 85,
        duration_percent: 24,
        pitch_bend_sensitivity: 2,
      },
      {
        id: "phrase-arc",
        type: "dynamics_arc",
        event_ids: ["lead-note", "jp-cell-1", "jp-cell-2"],
        start_value: 58,
        peak_value: 82,
        end_value: 66,
        peak_position: 0.62,
      },
      {
        id: "opening-arc",
        type: "opening_arc",
        event_ids: ["lead-note", "jp-cell-1", "jp-cell-2"],
        start_value: 48,
        peak_value: 112,
        end_value: 68,
        peak_position: 0.6,
      },
      {
        id: "brightness-arc",
        type: "timbre_arc",
        event_ids: ["jp-cell-1", "jp-cell-2"],
        curve: "BRI",
        start_value: 54,
        peak_value: 76,
        end_value: 60,
      },
    ],
    true,
  );
  assert.equal(gestureWrite.write.revision, 4);
  assert.deepEqual(
    gestureWrite.applied.compiled.map((entry) => [entry.type, entry.curves]),
    [
      ["articulation", []],
      ["vibrato", []],
      ["pitch_scoop", ["PBS", "PIT"]],
      ["dynamics_arc", ["DYN"]],
      ["opening_arc", []],
      ["timbre_arc", ["BRI"]],
    ],
  );

  await assert.rejects(
    applySongManifestTuningGestures(
      manifestPath,
      manifestPath,
      3,
      "lead",
      "verse-lead",
      [{
        id: "stale-gesture",
        type: "articulation",
        event_ids: ["lead-note"],
        accent: 50,
      }],
      true,
    ),
    /Stale manifest revision 3; current revision is 4/u,
  );

  await applySongManifestTuningGestures(
    manifestPath,
    manifestPath,
    4,
    "lead",
    "verse-lead",
    [{
      id: "second-scoop",
      type: "pitch_scoop",
      event_ids: ["jp-cell-1"],
      direction: "fall_away",
      depth_cents: 60,
      duration_percent: 35,
      pitch_bend_sensitivity: 2,
    }],
    true,
  );
  const tuned = (await loadSongManifest(manifestPath)).manifest;
  const part = tuned.vocal_tracks[0]?.parts[0];
  assert.ok(part);
  assert.deepEqual(
    part.tuning_gestures?.map((gesture) => gesture.id),
    ["crisp-entry", "tail-vibrato", "lead-scoop", "phrase-arc", "opening-arc", "brightness-arc", "second-scoop"],
  );
  assert.equal(part.notes[0]?.style.accent, 74);
  assert.equal(part.notes[0]?.style.risePort, 1);
  assert.equal(part.notes[0]?.velocity, 82);
  assert.equal(part.phrases[0]?.cells[0]?.style.accent, 74);
  assert.ok((part.phrases[0]?.cells[0]?.style.opening ?? 0) > 48);
  assert.equal(part.phrases[0]?.cells[1]?.vibrato?.type, 13);
  assert.deepEqual(part.control_curves.map((curve) => curve.curve).sort(), ["BRI", "DYN", "PBS", "PIT"]);
  assert.equal(new Set(part.control_curves.map((curve) => curve.curve)).size, 4);
  for (const curve of part.control_curves) {
    const ticks = curve.points.map((point) =>
      point.position.measure * 1920 + point.position.beat * 480 + point.position.tick);
    assert.equal(new Set(ticks).size, ticks.length);
  }
  await assert.rejects(
    applySongManifestTuningGestures(
      manifestPath,
      manifestPath,
      5,
      "lead",
      "verse-lead",
      [{
        id: "second-scoop",
        type: "pitch_scoop",
        event_ids: ["jp-cell-2"],
        direction: "up_into",
        depth_cents: 40,
        duration_percent: 20,
        pitch_bend_sensitivity: 2,
      }],
      true,
    ),
    /Tuning gesture second-scoop already exists/u,
  );

  await upsertSongManifestArrangementTrack(
    manifestPath,
    manifestPath,
    5,
    {
      kind: "pitched",
      id: "piano",
      name: "Piano",
      program: 0,
      notes: [{ id: "piano-c", position: { measure: 0, beat: 0 }, duration: 960, note_number: 48 }],
    },
    true,
  );
  const backingPath = join(temporary, "gesture-song-backing-r6.wav");
  const projectPath = join(temporary, "gesture-song-r6.vsqx");
  const built = await buildSongManifest({
    manifestPath,
    expectedRevision: 6,
    backingOutputPath: backingPath,
    projectOutputPath: projectPath,
  });
  assert.equal(built.validation.valid, true);
  assert.equal((await validateProject(projectPath)).valid, true);
  const notes = (await listNotes(projectPath, 0, 0, undefined, undefined, 0, 20)).page.items;
  assert.deepEqual(notes.map((note) => note.lyric), ["ら", "きゃ", "ら"]);
  assert.equal(notes[0]?.style.accent, 74);
  assert.equal(notes[1]?.style.accent, 74);
  assert.equal(notes[2]?.style.vibType, 13);
  const controls = (await listControlPoints(projectPath, 0, 0, undefined, undefined, undefined, 0, 100)).page.items;
  assert.deepEqual([...new Set(controls.map((point) => point.curve))].sort(), ["BRI", "DYN", "PBS", "PIT"]);
});
