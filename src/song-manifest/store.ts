import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, copyFile, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";

import { optionalSongIntentHash } from "../intent/hash.js";
import { currentTechnicalArtifactIds, resolveIntentReviewCurrentness } from "../intent/review.js";
import { summarizeCompositionIntent } from "../intent/summary.js";
import { resolveReadablePath, resolveWritablePath } from "../paths.js";
import { type CurveName, type VsqxFormat } from "../types.js";
import { type MusicalPosition, musicalPositionToTick } from "../vsqx.js";
import { compileManifestPhrase } from "./build.js";
import {
  MANIFEST_SCHEMA,
  ManifestChordChangeSchema,
  ManifestKeyChangeSchema,
  ManifestSectionSchema,
  ManifestTempoSchema,
  ManifestTimeSignatureSchema,
  type SongManifest,
  SongManifestSchema,
} from "./schema.js";

const MAX_MANIFEST_BYTES = 20 * 1024 * 1024;
export interface CreateSongManifestOptions {
  outputPath: string;
  songId: string;
  slug: string;
  title: string;
  format: VsqxFormat;
  preMeasure: number;
  timeSignatures: z.input<typeof ManifestTimeSignatureSchema>[];
  tempos: z.input<typeof ManifestTempoSchema>[];
  sections: z.input<typeof ManifestSectionSchema>[];
  keyChanges?: z.input<typeof ManifestKeyChangeSchema>[];
  chordChanges?: z.input<typeof ManifestChordChangeSchema>[];
  sampleRate: 44_100 | 48_000 | 96_000;
  gain: number;
  reverb: boolean;
  chorus: boolean;
  soundfontPath?: string;
  overwrite: boolean;
}

export interface ManifestWriteResult {
  path: string;
  backupPath?: string;
  revision: number;
  compositionHash: string;
  mixHash: string;
  contentHash: string;
  parentHash?: string;
  bytes: number;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key, entry]) => key !== "content_hash" && entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function songManifestHash(manifest: Omit<SongManifest, "content_hash"> | SongManifest): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(manifest))).digest("hex");
}

type HashlessSongManifest = Omit<SongManifest, "content_hash" | "composition_hash" | "mix_hash">;

export function songCompositionHash(manifest: HashlessSongManifest | SongManifest): string {
  const creativeState = {
    schema: manifest.schema,
    song_id: manifest.song_id,
    slug: manifest.slug,
    title: manifest.title,
    format: manifest.format,
    pre_measure: manifest.pre_measure,
    time_signatures: manifest.time_signatures,
    tempos: manifest.tempos,
    sections: manifest.sections,
    harmony: manifest.harmony,
    voices: manifest.voices,
    vocal_tracks: manifest.vocal_tracks,
    accompaniment: manifest.accompaniment,
  };
  return createHash("sha256").update(JSON.stringify(canonicalize(creativeState))).digest("hex");
}

export function songMixHash(
  manifest: HashlessSongManifest | SongManifest,
  compositionHash = songCompositionHash(manifest),
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize({ composition_hash: compositionHash, mix: manifest.mix })))
    .digest("hex");
}

export function positionTick(manifest: Pick<SongManifest, "time_signatures">, position: MusicalPosition): number {
  return musicalPositionToTick(manifest.time_signatures, position);
}

export function assertUniqueIds(values: readonly { id: string }[], name: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) throw new Error(`${name} contains duplicate stable ID ${value.id}`);
    seen.add(value.id);
  }
}

