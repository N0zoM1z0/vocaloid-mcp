import {
  manifestExpectedVocalEvents,
  type ManifestExpectedVocalEvent,
  type SongManifest,
} from "../song-manifest.js";
import { musicalPositionToTick, musicalTickToPosition, type MusicalPosition } from "../vsqx.js";
import { buildTheoryTimeline, theoryContextAtTick, type TheoryTimeline } from "./timeline.js";
import type { TheoryDomain, TheorySeverity } from "./types.js";


export interface SymbolicVocalEvent extends ManifestExpectedVocalEvent {
  startTick: number;
  endTick: number;
  sectionId?: string;
}

export interface SymbolicArrangementEvent {
  instanceId: string;
  sourceId: string;
  trackId: string;
  placementId?: string;
  patternId?: string;
  sectionId?: string;
  startTick: number;
  endTick: number;
  noteNumber: number;
  velocity: number;
  position: MusicalPosition;
  program: number;
  bankMsb: number;
  bankLsb: number;
}

export interface SymbolicDrumEvent {
  instanceId: string;
  sourceId: string;
  trackId: string;
  placementId?: string;
  patternId?: string;
  sectionId?: string;
  startTick: number;
  endTick: number;
  noteNumber: number;
  velocity: number;
  position: MusicalPosition;
}

export interface TempoSegment {
  startTick: number;
  endTick: number;
  bpm: number;
  startSeconds: number;
}

export interface SymbolicIndex {
  timeline: TheoryTimeline;
  vocalEvents: SymbolicVocalEvent[];
  vocalEventsByTrack: ReadonlyMap<string, SymbolicVocalEvent[]>;
  arrangementEvents: SymbolicArrangementEvent[];
  arrangementEventsByTrack: ReadonlyMap<string, SymbolicArrangementEvent[]>;
  drumEvents: SymbolicDrumEvent[];
  drumEventsByTrack: ReadonlyMap<string, SymbolicDrumEvent[]>;
  tempoSegments: TempoSegment[];
}

export interface RawTheoryFinding {
  code: string;
  ruleVersion: string;
  severity: TheorySeverity;
  domain: TheoryDomain;
  confidence: number;
  message: string;
  objectIds: string[];
  startTick?: number;
  endTick?: number;
  source: string;
  details: Record<string, string | number | boolean>;
  suggestion?: string;
  repairKind?: "pitch" | "rhythm" | "harmony" | "voicing" | "breath" | "arrangement" | "review";
}

export interface RawTheoryMetric {
  id: string;
  domain: TheoryDomain;
  value: string | number | boolean;
  unit: string;
  objectIds: string[];
}

export interface DomainAnalysis {
  findings: RawTheoryFinding[];
  metrics: RawTheoryMetric[];
}

function tick(manifest: Pick<SongManifest, "time_signatures">, position: MusicalPosition): number {
  return musicalPositionToTick(manifest.time_signatures, position);
}

function sectionAt(timeline: TheoryTimeline, startTick: number): string | undefined {
  return theoryContextAtTick(timeline, startTick).section?.id;
}

function buildTempoSegments(manifest: SongManifest, songEndTick: number): TempoSegment[] {
  const events = manifest.tempos.map((tempo) => ({ startTick: tick(manifest, tempo.position), bpm: tempo.bpm }));
  let startSeconds = 0;
  return events.map((event, index) => {
    const endTick = events[index + 1]?.startTick ?? songEndTick;
    const segment = { ...event, endTick, startSeconds };
    startSeconds += ((endTick - event.startTick) * 60) / (480 * event.bpm);
    return segment;
  });
}

function arrangementEvents(manifest: SongManifest, timeline: TheoryTimeline): SymbolicArrangementEvent[] {
  const events: SymbolicArrangementEvent[] = [];
  for (const track of manifest.accompaniment.tracks) {
    if (track.kind !== "pitched") continue;
    const trackFields = {
      trackId: track.id,
      program: track.program,
      bankMsb: track.bank_msb,
      bankLsb: track.bank_lsb,
    };
    for (const note of track.notes) {
      const startTick = tick(manifest, note.position);
      const resolvedSectionId = sectionAt(timeline, startTick);
      events.push({
        instanceId: note.id,
        sourceId: note.id,
        ...trackFields,
        ...(resolvedSectionId ? { sectionId: resolvedSectionId } : {}),
        startTick,
        endTick: startTick + note.duration,
        noteNumber: note.note_number,
        velocity: note.velocity,
        position: note.position,
      });
    }
    const patterns = new Map(track.patterns.map((pattern) => [pattern.id, pattern]));
    for (const placement of track.placements) {
      const pattern = patterns.get(placement.pattern_id);
      if (!pattern) continue;
      for (let repeat = 0; repeat < placement.repeats; repeat += 1) {
        for (const note of pattern.notes) {
          const position = {
            measure: placement.start.measure + repeat * pattern.measures + note.offset.measure,
            beat: note.offset.beat,
            tick: note.offset.tick,
          };
          const startTick = tick(manifest, position);
          const resolvedSectionId = placement.section_id ?? sectionAt(timeline, startTick);
          events.push({
            instanceId: `${placement.id}.${repeat}.${note.id}`,
            sourceId: note.id,
            ...trackFields,
            placementId: placement.id,
            patternId: pattern.id,
            ...(resolvedSectionId ? { sectionId: resolvedSectionId } : {}),
            startTick,
            endTick: startTick + note.duration,
            noteNumber: note.note_number + placement.transpose,
            velocity: Math.max(1, Math.min(127, Math.round(note.velocity * placement.velocity_scale))),
            position,
          });
        }
      }
    }
  }
  return events.sort((left, right) => left.startTick - right.startTick
    || left.trackId.localeCompare(right.trackId)
    || left.instanceId.localeCompare(right.instanceId));
}

