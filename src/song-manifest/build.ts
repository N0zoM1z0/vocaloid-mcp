import { unlink } from "node:fs/promises";
import { extname } from "node:path";
import { z } from "zod";

import {
  type AccompanimentTrackInput,
  type DrumHitInput,
  type DrumPatternInput,
  type DrumPatternPlacementInput,
  renderAccompaniment,
} from "../accompaniment.js";
import { resolveWritablePath } from "../paths.js";
import { type VibratoInput } from "../types.js";
import { compileVocalPhrase, type VocalPhraseInput } from "../vocal-phrase.js";
import {
  createSong,
  type PositionedNoteInput,
  type SongPartInput,
  type SongTrackInput,
  validateProject,
} from "../vsqx.js";
import {
  ManifestPositionSchema,
  ManifestVocalNoteSchema,
  ManifestVocalPhraseSchema,
  type SongManifest,
} from "./schema.js";
import { exists, fileSha256, loadSongManifest, mutateManifest, positionTick } from "./store.js";

export function compileManifestPhrase(
  manifest: Pick<SongManifest, "time_signatures">,
  phrase: z.infer<typeof ManifestVocalPhraseSchema>,
) {
  const normalized: VocalPhraseInput = {
    start: phrase.start,
    allocation: phrase.allocation,
    lyrics: phrase.lyrics.map((lyric) => ({
      lyric: lyric.lyric,
      phonemes: lyric.phonemes,
      phonemeLocked: lyric.phoneme_locked,
    })),
    cells: phrase.cells.map((cell) => ({
      duration: typeof cell.duration === "number"
        ? cell.duration
        : {
            denominator: cell.duration.denominator,
            dots: cell.duration.dots,
            ...(cell.duration.tuplet
              ? { tuplet: { played: cell.duration.tuplet.played, inTimeOf: cell.duration.tuplet.in_time_of } }
              : {}),
          },
      rest: cell.rest,
      ...(cell.note_number !== undefined ? { noteNumber: cell.note_number } : {}),
      ...(cell.lyric_index !== undefined ? { lyricIndex: cell.lyric_index } : {}),
      ...(cell.lyric !== undefined ? { lyric: cell.lyric } : {}),
      ...(cell.phonemes !== undefined ? { phonemes: cell.phonemes } : {}),
      ...(cell.phoneme_locked !== undefined ? { phonemeLocked: cell.phoneme_locked } : {}),
      gatePercent: cell.gate_percent,
      velocity: cell.velocity,
      ...(Object.keys(cell.style).length > 0 ? { style: cell.style } : {}),
      ...(cell.vibrato
        ? {
            vibrato: {
              type: cell.vibrato.type,
              length: cell.vibrato.length,
              ...(cell.vibrato.depth.length > 0 ? { depth: cell.vibrato.depth } : {}),
              ...(cell.vibrato.rate.length > 0 ? { rate: cell.vibrato.rate } : {}),
            },
          }
        : {}),
    })),
  };
  return compileVocalPhrase(manifest.time_signatures, normalized);
}

export interface ManifestExpectedVocalEvent {
  id: string;
  source: "direct_note" | "phrase_cell";
  trackId: string;
  partId: string;
  sectionId?: string;
  phraseId?: string;
  lyricUnitId?: string;
  position: z.infer<typeof ManifestPositionSchema>;
  duration: number;
  noteNumber: number;
  lyric: string;
  phonemes: string;
  velocity: number;
  vibrato?: VibratoInput;
}

