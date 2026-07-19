import type { SongManifest } from "../song-manifest.js";
import { musicalPositionToTick, type MusicalPosition } from "../vsqx.js";
import { parseChordSymbol, type ParsedChord } from "./chord.js";
import { parseScale, type ParsedScale } from "./scale.js";


export interface PointTimelineEvent<T> {
  id: string;
  startTick: number;
  value: T;
}

export interface IntervalTimelineEvent<T> extends PointTimelineEvent<T> {
  endTick: number;
}

export interface TheoryTimeline {
  songStartTick: 0;
  songEndTick: number;
  meters: readonly PointTimelineEvent<SongManifest["time_signatures"][number]>[];
  tempos: readonly PointTimelineEvent<SongManifest["tempos"][number]>[];
  keys: readonly PointTimelineEvent<{
    event: SongManifest["harmony"]["key_changes"][number];
    parsed: ParsedScale | null;
  }>[];
  chords: readonly IntervalTimelineEvent<{
    event: SongManifest["harmony"]["chord_changes"][number];
    parsed: ParsedChord | null;
  }>[];
  sections: readonly IntervalTimelineEvent<SongManifest["sections"][number]>[];
}

interface IntervalSearchIndex {
  leafCount: number;
  maximumEnds: Float64Array;
}

const intervalSearchIndexes = new WeakMap<readonly IntervalTimelineEvent<unknown>[], IntervalSearchIndex>();

function byStartThenId<T extends PointTimelineEvent<unknown>>(left: T, right: T): number {
  return left.startTick - right.startTick || left.id.localeCompare(right.id);
}

function lastStartedIndex(events: readonly PointTimelineEvent<unknown>[], tick: number): number {
  let low = 0;
  let high = events.length - 1;
  let selected = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const event = events[middle]!;
    if (event.startTick <= tick) {
      selected = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return selected;
}

function intervalSearchIndex<T>(events: readonly IntervalTimelineEvent<T>[]): IntervalSearchIndex {
  const key = events as readonly IntervalTimelineEvent<unknown>[];
  const existing = intervalSearchIndexes.get(key);
  if (existing) return existing;
  let leafCount = 1;
  while (leafCount < events.length) leafCount *= 2;
  const maximumEnds = new Float64Array(leafCount * 2);
  maximumEnds.fill(Number.NEGATIVE_INFINITY);
  for (let index = 0; index < events.length; index += 1) {
    maximumEnds[leafCount + index] = events[index]!.endTick;
  }
  for (let index = leafCount - 1; index > 0; index -= 1) {
    maximumEnds[index] = Math.max(maximumEnds[index * 2]!, maximumEnds[index * 2 + 1]!);
  }
  const built = { leafCount, maximumEnds };
  intervalSearchIndexes.set(key, built);
  return built;
}

function rightmostEndingAfter(
  index: IntervalSearchIndex,
  node: number,
  left: number,
  right: number,
  maximumEventIndex: number,
  tick: number,
): number {
  if (left > maximumEventIndex || index.maximumEnds[node]! <= tick) return -1;
  if (left === right) return left;
  const middle = Math.floor((left + right) / 2);
  const fromRight = rightmostEndingAfter(
    index,
    node * 2 + 1,
    middle + 1,
    right,
    maximumEventIndex,
    tick,
  );
  return fromRight >= 0
    ? fromRight
    : rightmostEndingAfter(index, node * 2, left, middle, maximumEventIndex, tick);
}

function collectEndingAfter(
  index: IntervalSearchIndex,
  node: number,
  left: number,
  right: number,
  maximumEventIndex: number,
  tick: number,
  selected: number[],
): void {
  if (left > maximumEventIndex || index.maximumEnds[node]! <= tick) return;
  if (left === right) {
    selected.push(left);
    return;
  }
  const middle = Math.floor((left + right) / 2);
  collectEndingAfter(index, node * 2, left, middle, maximumEventIndex, tick, selected);
  collectEndingAfter(index, node * 2 + 1, middle + 1, right, maximumEventIndex, tick, selected);
}

export function activePointAt<T>(events: readonly PointTimelineEvent<T>[], tick: number): PointTimelineEvent<T> | null {
  const selected = lastStartedIndex(events, tick);
  return selected >= 0 ? events[selected]! : null;
}

export function activeIntervalAt<T>(
  events: readonly IntervalTimelineEvent<T>[],
  tick: number,
): IntervalTimelineEvent<T> | null {
  const maximumEventIndex = lastStartedIndex(events, tick);
  if (maximumEventIndex < 0) return null;
  const search = intervalSearchIndex(events);
  const selected = rightmostEndingAfter(
    search,
    1,
    0,
    search.leafCount - 1,
    maximumEventIndex,
    tick,
  );
  return selected >= 0 ? events[selected]! : null;
}

export function intervalsAt<T>(
  events: readonly IntervalTimelineEvent<T>[],
  tick: number,
): IntervalTimelineEvent<T>[] {
  const maximumEventIndex = lastStartedIndex(events, tick);
  if (maximumEventIndex < 0) return [];
  const search = intervalSearchIndex(events);
  const selected: number[] = [];
  collectEndingAfter(
    search,
    1,
    0,
    search.leafCount - 1,
    maximumEventIndex,
    tick,
    selected,
  );
  return selected.map((eventIndex) => events[eventIndex]!).sort(byStartThenId);
}

export function timelineTick(
  manifest: Pick<SongManifest, "time_signatures">,
  position: MusicalPosition,
): number {
  return musicalPositionToTick(manifest.time_signatures, position);
}

export function buildTheoryTimeline(manifest: SongManifest): TheoryTimeline {
  const tick = (position: MusicalPosition): number => timelineTick(manifest, position);
  const sections = manifest.sections.map((section) => ({
    id: section.id,
    startTick: tick(section.start),
    endTick: tick(section.end),
    value: section,
  })).sort(byStartThenId);
  const songEndTick = Math.max(0, ...sections.map((section) => section.endTick));
  const meters = manifest.time_signatures.map((meter) => ({
    id: `meter-${meter.measure}`,
    startTick: tick({ measure: meter.measure, beat: 0, tick: 0 }),
    value: meter,
  })).sort(byStartThenId);
  const tempos = manifest.tempos.map((tempo, index) => ({
    id: `tempo-${index.toString().padStart(4, "0")}`,
    startTick: tick(tempo.position),
    value: tempo,
  })).sort(byStartThenId);
  const keys = manifest.harmony.key_changes.map((event) => ({
    id: event.id,
    startTick: tick(event.position),
    value: { event, parsed: parseScale(event.tonic, event.mode) },
  })).sort(byStartThenId);
  const chords = manifest.harmony.chord_changes.map((event) => {
    const startTick = tick(event.position);
    return {
      id: event.id,
      startTick,
      endTick: startTick + event.duration_ticks,
      value: { event, parsed: parseChordSymbol(event.symbol) },
    };
  }).sort(byStartThenId);
  return {
    songStartTick: 0,
    songEndTick,
    meters,
    tempos,
    keys,
    chords,
    sections,
  };
}

export function theoryContextAtTick(timeline: TheoryTimeline, tick: number) {
  return {
    tick,
    meter: activePointAt(timeline.meters, tick),
    tempo: activePointAt(timeline.tempos, tick),
    key: activePointAt(timeline.keys, tick),
    chord: activeIntervalAt(timeline.chords, tick),
    section: activeIntervalAt(timeline.sections, tick),
  };
}
