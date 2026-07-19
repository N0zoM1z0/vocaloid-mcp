import type { SongManifest } from "./song-manifest.js";
import { buildSymbolicIndex, type SymbolicVocalEvent } from "./theory/events.js";


export interface PhraseGrammarFinding {
  code: string;
  severity: "warning" | "info";
  message: string;
  object_ids: string[];
  details: Record<string, string | number | boolean>;
  suggestion: string;
}

interface PhraseFeatures {
  phrase_id: string;
  section_id?: string;
  note_count: number;
  pitch_range_semitones: number;
  peak_position: number;
  repeated_pitch_ratio: number;
  stepwise_ratio: number;
  maximum_leap_semitones: number;
  maximum_consecutive_direction: number;
  start_signature: string;
  duration_fingerprint: string;
  contour: number[];
  grammar_blueprint_id?: string;
  grammar_component_ids: string[];
}

function gcd(left: number, right: number): number {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b > 0) [a, b] = [b, a % b];
  return Math.max(1, a);
}

function normalizedDurationFingerprint(events: readonly SymbolicVocalEvent[]): string {
  const values = events.map((event) => event.duration);
  const divisor = values.reduce((current, value) => gcd(current, value), values[0] ?? 1);
  return values.map((value) => Math.round(value / divisor)).join("-");
}

function resample(values: readonly number[], count = 32): number[] {
  if (values.length === 0) return [];
  if (values.length === 1) return new Array(count).fill(values[0]);
  return Array.from({ length: count }, (_, index) => {
    const position = (index * (values.length - 1)) / (count - 1);
    const lower = Math.floor(position);
    const fraction = position - lower;
    return values[lower]! * (1 - fraction) + values[Math.min(values.length - 1, lower + 1)]! * fraction;
  });
}

function correlation(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]! - leftMean;
    const b = right[index]! - rightMean;
    numerator += a * b;
    leftEnergy += a * a;
    rightEnergy += b * b;
  }
  return leftEnergy > 0 && rightEnergy > 0 ? numerator / Math.sqrt(leftEnergy * rightEnergy) : 0;
}

function maximumDirectionRun(intervals: readonly number[]): number {
  let maximum = 0;
  let run = 0;
  let previous = 0;
  for (const interval of intervals) {
    const direction = Math.sign(interval);
    if (direction === 0) {
      run = 0;
      previous = 0;
      continue;
    }
    run = direction === previous ? run + 1 : 1;
    previous = direction;
    maximum = Math.max(maximum, run);
  }
  return maximum;
}

function componentIds(blueprint: NonNullable<SongManifest["vocal_tracks"][number]["parts"][number]["phrases"][number]["grammar_blueprint"]>): string[] {
  return [
    blueprint.components.role,
    blueprint.components.entry,
    ...blueprint.components.contour,
    ...blueprint.components.rhythm,
    ...blueprint.components.motion,
    blueprint.components.cadence,
    blueprint.components.development,
    ...blueprint.components.allocation,
    ...blueprint.components.articulation,
    ...blueprint.components.space,
  ];
}

function phraseFeatures(
  phrase: SongManifest["vocal_tracks"][number]["parts"][number]["phrases"][number],
  events: readonly SymbolicVocalEvent[],
): PhraseFeatures | null {
  if (events.length === 0) return null;
  const ordered = [...events].sort((left, right) => left.startTick - right.startTick || left.id.localeCompare(right.id));
  const pitches = ordered.map((event) => event.noteNumber);
  const intervals = pitches.slice(1).map((pitch, index) => pitch - pitches[index]!);
  const maximum = Math.max(...pitches);
  const minimum = Math.min(...pitches);
  const repeated = intervals.filter((interval) => interval === 0).length;
  const stepwise = intervals.filter((interval) => Math.abs(interval) >= 1 && Math.abs(interval) <= 3).length;
  const denominator = Math.max(1, intervals.length);
  const blueprint = phrase.grammar_blueprint;
  return {
    phrase_id: phrase.id,
    ...(ordered[0]?.sectionId ? { section_id: ordered[0].sectionId } : {}),
    note_count: pitches.length,
    pitch_range_semitones: maximum - minimum,
    peak_position: pitches.length > 1 ? pitches.indexOf(maximum) / (pitches.length - 1) : 0,
    repeated_pitch_ratio: repeated / denominator,
    stepwise_ratio: stepwise / denominator,
    maximum_leap_semitones: intervals.length > 0 ? Math.max(...intervals.map((interval) => Math.abs(interval))) : 0,
    maximum_consecutive_direction: maximumDirectionRun(intervals),
    // Phrase containers begin at their scheduling boundary.  The audible
    // entry can be later because phrase cells may deliberately begin with
    // rests, so entry homogeneity must use the first materialized note.
    start_signature: `${ordered[0]!.position.beat}:${ordered[0]!.position.tick ?? 0}`,
    duration_fingerprint: normalizedDurationFingerprint(ordered),
    contour: resample(pitches),
    ...(blueprint ? { grammar_blueprint_id: blueprint.id } : {}),
    grammar_component_ids: blueprint ? componentIds(blueprint) : [],
  };
}

