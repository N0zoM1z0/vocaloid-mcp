import type { DomainAnalysis, SymbolicIndex, SymbolicVocalEvent } from "./events.js";


interface PairMoment {
  tick: number;
  left: SymbolicVocalEvent;
  right: SymbolicVocalEvent;
  interval: number;
}

function overlappingMoments(
  left: readonly SymbolicVocalEvent[],
  right: readonly SymbolicVocalEvent[],
): PairMoment[] {
  const moments: PairMoment[] = [];
  let rightStart = 0;
  for (const leftEvent of left) {
    while (rightStart < right.length && right[rightStart]!.endTick <= leftEvent.startTick) rightStart += 1;
    for (let rightIndex = rightStart; rightIndex < right.length; rightIndex += 1) {
      const rightEvent = right[rightIndex]!;
      if (rightEvent.startTick >= leftEvent.endTick) break;
      if (rightEvent.endTick <= leftEvent.startTick) continue;
      moments.push({
        tick: Math.max(leftEvent.startTick, rightEvent.startTick),
        left: leftEvent,
        right: rightEvent,
        interval: rightEvent.noteNumber - leftEvent.noteNumber,
      });
    }
  }
  return moments.sort((a, b) => a.tick - b.tick
    || a.left.id.localeCompare(b.left.id)
    || a.right.id.localeCompare(b.right.id));
}

function overlapWeightedMeanPitches(moments: readonly PairMoment[]): { left: number; right: number } {
  let left = 0;
  let right = 0;
  let weight = 0;
  for (const moment of moments) {
    const overlap = Math.max(
      0,
      Math.min(moment.left.endTick, moment.right.endTick)
        - Math.max(moment.left.startTick, moment.right.startTick),
    );
    if (overlap === 0) continue;
    left += moment.left.noteNumber * overlap;
    right += moment.right.noteNumber * overlap;
    weight += overlap;
  }
  return weight > 0 ? { left: left / weight, right: right / weight } : { left: 0, right: 0 };
}

function perfectClass(interval: number): 0 | 7 | null {
  const pitchClass = ((Math.abs(interval) % 12) + 12) % 12;
  return pitchClass === 0 || pitchClass === 7 ? pitchClass : null;
}

