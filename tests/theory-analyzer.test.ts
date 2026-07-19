import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  createSongManifest,
  loadSongManifest,
  songCompositionHash,
  songManifestHash,
  songMixHash,
  SongManifestSchema,
  type SongManifest,
  upsertSongManifestArrangementTrack,
  upsertSongManifestVocalPart,
} from "../src/song-manifest.js";
import { analyzeManifestTheory } from "../src/theory/analyze.js";
import { beatStrengthAtTick } from "../src/theory/rhythm.js";
import { timelineTick } from "../src/theory/timeline.js";


function positionFromTick(tick: number) {
  const measure = Math.floor(tick / 1920);
  const withinMeasure = tick - measure * 1920;
  const beat = Math.floor(withinMeasure / 480);
  return { measure, beat, tick: withinMeasure - beat * 480 };
}

function rehash(manifest: SongManifest): SongManifest {
  const {
    content_hash: _contentHash,
    composition_hash: _compositionHash,
    mix_hash: _mixHash,
    ...candidate
  } = structuredClone(manifest);
  const composition_hash = songCompositionHash(candidate);
  const mix_hash = songMixHash(candidate, composition_hash);
  const content_hash = songManifestHash({ ...candidate, composition_hash, mix_hash });
  return SongManifestSchema.parse({ ...candidate, composition_hash, mix_hash, content_hash });
}

function metric(report: ReturnType<typeof analyzeManifestTheory>, id: string) {
  return report.metrics.find((entry) => entry.id === id)?.value;
}

async function createProblemFixture(path: string): Promise<SongManifest> {
  await createSongManifest({
    outputPath: path,
    songId: "theory-problem-song",
    slug: "theory-problem-song",
    title: "Theory Problem Song",
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 120 }],
    sections: [
      {
        id: "verse",
        name: "Verse",
        kind: "verse",
        start: { measure: 0, beat: 0 },
        end: { measure: 2, beat: 0 },
        energy: 0.2,
      },
      {
        id: "chorus",
        name: "Chorus",
        kind: "chorus",
        start: { measure: 2, beat: 0 },
        end: { measure: 4, beat: 0 },
        energy: 0.9,
      },
    ],
    keyChanges: [{ id: "key-c", position: { measure: 0, beat: 0 }, tonic: "C", mode: "major" }],
    chordChanges: [{
      id: "chord-c-over-e",
      position: { measure: 0, beat: 0 },
      symbol: "C/E",
      duration_ticks: 7680,
    }],
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
      id: "verse-lead",
      section_id: "verse",
      name: "Verse Lead",
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
          note_number: 79,
          lyric: "あ",
          phonemes: "a",
        },
      ],
    },
    true,
  );
  await upsertSongManifestVocalPart(
    path,
    path,
    2,
    { id: "voice-ia", name: "IA", component_id: "BLRGDDR4M3WM2LC6" },
    { id: "harmony", name: "Harmony", voice_id: "voice-ia" },
    {
      id: "verse-harmony",
      section_id: "verse",
      name: "Verse Harmony",
      start: { measure: 0, beat: 0 },
      end: { measure: 2, beat: 0 },
      notes: [
        {
          id: "harmony-c-sharp4",
          position: { measure: 0, beat: 0 },
          duration: 480,
          note_number: 61,
          lyric: "あ",
          phonemes: "a",
        },
        {
          id: "harmony-f-sharp5",
          position: { measure: 0, beat: 1 },
          duration: 480,
          note_number: 78,
          lyric: "あ",
          phonemes: "a",
        },
      ],
    },
    true,
  );

  const chordNotes = (prefix: string) => Array.from({ length: 8 }, (_, onset) =>
    [48, 55, 60].map((noteNumber, voice) => ({
      id: `${prefix}-${onset}-${voice}`,
      position: { measure: Math.floor(onset / 4), beat: onset % 4 },
      duration: 240,
      note_number: noteNumber,
    }))).flat();
  await upsertSongManifestArrangementTrack(path, path, 3, {
    kind: "pitched",
    id: "pad-a",
    name: "Pad A",
    program: 88,
    notes: chordNotes("pad-a-note"),
  }, true);
  await upsertSongManifestArrangementTrack(path, path, 4, {
    kind: "pitched",
    id: "pad-b",
    name: "Pad B",
    program: 88,
    notes: chordNotes("pad-b-note"),
  }, true);
  await upsertSongManifestArrangementTrack(path, path, 5, {
    kind: "pitched",
    id: "bass",
    name: "Bass",
    program: 33,
    notes: Array.from({ length: 8 }, (_, onset) => ({
      id: `bass-note-${onset}`,
      position: { measure: Math.floor(onset / 4), beat: onset % 4 },
      duration: 240,
      note_number: 48,
    })),
  }, true);
  await upsertSongManifestArrangementTrack(path, path, 6, {
    kind: "pitched",
    id: "guitar",
    name: "Guitar",
    program: 24,
    notes: [{
      id: "guitar-too-low",
      position: { measure: 0, beat: 0 },
      duration: 480,
      note_number: 30,
    }],
  }, true);
  return (await loadSongManifest(path)).manifest;
}

