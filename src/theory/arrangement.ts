import type { SongManifest } from "../song-manifest.js";
import { isChordTone } from "./chord.js";
import type { DomainAnalysis, SymbolicArrangementEvent, SymbolicIndex } from "./events.js";
import { normalizePitchClass } from "./pitch.js";
import { beatStrengthAtTick } from "./rhythm.js";
import { theoryContextAtTick } from "./timeline.js";


interface PracticalRange {
  minimum: number;
  maximum: number;
  family: string;
}

interface RegisterEvent {
  key: string;
  trackId: string;
  sourceId: string;
  startTick: number;
  endTick: number;
  noteNumber: number;
}

interface RegisterEnd {
  key: string;
  endTick: number;
}

function pushRegisterEnd(heap: RegisterEnd[], value: RegisterEnd): void {
  heap.push(value);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent]!.endTick <= value.endTick) break;
    heap[index] = heap[parent]!;
    index = parent;
  }
  heap[index] = value;
}

function popRegisterEnd(heap: RegisterEnd[]): RegisterEnd | undefined {
  const root = heap[0];
  const tail = heap.pop();
  if (!root || !tail || heap.length === 0) return root;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    const child = right < heap.length && heap[right]!.endTick < heap[left]!.endTick ? right : left;
    if (heap[child]!.endTick >= tail.endTick) break;
    heap[index] = heap[child]!;
    index = child;
  }
  heap[index] = tail;
  return root;
}

function practicalRange(program: number): PracticalRange | null {
  if (program >= 0 && program <= 7) return { minimum: 21, maximum: 108, family: "piano" };
  if (program >= 24 && program <= 31) return { minimum: 40, maximum: 88, family: "guitar" };
  if (program >= 32 && program <= 39) return { minimum: 28, maximum: 72, family: "bass" };
  if (program >= 40 && program <= 51) return { minimum: 36, maximum: 103, family: "strings" };
  if (program >= 56 && program <= 63) return { minimum: 40, maximum: 88, family: "brass" };
  if (program >= 64 && program <= 79) return { minimum: 46, maximum: 96, family: "winds" };
  if (program >= 80 && program <= 95) return { minimum: 36, maximum: 96, family: "synth" };
  return null;
}

function isBassTrack(track: SongManifest["accompaniment"]["tracks"][number]): boolean {
  return track.kind === "pitched" && (track.program >= 32 && track.program <= 39 || /bass/u.test(track.name.toLowerCase()));
}

function stableEventObjectIds(event: SymbolicArrangementEvent): string[] {
  return [event.trackId, ...(event.placementId ? [event.placementId] : []), event.sourceId];
}

function intersectionSize(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  let count = 0;
  for (const value of smaller) if (larger.has(value)) count += 1;
  return count;
}

