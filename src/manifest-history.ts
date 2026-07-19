import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { optionalSongIntentHash } from "./intent/hash.js";
import { loadSongManifest, type SongManifest } from "./song-manifest.js";


export interface ManifestHistoryEntry {
  path: string;
  current: boolean;
  revision: number;
  contentHash: string;
  parentHash: string | null;
  compositionHash: string;
  mixHash: string;
  intentHash: string | null;
  updatedAt: string;
  fileModifiedAt: string;
  bytes: number;
}

export interface InvalidManifestHistoryEntry {
  path: string;
  error: string;
}

export async function listManifestHistory(manifestPath: string) {
  const loaded = await loadSongManifest(manifestPath);
  const directory = dirname(loaded.path);
  const filename = basename(loaded.path);
  const candidates = [
    loaded.path,
    ...(await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.startsWith(`${filename}.bak-`))
      .map((entry) => join(directory, entry.name)),
  ];
  const entries: ManifestHistoryEntry[] = [];
  const invalid: InvalidManifestHistoryEntry[] = [];
  for (const path of candidates) {
    try {
      const [snapshot, info] = await Promise.all([loadSongManifest(path), stat(path)]);
      if (snapshot.manifest.song_id !== loaded.manifest.song_id) {
        invalid.push({ path, error: `song_id ${snapshot.manifest.song_id} does not match ${loaded.manifest.song_id}` });
        continue;
      }
      entries.push({
        path,
        current: path === loaded.path,
        revision: snapshot.manifest.revision,
        contentHash: snapshot.manifest.content_hash,
        parentHash: snapshot.manifest.parent_hash ?? null,
        compositionHash: snapshot.manifest.composition_hash,
        mixHash: snapshot.manifest.mix_hash,
        intentHash: optionalSongIntentHash(snapshot.manifest.composition_intent),
        updatedAt: snapshot.manifest.updated_at,
        fileModifiedAt: info.mtime.toISOString(),
        bytes: info.size,
      });
    } catch (error) {
      invalid.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  entries.sort((left, right) => right.revision - left.revision
    || Number(right.current) - Number(left.current)
    || right.fileModifiedAt.localeCompare(left.fileModifiedAt));
  invalid.sort((left, right) => left.path.localeCompare(right.path));
  return {
    manifestPath: loaded.path,
    songId: loaded.manifest.song_id,
    currentRevision: loaded.manifest.revision,
    entries,
    invalid,
  };
}

export type DiffDomain =
  | "timeline"
  | "sections"
  | "harmony"
  | "voices"
  | "vocals"
  | "arrangement"
  | "mix"
  | "intent"
  | "guidance"
  | "artifacts"
  | "review_notes";

export interface ManifestEntity {
  id: string;
  value: unknown;
}

export function manifestEntities(manifest: SongManifest): Record<DiffDomain, ManifestEntity[]> {
  return {
    timeline: [
      { id: "time-signatures", value: manifest.time_signatures },
      { id: "tempos", value: manifest.tempos },
      { id: "pre-measure", value: manifest.pre_measure },
    ],
    sections: manifest.sections.map((entry) => ({ id: entry.id, value: entry })),
    harmony: [
      ...manifest.harmony.key_changes.map((entry) => ({ id: entry.id, value: entry })),
      ...manifest.harmony.chord_changes.map((entry) => ({ id: entry.id, value: entry })),
    ],
    voices: manifest.voices.map((entry) => ({ id: entry.id, value: entry })),
    vocals: manifest.vocal_tracks.flatMap((track) => [
      { id: track.id, value: { ...track, parts: undefined } },
      ...track.parts.flatMap((part) => [
        { id: part.id, value: { ...part, notes: undefined, phrases: undefined, control_curves: undefined, tuning_gestures: undefined } },
        ...part.notes.map((entry) => ({ id: entry.id, value: entry })),
        ...part.phrases.flatMap((phrase) => [
          { id: phrase.id, value: { ...phrase, lyrics: undefined, cells: undefined } },
          ...phrase.lyrics.map((entry) => ({ id: entry.id, value: entry })),
          ...phrase.cells.map((entry) => ({ id: entry.id, value: entry })),
        ]),
        ...part.control_curves.flatMap((curve) => [
          { id: curve.id, value: { id: curve.id, curve: curve.curve } },
          ...curve.points.map((entry) => ({ id: entry.id, value: entry })),
        ]),
        ...(part.tuning_gestures ?? []).map((entry) => ({ id: entry.id, value: entry })),
      ]),
    ]),
    arrangement: manifest.accompaniment.tracks.flatMap((track) => [
      { id: track.id, value: { ...track, notes: undefined, hits: undefined, patterns: undefined, placements: undefined } },
      ...(track.kind === "pitched"
        ? [
            ...track.notes.map((entry) => ({ id: entry.id, value: entry })),
            ...track.patterns.flatMap((pattern) => [
              { id: pattern.id, value: { id: pattern.id, measures: pattern.measures } },
              ...pattern.notes.map((entry) => ({ id: entry.id, value: entry })),
            ]),
          ]
        : [
            ...track.hits.map((entry) => ({ id: entry.id, value: entry })),
            ...track.patterns.flatMap((pattern) => [
              { id: pattern.id, value: { id: pattern.id, measures: pattern.measures } },
              ...pattern.hits.map((entry) => ({ id: entry.id, value: entry })),
            ]),
          ]),
      ...track.placements.map((entry) => ({ id: entry.id, value: entry })),
    ]),
    mix: [
      ...manifest.mix.effect_chains.flatMap((chain) => [
        { id: chain.id, value: { id: chain.id, target_id: chain.target_id } },
        ...chain.effects.map((entry) => ({ id: entry.id, value: entry })),
      ]),
      ...manifest.mix.section_dynamics.map((entry) => ({ id: entry.id, value: entry })),
    ],
    intent: manifest.composition_intent
      ? [
          { id: "composition-intent/song", value: manifest.composition_intent.song },
          ...manifest.composition_intent.sections.map((entry) => ({ id: entry.id, value: entry })),
          ...manifest.composition_intent.phrase_directions.flatMap((entry) => [
            { id: entry.id, value: { ...entry, listening_question: undefined } },
            { id: entry.listening_question.id, value: entry.listening_question },
          ]),
        ]
      : [],
    guidance: manifest.composition_guidance
      ? [{ id: "composition-guidance", value: manifest.composition_guidance }]
      : [],
    artifacts: manifest.artifacts.map((entry) => ({ id: entry.id, value: entry })),
    review_notes: (manifest.review_notes ?? []).map((entry) => ({ id: entry.id, value: entry })),
  };
}

export function manifestObjectFingerprints(manifest: SongManifest): Map<string, string> {
  const fingerprints = new Map<string, string>();
  for (const entries of Object.values(manifestEntities(manifest))) {
    for (const entry of entries) {
      if (fingerprints.has(entry.id)) {
        throw new Error(`Duplicate manifest history entity ID ${entry.id}`);
      }
      fingerprints.set(
        entry.id,
        createHash("sha256").update(canonicalManifestValue(entry.value)).digest("hex"),
      );
    }
  }
  return fingerprints;
}

export function canonicalManifestValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalManifestValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalManifestValue(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareDomain(from: ManifestEntity[], to: ManifestEntity[]) {
  const left = new Map(from.map((entry) => [entry.id, canonicalManifestValue(entry.value)]));
  const right = new Map(to.map((entry) => [entry.id, canonicalManifestValue(entry.value)]));
  const added = [...right.keys()].filter((id) => !left.has(id)).sort();
  const removed = [...left.keys()].filter((id) => !right.has(id)).sort();
  const modified = [...right.keys()].filter((id) => left.has(id) && left.get(id) !== right.get(id)).sort();
  return { added, removed, modified, changes: added.length + removed.length + modified.length };
}

export async function diffManifestSnapshots(fromPath: string, toPath: string) {
  const [from, to] = await Promise.all([loadSongManifest(fromPath), loadSongManifest(toPath)]);
  if (from.manifest.song_id !== to.manifest.song_id) {
    throw new Error(`Cannot diff different songs ${from.manifest.song_id} and ${to.manifest.song_id}`);
  }
  const left = manifestEntities(from.manifest);
  const right = manifestEntities(to.manifest);
  const domains = Object.fromEntries(
    (Object.keys(left) as DiffDomain[]).map((domain) => [domain, compareDomain(left[domain], right[domain])]),
  ) as Record<DiffDomain, ReturnType<typeof compareDomain>>;
  return {
    songId: from.manifest.song_id,
    from: {
      path: from.path,
      revision: from.manifest.revision,
      contentHash: from.manifest.content_hash,
      compositionHash: from.manifest.composition_hash,
      mixHash: from.manifest.mix_hash,
      intentHash: optionalSongIntentHash(from.manifest.composition_intent),
    },
    to: {
      path: to.path,
      revision: to.manifest.revision,
      contentHash: to.manifest.content_hash,
      compositionHash: to.manifest.composition_hash,
      mixHash: to.manifest.mix_hash,
      intentHash: optionalSongIntentHash(to.manifest.composition_intent),
    },
    compositionChanged: from.manifest.composition_hash !== to.manifest.composition_hash,
    mixChanged: from.manifest.mix_hash !== to.manifest.mix_hash,
    domains,
    totalChanges: Object.values(domains).reduce((sum, domain) => sum + domain.changes, 0),
  };
}