test("symbolic analyzer is deterministic, non-mutating, and locates theory/arrangement risks", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-theory-analyzer-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const manifest = await createProblemFixture(join(temporary, "problem.song.json"));
  const before = JSON.stringify(manifest);
  const first = analyzeManifestTheory(manifest);
  const second = analyzeManifestTheory(manifest);
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(manifest), before);
  assert.equal(first.compositionHash, manifest.composition_hash);
  assert.equal(first.rulesetId, "core/v1");
  assert.match(first.rulesetHash, /^[a-f0-9]{64}$/u);
  const codes = new Set(first.issues.map((issue) => issue.code));
  for (const expected of [
    "LARGE_LEAP_UNBALANCED",
    "VOCAL_HARMONY_MINOR_SECOND",
    "VOICE_CROSSING",
    "BASS_CONFLICTS_WITH_SLASH_CHORD",
    "ARRANGEMENT_RANGE_RISK",
    "REGISTER_DENSITY_COLLISION",
    "RHYTHMIC_LAYER_COLLISION",
    "ACCOMPANIMENT_ROLE_REDUNDANCY",
    "SECTION_DENSITY_ENERGY_MISMATCH",
  ]) assert.ok(codes.has(expected), `missing ${expected}`);
  assert.equal(metric(first, "harmony.chord_coverage"), 1);
  assert.equal(metric(first, "arrangement.rhythmic_redundancy_pairs"), 3);
  assert.ok(first.issues.every((issue) => issue.evidence[0]?.level === "symbolic_exact"));
  assert.ok(first.issues.every((issue) => issue.suggestedRepairs.length <= 1));

  const transposed = structuredClone(manifest);
  for (const track of transposed.vocal_tracks) for (const part of track.parts) {
    for (const note of part.notes) note.note_number += 1;
  }
  const transposedReport = analyzeManifestTheory(rehash(transposed));
  assert.equal(metric(first, "melody.range.lead"), metric(transposedReport, "melody.range.lead"));
  assert.equal(metric(first, "melody.motif_repetition.lead"), metric(transposedReport, "melody.motif_repetition.lead"));
  assert.equal(metric(first, "rhythm.syncopation.lead"), metric(transposedReport, "rhythm.syncopation.lead"));
});

test("leading-tone resolution applies to semitone leading tones, not modal subtonics", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-theory-leading-tone-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));

  const fixture = async (name: string, tonic: string, mode: string, noteNumber: number) => {
    const path = join(temporary, `${name}.song.json`);
    await createSongManifest({
      outputPath: path,
      songId: name,
      slug: name,
      title: name,
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
      keyChanges: [{ id: `key-${name}`, position: { measure: 0, beat: 0 }, tonic, mode }],
      chordChanges: [{ id: `chord-${name}`, position: { measure: 0, beat: 0 }, symbol: `${tonic}m`, duration_ticks: 1920 }],
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
        id: "verse-lead",
        section_id: "verse",
        name: "Verse Lead",
        start: { measure: 0, beat: 0 },
        end: { measure: 1, beat: 0 },
        notes: [{
          id: "degree-seven",
          position: { measure: 0, beat: 0 },
          duration: 480,
          note_number: noteNumber,
          lyric: "あ",
          phonemes: "a",
        }],
      },
      true,
    );
    return analyzeManifestTheory((await loadSongManifest(path)).manifest);
  };

  const dorian = await fixture("d-dorian", "D", "dorian", 60);
  assert.ok(!dorian.issues.some((issue) => issue.code === "LEADING_TONE_UNRESOLVED"));

  const major = await fixture("c-major", "C", "major", 59);
  const leadingTone = major.issues.find((issue) => issue.code === "LEADING_TONE_UNRESOLVED");
  assert.ok(leadingTone);
  assert.equal(leadingTone.evidence[0]?.details.leading_tone_distance_semitones, 1);
});