export function analyzeVoiceLeading(index: SymbolicIndex): DomainAnalysis {
  const findings: DomainAnalysis["findings"] = [];
  const metrics: DomainAnalysis["metrics"] = [];
  const tracks = [...index.vocalEventsByTrack.entries()]
    .filter(([, events]) => events.length > 0)
    .map(([id, events]) => ({ id, events }));

  let collisionCount = 0;
  let crossingCount = 0;
  let parallelCount = 0;
  for (let leftIndex = 0; leftIndex < tracks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < tracks.length; rightIndex += 1) {
      const first = tracks[leftIndex]!;
      const second = tracks[rightIndex]!;
      const unorderedMoments = overlappingMoments(first.events, second.events);
      const overlapMeans = overlapWeightedMeanPitches(unorderedMoments);
      const lower = overlapMeans.left < overlapMeans.right
        || (overlapMeans.left === overlapMeans.right && first.id.localeCompare(second.id) < 0)
        ? first
        : second;
      const upper = lower === first ? second : first;
      const lowerMean = lower === first ? overlapMeans.left : overlapMeans.right;
      const upperMean = lower === first ? overlapMeans.right : overlapMeans.left;
      const moments = lower === first
        ? unorderedMoments
        : unorderedMoments.map((moment) => ({
            tick: moment.tick,
            left: moment.right,
            right: moment.left,
            interval: -moment.interval,
          }));
      let pairCollisions = 0;
      let pairCrossings = 0;
      let pairSpacing = 0;
      for (const moment of moments) {
        const absoluteInterval = Math.abs(moment.interval);
        const pitchClass = absoluteInterval % 12;
        if ((pitchClass === 1 || pitchClass === 11) && pairCollisions < 128) {
          pairCollisions += 1;
          collisionCount += 1;
          findings.push({
            code: "VOCAL_HARMONY_MINOR_SECOND",
            ruleVersion: "1.0.0",
            severity: "warning",
            domain: "voice_leading",
            confidence: 0.95,
            message: `${moment.left.id} and ${moment.right.id} overlap as a minor-second class between ${lower.id} and ${upper.id}.`,
            objectIds: [lower.id, upper.id, moment.left.id, moment.right.id],
            startTick: moment.tick,
            endTick: Math.min(moment.left.endTick, moment.right.endTick),
            source: "symbolic cross-track interval sweep",
            details: { semitones: moment.interval },
            suggestion: "Change octave/voicing or shorten the overlap unless the clash serves a declared phrase direction.",
            repairKind: "voicing",
          });
        }
        if (moment.left.noteNumber > moment.right.noteNumber && pairCrossings < 128) {
          pairCrossings += 1;
          crossingCount += 1;
          findings.push({
            code: "VOICE_CROSSING",
            ruleVersion: "1.0.0",
            severity: "warning",
            domain: "voice_leading",
            confidence: 0.85,
            message: `${lower.id} crosses above ${upper.id} at ${moment.left.id}/${moment.right.id}.`,
            objectIds: [lower.id, upper.id, moment.left.id, moment.right.id],
            startTick: moment.tick,
            endTick: Math.min(moment.left.endTick, moment.right.endTick),
            source: "overlap-weighted voice ordering",
            details: {
              lower_note: moment.left.noteNumber,
              upper_note: moment.right.noteNumber,
              lower_overlap_mean: Number(lowerMean.toFixed(4)),
              upper_overlap_mean: Number(upperMean.toFixed(4)),
            },
            suggestion: "Check whether the crossing clarifies a handoff; otherwise restore register separation.",
            repairKind: "voicing",
          });
        }
        if (absoluteInterval > 19 && pairSpacing < 128) {
          pairSpacing += 1;
          findings.push({
            code: "VOICE_SPACING_EXTREME",
            ruleVersion: "1.0.0",
            severity: "warning",
            domain: "voice_leading",
            confidence: 0.8,
            message: `${lower.id}/${upper.id} span ${absoluteInterval} semitones at ${moment.left.id}/${moment.right.id}.`,
            objectIds: [lower.id, upper.id, moment.left.id, moment.right.id],
            startTick: moment.tick,
            endTick: Math.min(moment.left.endTick, moment.right.endTick),
            source: "symbolic cross-track spacing",
            details: { semitones: absoluteInterval },
            suggestion: "Audition intelligibility and blend; consider an octave redistribution or a deliberate open-spacing rationale.",
            repairKind: "voicing",
          });
        }
      }

      let previous: PairMoment | undefined;
      let pairParallels = 0;
      for (const current of moments) {
        if (!previous) {
          previous = current;
          continue;
        }
        if (current.left.id === previous.left.id || current.right.id === previous.right.id) {
          previous = current;
          continue;
        }
        const previousPerfect = perfectClass(previous.interval);
        const currentPerfect = perfectClass(current.interval);
        const lowerMotion = current.left.noteNumber - previous.left.noteNumber;
        const upperMotion = current.right.noteNumber - previous.right.noteNumber;
        if (previousPerfect !== null && currentPerfect === previousPerfect
          && lowerMotion !== 0 && Math.sign(lowerMotion) === Math.sign(upperMotion)
          && current.tick - previous.tick <= 1920 && pairParallels < 128) {
          pairParallels += 1;
          parallelCount += 1;
          findings.push({
            code: "PARALLEL_PERFECT_INTERVAL",
            ruleVersion: "1.0.0",
            severity: "warning",
            domain: "voice_leading",
            confidence: 0.75,
            message: `${lower.id}/${upper.id} move in parallel ${currentPerfect === 7 ? "fifths" : "octaves/unisons"}.`,
            objectIds: [lower.id, upper.id, previous.left.id, previous.right.id, current.left.id, current.right.id],
            startTick: previous.tick,
            endTick: current.tick,
            source: "successive overlapping vocal intervals",
            details: {
              interval_class: currentPerfect,
              lower_motion: lowerMotion,
              upper_motion: upperMotion,
            },
            suggestion: "Introduce contrary/oblique motion or retain the parallel texture as an explicit stylistic choice.",
            repairKind: "voicing",
          });
        }
        previous = current;
      }
      metrics.push({
        id: `voice_leading.overlaps.${lower.id}.${upper.id}`,
        domain: "voice_leading",
        value: moments.length,
        unit: "overlap_pairs",
        objectIds: [lower.id, upper.id],
      });
    }
  }
  metrics.push(
    {
      id: "voice_leading.minor_second_collisions",
      domain: "voice_leading",
      value: collisionCount,
      unit: "collisions",
      objectIds: tracks.map((track) => track.id),
    },
    {
      id: "voice_leading.crossings",
      domain: "voice_leading",
      value: crossingCount,
      unit: "crossings",
      objectIds: tracks.map((track) => track.id),
    },
    {
      id: "voice_leading.parallel_perfects",
      domain: "voice_leading",
      value: parallelCount,
      unit: "motions",
      objectIds: tracks.map((track) => track.id),
    },
  );
  return { findings, metrics };
}
