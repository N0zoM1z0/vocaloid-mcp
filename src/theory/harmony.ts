import type { SongManifest } from "../song-manifest.js";
import {
  harmonicFunctionForChord,
  isChordTone,
  romanNumeralForChord,
} from "./chord.js";
import type { DomainAnalysis, SymbolicIndex, SymbolicVocalEvent } from "./events.js";
import { secondsBetweenTicks } from "./events.js";
import { normalizePitchClass } from "./pitch.js";
import { beatStrengthAtTick } from "./rhythm.js";
import { theoryContextAtTick } from "./timeline.js";


function clippedIntervalCoverage(
  intervals: readonly { startTick: number; endTick: number }[],
  songEndTick: number,
): number {
  let cursor = 0;
  let covered = 0;
  for (const interval of intervals) {
    const start = Math.max(0, Math.min(songEndTick, interval.startTick));
    const end = Math.max(0, Math.min(songEndTick, interval.endTick));
    if (end <= cursor) continue;
    const effectiveStart = Math.max(cursor, start);
    if (end > effectiveStart) covered += end - effectiveStart;
    cursor = Math.max(cursor, end);
  }
  return songEndTick > 0 ? covered / songEndTick : 1;
}

function resolvesToChordTone(
  index: SymbolicIndex,
  current: SymbolicVocalEvent,
  next: SymbolicVocalEvent | undefined,
): boolean {
  if (!next || next.startTick - current.endTick > 240 || Math.abs(next.noteNumber - current.noteNumber) > 2) {
    return false;
  }
  const chord = theoryContextAtTick(index.timeline, next.startTick).chord?.value.parsed;
  return chord?.exact === true && isChordTone(next.noteNumber, chord);
}