test("voice ordering is inferred from overlapping material, not unrelated song sections", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-theory-overlap-order-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const path = join(temporary, "overlap-order.song.json");
  await createSongManifest({
    outputPath: path,
    songId: "overlap-order",
    slug: "overlap-order",
    title: "Overlap Order",
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 120 }],
    sections: [
      {
        id: "verse",
        name: "Verse",
        kind: "verse",
        start: { measure: 0, beat: 0 },
        end: { measure: 2, beat: 0 },
      },
      {
        id: "chorus",
        name: "Chorus",
        kind: "chorus",
        start: { measure: 2, beat: 0 },
        end: { measure: 4, beat: 0 },
      },
    ],
    keyChanges: [{ id: "key-c", position: { measure: 0, beat: 0 }, tonic: "C", mode: "major" }],
    chordChanges: [{ id: "chord-c", position: { measure: 0, beat: 0 }, symbol: "C", duration_ticks: 7680 }],
    sampleRate: 44_100,
    gain: 0.2,
    reverb: false,
    chorus: false,
    overwrite: false,
  });
  const voice = { id: "voice-ia", name: "IA", component_id: "BLRGDDR4M3WM2LC6" };
  const lead = { id: "lead", name: "Lead", voice_id: voice.id };
  await upsertSongManifestVocalPart(path, path, 1, voice, lead, {
    id: "lead-verse",
    section_id: "verse",
    name: "Low Verse",
    start: { measure: 0, beat: 0 },
    end: { measure: 2, beat: 0 },
    notes: [{
      id: "lead-low-unrelated",
      position: { measure: 0, beat: 0 },
      duration: 480,
      note_number: 36,
      lyric: "あ",
      phonemes: "a",
    }],
  }, true);
  await upsertSongManifestVocalPart(path, path, 2, voice, lead, {
    id: "lead-chorus",
    section_id: "chorus",
    name: "Lead Chorus",
    start: { measure: 2, beat: 0 },
    end: { measure: 4, beat: 0 },
    notes: [0, 1].map((beat) => ({
      id: `lead-chorus-${beat}`,
      position: { measure: 2, beat },
      duration: 480,
      note_number: 67,
      lyric: "あ",
      phonemes: "a",
    })),
  }, true);
  await upsertSongManifestVocalPart(
    path,
    path,
    3,
    voice,
    { id: "harmony", name: "Harmony", voice_id: voice.id },
    {
      id: "harmony-chorus",
      section_id: "chorus",
      name: "Harmony Chorus",
      start: { measure: 2, beat: 0 },
      end: { measure: 4, beat: 0 },
      notes: [0, 1].map((beat) => ({
        id: `harmony-chorus-${beat}`,
        position: { measure: 2, beat },
        duration: 480,
        note_number: 64,
        lyric: "あ",
        phonemes: "a",
      })),
    },
    true,
  );

  const report = analyzeManifestTheory((await loadSongManifest(path)).manifest);
  assert.ok(!report.issues.some((issue) => issue.code === "VOICE_CROSSING"));
  assert.equal(metric(report, "voice_leading.crossings"), 0);
});

