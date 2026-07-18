import type { SongManifest } from "../song-manifest.js";
import type { DomainAnalysis, SymbolicIndex, SymbolicVocalEvent } from "./events.js";
import { secondsBetweenTicks } from "./events.js";
import { beatStrengthAtTick } from "./rhythm.js";
import { pitchClassInScale } from "./scale.js";
import { theoryContextAtTick } from "./timeline.js";


function weightedMeanPitch(events: readonly SymbolicVocalEvent[]): number {
  const total = events.reduce((sum, event) => sum + event.duration, 0);
  if (total === 0) return 0;
  return events.reduce((sum, event) => sum + event.noteNumber * event.duration, 0) / total;
}

function oppositeStepRecovery(previous: SymbolicVocalEvent, current: SymbolicVocalEvent, next?: SymbolicVocalEvent): boolean {
  if (!next || next.startTick - current.endTick >= 480) return false;
  const leap = current.noteNumber - previous.noteNumber;
  const recovery = next.noteNumber - current.noteNumber;
  return Math.sign(leap) !== Math.sign(recovery) && Math.abs(recovery) <= 2;
}

export function analyzeMelody(manifest: SongManifest, index: SymbolicIndex): DomainAnalysis {
  const findings: DomainAnalysis["findings"] = [];
  const metrics: DomainAnalysis["metrics"] = [];
  for (const [trackId, events] of index.vocalEventsByTrack) {
    if (events.length === 0) continue;
    let minimum = 127;
    let maximum = 0;
    for (const event of events) {
      minimum = Math.min(minimum, event.noteNumber);
      maximum = Math.max(maximum, event.noteNumber);
    }
    const weightedMean = weightedMeanPitch(events);
    const totalTicks = events.reduce((sum, event) => sum + event.duration, 0);
    const outsideWorkingRangeTicks = events
      .filter((event) => event.noteNumber < 52 || event.noteNumber > 79)
      .reduce((sum, event) => sum + event.duration, 0);
    const climax = events.find((event) => event.noteNumber === maximum)!;
    const intervals = events.slice(1).map((event, eventIndex) =>
      event.noteNumber - events[eventIndex]!.noteNumber);
    const motifCounts = new Map<string, number>();
    for (let intervalIndex = 0; intervalIndex + 2 < intervals.length; intervalIndex += 1) {
      const key = intervals.slice(intervalIndex, intervalIndex + 3).join(",");
      motifCounts.set(key, (motifCounts.get(key) ?? 0) + 1);
    }
    const motifWindows = Math.max(0, intervals.length - 2);
    const repeatedMotifWindows = [...motifCounts.values()].reduce(
      (sum, count) => sum + Math.max(0, count - 1),
      0,
    );
    const motifRepetition = motifWindows > 0 ? repeatedMotifWindows / motifWindows : 0;
    let contourChanges = 0;
    let previousDirection = 0;
    for (const interval of intervals) {
      const direction = Math.sign(interval);
      if (direction !== 0 && previousDirection !== 0 && direction !== previousDirection) contourChanges += 1;
      if (direction !== 0) previousDirection = direction;
    }
    const climaxPosition = index.timeline.songEndTick > 0 ? climax.startTick / index.timeline.songEndTick : 0;
    metrics.push(
      { id: `melody.range.${trackId}`, domain: "melody", value: maximum - minimum, unit: "semitones", objectIds: [trackId] },
      { id: `melody.minimum.${trackId}`, domain: "melody", value: minimum, unit: "midi_note", objectIds: [trackId] },
      { id: `melody.maximum.${trackId}`, domain: "melody", value: maximum, unit: "midi_note", objectIds: [trackId] },
      { id: `melody.weighted_mean.${trackId}`, domain: "melody", value: Number(weightedMean.toFixed(4)), unit: "midi_note", objectIds: [trackId] },
      {
        id: `melody.climax_position.${trackId}`,
        domain: "melody",
        value: Number(climaxPosition.toFixed(6)),
        unit: "song_ratio",
        objectIds: [trackId, climax.id],
      },
      {
        id: `melody.motif_repetition.${trackId}`,
        domain: "melody",
        value: Number(motifRepetition.toFixed(6)),
        unit: "repeated_interval_trigram_ratio",
        objectIds: [trackId],
      },
      {
        id: `melody.contour_changes.${trackId}`,
        domain: "melody",
        value: contourChanges,
        unit: "direction_changes",
        objectIds: [trackId],
      },
    );
    if (events.length >= 12 && motifRepetition > 0.55) {
      findings.push({
        code: "MOTIF_REPETITION_HIGH",
        ruleVersion: "1.0.0",
        severity: "info",
        domain: "melody",
        confidence: 0.8,
        message: `${trackId} repeats ${((motifRepetition) * 100).toFixed(1)}% of its three-interval motif windows beyond their first occurrence.`,
        objectIds: [trackId],
        source: "transposition-invariant melodic interval trigrams",
        details: { repeated_ratio: Number(motifRepetition.toFixed(6)), motif_windows: motifWindows },
        suggestion: "Keep a recognizable hook while varying contour, rhythm, harmony, or phrase destination where repetition adds no meaning.",
        repairKind: "pitch",
      });
    }
    if (events.length >= 8 && (climaxPosition < 0.12 || climaxPosition > 0.95)) {
      findings.push({
        code: "CLIMAX_PLACEMENT_UNUSUAL",
        ruleVersion: "1.0.0",
        severity: "info",
        domain: "melody",
        confidence: 0.75,
        message: `${trackId}'s first highest pitch occurs at ${(climaxPosition * 100).toFixed(1)}% of the song timeline.`,
        objectIds: [trackId, climax.id],
        startTick: climax.startTick,
        endTick: climax.endTick,
        source: "symbolic vocal maximum and semantic song end",
        details: { climax_position: Number(climaxPosition.toFixed(6)), maximum_note: maximum },
        suggestion: "Confirm that the early/late climax serves the form and anchor-phrase direction; do not move it solely to match a median.",
        repairKind: "review",
      });
    }
    if (totalTicks > 0 && outsideWorkingRangeTicks / totalTicks > 0.35) {
      findings.push({
        code: "VOCAL_TESSITURA_STRAIN",
        ruleVersion: "1.0.0",
        severity: "warning",
        domain: "melody",
        confidence: 0.9,
        message: `${((outsideWorkingRangeTicks / totalTicks) * 100).toFixed(1)}% of voiced ticks on ${trackId} lie outside the conservative E3-G5 working tessitura.`,
        objectIds: [trackId],
        source: "symbolic vocal duration-weighted tessitura",
        details: { minimum, maximum, outside_ratio: Number((outsideWorkingRangeTicks / totalTicks).toFixed(6)) },
        suggestion: "Transpose, redistribute harmony, or keep the register only after an isolated target-voicebank audition.",
        repairKind: "pitch",
      });
    }

    let runStart = events[0]!;
    let runEndTick = runStart.endTick;
    let breathWindowCount = 0;
    let longestBreathWindowMilliseconds = 0;
    let longestContinuousRunSeconds = 0;
    for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
      const event = events[eventIndex]!;
      const previous = events[eventIndex - 1];
      if (previous) {
        const gap = event.startTick - previous.endTick;
        const leap = event.noteNumber - previous.noteNumber;
        if (gap < 480 && Math.abs(leap) > 7 && !oppositeStepRecovery(previous, event, events[eventIndex + 1])) {
          findings.push({
            code: "LARGE_LEAP_UNBALANCED",
            ruleVersion: "1.0.0",
            severity: "warning",
            domain: "melody",
            confidence: 0.9,
            message: `${previous.id} to ${event.id} leaps ${Math.abs(leap)} semitones without immediate opposite-step recovery.`,
            objectIds: [trackId, previous.partId, previous.id, event.id],
            startTick: event.startTick,
            source: "symbolic adjacent vocal intervals",
            details: { semitones: leap, gap_ticks: gap },
            suggestion: "Add preparation/recovery, change register, or preserve the leap with an intentional review note.",
            repairKind: "pitch",
          });
        }
        if (gap >= 120) {
          const seconds = secondsBetweenTicks(index, runStart.startTick, runEndTick);
          breathWindowCount += 1;
          longestBreathWindowMilliseconds = Math.max(
            longestBreathWindowMilliseconds,
            secondsBetweenTicks(index, previous.endTick, event.startTick) * 1000,
          );
          longestContinuousRunSeconds = Math.max(longestContinuousRunSeconds, seconds);
          if (seconds > 12) {
            findings.push({
              code: "PHRASE_WITHOUT_BREATH",
              ruleVersion: "1.0.0",
              severity: "warning",
              domain: "vocal",
              confidence: 0.9,
              message: `${trackId} contains a ${seconds.toFixed(2)} second voiced run without a 120-tick breath window.`,
              objectIds: [trackId, runStart.partId],
              startTick: runStart.startTick,
              endTick: runEndTick,
              source: "symbolic vocal gaps and tempo map",
              details: { duration_seconds: Number(seconds.toFixed(4)), breath_threshold_ticks: 120 },
              suggestion: "Introduce a breath/rest window or document and audition the deliberate continuous phrase.",
              repairKind: "breath",
            });
          }
          runStart = event;
        }
      }
      runEndTick = Math.max(runEndTick, event.endTick);

      const activeScale = theoryContextAtTick(index.timeline, event.startTick).key?.value.parsed;
      const strength = beatStrengthAtTick(manifest, event.startTick);
      if (activeScale && strength.strength >= 0.65 && event.duration >= 240
        && !pitchClassInScale(event.noteNumber, activeScale)) {
        findings.push({
          code: "STRONG_BEAT_OUT_OF_SCALE",
          ruleVersion: "1.0.0",
          severity: "warning",
          domain: "melody",
          confidence: 0.85,
          message: `${event.id} places an out-of-scale sustained pitch on a ${strength.role} in ${activeScale.tonic.normalized} ${activeScale.mode}.`,
          objectIds: [trackId, event.partId, event.id],
          startTick: event.startTick,
          source: "symbolic note, meter, and key timeline",
          details: { note_number: event.noteNumber, beat_strength: strength.strength, duration_ticks: event.duration },
          suggestion: "Verify preparation/resolution as chromatic color; otherwise use a nearby scale/chord tone.",
          repairKind: "pitch",
        });
      }
    }
    const finalSeconds = secondsBetweenTicks(index, runStart.startTick, runEndTick);
    longestContinuousRunSeconds = Math.max(longestContinuousRunSeconds, finalSeconds);
    if (finalSeconds > 12) {
      findings.push({
        code: "PHRASE_WITHOUT_BREATH",
        ruleVersion: "1.0.0",
        severity: "warning",
        domain: "vocal",
        confidence: 0.9,
        message: `${trackId} ends with a ${finalSeconds.toFixed(2)} second voiced run without a 120-tick breath window.`,
        objectIds: [trackId, runStart.partId],
        startTick: runStart.startTick,
        endTick: runEndTick,
        source: "symbolic vocal gaps and tempo map",
        details: { duration_seconds: Number(finalSeconds.toFixed(4)), breath_threshold_ticks: 120 },
        suggestion: "Introduce a breath/rest window or document and audition the deliberate continuous phrase.",
        repairKind: "breath",
      });
    }
    metrics.push(
      {
        id: `vocal.breath_window_count.${trackId}`,
        domain: "vocal",
        value: breathWindowCount,
        unit: "windows_at_least_120_ticks",
        objectIds: [trackId],
      },
      {
        id: `vocal.longest_breath_window.${trackId}`,
        domain: "vocal",
        value: Number(longestBreathWindowMilliseconds.toFixed(4)),
        unit: "milliseconds",
        objectIds: [trackId],
      },
      {
        id: `vocal.longest_continuous_run.${trackId}`,
        domain: "vocal",
        value: Number(longestContinuousRunSeconds.toFixed(4)),
        unit: "seconds",
        objectIds: [trackId],
      },
    );
  }
  return { findings, metrics };
}