function assertGloballyUniqueStableIds(manifest: SongManifest): void {
  const seen = new Map<string, string>();
  const add = (id: string, location: string): void => {
    const previous = seen.get(id);
    if (previous) {
      throw new Error(`Stable ID ${id} is ambiguous: used by ${previous} and ${location}`);
    }
    seen.set(id, location);
  };
  for (const section of manifest.sections) add(section.id, `section ${section.name}`);
  for (const event of manifest.harmony.key_changes) add(event.id, `key change at measure ${event.position.measure}`);
  for (const event of manifest.harmony.chord_changes) add(event.id, `chord ${event.symbol}`);
  for (const voice of manifest.voices) add(voice.id, `voice ${voice.name}`);
  for (const track of manifest.vocal_tracks) {
    add(track.id, `vocal track ${track.name}`);
    for (const part of track.parts) {
      add(part.id, `vocal part ${track.id}/${part.name}`);
      for (const note of part.notes) add(note.id, `vocal note in ${part.id}`);
      for (const phrase of part.phrases) {
        add(phrase.id, `vocal phrase in ${part.id}`);
        for (const lyric of phrase.lyrics) add(lyric.id, `lyric unit in ${phrase.id}`);
        for (const cell of phrase.cells) add(cell.id, `rhythm cell in ${phrase.id}`);
      }
      for (const curve of part.control_curves) {
        add(curve.id, `${curve.curve} curve in ${part.id}`);
        for (const point of curve.points) add(point.id, `${curve.curve} point in ${curve.id}`);
      }
      for (const gesture of part.tuning_gestures ?? []) add(gesture.id, `tuning gesture in ${part.id}`);
    }
  }
  for (const track of manifest.accompaniment.tracks) {
    add(track.id, `arrangement track ${track.name}`);
    if (track.kind === "pitched") {
      for (const note of track.notes) add(note.id, `instrument note in ${track.id}`);
      for (const pattern of track.patterns) {
        add(pattern.id, `instrument pattern in ${track.id}`);
        for (const note of pattern.notes) add(note.id, `instrument pattern note in ${pattern.id}`);
      }
    } else {
      for (const hit of track.hits) add(hit.id, `drum hit in ${track.id}`);
      for (const pattern of track.patterns) {
        add(pattern.id, `drum pattern in ${track.id}`);
        for (const hit of pattern.hits) add(hit.id, `drum pattern hit in ${pattern.id}`);
      }
    }
    for (const placement of track.placements) add(placement.id, `placement in ${track.id}`);
  }
  for (const chain of manifest.mix.effect_chains) {
    add(chain.id, `effect chain for ${chain.target_id}`);
    for (const effect of chain.effects) add(effect.id, `effect in ${chain.id}`);
  }
  for (const dynamic of manifest.mix.section_dynamics) add(dynamic.id, `section dynamic for ${dynamic.target_id}`);
  for (const artifact of manifest.artifacts) add(artifact.id, `artifact ${artifact.role}`);
  for (const note of manifest.review_notes ?? []) add(note.id, `review note by ${note.author_name}`);
  for (const sectionIntent of manifest.composition_intent?.sections ?? []) {
    add(sectionIntent.id, `creative intent for section ${sectionIntent.section_id}`);
  }
  for (const direction of manifest.composition_intent?.phrase_directions ?? []) {
    add(direction.id, `phrase direction in section ${direction.section_id}`);
    add(direction.listening_question.id, `listening question for ${direction.id}`);
  }
  for (const exception of manifest.composition_guidance?.exceptions ?? []) {
    add(exception.id, `theory exception for ${exception.issue_code}`);
  }
}