test("Japanese phrase analysis measures short mora, melisma, and tuning suitability", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-theory-phrase-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const path = join(temporary, "phrase.song.json");
  await createSongManifest({
    outputPath: path,
    songId: "phrase-song",
    slug: "phrase-song",
    title: "Phrase Song",
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
    keyChanges: [{ id: "key-c", position: { measure: 0, beat: 0 }, tonic: "C", mode: "major" }],
    chordChanges: [{ id: "chord-c", position: { measure: 0, beat: 0 }, symbol: "C", duration_ticks: 1920 }],
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
      id: "verse-lead",
      section_id: "verse",
      name: "Verse Lead",
      start: { measure: 0, beat: 0 },
      end: { measure: 1, beat: 0 },
      phrases: [{
        id: "phrase-fast-n",
        start: { measure: 0, beat: 0 },
        allocation: "explicit",
        lyrics: [
          { id: "lyric-n", lyric: "ん", phonemes: "N", phoneme_locked: true },
          { id: "lyric-ka", lyric: "か", phonemes: "k a", phoneme_locked: true },
        ],
        cells: [
          {
            id: "cell-n-start",
            duration: { denominator: 64, dots: 0 },
            note_number: 60,
            lyric_index: 0,
            vibrato: { type: 1, length: 50 },
          },
          {
            id: "cell-n-melisma",
            duration: { denominator: 64, dots: 0 },
            note_number: 62,
            lyric_index: 0,
          },
          {
            id: "cell-breath",
            duration: { denominator: 8, dots: 0 },
            rest: true,
          },
          {
            id: "cell-ka",
            duration: { denominator: 64, dots: 0 },
            note_number: 62,
            lyric_index: 1,
          },
        ],
      }],
    },
    true,
  );
  const report = analyzeManifestTheory((await loadSongManifest(path)).manifest);
  const codes = new Set(report.issues.map((issue) => issue.code));
  assert.ok(codes.has("MORA_DURATION_UNSINGABLE"));
  assert.ok(codes.has("CONSONANT_LEAD_TIME_INSUFFICIENT"));
  assert.ok(codes.has("MELISMA_PHONEME_UNSUITABLE"));
  assert.ok(codes.has("VIBRATO_NOTE_TOO_SHORT"));
  assert.equal(metric(report, "note_allocation.max_onsets_per_second.lead"), 3);
  assert.ok(Number(metric(report, "note_allocation.minimum_mora_duration.lead")) < 40);
  assert.ok(Number(metric(report, "note_allocation.minimum_consonant_budget.lead")) < 40);
  assert.equal(metric(report, "note_allocation.unsuitable_melisma_ratio.lead"), 1);
  assert.equal(metric(report, "vocal.breath_window_count.lead"), 1);
  assert.ok(Number(metric(report, "vocal.longest_breath_window.lead")) > 200);
});

test("compound meter grouping is explicit and reusable patterns cannot silently cross meter changes", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-theory-meter-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const path = join(temporary, "meter.song.json");
  await createSongManifest({
    outputPath: path,
    songId: "meter-song",
    slug: "meter-song",
    title: "Meter Song",
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [
      { measure: 0, numerator: 4, denominator: 4 },
      { measure: 2, numerator: 6, denominator: 8 },
    ],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 120 }],
    sections: [{
      id: "song",
      name: "Song",
      kind: "custom",
      start: { measure: 0, beat: 0 },
      end: { measure: 4, beat: 0 },
    }],
    keyChanges: [],
    chordChanges: [],
    sampleRate: 44_100,
    gain: 0.2,
    reverb: false,
    chorus: false,
    overwrite: false,
  });
  await upsertSongManifestArrangementTrack(path, path, 1, {
    kind: "pitched",
    id: "meter-pattern-track",
    name: "Meter Pattern",
    program: 88,
    patterns: [{
      id: "two-measure-pattern",
      measures: 2,
      notes: [{
        id: "pattern-note",
        offset: { measure: 0, beat: 0 },
        duration: 240,
        note_number: 60,
      }],
    }],
    placements: [{
      id: "meter-crossing-placement",
      pattern_id: "two-measure-pattern",
      start: { measure: 1, beat: 0 },
    }],
  }, true);
  const manifest = (await loadSongManifest(path)).manifest;
  const compoundGroup = beatStrengthAtTick(
    manifest,
    timelineTick(manifest, { measure: 2, beat: 3, tick: 0 }),
  );
  const compoundInnerBeat = beatStrengthAtTick(
    manifest,
    timelineTick(manifest, { measure: 2, beat: 1, tick: 0 }),
  );
  assert.deepEqual(compoundGroup, { strength: 0.75, role: "group", beat: 3, tickWithinBeat: 0 });
  assert.deepEqual(compoundInnerBeat, { strength: 0.45, role: "beat", beat: 1, tickWithinBeat: 0 });
  assert.ok(analyzeManifestTheory(manifest).issues.some((issue) => issue.code === "PATTERN_METER_MISMATCH"));
});