function drumEvents(manifest: SongManifest, timeline: TheoryTimeline): SymbolicDrumEvent[] {
  const events: SymbolicDrumEvent[] = [];
  for (const track of manifest.accompaniment.tracks) {
    if (track.kind !== "drums") continue;
    for (const hit of track.hits) {
      const startTick = tick(manifest, hit.position);
      const resolvedSectionId = sectionAt(timeline, startTick);
      events.push({
        instanceId: hit.id,
        sourceId: hit.id,
        trackId: track.id,
        ...(resolvedSectionId ? { sectionId: resolvedSectionId } : {}),
        startTick,
        endTick: startTick + hit.duration,
        noteNumber: hit.note_number,
        velocity: hit.velocity,
        position: hit.position,
      });
    }
    const patterns = new Map(track.patterns.map((pattern) => [pattern.id, pattern]));
    for (const placement of track.placements) {
      const pattern = patterns.get(placement.pattern_id);
      if (!pattern) continue;
      for (let repeat = 0; repeat < placement.repeats; repeat += 1) {
        for (const hit of pattern.hits) {
          const position = {
            measure: placement.start.measure + repeat * pattern.measures + hit.offset.measure,
            beat: hit.offset.beat,
            tick: hit.offset.tick,
          };
          const startTick = tick(manifest, position);
          const resolvedSectionId = placement.section_id ?? sectionAt(timeline, startTick);
          events.push({
            instanceId: `${placement.id}.${repeat}.${hit.id}`,
            sourceId: hit.id,
            trackId: track.id,
            placementId: placement.id,
            patternId: pattern.id,
            ...(resolvedSectionId ? { sectionId: resolvedSectionId } : {}),
            startTick,
            endTick: startTick + hit.duration,
            noteNumber: hit.note_number,
            velocity: Math.max(1, Math.min(127, Math.round(hit.velocity * placement.velocity_scale))),
            position,
          });
        }
      }
    }
  }
  return events.sort((left, right) => left.startTick - right.startTick
    || left.trackId.localeCompare(right.trackId)
    || left.instanceId.localeCompare(right.instanceId));
}

export function buildSymbolicIndex(manifest: SongManifest): SymbolicIndex {
  const timeline = buildTheoryTimeline(manifest);
  const vocalEvents = manifest.vocal_tracks.flatMap((track) =>
    manifestExpectedVocalEvents(manifest, track.id).map((event) => {
      const startTick = tick(manifest, event.position);
      const resolvedSectionId = event.sectionId ?? sectionAt(timeline, startTick);
      return {
        ...event,
        ...(resolvedSectionId ? { sectionId: resolvedSectionId } : {}),
        startTick,
        endTick: startTick + event.duration,
      };
    }));
  vocalEvents.sort((left, right) => left.startTick - right.startTick
    || left.trackId.localeCompare(right.trackId)
    || left.id.localeCompare(right.id));
  const vocalEventsByTrack = new Map<string, SymbolicVocalEvent[]>();
  for (const event of vocalEvents) {
    const selected = vocalEventsByTrack.get(event.trackId) ?? [];
    selected.push(event);
    vocalEventsByTrack.set(event.trackId, selected);
  }
  const expandedArrangement = arrangementEvents(manifest, timeline);
  const arrangementEventsByTrack = new Map<string, SymbolicArrangementEvent[]>();
  for (const event of expandedArrangement) {
    const selected = arrangementEventsByTrack.get(event.trackId) ?? [];
    selected.push(event);
    arrangementEventsByTrack.set(event.trackId, selected);
  }
  const expandedDrums = drumEvents(manifest, timeline);
  const drumEventsByTrack = new Map<string, SymbolicDrumEvent[]>();
  for (const event of expandedDrums) {
    const selected = drumEventsByTrack.get(event.trackId) ?? [];
    selected.push(event);
    drumEventsByTrack.set(event.trackId, selected);
  }
  return {
    timeline,
    vocalEvents,
    vocalEventsByTrack,
    arrangementEvents: expandedArrangement,
    arrangementEventsByTrack,
    drumEvents: expandedDrums,
    drumEventsByTrack,
    tempoSegments: buildTempoSegments(manifest, timeline.songEndTick),
  };
}

export function secondsAtTick(index: Pick<SymbolicIndex, "tempoSegments">, targetTick: number): number {
  const segments = index.tempoSegments;
  let low = 0;
  let high = segments.length - 1;
  let selected = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const segment = segments[middle]!;
    if (segment.startTick <= targetTick) {
      selected = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  const segment = segments[selected];
  if (!segment) return 0;
  return segment.startSeconds + ((targetTick - segment.startTick) * 60) / (480 * segment.bpm);
}

export function secondsBetweenTicks(
  index: Pick<SymbolicIndex, "tempoSegments">,
  startTick: number,
  endTick: number,
): number {
  return Math.max(0, secondsAtTick(index, endTick) - secondsAtTick(index, startTick));
}

export function positionAtTick(manifest: Pick<SongManifest, "time_signatures">, targetTick: number) {
  const position = musicalTickToPosition(
    manifest.time_signatures,
    Math.max(0, Math.min(2_147_483_647, targetTick)),
  );
  return { measure: Math.min(100_000, position.measure), beat: position.beat, tick: position.tick ?? 0 };
}