function validateManifestSemantics(manifest: SongManifest): void {
  if (manifest.time_signatures[0]?.measure !== 0) {
    throw new Error("time_signatures must begin at measure 0");
  }
  for (let index = 1; index < manifest.time_signatures.length; index += 1) {
    if ((manifest.time_signatures[index]?.measure ?? 0) <= (manifest.time_signatures[index - 1]?.measure ?? 0)) {
      throw new Error("time_signatures must be strictly ordered by measure");
    }
  }
  const tempoTicks = manifest.tempos.map((tempo) => positionTick(manifest, tempo.position));
  if (tempoTicks[0] !== 0) throw new Error("tempos must begin at song position 0:0:0");
  for (let index = 1; index < tempoTicks.length; index += 1) {
    if ((tempoTicks[index] ?? 0) <= (tempoTicks[index - 1] ?? 0)) {
      throw new Error("tempos must be strictly ordered by musical position");
    }
  }
  assertUniqueIds(manifest.sections, "sections");
  const orderedSections = [...manifest.sections].sort(
    (left, right) => positionTick(manifest, left.start) - positionTick(manifest, right.start),
  );
  for (const [index, section] of orderedSections.entries()) {
    const start = positionTick(manifest, section.start);
    const end = positionTick(manifest, section.end);
    if (end <= start) throw new Error(`Section ${section.id} end must follow start`);
    const previous = orderedSections[index - 1];
    if (previous && positionTick(manifest, previous.end) > start) {
      throw new Error(`Sections ${previous.id} and ${section.id} overlap`);
    }
  }
  const sectionIds = new Set(manifest.sections.map((section) => section.id));
  assertUniqueIds(manifest.voices, "voices");
  assertUniqueIds(manifest.vocal_tracks, "vocal_tracks");
  const voiceIds = new Set(manifest.voices.map((voice) => voice.id));
  for (const track of manifest.vocal_tracks) {
    if (!voiceIds.has(track.voice_id)) {
      throw new Error(`Vocal track ${track.id} references unknown voice ${track.voice_id}`);
    }
    if (track.parts.length === 0) {
      throw new Error(`Vocal track ${track.id} needs at least one part`);
    }
    assertUniqueIds(track.parts, `vocal track ${track.id} parts`);
    for (const part of track.parts) {
      if (part.section_id && !sectionIds.has(part.section_id)) {
        throw new Error(`Vocal part ${part.id} references unknown section ${part.section_id}`);
      }
      const partStart = positionTick(manifest, part.start);
      const partEnd = positionTick(manifest, part.end);
      if (partEnd <= partStart) throw new Error(`Vocal part ${part.id} end must follow start`);
      assertUniqueIds(part.notes, `vocal part ${part.id} notes`);
      assertUniqueIds(part.phrases, `vocal part ${part.id} phrases`);
      assertUniqueIds(part.control_curves, `vocal part ${part.id} curves`);
      assertUniqueIds(part.tuning_gestures ?? [], `vocal part ${part.id} tuning gestures`);
      const voicedEventIds = new Set([
        ...part.notes.map((note) => note.id),
        ...part.phrases.flatMap((phrase) => phrase.cells.filter((cell) => !cell.rest).map((cell) => cell.id)),
      ]);
      for (const gesture of part.tuning_gestures ?? []) {
        const targets = new Set<string>();
        for (const eventId of gesture.event_ids) {
          if (targets.has(eventId)) throw new Error(`Tuning gesture ${gesture.id} repeats event ID ${eventId}`);
          targets.add(eventId);
          if (!voicedEventIds.has(eventId)) {
            throw new Error(`Tuning gesture ${gesture.id} references unknown voiced event ${eventId} in part ${part.id}`);
          }
        }
      }
      const curveTypes = new Set<CurveName>();
      const curveRanges: Record<CurveName, readonly [number, number]> = {
        DYN: [0, 127], BRE: [0, 127], BRI: [0, 127], CLE: [0, 127],
        GEN: [0, 127], POR: [0, 127], PIT: [-8192, 8191], PBS: [0, 24],
      };
      for (const curve of part.control_curves) {
        if (curveTypes.has(curve.curve)) {
          throw new Error(`Vocal part ${part.id} has more than one ${curve.curve} curve; merge their points by stable ID`);
        }
        curveTypes.add(curve.curve);
        assertUniqueIds(curve.points, `${curve.curve} curve ${curve.id} points`);
        const pointTicks = new Set<number>();
        const [minimum, maximum] = curveRanges[curve.curve];
        for (const point of curve.points) {
          const tick = positionTick(manifest, point.position);
          if (tick < partStart || tick >= partEnd) {
            throw new Error(`Control point ${point.id} lies outside part ${part.id}`);
          }
          if (pointTicks.has(tick)) {
            throw new Error(`${curve.curve} curve ${curve.id} has more than one point at tick ${tick}`);
          }
          pointTicks.add(tick);
          if (point.value < minimum || point.value > maximum) {
            throw new Error(`${curve.curve} point ${point.id} value must be in ${minimum}..${maximum}`);
          }
        }
      }
      for (const note of part.notes) {
        const tick = positionTick(manifest, note.position);
        if (tick < partStart || tick + note.duration > partEnd) {
          throw new Error(`Vocal note ${note.id} lies outside part ${part.id}`);
        }
      }
      for (const phrase of part.phrases) {
        const compiled = compileManifestPhrase(manifest, phrase);
        if (compiled.startTick < partStart || compiled.endTick > partEnd) {
          throw new Error(`Vocal phrase ${phrase.id} lies outside part ${part.id}`);
        }
      }
    }
  }
  assertUniqueIds(manifest.accompaniment.tracks, "accompaniment tracks");
  for (const track of manifest.accompaniment.tracks) {
    if (track.kind === "pitched") {
      if (track.notes.length === 0 && track.placements.length === 0) {
        throw new Error(`Pitched arrangement track ${track.id} needs direct notes or pattern placements`);
      }
      assertUniqueIds(track.notes, `arrangement track ${track.id} notes`);
      assertUniqueIds(track.patterns, `arrangement track ${track.id} patterns`);
      assertUniqueIds(track.placements, `arrangement track ${track.id} placements`);
      const patterns = new Set(track.patterns.map((pattern) => pattern.id));
      for (const placement of track.placements) {
        if (!patterns.has(placement.pattern_id)) {
          throw new Error(`Placement ${placement.id} references unknown pattern ${placement.pattern_id}`);
        }
        if (placement.section_id && !sectionIds.has(placement.section_id)) {
          throw new Error(`Placement ${placement.id} references unknown section ${placement.section_id}`);
        }
      }
    } else {
      if (track.hits.length === 0 && track.placements.length === 0) {
        throw new Error(`Drum arrangement track ${track.id} needs direct hits or pattern placements`);
      }
      assertUniqueIds(track.hits, `drum track ${track.id} hits`);
      assertUniqueIds(track.patterns, `drum track ${track.id} patterns`);
      assertUniqueIds(track.placements, `drum track ${track.id} placements`);
      const patterns = new Set(track.patterns.map((pattern) => pattern.id));
      for (const placement of track.placements) {
        if (!patterns.has(placement.pattern_id)) {
          throw new Error(`Drum placement ${placement.id} references unknown pattern ${placement.pattern_id}`);
        }
        if (placement.section_id && !sectionIds.has(placement.section_id)) {
          throw new Error(`Drum placement ${placement.id} references unknown section ${placement.section_id}`);
        }
      }
    }
  }
  const trackIds = new Set([
    ...manifest.vocal_tracks.map((track) => track.id),
    ...manifest.accompaniment.tracks.map((track) => track.id),
  ]);
  if (trackIds.has("mix-bus")) throw new Error("mix-bus is reserved for the downstream mix bus");
  const mixTargets = new Set([...trackIds, "mix-bus"]);
  const chainTargets = new Set<string>();
  for (const chain of manifest.mix.effect_chains) {
    if (!mixTargets.has(chain.target_id)) {
      throw new Error(`Effect chain ${chain.id} references unknown mix target ${chain.target_id}`);
    }
    if (chainTargets.has(chain.target_id)) {
      throw new Error(`Mix target ${chain.target_id} has more than one effect chain`);
    }
    chainTargets.add(chain.target_id);
    assertUniqueIds(chain.effects, `effect chain ${chain.id} effects`);
  }
  const dynamicTargets = new Set<string>();
  for (const dynamic of manifest.mix.section_dynamics) {
    if (!sectionIds.has(dynamic.section_id)) {
      throw new Error(`Section dynamic ${dynamic.id} references unknown section ${dynamic.section_id}`);
    }
    if (!mixTargets.has(dynamic.target_id)) {
      throw new Error(`Section dynamic ${dynamic.id} references unknown mix target ${dynamic.target_id}`);
    }
    const key = `${dynamic.target_id}\u0000${dynamic.section_id}`;
    if (dynamicTargets.has(key)) {
      throw new Error(`Mix target ${dynamic.target_id} has duplicate dynamics for section ${dynamic.section_id}`);
    }
    dynamicTargets.add(key);
  }
  assertUniqueIds(manifest.artifacts, "artifacts");
  assertUniqueIds(manifest.review_notes ?? [], "review notes");
  const reviewTargets = new Set<string>([
    ...manifest.sections.map((entry) => entry.id),
    ...manifest.harmony.key_changes.map((entry) => entry.id),
    ...manifest.harmony.chord_changes.map((entry) => entry.id),
    ...manifest.voices.map((entry) => entry.id),
    ...manifest.vocal_tracks.flatMap((track) => [
      track.id,
      ...track.parts.flatMap((part) => [
        part.id,
        ...part.notes.map((entry) => entry.id),
        ...part.phrases.flatMap((phrase) => [
          phrase.id,
          ...phrase.lyrics.map((entry) => entry.id),
          ...phrase.cells.map((entry) => entry.id),
        ]),
        ...part.control_curves.flatMap((curve) => [curve.id, ...curve.points.map((entry) => entry.id)]),
        ...(part.tuning_gestures ?? []).map((entry) => entry.id),
      ]),
    ]),
    ...manifest.accompaniment.tracks.flatMap((track) => [
      track.id,
      ...(track.kind === "pitched"
        ? [
            ...track.notes.map((entry) => entry.id),
            ...track.patterns.flatMap((pattern) => [pattern.id, ...pattern.notes.map((entry) => entry.id)]),
          ]
        : [
            ...track.hits.map((entry) => entry.id),
            ...track.patterns.flatMap((pattern) => [pattern.id, ...pattern.hits.map((entry) => entry.id)]),
          ]),
      ...track.placements.map((entry) => entry.id),
    ]),
    ...manifest.mix.effect_chains.flatMap((chain) => [chain.id, ...chain.effects.map((entry) => entry.id)]),
    ...manifest.mix.section_dynamics.map((entry) => entry.id),
    ...manifest.artifacts.map((entry) => entry.id),
    ...(manifest.composition_intent?.sections ?? []).map((entry) => entry.id),
    ...(manifest.composition_intent?.phrase_directions ?? []).flatMap((entry) => [
      entry.id,
      entry.listening_question.id,
    ]),
    "mix-bus",
  ]);
  if (manifest.composition_intent) {
    const vocalPhraseIds = new Set(manifest.vocal_tracks.flatMap((track) =>
      track.parts.flatMap((part) => part.phrases.map((phrase) => phrase.id))));
    const lyricUnitIds = new Set(manifest.vocal_tracks.flatMap((track) =>
      track.parts.flatMap((part) => part.phrases.flatMap((phrase) =>
        phrase.lyrics.map((lyric) => lyric.id)))));
    const vocalEventIds = new Set(manifest.vocal_tracks.flatMap((track) =>
      track.parts.flatMap((part) => [
        ...part.notes.map((note) => note.id),
        ...part.phrases.flatMap((phrase) => phrase.cells.map((cell) => cell.id)),
      ])));
    const tuningGestureIds = new Set(manifest.vocal_tracks.flatMap((track) =>
      track.parts.flatMap((part) => (part.tuning_gestures ?? []).map((gesture) => gesture.id))));
    const chordIds = new Set(manifest.harmony.chord_changes.map((chord) => chord.id));
    const semanticFocusIds = new Set([...lyricUnitIds, ...vocalEventIds]);
    const assertIntentLinks = (
      directionId: string,
      kind: string,
      ids: readonly string[] | undefined,
      allowed: ReadonlySet<string>,
    ): void => {
      for (const id of ids ?? []) {
        if (!allowed.has(id)) {
          throw new Error(
            `INTENT_REALIZATION_REFERENCE_INVALID: phrase direction ${directionId} `
            + `${kind} references unknown object ${id}`,
          );
        }
      }
    };
    for (const sectionIntent of manifest.composition_intent.sections) {
      if (!sectionIds.has(sectionIntent.section_id)) {
        throw new Error(
          `INTENT_SECTION_REFERENCE_INVALID: section intent ${sectionIntent.id} `
          + `references unknown section ${sectionIntent.section_id}`,
        );
      }
    }
    for (const direction of manifest.composition_intent.phrase_directions) {
      if (!sectionIds.has(direction.section_id)) {
        throw new Error(
          `INTENT_SECTION_REFERENCE_INVALID: phrase direction ${direction.id} `
          + `references unknown section ${direction.section_id}`,
        );
      }
      assertIntentLinks(
        direction.id,
        "lyric_anchor.lyric_unit_ids",
        direction.lyric_anchor?.lyric_unit_ids,
        lyricUnitIds,
      );
      const links = direction.realization_links;
      if (!links) continue;
      assertIntentLinks(direction.id, "vocal_phrase_ids", links.vocal_phrase_ids, vocalPhraseIds);
      assertIntentLinks(direction.id, "lyric_unit_ids", links.lyric_unit_ids, lyricUnitIds);
      assertIntentLinks(direction.id, "event_ids", links.event_ids, vocalEventIds);
      assertIntentLinks(
        direction.id,
        "semantic_focus_object_ids",
        links.semantic_focus_object_ids,
        semanticFocusIds,
      );
      assertIntentLinks(direction.id, "tuning_gesture_ids", links.tuning_gesture_ids, tuningGestureIds);
      assertIntentLinks(direction.id, "chord_ids", links.chord_ids, chordIds);
      assertIntentLinks(direction.id, "track_ids", links.track_ids, trackIds);
    }
  }
  for (const note of manifest.review_notes ?? []) {
    if (note.section_id && !sectionIds.has(note.section_id)) {
      throw new Error(`Review note ${note.id} references unknown section ${note.section_id}`);
    }
    for (const id of note.object_ids) {
      if (!reviewTargets.has(id)) throw new Error(`Review note ${note.id} references unknown object ${id}`);
    }
    for (const id of note.artifact_ids) {
      if (!manifest.artifacts.some((artifact) => artifact.id === id)) {
        throw new Error(`Review note ${note.id} references unknown artifact ${id}`);
      }
    }
  }
  for (const exception of manifest.composition_guidance?.exceptions ?? []) {
    for (const id of exception.object_ids) {
      if (!reviewTargets.has(id)) {
        throw new Error(`Theory exception ${exception.id} references unknown object ${id}`);
      }
    }
  }
  assertGloballyUniqueStableIds(manifest);
}

