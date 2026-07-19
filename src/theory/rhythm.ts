import type { SongManifest } from "../song-manifest.js";
import { musicalTickToPosition } from "../vsqx.js";
import type { DomainAnalysis, SymbolicIndex } from "./events.js";
import { timelineTick } from "./timeline.js";


export interface BeatStrength {
  strength: number;
  role: "downbeat" | "group" | "beat" | "subdivision";
  beat: number;
  tickWithinBeat: number;
}

export function beatStrengthAtTick(manifest: SongManifest, targetTick: number): BeatStrength {
  const position = musicalTickToPosition(manifest.time_signatures, targetTick);
  const signature = [...manifest.time_signatures]
    .reverse()
    .find((candidate) => candidate.measure <= position.measure)!;
  const ticksPerBeat = (480 * 4) / signature.denominator;
  const tickWithinBeat = position.tick ?? 0;
  if (tickWithinBeat > 0) {
    return { strength: tickWithinBeat === ticksPerBeat / 2 ? 0.3 : 0.15, role: "subdivision", beat: position.beat, tickWithinBeat };
  }
  if (position.beat === 0) return { strength: 1, role: "downbeat", beat: position.beat, tickWithinBeat };
  const compound = signature.numerator > 3 && signature.numerator % 3 === 0 && signature.denominator >= 8;
  if (compound && position.beat % 3 === 0) {
    return { strength: 0.75, role: "group", beat: position.beat, tickWithinBeat };
  }
  if (!compound && signature.numerator >= 4 && position.beat === Math.floor(signature.numerator / 2)) {
    return { strength: 0.65, role: "group", beat: position.beat, tickWithinBeat };
  }
  return { strength: 0.45, role: "beat", beat: position.beat, tickWithinBeat };
}

export function analyzeRhythm(manifest: SongManifest, index: SymbolicIndex): DomainAnalysis {
  const findings: DomainAnalysis["findings"] = [];
  const metrics: DomainAnalysis["metrics"] = [];
  for (const [trackId, events] of index.vocalEventsByTrack) {
    if (events.length === 0) continue;
    const syncopated = events.filter((event) => beatStrengthAtTick(manifest, event.startTick).strength < 0.45).length;
    metrics.push({
      id: `rhythm.syncopation.${trackId}`,
      domain: "rhythm",
      value: Number((syncopated / events.length).toFixed(6)),
      unit: "ratio",
      objectIds: [trackId],
    });
  }
  for (const track of manifest.accompaniment.tracks) {
    const events = track.kind === "pitched"
      ? index.arrangementEventsByTrack.get(track.id) ?? []
      : index.drumEventsByTrack.get(track.id) ?? [];
    if (events.length === 0) continue;
    const syncopated = events.filter((event) => beatStrengthAtTick(manifest, event.startTick).strength < 0.45).length;
    metrics.push(
      {
        id: `rhythm.syncopation.${track.id}`,
        domain: "rhythm",
        value: Number((syncopated / events.length).toFixed(6)),
        unit: "ratio",
        objectIds: [track.id],
      },
      {
        id: `rhythm.onset_density.${track.id}`,
        domain: "rhythm",
        value: index.timeline.songEndTick > 0
          ? Number((events.length / (index.timeline.songEndTick / 480)).toFixed(6))
          : 0,
        unit: "onsets_per_quarter",
        objectIds: [track.id],
      },
    );
  }
  for (const track of manifest.accompaniment.tracks) {
    for (const placement of track.placements) {
      const pattern = track.patterns.find((candidate) => candidate.id === placement.pattern_id);
      if (!pattern) continue;
      const startMeasure = placement.start.measure;
      const endMeasure = startMeasure + pattern.measures * placement.repeats;
      const changes = manifest.time_signatures.filter((signature) =>
        signature.measure > startMeasure && signature.measure < endMeasure);
      if (changes.length === 0) continue;
      findings.push({
        code: "PATTERN_METER_MISMATCH",
        ruleVersion: "1.0.0",
        severity: "warning",
        domain: "rhythm",
        confidence: 1,
        message: `Placement ${placement.id} repeats ${pattern.id} across a meter change without an explicit variant.`,
        objectIds: [track.id, pattern.id, placement.id],
        startTick: timelineTick(manifest, placement.start),
        source: "manifest.accompaniment.tracks[].placements",
        details: { meter_changes: changes.length, end_measure: endMeasure },
        suggestion: "Split the placement at the meter boundary and use a meter-specific pattern variant.",
        repairKind: "rhythm",
      });
    }
  }
  return { findings, metrics };
}