export function manifestExpectedVocalEvents(
  manifest: SongManifest,
  vocalTrackId: string,
): ManifestExpectedVocalEvent[] {
  const track = manifest.vocal_tracks.find((candidate) => candidate.id === vocalTrackId);
  if (!track) throw new Error(`Manifest has no vocal track ${vocalTrackId}`);
  const events: ManifestExpectedVocalEvent[] = [];
  for (const part of track.parts) {
    for (const note of part.notes) {
      events.push({
        id: note.id,
        source: "direct_note",
        trackId: track.id,
        partId: part.id,
        ...(part.section_id ? { sectionId: part.section_id } : {}),
        position: note.position,
        duration: note.duration,
        noteNumber: note.note_number,
        lyric: note.lyric,
        phonemes: note.phonemes,
        velocity: note.velocity,
        ...(note.vibrato
          ? {
              vibrato: {
                type: note.vibrato.type,
                length: note.vibrato.length,
                ...(note.vibrato.depth.length > 0 ? { depth: note.vibrato.depth } : {}),
                ...(note.vibrato.rate.length > 0 ? { rate: note.vibrato.rate } : {}),
              },
            }
          : {}),
      });
    }
    for (const phrase of part.phrases) {
      const compiled = compileManifestPhrase(manifest, phrase);
      let noteIndex = 0;
      let sequentialLyricIndex = 0;
      for (const cell of phrase.cells) {
        if (cell.rest) continue;
        const note = compiled.notes[noteIndex++];
        if (!note) throw new Error(`Internal phrase mapping failed for ${phrase.id}/${cell.id}`);
        const lyricIndex = cell.lyric_index ?? sequentialLyricIndex;
        const lyricUnit = phrase.allocation === "sequential" || cell.lyric_index !== undefined
          ? phrase.lyrics[lyricIndex]
          : undefined;
        events.push({
          id: cell.id,
          source: "phrase_cell",
          trackId: track.id,
          partId: part.id,
          ...(part.section_id ? { sectionId: part.section_id } : {}),
          phraseId: phrase.id,
          ...(lyricUnit ? { lyricUnitId: lyricUnit.id } : {}),
          position: {
            measure: note.position.measure,
            beat: note.position.beat,
            tick: note.position.tick ?? 0,
          },
          duration: note.duration,
          noteNumber: note.noteNumber,
          lyric: note.lyric,
          phonemes: note.phonemes ?? note.lyric,
          velocity: note.velocity ?? 64,
          ...(note.vibrato ? { vibrato: note.vibrato } : {}),
        });
        if (phrase.allocation === "sequential") sequentialLyricIndex += 1;
      }
    }
  }
  return events.sort((left, right) =>
    positionTick(manifest, left.position) - positionTick(manifest, right.position)
      || left.id.localeCompare(right.id));
}

function manifestNote(note: z.infer<typeof ManifestVocalNoteSchema>): PositionedNoteInput {
  return {
    position: note.position,
    duration: note.duration,
    noteNumber: note.note_number,
    lyric: note.lyric,
    phonemes: note.phonemes,
    phonemeLocked: note.phoneme_locked,
    velocity: note.velocity,
    ...(Object.keys(note.style).length > 0 ? { style: note.style } : {}),
    ...(note.vibrato
      ? {
          vibrato: {
            type: note.vibrato.type,
            length: note.vibrato.length,
            ...(note.vibrato.depth.length > 0 ? { depth: note.vibrato.depth } : {}),
            ...(note.vibrato.rate.length > 0 ? { rate: note.vibrato.rate } : {}),
          } satisfies VibratoInput,
        }
      : {}),
  };
}

function buildVocalTracks(manifest: SongManifest): SongTrackInput[] {
  const voices = new Map(manifest.voices.map((voice) => [voice.id, voice]));
  return manifest.vocal_tracks.map((track) => {
    const voice = voices.get(track.voice_id);
    if (!voice) throw new Error(`Unknown voice ${track.voice_id}`);
    const parts: SongPartInput[] = track.parts.map((part) => {
      const notes = [
        ...part.notes.map(manifestNote),
        ...part.phrases.flatMap((phrase) => compileManifestPhrase(manifest, phrase).notes),
      ];
      const controls = Object.fromEntries(
        part.control_curves.map((curve) => [
          curve.curve,
          curve.points.map((point) => ({ position: point.position, value: point.value })),
        ]),
      ) as NonNullable<SongPartInput["controlCurves"]>;
      return {
        name: part.name,
        ...(part.comment ? { comment: part.comment } : {}),
        start: part.start,
        end: part.end,
        notes,
        ...(Object.keys(controls).length > 0 ? { controlCurves: controls } : {}),
      };
    });
    return {
      name: track.name,
      ...(track.comment ? { comment: track.comment } : {}),
      voice: { name: voice.name, componentId: voice.component_id },
      bankSelect: voice.bank_select,
      programChange: voice.program_change,
      mixer: {
        volume: track.mixer.volume,
        pan: track.mixer.pan,
        mute: track.mixer.mute,
        solo: track.mixer.solo,
        sendLevel: track.mixer.send_level,
        sendEnabled: track.mixer.send_enabled,
      },
      parts,
    };
  });
}