function largestSimilarityCluster(count: number, pairs: readonly { left: number; right: number; correlation: number }[], threshold: number): number {
  const adjacency = Array.from({ length: count }, () => new Set<number>());
  for (const pair of pairs) {
    if (pair.correlation >= threshold) {
      adjacency[pair.left]!.add(pair.right);
      adjacency[pair.right]!.add(pair.left);
    }
  }
  const seen = new Set<number>();
  let largest = 0;
  for (let start = 0; start < count; start += 1) {
    if (seen.has(start)) continue;
    const stack = [start];
    let size = 0;
    seen.add(start);
    while (stack.length > 0) {
      const current = stack.pop()!;
      size += 1;
      for (const neighbor of adjacency[current]!) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    largest = Math.max(largest, size);
  }
  return largest;
}

function ratioInRange(value: number, range: readonly [number, number] | undefined): boolean {
  return range === undefined || (value >= range[0] && value <= range[1]);
}

function blueprintFindings(
  phrase: SongManifest["vocal_tracks"][number]["parts"][number]["phrases"][number],
  features: PhraseFeatures,
): PhraseGrammarFinding[] {
  const blueprint = phrase.grammar_blueprint;
  if (!blueprint) return [];
  const findings: PhraseGrammarFinding[] = [];
  const checks: Array<{ metric: string; value: number; enabled: boolean; valid: boolean; expected: string }> = [
    {
      metric: "pitch_range_semitones",
      value: features.pitch_range_semitones,
      enabled: blueprint.limits.range_semitones !== undefined,
      valid: ratioInRange(features.pitch_range_semitones, blueprint.limits.range_semitones),
      expected: JSON.stringify(blueprint.limits.range_semitones ?? []),
    },
    {
      metric: "peak_position",
      value: features.peak_position,
      enabled: blueprint.limits.peak_window !== undefined,
      valid: ratioInRange(features.peak_position, blueprint.limits.peak_window),
      expected: JSON.stringify(blueprint.limits.peak_window ?? []),
    },
    {
      metric: "repeated_pitch_ratio",
      value: features.repeated_pitch_ratio,
      enabled: blueprint.limits.repeated_pitch_ratio !== undefined,
      valid: ratioInRange(features.repeated_pitch_ratio, blueprint.limits.repeated_pitch_ratio),
      expected: JSON.stringify(blueprint.limits.repeated_pitch_ratio ?? []),
    },
    {
      metric: "stepwise_ratio",
      value: features.stepwise_ratio,
      enabled: blueprint.limits.stepwise_ratio !== undefined,
      valid: ratioInRange(features.stepwise_ratio, blueprint.limits.stepwise_ratio),
      expected: JSON.stringify(blueprint.limits.stepwise_ratio ?? []),
    },
    {
      metric: "maximum_leap_semitones",
      value: features.maximum_leap_semitones,
      enabled: blueprint.limits.maximum_leap_semitones !== undefined,
      valid: blueprint.limits.maximum_leap_semitones === undefined
        || features.maximum_leap_semitones <= blueprint.limits.maximum_leap_semitones,
      expected: `<=${blueprint.limits.maximum_leap_semitones}`,
    },
    {
      metric: "maximum_consecutive_direction",
      value: features.maximum_consecutive_direction,
      enabled: blueprint.limits.maximum_consecutive_direction !== undefined,
      valid: blueprint.limits.maximum_consecutive_direction === undefined
        || features.maximum_consecutive_direction <= blueprint.limits.maximum_consecutive_direction,
      expected: `<=${blueprint.limits.maximum_consecutive_direction}`,
    },
  ];
  for (const check of checks) {
    if (check.enabled && !check.valid) {
      findings.push({
        code: "GRAMMAR_LIMIT_MISMATCH",
        severity: "warning",
        message: `${phrase.id} has ${check.metric}=${check.value.toFixed(4)}, outside blueprint ${check.expected}.`,
        object_ids: [phrase.id, blueprint.id],
        details: { metric: check.metric, observed: Number(check.value.toFixed(6)), expected: check.expected },
        suggestion: "Revise the notes or revise the explicit blueprint limit; do not silently claim the selected grammar was materialized.",
      });
    }
  }
  return findings;
}

export interface AnalyzePhraseGrammarOptions {
  trackId?: string;
  maximumPairExamples?: number;
}

export function analyzeManifestPhraseGrammar(manifest: SongManifest, options: AnalyzePhraseGrammarOptions = {}) {
  const index = buildSymbolicIndex(manifest);
  const tracks = [];
  const allFindings: PhraseGrammarFinding[] = [];
  for (const track of manifest.vocal_tracks) {
    if (options.trackId && track.id !== options.trackId) continue;
    const eventByPhrase = new Map<string, SymbolicVocalEvent[]>();
    for (const event of index.vocalEventsByTrack.get(track.id) ?? []) {
      if (!event.phraseId) continue;
      const selected = eventByPhrase.get(event.phraseId) ?? [];
      selected.push(event);
      eventByPhrase.set(event.phraseId, selected);
    }
    const phraseObjects = track.parts.flatMap((part) => part.phrases);
    const phraseById = new Map(phraseObjects.map((phrase) => [phrase.id, phrase]));
    const phrases = phraseObjects.map((phrase) => phraseFeatures(phrase, eventByPhrase.get(phrase.id) ?? [])).filter((value): value is PhraseFeatures => value !== null);
    const pairs: Array<{ left: number; right: number; correlation: number }> = [];
    for (let left = 0; left < phrases.length; left += 1) {
      for (let right = left + 1; right < phrases.length; right += 1) {
        pairs.push({ left, right, correlation: correlation(phrases[left]!.contour, phrases[right]!.contour) });
      }
    }
    const intervalCount = phrases.reduce((sum, phrase) => sum + Math.max(0, phrase.note_count - 1), 0);
    const weightedStepwise = phrases.reduce((sum, phrase) => sum + phrase.stepwise_ratio * Math.max(0, phrase.note_count - 1), 0);
    const weightedRepeated = phrases.reduce((sum, phrase) => sum + phrase.repeated_pitch_ratio * Math.max(0, phrase.note_count - 1), 0);
    const stepwiseRatio = intervalCount > 0 ? weightedStepwise / intervalCount : 0;
    const repeatedRatio = intervalCount > 0 ? weightedRepeated / intervalCount : 0;
    const startCounts = new Map<string, number>();
    const rhythmCounts = new Map<string, number>();
    const peakCounts = new Map<string, number>();
    for (const phrase of phrases) {
      startCounts.set(phrase.start_signature, (startCounts.get(phrase.start_signature) ?? 0) + 1);
      rhythmCounts.set(phrase.duration_fingerprint, (rhythmCounts.get(phrase.duration_fingerprint) ?? 0) + 1);
      const bin = phrase.peak_position < 1 / 3 ? "early" : phrase.peak_position < 2 / 3 ? "middle" : "late";
      peakCounts.set(bin, (peakCounts.get(bin) ?? 0) + 1);
      const source = phraseById.get(phrase.phrase_id);
      if (source) allFindings.push(...blueprintFindings(source, phrase));
    }
    const dominantStart = Math.max(0, ...startCounts.values());
    const dominantPeak = Math.max(0, ...peakCounts.values());
    const largestCluster = largestSimilarityCluster(phrases.length, pairs, 0.88);
    const trackFindings: PhraseGrammarFinding[] = [];
    if (phrases.length >= 6 && dominantStart / phrases.length >= 0.8) {
      trackFindings.push({
        code: "PHRASE_ENTRY_HOMOGENEITY",
        severity: "warning",
        message: `${dominantStart}/${phrases.length} phrases on ${track.id} share the same beat:tick entry position.`,
        object_ids: [track.id],
        details: { phrase_count: phrases.length, dominant_entry_ratio: Number((dominantStart / phrases.length).toFixed(6)) },
        suggestion: "Select entry.downbeat only where firmness is needed; consider pickup or delayed-entry components for contrasting phrase roles.",
      });
    }
    if (phrases.length >= 6 && stepwiseRatio > 0.9 && repeatedRatio < 0.08) {
      trackFindings.push({
        code: "PHRASE_MOTION_OVERCONCENTRATED",
        severity: "warning",
        message: `${(stepwiseRatio * 100).toFixed(1)}% of adjacent motion on ${track.id} is 1–3 semitone stepwise motion while only ${(repeatedRatio * 100).toFixed(1)}% repeats pitch.`,
        object_ids: [track.id],
        details: { stepwise_ratio: Number(stepwiseRatio.toFixed(6)), repeated_pitch_ratio: Number(repeatedRatio.toFixed(6)) },
        suggestion: "Keep stepwise singability, but assign selected phrases repeated-tone, pentatonic-gap, chord-outline, or one prepared leap-recovery motion.",
      });
    }
    if (phrases.length >= 6 && largestCluster / phrases.length >= 0.5) {
      trackFindings.push({
        code: "PHRASE_CONTOUR_CLUSTER_HIGH",
        severity: "warning",
        message: `${largestCluster}/${phrases.length} phrases on ${track.id} belong to one >=0.88 normalized-contour similarity cluster.`,
        object_ids: [track.id],
        details: { phrase_count: phrases.length, cluster_size: largestCluster, cluster_ratio: Number((largestCluster / phrases.length).toFixed(6)) },
        suggestion: "Preserve intentional hook returns, but give neighboring formal roles different contour archetypes or asymmetrical peak windows.",
      });
    }
    if (phrases.length >= 6 && dominantPeak / phrases.length >= 0.65) {
      trackFindings.push({
        code: "PHRASE_PEAK_POSITION_CONCENTRATED",
        severity: "warning",
        message: `${dominantPeak}/${phrases.length} phrases on ${track.id} place their first maximum in the same early/middle/late third.`,
        object_ids: [track.id],
        details: { dominant_peak_ratio: Number((dominantPeak / phrases.length).toFixed(6)) },
        suggestion: "Choose early-peak, plateau, level, valley, or leap-hold-release only where the phrase role calls for it; do not default every focus to a late peak.",
      });
    }
    if (phrases.length >= 6 && rhythmCounts.size <= Math.max(2, Math.floor(phrases.length / 4))) {
      trackFindings.push({
        code: "PHRASE_RHYTHM_FINGERPRINT_NARROW",
        severity: "warning",
        message: `${phrases.length} phrases on ${track.id} use only ${rhythmCounts.size} normalized duration fingerprints.`,
        object_ids: [track.id],
        details: { phrase_count: phrases.length, distinct_rhythm_fingerprints: rhythmCounts.size },
        suggestion: "Vary pickup, held-vowel, syncopated-tie, sparse-breath, acceleration, or sustained-tail plans before changing pitches at random.",
      });
    }
    allFindings.push(...trackFindings);
    const pairExamples = pairs
      .sort((left, right) => right.correlation - left.correlation)
      .slice(0, options.maximumPairExamples ?? 12)
      .map((pair) => ({
        phrase_a: phrases[pair.left]!.phrase_id,
        phrase_b: phrases[pair.right]!.phrase_id,
        contour_correlation: Number(pair.correlation.toFixed(6)),
      }));
    tracks.push({
      track_id: track.id,
      phrase_count: phrases.length,
      blueprint_count: phrases.filter((phrase) => phrase.grammar_blueprint_id !== undefined).length,
      metrics: {
        stepwise_ratio: Number(stepwiseRatio.toFixed(6)),
        repeated_pitch_ratio: Number(repeatedRatio.toFixed(6)),
        distinct_entry_positions: startCounts.size,
        distinct_rhythm_fingerprints: rhythmCounts.size,
        largest_contour_cluster: largestCluster,
        largest_contour_cluster_ratio: phrases.length > 0 ? Number((largestCluster / phrases.length).toFixed(6)) : 0,
        peak_position_bins: Object.fromEntries([...peakCounts.entries()].sort()),
      },
      phrase_metrics: phrases.map(({ contour: _contour, ...phrase }) => phrase),
      most_similar_pairs: pairExamples,
      findings: trackFindings,
    });
  }
  if (options.trackId && tracks.length === 0) throw new Error(`Manifest has no vocal track ${options.trackId}`);
  const warningCount = allFindings.filter((finding) => finding.severity === "warning").length;
  return {
    schema: "vocaloid-phrase-grammar-analysis/v1" as const,
    composition_hash: manifest.composition_hash,
    summary: {
      tracks: tracks.length,
      phrases: tracks.reduce((sum, track) => sum + track.phrase_count, 0),
      blueprints: tracks.reduce((sum, track) => sum + track.blueprint_count, 0),
      warnings: warningCount,
      infos: allFindings.length - warningCount,
    },
    tracks,
    findings: allFindings,
    boundary: {
      mutates_manifest: false,
      generates_notes: false,
      corpus_access: false,
      automatic_repair: false,
      listening_required: true,
    },
  };
}