test("20,000-event analysis remains bounded and preserves its input", () => {
  const now = "2026-07-19T00:00:00.000Z";
  const base = SongManifestSchema.parse({
    schema: "vocaloid-song-manifest/v1",
    revision: 1,
    composition_hash: "0".repeat(64),
    mix_hash: "0".repeat(64),
    content_hash: "0".repeat(64),
    song_id: "performance-song",
    slug: "performance-song",
    title: "Performance Song",
    format: "vsq3",
    pre_measure: 1,
    created_at: now,
    updated_at: now,
    time_signatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0, tick: 0 }, bpm: 120 }],
    sections: [{
      id: "long-section",
      name: "Long Section",
      kind: "custom",
      start: { measure: 0, beat: 0, tick: 0 },
      end: { measure: 625, beat: 0, tick: 0 },
      energy: 0.5,
      description: "",
    }],
    harmony: { key_changes: [], chord_changes: [] },
    voices: [{
      id: "voice-ia",
      name: "IA",
      component_id: "BLRGDDR4M3WM2LC6",
      bank_select: 0,
      program_change: 0,
      parameters: {},
    }],
    vocal_tracks: [{
      id: "lead",
      name: "Lead",
      comment: "",
      voice_id: "voice-ia",
      mixer: { volume: 0, pan: 64, mute: false, solo: false, send_level: -898, send_enabled: false },
      parts: [0, 1].map((partIndex) => ({
        id: `long-part-${partIndex}`,
        section_id: "long-section",
        name: `Long Part ${partIndex}`,
        comment: "",
        start: positionFromTick(partIndex * 600_000),
        end: positionFromTick((partIndex + 1) * 600_000),
        notes: Array.from({ length: 10_000 }, (_, localIndex) => {
          const eventIndex = partIndex * 10_000 + localIndex;
          return {
            id: `perf-note-${eventIndex}`,
            position: positionFromTick(eventIndex * 60),
            duration: 30,
            note_number: 60 + eventIndex % 3,
            lyric: "あ",
            phonemes: "a",
            phoneme_locked: true,
            velocity: 64,
            style: {},
          };
        }),
        phrases: [],
        control_curves: [],
      })),
    }],
    accompaniment: {
      sample_rate: 44_100,
      gain: 0.2,
      reverb: false,
      chorus: false,
      tracks: [],
    },
    mix: { effect_chains: [], section_dynamics: [] },
    artifacts: [],
    review_notes: [],
  });
  const manifest = rehash(base);
  const before = JSON.stringify(manifest);
  const started = performance.now();
  const report = analyzeManifestTheory(manifest);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 2000, `20,000-event analysis took ${elapsed.toFixed(1)} ms`);
  assert.equal(JSON.stringify(manifest), before);
  assert.equal(report.metrics.find((entry) => entry.id === "melody.range.lead")?.value, 2);
  assert.ok(report.issues.length < 20_000);

  const denseArrangement = structuredClone(manifest);
  denseArrangement.vocal_tracks = [];
  denseArrangement.accompaniment.tracks = [0, 1, 2].map((trackIndex) => {
    const startIndex = Math.floor((20_000 * trackIndex) / 3);
    const endIndex = Math.floor((20_000 * (trackIndex + 1)) / 3);
    return {
      kind: "pitched" as const,
      id: `dense-${trackIndex}`,
      name: `Dense ${trackIndex}`,
      bank_msb: 0,
      bank_lsb: 0,
      program: 88,
      volume: 100,
      pan: 64,
      notes: Array.from({ length: endIndex - startIndex }, (_, localIndex) => ({
        id: `dense-note-${startIndex + localIndex}`,
        position: { measure: 0, beat: 0, tick: 0 },
        duration: 600_000,
        note_number: 48 + trackIndex * 12,
        velocity: 88,
      })),
      patterns: [],
      placements: [],
    };
  });
  const denseManifest = rehash(denseArrangement);
  const denseBefore = JSON.stringify(denseManifest);
  const denseStarted = performance.now();
  const denseReport = analyzeManifestTheory(denseManifest);
  const denseElapsed = performance.now() - denseStarted;
  assert.ok(denseElapsed < 2000, `20,000 overlapping arrangement events took ${denseElapsed.toFixed(1)} ms`);
  assert.equal(JSON.stringify(denseManifest), denseBefore);
  assert.ok(Number(metric(denseReport, "arrangement.register_collisions")) > 0);
});