function buildArrangement(manifest: SongManifest): {
  tracks: AccompanimentTrackInput[];
  drums: DrumHitInput[];
  drumPatterns: DrumPatternInput[];
  drumPlacements: DrumPatternPlacementInput[];
} {
  const tracks: AccompanimentTrackInput[] = [];
  const drums: DrumHitInput[] = [];
  const drumPatterns: DrumPatternInput[] = [];
  const drumPlacements: DrumPatternPlacementInput[] = [];
  for (const track of manifest.accompaniment.tracks) {
    if (track.kind === "pitched") {
      tracks.push({
        name: track.name,
        program: track.program,
        bankMsb: track.bank_msb,
        bankLsb: track.bank_lsb,
        volume: track.volume,
        pan: track.pan,
        notes: track.notes.map((note) => ({
          position: note.position,
          duration: note.duration,
          noteNumber: note.note_number,
          velocity: note.velocity,
        })),
        patterns: track.patterns.map((pattern) => ({
          id: pattern.id,
          measures: pattern.measures,
          notes: pattern.notes.map((note) => ({
            offset: note.offset,
            duration: note.duration,
            noteNumber: note.note_number,
            velocity: note.velocity,
          })),
        })),
        placements: track.placements.map((placement) => ({
          patternId: placement.pattern_id,
          start: placement.start,
          repeats: placement.repeats,
          transpose: placement.transpose,
          velocityScale: placement.velocity_scale,
        })),
      });
    } else {
      drums.push(...track.hits.map((hit) => ({
        position: hit.position,
        noteNumber: hit.note_number,
        velocity: hit.velocity,
        duration: hit.duration,
      })));
      const patternPrefix = `${track.id}--`;
      drumPatterns.push(...track.patterns.map((pattern) => ({
        id: `${patternPrefix}${pattern.id}`,
        measures: pattern.measures,
        hits: pattern.hits.map((hit) => ({
          offset: hit.offset,
          noteNumber: hit.note_number,
          velocity: hit.velocity,
          duration: hit.duration,
        })),
      })));
      drumPlacements.push(...track.placements.map((placement) => ({
        patternId: `${patternPrefix}${placement.pattern_id}`,
        start: placement.start,
        repeats: placement.repeats,
        velocityScale: placement.velocity_scale,
      })));
    }
  }
  return { tracks, drums, drumPatterns, drumPlacements };
}

export interface BuildSongManifestOptions {
  manifestPath: string;
  expectedRevision: number;
  backingOutputPath: string;
  projectOutputPath: string;
}