export function analyzeArrangement(manifest: SongManifest, index: SymbolicIndex): DomainAnalysis {
  const findings: DomainAnalysis["findings"] = [];
  const metrics: DomainAnalysis["metrics"] = [];
  const rangeFindingKeys = new Set<string>();
  const bassConflictKeys = new Set<string>();
  for (const track of manifest.accompaniment.tracks) {
    const pitchedEvents = index.arrangementEventsByTrack.get(track.id) ?? [];
    const drumEvents = index.drumEventsByTrack.get(track.id) ?? [];
    const eventCount = pitchedEvents.length + drumEvents.length;
    metrics.push({
      id: `arrangement.event_count.${track.id}`,
      domain: "arrangement",
      value: eventCount,
      unit: "events",
      objectIds: [track.id],
    });
    if (track.kind !== "pitched") continue;
    const range = practicalRange(track.program);
    if (pitchedEvents.length > 0) {
      let minimum = Number.POSITIVE_INFINITY;
      let maximum = Number.NEGATIVE_INFINITY;
      for (const event of pitchedEvents) {
        minimum = Math.min(minimum, event.noteNumber);
        maximum = Math.max(maximum, event.noteNumber);
      }
      metrics.push(
        {
          id: `arrangement.minimum.${track.id}`,
          domain: "arrangement",
          value: minimum,
          unit: "midi_note",
          objectIds: [track.id],
        },
        {
          id: `arrangement.maximum.${track.id}`,
          domain: "arrangement",
          value: maximum,
          unit: "midi_note",
          objectIds: [track.id],
        },
      );
    }
    for (const event of pitchedEvents) {
      if (event.noteNumber < 0 || event.noteNumber > 127) {
        const key = `${track.id}\u0000${event.sourceId}\u0000midi`;
        if (!rangeFindingKeys.has(key)) {
          rangeFindingKeys.add(key);
          findings.push({
            code: "VOICING_NOTE_OUTSIDE_MIDI",
            ruleVersion: "1.0.0",
            severity: "error",
            domain: "arrangement",
            confidence: 1,
            message: `${event.instanceId} expands to MIDI ${event.noteNumber}, outside 0..127.`,
            objectIds: stableEventObjectIds(event),
            startTick: event.startTick,
            endTick: event.endTick,
            source: "expanded accompaniment note and placement transpose",
            details: { note_number: event.noteNumber },
            suggestion: "Reduce the source note or placement transpose before build.",
            repairKind: "voicing",
          });
        }
      } else if (range && (event.noteNumber < range.minimum || event.noteNumber > range.maximum)) {
        const key = `${track.id}\u0000${event.sourceId}\u0000${range.family}`;
        if (!rangeFindingKeys.has(key)) {
          rangeFindingKeys.add(key);
          findings.push({
            code: "ARRANGEMENT_RANGE_RISK",
            ruleVersion: "1.0.0",
            severity: "warning",
            domain: "arrangement",
            confidence: 0.85,
            message: `${event.instanceId} is MIDI ${event.noteNumber}, outside the conservative ${range.family} range ${range.minimum}..${range.maximum}.`,
            objectIds: stableEventObjectIds(event),
            startTick: event.startTick,
            endTick: event.endTick,
            source: "GM-family practical range",
            details: {
              note_number: event.noteNumber,
              minimum: range.minimum,
              maximum: range.maximum,
              family: range.family,
            },
            suggestion: "Change octave/instrument or document the extended register after renderer-specific audition.",
            repairKind: "arrangement",
          });
        }
      }

      if (isBassTrack(track) && beatStrengthAtTick(manifest, event.startTick).strength >= 0.65) {
        const chordContext = theoryContextAtTick(index.timeline, event.startTick).chord;
        const chord = chordContext?.value.parsed;
        if (chord?.bassPitchClass !== undefined
          && normalizePitchClass(event.noteNumber) !== chord.bassPitchClass) {
          const key = `${track.id}\u0000${event.sourceId}\u0000${chordContext!.id}`;
          if (!bassConflictKeys.has(key)) {
            bassConflictKeys.add(key);
            findings.push({
              code: "BASS_CONFLICTS_WITH_SLASH_CHORD",
              ruleVersion: "1.0.0",
              severity: "warning",
              domain: "arrangement",
              confidence: 0.9,
              message: `${event.instanceId} plays a chord tone other than declared slash bass ${chord.bass} on a strong beat.`,
              objectIds: [...stableEventObjectIds(event), chordContext!.id],
              startTick: event.startTick,
              endTick: event.endTick,
              source: "expanded bass event and slash-chord intent",
              details: {
                note_number: event.noteNumber,
                declared_bass_pitch_class: chord.bassPitchClass,
                chord: chord.symbol,
                is_chord_tone: isChordTone(event.noteNumber, chord),
              },
              suggestion: "Use the declared inversion bass, revise the slash chord, or mark the displacement as intentional.",
              repairKind: "voicing",
            });
          }
        }
      }
    }
  }

  const registerEvents: RegisterEvent[] = [
    ...index.vocalEvents.map((event) => ({
      key: `vocal\u0000${event.trackId}\u0000${event.id}`,
      trackId: event.trackId,
      sourceId: event.id,
      startTick: event.startTick,
      endTick: event.endTick,
      noteNumber: event.noteNumber,
    })),
    ...index.arrangementEvents.map((event) => ({
      key: `arrangement\u0000${event.trackId}\u0000${event.instanceId}`,
      trackId: event.trackId,
      sourceId: event.sourceId,
      startTick: event.startTick,
      endTick: event.endTick,
      noteNumber: event.noteNumber,
    })),
  ].filter((event) => event.noteNumber >= 40 && event.noteNumber <= 72)
    .sort((left, right) => left.startTick - right.startTick
    || left.trackId.localeCompare(right.trackId)
    || left.key.localeCompare(right.key));
  const active = new Map<string, RegisterEvent>();
  const activeTrackCounts = new Map<string, number>();
  const registerEnds: RegisterEnd[] = [];
  let lastRegisterFindingTick = Number.NEGATIVE_INFINITY;
  let registerCollisionCount = 0;
  for (const event of registerEvents) {
    while (registerEnds[0] && registerEnds[0].endTick <= event.startTick) {
      const ended = popRegisterEnd(registerEnds)!;
      const expired = active.get(ended.key);
      if (!expired) continue;
      active.delete(ended.key);
      const trackCount = (activeTrackCounts.get(expired.trackId) ?? 1) - 1;
      if (trackCount === 0) activeTrackCounts.delete(expired.trackId);
      else activeTrackCounts.set(expired.trackId, trackCount);
    }
    active.set(event.key, event);
    activeTrackCounts.set(event.trackId, (activeTrackCounts.get(event.trackId) ?? 0) + 1);
    pushRegisterEnd(registerEnds, { key: event.key, endTick: event.endTick });
    if (active.size >= 6 && activeTrackCounts.size >= 3 && event.startTick - lastRegisterFindingTick >= 480) {
      lastRegisterFindingTick = event.startTick;
      registerCollisionCount += 1;
      const objectIds = new Set<string>();
      for (const candidate of active.values()) {
        objectIds.add(candidate.trackId);
        objectIds.add(candidate.sourceId);
        if (objectIds.size >= 256) break;
      }
      findings.push({
        code: "REGISTER_DENSITY_COLLISION",
        ruleVersion: "1.0.0",
        severity: "warning",
        domain: "arrangement",
        confidence: 0.8,
        message: `${active.size} simultaneous pitched events across ${activeTrackCounts.size} tracks crowd MIDI 40..72.`,
        objectIds: [...objectIds].slice(0, 256),
        startTick: event.startTick,
        endTick: registerEnds[0]!.endTick,
        source: "end-time-heap register interval sweep",
        details: { active_events: active.size, active_tracks: activeTrackCounts.size },
        suggestion: "Remove a layer, change octave/voicing, or create rhythmic space around the lead.",
        repairKind: "arrangement",
      });
    }
  }

  const trackOnsets = new Map<string, Set<string>>();
  const trackPitchOnsets = new Map<string, Set<string>>();
  for (const event of index.arrangementEvents) {
    const onsets = trackOnsets.get(event.trackId) ?? new Set<string>();
    onsets.add(String(event.startTick));
    trackOnsets.set(event.trackId, onsets);
    const pitches = trackPitchOnsets.get(event.trackId) ?? new Set<string>();
    pitches.add(`${event.startTick}:${normalizePitchClass(event.noteNumber)}`);
    trackPitchOnsets.set(event.trackId, pitches);
  }
  for (const event of index.drumEvents) {
    const onsets = trackOnsets.get(event.trackId) ?? new Set<string>();
    onsets.add(String(event.startTick));
    trackOnsets.set(event.trackId, onsets);
  }
  const arrangementTrackIds = [...trackOnsets.keys()].sort();
  let rhythmicRedundancyPairs = 0;
  for (let leftIndex = 0; leftIndex < arrangementTrackIds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < arrangementTrackIds.length; rightIndex += 1) {
      const leftId = arrangementTrackIds[leftIndex]!;
      const rightId = arrangementTrackIds[rightIndex]!;
      const left = trackOnsets.get(leftId)!;
      const right = trackOnsets.get(rightId)!;
      const denominator = Math.min(left.size, right.size);
      if (denominator < 8) continue;
      const onsetSimilarity = intersectionSize(left, right) / denominator;
      if (onsetSimilarity >= 0.85) {
        rhythmicRedundancyPairs += 1;
        findings.push({
          code: "RHYTHMIC_LAYER_COLLISION",
          ruleVersion: "1.0.0",
          severity: "warning",
          domain: "arrangement",
          confidence: 0.8,
          message: `${leftId} and ${rightId} share ${(onsetSimilarity * 100).toFixed(1)}% of the smaller track's onset grid.`,
          objectIds: [leftId, rightId],
          source: "expanded accompaniment onset sets",
          details: { onset_similarity: Number(onsetSimilarity.toFixed(6)), compared_onsets: denominator },
          suggestion: "Give one layer a complementary rhythm, rests, or a distinct call/response role.",
          repairKind: "arrangement",
        });
      }
      const leftPitches = trackPitchOnsets.get(leftId);
      const rightPitches = trackPitchOnsets.get(rightId);
      if (!leftPitches || !rightPitches) continue;
      const pitchDenominator = Math.min(leftPitches.size, rightPitches.size);
      if (pitchDenominator < 8) continue;
      const pitchSimilarity = intersectionSize(leftPitches, rightPitches) / pitchDenominator;
      if (pitchSimilarity >= 0.85) {
        findings.push({
          code: "ACCOMPANIMENT_ROLE_REDUNDANCY",
          ruleVersion: "1.0.0",
          severity: "warning",
          domain: "arrangement",
          confidence: 0.85,
          message: `${leftId} and ${rightId} duplicate ${(pitchSimilarity * 100).toFixed(1)}% of the smaller track's onset/pitch-class events.`,
          objectIds: [leftId, rightId],
          source: "expanded accompaniment onset/pitch-class sets",
          details: { pitch_onset_similarity: Number(pitchSimilarity.toFixed(6)), compared_events: pitchDenominator },
          suggestion: "Mute-test one layer; retain both only when timbre/space creates a clear audible function.",
          repairKind: "arrangement",
        });
      }
    }
  }

  const sectionCounts = new Map<string, number>();
  const countSectionEvent = (event: { sectionId?: string }): void => {
    if (event.sectionId) sectionCounts.set(event.sectionId, (sectionCounts.get(event.sectionId) ?? 0) + 1);
  };
  for (const event of index.vocalEvents) countSectionEvent(event);
  for (const event of index.arrangementEvents) countSectionEvent(event);
  for (const event of index.drumEvents) countSectionEvent(event);
  const sectionDensities = index.timeline.sections.map((section) => ({
    section,
    density: (sectionCounts.get(section.id) ?? 0) / Math.max(1, (section.endTick - section.startTick) / 480),
  }));
  const densities = sectionDensities.map((entry) => entry.density);
  const minimumDensity = densities.length > 0 ? Math.min(...densities) : 0;
  const maximumDensity = densities.length > 0 ? Math.max(...densities) : 0;
  for (const entry of sectionDensities) {
    metrics.push({
      id: `arrangement.section_density.${entry.section.id}`,
      domain: "arrangement",
      value: Number(entry.density.toFixed(6)),
      unit: "onsets_per_quarter",
      objectIds: [entry.section.id],
    });
    if (maximumDensity - minimumDensity < 0.25) continue;
    const normalizedDensity = (entry.density - minimumDensity) / (maximumDensity - minimumDensity);
    if (Math.abs(normalizedDensity - entry.section.value.energy) <= 0.55) continue;
    findings.push({
      code: "SECTION_DENSITY_ENERGY_MISMATCH",
      ruleVersion: "1.0.0",
      severity: "warning",
      domain: "arrangement",
      confidence: 0.75,
      message: `${entry.section.id} declares energy ${entry.section.value.energy.toFixed(2)} but has normalized onset density ${normalizedDensity.toFixed(2)}.`,
      objectIds: [entry.section.id],
      startTick: entry.section.startTick,
      endTick: entry.section.endTick,
      source: "section energy and symbolic onset density",
      details: {
        declared_energy: entry.section.value.energy,
        normalized_density: Number(normalizedDensity.toFixed(6)),
      },
      suggestion: "Reconcile the section role using register, rhythm, dynamics, or intentional space rather than blindly adding notes.",
      repairKind: "arrangement",
    });
  }
  metrics.push(
    {
      id: "arrangement.register_collisions",
      domain: "arrangement",
      value: registerCollisionCount,
      unit: "collision_windows",
      objectIds: manifest.accompaniment.tracks.map((track) => track.id),
    },
    {
      id: "arrangement.rhythmic_redundancy_pairs",
      domain: "arrangement",
      value: rhythmicRedundancyPairs,
      unit: "track_pairs",
      objectIds: arrangementTrackIds,
    },
  );
  return { findings, metrics };
}