function withHash(candidate: HashlessSongManifest): SongManifest {
  const composition_hash = songCompositionHash(candidate);
  const mix_hash = songMixHash(candidate, composition_hash);
  const content_hash = songManifestHash({ ...candidate, composition_hash, mix_hash });
  const manifest = SongManifestSchema.parse({ ...candidate, composition_hash, mix_hash, content_hash });
  validateManifestSemantics(manifest);
  return manifest;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function persistManifest(
  manifest: SongManifest,
  requestedPath: string,
  overwrite: boolean,
): Promise<ManifestWriteResult> {
  const path = await resolveWritablePath(requestedPath);
  if (!path.endsWith(".song.json")) throw new Error(`Manifest path must end in .song.json: ${path}`);
  const outputExists = await exists(path);
  if (outputExists && !overwrite) {
    throw new Error(`Manifest already exists: ${path}. Use a new revision path or set overwrite=true.`);
  }
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_MANIFEST_BYTES) {
    throw new Error(`Manifest exceeds ${MAX_MANIFEST_BYTES} byte safety limit`);
  }
  let backupPath: string | undefined;
  if (outputExists) {
    backupPath = `${path}.bak-${new Date().toISOString().replaceAll(":", "-")}`;
    await copyFile(path, backupPath);
  }
  const temporary = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${Date.now()}`);
  try {
    await writeFile(temporary, serialized, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return {
    path,
    ...(backupPath ? { backupPath } : {}),
    revision: manifest.revision,
    compositionHash: manifest.composition_hash,
    mixHash: manifest.mix_hash,
    contentHash: manifest.content_hash,
    ...(manifest.parent_hash ? { parentHash: manifest.parent_hash } : {}),
    bytes: Buffer.byteLength(serialized),
  };
}

export async function loadSongManifest(inputPath: string): Promise<{ path: string; manifest: SongManifest }> {
  const path = await resolveReadablePath(inputPath);
  const info = await stat(path);
  if (info.size > MAX_MANIFEST_BYTES) throw new Error(`Manifest exceeds ${MAX_MANIFEST_BYTES} byte safety limit`);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid song manifest JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const manifest = SongManifestSchema.parse(raw);
  const actualComposition = songCompositionHash(manifest);
  if (actualComposition !== manifest.composition_hash) {
    throw new Error(
      `Song manifest composition hash mismatch: stored ${manifest.composition_hash}, actual ${actualComposition}. `
      + "Creative state or provenance may have been edited outside the MCP.",
    );
  }
  const actualMix = songMixHash(manifest, manifest.composition_hash);
  if (actualMix !== manifest.mix_hash) {
    throw new Error(
      `Song manifest mix hash mismatch: stored ${manifest.mix_hash}, actual ${actualMix}. `
      + "Mix intent or its composition dependency may have been edited outside the MCP.",
    );
  }
  const actual = songManifestHash(manifest);
  if (actual !== manifest.content_hash) {
    throw new Error(
      `Song manifest content hash mismatch: stored ${manifest.content_hash}, actual ${actual}. `
      + "The file may have been edited outside the MCP; inspect or restore a known revision before writing.",
    );
  }
  validateManifestSemantics(manifest);
  return { path, manifest };
}

export async function createSongManifest(options: CreateSongManifestOptions): Promise<ManifestWriteResult> {
  const now = new Date().toISOString();
  const candidate = {
    schema: MANIFEST_SCHEMA,
    revision: 1,
    song_id: options.songId,
    slug: options.slug,
    title: options.title,
    format: options.format,
    pre_measure: options.preMeasure,
    created_at: now,
    updated_at: now,
    time_signatures: z.array(ManifestTimeSignatureSchema).parse(options.timeSignatures),
    tempos: z.array(ManifestTempoSchema).parse(options.tempos),
    sections: z.array(ManifestSectionSchema).parse(options.sections),
    harmony: {
      key_changes: z.array(ManifestKeyChangeSchema).parse(options.keyChanges ?? []),
      chord_changes: z.array(ManifestChordChangeSchema).parse(options.chordChanges ?? []),
    },
    voices: [],
    vocal_tracks: [],
    accompaniment: {
      sample_rate: options.sampleRate,
      gain: options.gain,
      reverb: options.reverb,
      chorus: options.chorus,
      ...(options.soundfontPath ? { soundfont_path: options.soundfontPath } : {}),
      tracks: [],
    },
    mix: { effect_chains: [], section_dynamics: [] },
    artifacts: [],
    review_notes: [],
  } satisfies HashlessSongManifest;
  return persistManifest(withHash(candidate), options.outputPath, options.overwrite);
}

export function currentMixArtifactIds(manifest: SongManifest): ReadonlySet<string> {
  return currentTechnicalArtifactIds(
    manifest.artifacts,
    manifest.composition_hash,
    manifest.mix_hash,
  );
}

function manifestSummary(path: string, manifest: SongManifest) {
  const currentMixArtifacts = currentMixArtifactIds(manifest);
  const compositionIntent = summarizeCompositionIntent(
    manifest.composition_intent,
    manifest.sections.map((section) => section.id),
  );
  const intentReviewContext = {
    ...(manifest.composition_intent ? { compositionIntent: manifest.composition_intent } : {}),
    compositionHash: manifest.composition_hash,
    artifacts: manifest.artifacts,
    currentArtifactIds: currentMixArtifacts,
  };
  return {
    path,
    schema: manifest.schema,
    revision: manifest.revision,
    compositionHash: manifest.composition_hash,
    mixHash: manifest.mix_hash,
    contentHash: manifest.content_hash,
    intentHash: optionalSongIntentHash(manifest.composition_intent),
    parentHash: manifest.parent_hash ?? null,
    songId: manifest.song_id,
    slug: manifest.slug,
    title: manifest.title,
    format: manifest.format,
    sections: manifest.sections.map((section) => ({
      id: section.id,
      name: section.name,
      kind: section.kind,
      start: section.start,
      end: section.end,
      energy: section.energy,
    })),
    tempoChanges: manifest.tempos.length,
    meterChanges: manifest.time_signatures.length,
    voices: manifest.voices.map((voice) => ({ id: voice.id, name: voice.name, componentId: voice.component_id })),
    vocalTracks: manifest.vocal_tracks.map((track) => ({
      id: track.id,
      name: track.name,
      voiceId: track.voice_id,
      parts: track.parts.length,
      notes: track.parts.reduce((sum, part) => sum + part.notes.length, 0),
      phrases: track.parts.reduce((sum, part) => sum + part.phrases.length, 0),
    })),
    arrangementTracks: manifest.accompaniment.tracks.map((track) => ({
      id: track.id,
      name: track.name,
      kind: track.kind,
      directEvents: track.kind === "pitched" ? track.notes.length : track.hits.length,
      patterns: track.patterns.length,
      placements: track.placements.length,
    })),
    mix: {
      effectChains: manifest.mix.effect_chains.map((chain) => ({
        id: chain.id,
        targetId: chain.target_id,
        effects: chain.effects.map((effect) => ({ id: effect.id, type: effect.type, enabled: effect.enabled })),
      })),
      sectionDynamics: manifest.mix.section_dynamics.map((dynamic) => ({
        id: dynamic.id,
        targetId: dynamic.target_id,
        sectionId: dynamic.section_id,
        gainDb: dynamic.gain_db,
        rampMs: dynamic.ramp_ms,
      })),
    },
    compositionIntent,
    compositionGuidance: manifest.composition_guidance
      ? {
          theoryRulesetId: manifest.composition_guidance.theory_ruleset_id,
          strictness: manifest.composition_guidance.strictness,
          harmonicLanguage: manifest.composition_guidance.harmonic_language,
          requiredReviewSeverities: manifest.composition_guidance.required_review_severities,
          styleProfile: manifest.composition_guidance.style_profile ?? null,
          intentReviewPolicy: manifest.composition_guidance.intent_review_policy ?? null,
          exceptions: manifest.composition_guidance.exceptions.map((exception) => ({
            id: exception.id,
            issueCode: exception.issue_code,
            objectIds: exception.object_ids,
            targetFingerprint: exception.target_fingerprint,
            authorType: exception.author_type,
          })),
        }
      : null,
    artifacts: manifest.artifacts.map((artifact) => ({
      id: artifact.id,
      role: artifact.role,
      path: artifact.path,
      sourceRevision: artifact.source_revision,
      sourceCompositionHash: artifact.source_composition_hash,
      sha256: artifact.sha256,
      dependencies: artifact.dependencies,
      metadata: artifact.metadata,
      currentComposition: artifact.source_composition_hash === manifest.composition_hash,
      currentMix: currentMixArtifacts.has(artifact.id),
    })),
    reviewNotes: (manifest.review_notes ?? []).map((note) => ({
      id: note.id,
      authorType: note.author_type,
      authorName: note.author_name,
      observation: note.observation,
      sectionId: note.section_id ?? null,
      objectIds: note.object_ids,
      artifactIds: note.artifact_ids,
      position: note.position ?? null,
      status: note.status,
      createdAt: note.created_at,
      resolvedAt: note.resolved_at ?? null,
      resolution: note.resolution ?? null,
      intentFidelity: note.intent_fidelity
        ? {
            basis: note.intent_fidelity,
            ...resolveIntentReviewCurrentness(note.intent_fidelity, intentReviewContext),
          }
        : null,
    })),
  };
}

export async function inspectSongManifest(inputPath: string) {
  const { path, manifest } = await loadSongManifest(inputPath);
  return manifestSummary(path, manifest);
}

export async function restoreSongManifestSnapshot(
  manifestPath: string,
  snapshotPath: string,
  expectedRevision: number,
) {
  const [current, snapshot] = await Promise.all([
    loadSongManifest(manifestPath),
    loadSongManifest(snapshotPath),
  ]);
  if (current.manifest.revision !== expectedRevision) {
    throw new Error(
      `Stale manifest revision ${expectedRevision}; current revision is ${current.manifest.revision} `
      + `(${current.manifest.content_hash}). Inspect history again before restoring.`,
    );
  }
  if (snapshot.manifest.song_id !== current.manifest.song_id) {
    throw new Error(
      `Snapshot song ${snapshot.manifest.song_id} does not match current song ${current.manifest.song_id}`,
    );
  }
  if (snapshot.path === current.path) throw new Error("snapshotPath must identify a historical snapshot, not the current manifest");
  const {
    content_hash: _snapshotContentHash,
    composition_hash: _snapshotCompositionHash,
    mix_hash: _snapshotMixHash,
    parent_hash: _snapshotParentHash,
    revision: snapshotRevision,
    ...snapshotState
  } = structuredClone(snapshot.manifest);
  const candidate = {
    ...snapshotState,
    revision: current.manifest.revision + 1,
    parent_hash: current.manifest.content_hash,
    updated_at: new Date().toISOString(),
  } satisfies HashlessSongManifest;
  const restored = withHash(candidate);
  const write = await persistManifest(restored, current.path, true);
  return {
    write,
    restoredFrom: {
      path: snapshot.path,
      revision: snapshotRevision,
      contentHash: snapshot.manifest.content_hash,
      compositionHash: snapshot.manifest.composition_hash,
      mixHash: snapshot.manifest.mix_hash,
    },
    summary: manifestSummary(write.path, restored),
  };
}

export async function getSongManifestSection(inputPath: string, sectionId: string) {
  const { path, manifest } = await loadSongManifest(inputPath);
  const section = manifest.sections.find((candidate) => candidate.id === sectionId);
  if (!section) throw new Error(`No section with stable ID ${sectionId}`);
  const start = positionTick(manifest, section.start);
  const end = positionTick(manifest, section.end);
  const vocalTracks = manifest.vocal_tracks
    .map((track) => ({
      id: track.id,
      name: track.name,
      voiceId: track.voice_id,
      mixer: track.mixer,
      parts: track.parts.filter((part) =>
        part.section_id === sectionId
        || (positionTick(manifest, part.start) < end && positionTick(manifest, part.end) > start)),
    }))
    .filter((track) => track.parts.length > 0);
  const arrangementTracks = manifest.accompaniment.tracks.map((track) => {
    const placements = track.placements.filter((placement) =>
      placement.section_id === sectionId
      || (positionTick(manifest, placement.start) >= start && positionTick(manifest, placement.start) < end));
    const patternIds = new Set(placements.map((placement) => placement.pattern_id));
    const direct = track.kind === "pitched"
      ? { notes: track.notes.filter((note) => {
          const tick = positionTick(manifest, note.position);
          return tick >= start && tick < end;
        }) }
      : { hits: track.hits.filter((hit) => {
          const tick = positionTick(manifest, hit.position);
          return tick >= start && tick < end;
        }) };
    return {
      id: track.id,
      name: track.name,
      kind: track.kind,
      ...direct,
      patterns: track.patterns.filter((pattern) => patternIds.has(pattern.id)),
      placements,
    };
  }).filter((track) => track.placements.length > 0 || ("notes" in track ? track.notes.length > 0 : track.hits.length > 0));
  const activeTargets = new Set([
    "mix-bus",
    ...vocalTracks.map((track) => track.id),
    ...arrangementTracks.map((track) => track.id),
  ]);
  return {
    path,
    revision: manifest.revision,
    contentHash: manifest.content_hash,
    intentHash: optionalSongIntentHash(manifest.composition_intent),
    section,
    compositionIntent: manifest.composition_intent
      ? {
          song: manifest.composition_intent.song,
          section: manifest.composition_intent.sections.find((entry) => entry.section_id === sectionId) ?? null,
          phraseDirections: manifest.composition_intent.phrase_directions.filter(
            (entry) => entry.section_id === sectionId,
          ),
        }
      : null,
    harmony: {
      key_changes: manifest.harmony.key_changes.filter((event) => {
        const tick = positionTick(manifest, event.position);
        return tick >= start && tick < end;
      }),
      chord_changes: manifest.harmony.chord_changes.filter((event) => {
        const tick = positionTick(manifest, event.position);
        return tick >= start && tick < end;
      }),
    },
    vocalTracks,
    arrangementTracks,
    mix: {
      effect_chains: manifest.mix.effect_chains.filter((chain) => activeTargets.has(chain.target_id)),
      section_dynamics: manifest.mix.section_dynamics.filter((dynamic) =>
        dynamic.section_id === sectionId && activeTargets.has(dynamic.target_id)),
    },
    reviewNotes: (manifest.review_notes ?? []).filter((note) =>
      note.section_id === sectionId
      || note.object_ids.some((id) => activeTargets.has(id))
      || (note.position !== undefined
        && positionTick(manifest, note.position) >= start
        && positionTick(manifest, note.position) < end)),
  };
}

type ManifestUpdater = (draft: SongManifest) => void;

export async function mutateManifest(
  inputPath: string,
  outputPath: string,
  expectedRevision: number,
  overwrite: boolean,
  updater: ManifestUpdater,
): Promise<{ write: ManifestWriteResult; summary: ReturnType<typeof manifestSummary> }> {
  const loaded = await loadSongManifest(inputPath);
  if (loaded.manifest.revision !== expectedRevision) {
    throw new Error(
      `Stale manifest revision ${expectedRevision}; current revision is ${loaded.manifest.revision} `
      + `(${loaded.manifest.content_hash}). Inspect again before applying a mutation.`,
    );
  }
  const draft = structuredClone(loaded.manifest);
  updater(draft);
  const parentHash = loaded.manifest.content_hash;
  const {
    content_hash: _oldHash,
    composition_hash: _oldCompositionHash,
    mix_hash: _oldMixHash,
    parent_hash: _oldParent,
    ...withoutHashes
  } = draft;
  const candidate = {
    ...withoutHashes,
    revision: loaded.manifest.revision + 1,
    parent_hash: parentHash,
    updated_at: new Date().toISOString(),
  } satisfies HashlessSongManifest;
  const manifest = withHash(candidate);
  const write = await persistManifest(manifest, outputPath, overwrite);
  return { write, summary: manifestSummary(write.path, manifest) };
}

export async function fileSha256(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return { sha256: hash.digest("hex"), bytes: (await stat(path)).size };
}