function assertBuildVocalTimelines(manifest: SongManifest): void {
  const failures: string[] = [];
  for (const track of manifest.vocal_tracks) {
    const parts = [...track.parts]
      .sort((left, right) => positionTick(manifest, left.start) - positionTick(manifest, right.start));
    for (let index = 1; index < parts.length; index += 1) {
      const previous = parts[index - 1]!;
      const current = parts[index]!;
      if (positionTick(manifest, previous.end) > positionTick(manifest, current.start)) {
        failures.push(`PART_OVERLAP: ${previous.id} overlaps ${current.id} on ${track.id}`);
      }
    }
    const byPart = new Map<string, ManifestExpectedVocalEvent[]>();
    for (const event of manifestExpectedVocalEvents(manifest, track.id)) {
      const selected = byPart.get(event.partId) ?? [];
      selected.push(event);
      byPart.set(event.partId, selected);
    }
    for (const [partId, events] of byPart) {
      events.sort((left, right) => positionTick(manifest, left.position) - positionTick(manifest, right.position));
      for (let index = 1; index < events.length; index += 1) {
        const previous = events[index - 1]!;
        const current = events[index]!;
        if (positionTick(manifest, previous.position) + previous.duration
          > positionTick(manifest, current.position)) {
          failures.push(`VOCAL_EVENT_OVERLAP: ${previous.id} overlaps ${current.id} in ${partId}`);
        }
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`Song preflight rejected build: ${failures.join("; ")}`);
  }
}

export async function buildSongManifest(options: BuildSongManifestOptions) {
  const loaded = await loadSongManifest(options.manifestPath);
  const manifest = loaded.manifest;
  if (manifest.revision !== options.expectedRevision) {
    throw new Error(`Stale manifest revision ${options.expectedRevision}; current revision is ${manifest.revision}`);
  }
  if (manifest.vocal_tracks.length === 0) throw new Error("Manifest has no vocal tracks");
  if (manifest.accompaniment.tracks.filter((track) => track.kind === "pitched").length === 0) {
    throw new Error("Manifest needs at least one pitched accompaniment track for the current renderer");
  }
  // Dynamic import avoids a static song-manifest <-> preflight module cycle while
  // ensuring callers cannot bypass the same aggregate build gate used by MCP.
  const { assertSongBuildPreflight, preflightSongManifest } = await import("../song-preflight.js");
  assertSongBuildPreflight(await preflightSongManifest(loaded.path, {
    artifactCheck: "none",
    includePerformanceWarnings: false,
  }));
  assertBuildVocalTimelines(manifest);
  const backingPath = await resolveWritablePath(options.backingOutputPath);
  const projectPath = await resolveWritablePath(options.projectOutputPath);
  if (extname(backingPath).toLowerCase() !== ".wav") throw new Error("backingOutputPath must end in .wav");
  if (extname(projectPath).toLowerCase() !== ".vsqx") {
    throw new Error("projectOutputPath must end in .vsqx");
  }
  if (await exists(backingPath)) throw new Error(`Backing output already exists: ${backingPath}`);
  if (await exists(projectPath)) throw new Error(`Project output already exists: ${projectPath}`);
  const end = [...manifest.sections]
    .sort((left, right) => positionTick(manifest, right.end) - positionTick(manifest, left.end))[0]?.end;
  if (!end) throw new Error("Manifest has no song end");
  const arrangement = buildArrangement(manifest);
  let backingCreated = false;
  let projectCreated = false;
  try {
    const backing = await renderAccompaniment({
      outputPath: backingPath,
      timeSignatures: manifest.time_signatures,
      tempos: manifest.tempos,
      end,
      tracks: arrangement.tracks,
      drums: arrangement.drums,
      drumPatterns: arrangement.drumPatterns,
      drumPlacements: arrangement.drumPlacements,
      sampleRate: manifest.accompaniment.sample_rate,
      gain: manifest.accompaniment.gain,
      reverb: manifest.accompaniment.reverb,
      chorus: manifest.accompaniment.chorus,
      ...(manifest.accompaniment.soundfont_path
        ? { soundfontPath: manifest.accompaniment.soundfont_path }
        : {}),
      overwrite: false,
    });
    backingCreated = true;
    const project = await createSong({
      outputPath: projectPath,
      format: manifest.format,
      sequenceName: manifest.title,
      preMeasure: manifest.pre_measure,
      timeSignatures: manifest.time_signatures,
      tempos: manifest.tempos,
      tracks: buildVocalTracks(manifest),
      audioParts: [{
        name: `${manifest.title} Backing`,
        comment: `Built from ${manifest.slug} manifest revision ${manifest.revision}`,
        kind: "stereo",
        filePath: backingPath,
        start: { measure: 0, beat: 0, tick: 0 },
      }],
      overwrite: false,
    });
    projectCreated = true;
    const validation = await validateProject(projectPath);
    if (!validation.valid) {
      throw new Error(`Built project failed validation: ${validation.diagnostics.join("; ")}`);
    }
    const [backingDigest, projectDigest] = await Promise.all([
      fileSha256(backingPath),
      fileSha256(projectPath),
    ]);
    const now = new Date().toISOString();
    const artifactInputs: SongManifest["artifacts"] = [
      {
        id: `backing-r${manifest.revision}`,
        role: "backing",
        path: backingPath,
        ...backingDigest,
        source_revision: manifest.revision,
        source_composition_hash: manifest.composition_hash,
        dependencies: [],
        metadata: {
          renderer: "fluidsynth",
          sample_rate: manifest.accompaniment.sample_rate,
          reverb: manifest.accompaniment.reverb,
          chorus: manifest.accompaniment.chorus,
        },
        created_at: now,
      },
      {
        id: `vsqx-r${manifest.revision}`,
        role: "vsqx",
        path: projectPath,
        ...projectDigest,
        source_revision: manifest.revision,
        source_composition_hash: manifest.composition_hash,
        dependencies: [`backing-r${manifest.revision}`],
        metadata: { format: manifest.format },
        created_at: now,
      },
    ];
    const mutation = await mutateManifest(
      loaded.path,
      loaded.path,
      manifest.revision,
      true,
      (draft) => {
        for (const artifact of artifactInputs) {
          const index = draft.artifacts.findIndex((candidate) => candidate.id === artifact.id);
          if (index >= 0) draft.artifacts[index] = artifact;
          else draft.artifacts.push(artifact);
        }
      },
    );
    return {
      sourceRevision: manifest.revision,
      manifestRevision: mutation.write.revision,
      manifestContentHash: mutation.write.contentHash,
      backing: { ...backing, sha256: backingDigest.sha256 },
      project: { ...project, sha256: projectDigest.sha256 },
      validation,
      artifacts: artifactInputs,
    };
  } catch (error) {
    if (projectCreated) await unlink(projectPath).catch(() => undefined);
    if (backingCreated) await unlink(backingPath).catch(() => undefined);
    throw error;
  }
}