export function analyzeHarmony(manifest: SongManifest, index: SymbolicIndex): DomainAnalysis {
  const findings: DomainAnalysis["findings"] = [];
  const metrics: DomainAnalysis["metrics"] = [];
  const { keys, chords, songEndTick } = index.timeline;

  for (const key of keys) {
    if (key.value.parsed) continue;
    findings.push({
      code: "KEY_INVALID",
      ruleVersion: "1.0.0",
      severity: "error",
      domain: "key",
      confidence: 1,
      message: `Key event ${key.id} cannot parse ${key.value.event.tonic} ${key.value.event.mode}.`,
      objectIds: [key.id],
      startTick: key.startTick,
      source: "manifest.harmony.key_changes",
      details: { tonic: key.value.event.tonic, mode: key.value.event.mode },
      suggestion: "Use a supported tonic spelling and explicit mode, or declare a supported non-tonal pitch policy.",
      repairKind: "harmony",
    });
  }
  if (keys.length === 0 || keys[0]!.startTick > 0) {
    findings.push({
      code: "KEY_COVERAGE_GAP",
      ruleVersion: "1.0.0",
      severity: "warning",
      domain: "key",
      confidence: 1,
      message: keys.length === 0
        ? "No key event declares the opening pitch context."
        : `The first key event begins at tick ${keys[0]!.startTick}, after the song starts.`,
      objectIds: keys.length > 0 ? [keys[0]!.id] : manifest.sections.slice(0, 64).map((section) => section.id),
      startTick: 0,
      endTick: keys[0]?.startTick ?? songEndTick,
      source: "manifest.harmony.key_changes",
      details: { first_key_tick: keys[0]?.startTick ?? -1 },
      suggestion: "Declare the opening tonal/modal context, or explicitly select a pitch-set/atonal policy.",
      repairKind: "harmony",
    });
  }

  let previousChord: (typeof chords)[number] | undefined;
  for (const chord of chords) {
    if (!chord.value.parsed || !chord.value.parsed.exact) {
      findings.push({
        code: "CHORD_SYMBOL_UNPARSED_STRICT",
        ruleVersion: "1.0.0",
        severity: chord.value.parsed ? "warning" : "error",
        domain: "harmony",
        confidence: chord.value.parsed ? 0.8 : 1,
        message: chord.value.parsed
          ? `Chord ${chord.id} contains unsupported token(s): ${chord.value.parsed.unsupportedTokens.join(", ")}.`
          : `Chord ${chord.id} cannot parse symbol ${chord.value.event.symbol}.`,
        objectIds: [chord.id],
        startTick: chord.startTick,
        endTick: chord.endTick,
        source: "manifest.harmony.chord_changes",
        details: {
          symbol: chord.value.event.symbol,
          exact: chord.value.parsed?.exact ?? false,
        },
        suggestion: "Use an exact supported chord symbol before relying on chord-tone or Roman-numeral evidence.",
        repairKind: "harmony",
      });
    }
    if (chord.startTick < 0 || chord.endTick > songEndTick) {
      findings.push({
        code: "CHORD_OUTSIDE_SONG",
        ruleVersion: "1.0.0",
        severity: "error",
        domain: "harmony",
        confidence: 1,
        message: `Chord ${chord.id} spans ${chord.startTick}..${chord.endTick}, outside 0..${songEndTick}.`,
        objectIds: [chord.id],
        startTick: Math.max(0, chord.startTick),
        endTick: chord.endTick,
        source: "manifest.harmony.chord_changes",
        details: { start_tick: chord.startTick, end_tick: chord.endTick, song_end_tick: songEndTick },
        suggestion: "Move/shorten the chord event or extend the semantic final section.",
        repairKind: "harmony",
      });
    }
    if (previousChord && chord.startTick < previousChord.endTick) {
      findings.push({
        code: "CHORD_TIMELINE_OVERLAP",
        ruleVersion: "1.0.0",
        severity: "error",
        domain: "harmony",
        confidence: 1,
        message: `Chord events ${previousChord.id} and ${chord.id} overlap.`,
        objectIds: [previousChord.id, chord.id],
        startTick: chord.startTick,
        endTick: Math.min(previousChord.endTick, chord.endTick),
        source: "manifest.harmony.chord_changes",
        details: { overlap_ticks: previousChord.endTick - chord.startTick },
        suggestion: "Shorten or move one chord event so the harmonic context is unambiguous.",
        repairKind: "harmony",
      });
    }
    if (!previousChord || chord.endTick > previousChord.endTick) previousChord = chord;

    const activeKey = theoryContextAtTick(index.timeline, chord.startTick).key?.value.parsed;
    if (chord.value.parsed?.exact && activeKey) {
      metrics.push(
        {
          id: `harmony.roman.${chord.id}`,
          domain: "harmony",
          value: romanNumeralForChord(chord.value.parsed, activeKey),
          unit: "roman_numeral",
          objectIds: [chord.id],
        },
        {
          id: `harmony.function.${chord.id}`,
          domain: "harmony",
          value: harmonicFunctionForChord(chord.value.parsed, activeKey),
          unit: "harmonic_function",
          objectIds: [chord.id],
        },
      );
    }
  }

  let coverageCursor = 0;
  for (const chord of chords) {
    if (chord.startTick - coverageCursor >= 480) {
      findings.push({
        code: "CHORD_COVERAGE_GAP",
        ruleVersion: "1.0.0",
        severity: "warning",
        domain: "harmony",
        confidence: 1,
        message: `No chord intent covers ticks ${coverageCursor}..${chord.startTick}.`,
        objectIds: [chord.id],
        startTick: coverageCursor,
        endTick: chord.startTick,
        source: "manifest.harmony.chord_changes",
        details: { gap_ticks: chord.startTick - coverageCursor },
        suggestion: "Declare the intended harmony or explicitly mark the passage as harmonically open.",
        repairKind: "harmony",
      });
    }
    coverageCursor = Math.max(coverageCursor, chord.endTick);
  }
  if (songEndTick - coverageCursor >= 480) {
    findings.push({
      code: "CHORD_COVERAGE_GAP",
      ruleVersion: "1.0.0",
      severity: "warning",
      domain: "harmony",
      confidence: 1,
      message: `No chord intent covers the final ticks ${coverageCursor}..${songEndTick}.`,
      objectIds: manifest.sections.slice(-64).map((section) => section.id),
      startTick: coverageCursor,
      endTick: songEndTick,
      source: "manifest.harmony.chord_changes",
      details: { gap_ticks: songEndTick - coverageCursor },
      suggestion: "Declare the final harmony/cadence or explicitly preserve an open ending.",
      repairKind: "harmony",
    });
  }
  metrics.push(
    {
      id: "harmony.chord_coverage",
      domain: "harmony",
      value: Number(clippedIntervalCoverage(chords, songEndTick).toFixed(6)),
      unit: "ratio",
      objectIds: chords.slice(0, 256).map((chord) => chord.id),
    },
    {
      id: "harmony.exact_parse_ratio",
      domain: "harmony",
      value: chords.length > 0
        ? Number((chords.filter((chord) => chord.value.parsed?.exact).length / chords.length).toFixed(6))
        : 0,
      unit: "ratio",
      objectIds: chords.slice(0, 256).map((chord) => chord.id),
    },
    {
      id: "harmony.mean_chord_duration",
      domain: "harmony",
      value: chords.length > 0
        ? Number((chords.reduce((sum, chord) => sum + chord.endTick - chord.startTick, 0) / chords.length).toFixed(4))
        : 0,
      unit: "ticks",
      objectIds: chords.slice(0, 256).map((chord) => chord.id),
    },
  );

  for (const [trackId, events] of index.vocalEventsByTrack) {
    for (const [eventIndex, event] of events.entries()) {
      const context = theoryContextAtTick(index.timeline, event.startTick);
      const chord = context.chord?.value.parsed;
      const next = events[eventIndex + 1];
      if (chord?.exact && !isChordTone(event.noteNumber, chord)
        && beatStrengthAtTick(manifest, event.startTick).strength >= 0.45
        && secondsBetweenTicks(index, event.startTick, event.endTick) >= 0.5
        && !resolvesToChordTone(index, event, next)) {
        findings.push({
          code: "SUSTAINED_NON_CHORD_TONE_UNRESOLVED",
          ruleVersion: "1.0.0",
          severity: "warning",
          domain: "harmony",
          confidence: 0.85,
          message: `${event.id} sustains a non-chord tone over ${context.chord!.value.event.symbol} without nearby stepwise resolution.`,
          objectIds: [trackId, event.partId, event.id, context.chord!.id],
          startTick: event.startTick,
          endTick: event.endTick,
          source: "symbolic vocal note and active chord timeline",
          details: {
            note_number: event.noteNumber,
            duration_ticks: event.duration,
            chord: context.chord!.value.event.symbol,
          },
          suggestion: "Prepare/resolve the color tone, shorten it, or preserve it with a phrase-specific intentional exception.",
          repairKind: "pitch",
        });
      }
      const scale = context.key?.value.parsed;
      if (!scale || scale.pitchClasses.length !== 7 || event.duration < 120) continue;
      const leadingTone = scale.pitchClasses[6]!;
      if (normalizePitchClass(event.noteNumber) !== leadingTone) continue;
      const resolvesToTonic = next !== undefined
        && next.startTick - event.endTick <= 240
        && normalizePitchClass(next.noteNumber) === scale.tonic.pitchClass;
      if (!resolvesToTonic) {
        findings.push({
          code: "LEADING_TONE_UNRESOLVED",
          ruleVersion: "1.0.0",
          severity: "warning",
          domain: "harmony",
          confidence: 0.8,
          message: `${event.id} presents the active scale's leading tone without a nearby tonic resolution.`,
          objectIds: [trackId, event.partId, event.id, context.key!.id],
          startTick: event.startTick,
          endTick: event.endTick,
          source: "symbolic vocal note and active key timeline",
          details: { note_number: event.noteNumber, tonic_pitch_class: scale.tonic.pitchClass },
          suggestion: "Resolve to tonic, weaken the metric placement, or document the deliberate suspended direction.",
          repairKind: "pitch",
        });
      }
    }
  }
  return { findings, metrics };
}
