import { VOCALOID3_JAPANESE_PHONEMES } from "./japanese.js";
import { isChordTone, parseChordSymbol } from "./harmony.js";
import { analyzeCompositionIntent } from "./intent/analyze.js";
import type { CreativeReadinessReport } from "./intent/report-types.js";
import { resolveReadablePath } from "./paths.js";
import {
  fileSha256,
  currentMixArtifactIds,
  loadSongManifest,
  manifestExpectedVocalEvents,
  type ManifestArtifact,
  type SongManifest,
} from "./song-manifest.js";
import { analyzeManifestTheory } from "./theory/analyze.js";
import {
  proposeTheoryRepairs,
  type TheoryProposalOptionsInput,
  type TheoryProposalReport,
} from "./theory/proposals.js";
import {
  evaluateReleasePolicy,
  type ReleasePolicyGate,
} from "./theory/policy.js";
import { theoryFindingBlocks } from "./theory/rules.js";
import type { CandidateRepair, TheoryEvidence, TheoryIssue, TheoryReport } from "./theory/types.js";
import { musicalPositionToTick, type MusicalPosition } from "./vsqx.js";


export type PreflightSeverity = "error" | "warning" | "info";
export type PreflightDomain =
  | "structure"
  | "form"
  | "timeline"
  | "key"
  | "vocal"
  | "phoneme"
  | "performance"
  | "harmony"
  | "melody"
  | "rhythm"
  | "note_allocation"
  | "voice_leading"
  | "arrangement"
  | "mix"
  | "artifact"
  | "host"
  | "policy";

export interface SongPreflightIssue {
  origin: "workflow" | "theory";
  code: string;
  severity: PreflightSeverity;
  domain: PreflightDomain;
  message: string;
  objectIds: string[];
  position?: MusicalPosition;
  endPosition?: MusicalPosition;
  suggestedAction: string;
  ruleVersion?: string;
  confidence?: number;
  targetFingerprint?: string;
  evidence?: TheoryEvidence[];
  suggestedRepairs?: CandidateRepair[];
}

export interface ReadinessGate {
  ready: boolean;
  blockers: string[];
}

export interface SongPreflightResult {
  path: string;
  revision: number;
  compositionHash: string;
  mixHash: string;
  songEndTick: number;
  counts: {
    sections: number;
    vocalTracks: number;
    vocalParts: number;
    vocalEvents: number;
    arrangementTracks: number;
    artifacts: number;
    errors: number;
    warnings: number;
    infos: number;
    theoryIssues: number;
    creativeFindings: number;
  };
  readiness: {
    score: ReadinessGate;
    build: ReadinessGate;
    render: ReadinessGate;
    mix: ReadinessGate;
    delivery: ReadinessGate;
  };
  theory: TheoryReport;
  theoryProposals?: TheoryProposalReport;
  creativeReadiness: CreativeReadinessReport;
  releasePolicy: ReleasePolicyGate;
  checkedArtifactIds: string[];
  issues: SongPreflightIssue[];
}

export interface SongPreflightOptions {
  artifactCheck: "none" | "current" | "all";
  includePerformanceWarnings: boolean;
  verifiedVoiceComponentIds?: ReadonlySet<string>;
  theoryProposalOptions?: TheoryProposalOptionsInput;
}

const JAPANESE_PHONEMES = new Set<string>([
  ...VOCALOID3_JAPANESE_PHONEMES,
  "-",
]);

function tick(manifest: SongManifest, position: MusicalPosition): number {
  return musicalPositionToTick(manifest.time_signatures, position);
}

function issue(
  code: string,
  severity: PreflightSeverity,
  domain: PreflightDomain,
  message: string,
  objectIds: string[],
  suggestedAction: string,
  position?: MusicalPosition,
): SongPreflightIssue {
  return {
    origin: "workflow",
    code,
    severity,
    domain,
    message,
    objectIds,
    ...(position ? { position } : {}),
    suggestedAction,
  };
}

function theoryPreflightIssue(entry: TheoryIssue): SongPreflightIssue {
  return {
    origin: "theory",
    code: entry.code,
    severity: entry.severity,
    domain: entry.domain,
    message: entry.message,
    objectIds: entry.objectIds,
    ...(entry.position ? { position: entry.position } : {}),
    ...(entry.endPosition ? { endPosition: entry.endPosition } : {}),
    suggestedAction: entry.suggestedRepairs[0]?.summary
      ?? "Review the exact symbolic evidence and either revise the score or preserve the choice through the later exception workflow.",
    ruleVersion: entry.ruleVersion,
    confidence: entry.confidence,
    targetFingerprint: entry.targetFingerprint,
    evidence: entry.evidence,
    suggestedRepairs: entry.suggestedRepairs,
  };
}

function allStableIds(manifest: SongManifest): Set<string> {
  const ids = new Set<string>([manifest.song_id, ...manifest.sections.map((entry) => entry.id)]);
  for (const sectionIntent of manifest.composition_intent?.sections ?? []) ids.add(sectionIntent.id);
  for (const direction of manifest.composition_intent?.phrase_directions ?? []) {
    ids.add(direction.id);
    ids.add(direction.listening_question.id);
  }
  for (const entry of manifest.harmony.key_changes) ids.add(entry.id);
  for (const entry of manifest.harmony.chord_changes) ids.add(entry.id);
  for (const voice of manifest.voices) ids.add(voice.id);
  for (const track of manifest.vocal_tracks) {
    ids.add(track.id);
    for (const part of track.parts) {
      ids.add(part.id);
      for (const note of part.notes) ids.add(note.id);
      for (const phrase of part.phrases) {
        ids.add(phrase.id);
        for (const lyric of phrase.lyrics) ids.add(lyric.id);
        for (const cell of phrase.cells) ids.add(cell.id);
      }
      for (const curve of part.control_curves) {
        ids.add(curve.id);
        for (const point of curve.points) ids.add(point.id);
      }
      for (const gesture of part.tuning_gestures ?? []) ids.add(gesture.id);
    }
  }
  for (const track of manifest.accompaniment.tracks) {
    ids.add(track.id);
    if (track.kind === "pitched") {
      for (const note of track.notes) ids.add(note.id);
      for (const pattern of track.patterns) {
        ids.add(pattern.id);
        for (const note of pattern.notes) ids.add(note.id);
      }
    } else {
      for (const hit of track.hits) ids.add(hit.id);
      for (const pattern of track.patterns) {
        ids.add(pattern.id);
        for (const hit of pattern.hits) ids.add(hit.id);
      }
    }
    for (const placement of track.placements) ids.add(placement.id);
  }
  for (const chain of manifest.mix.effect_chains) {
    ids.add(chain.id);
    for (const effect of chain.effects) ids.add(effect.id);
  }
  for (const dynamic of manifest.mix.section_dynamics) ids.add(dynamic.id);
  for (const artifact of manifest.artifacts) ids.add(artifact.id);
  ids.add("mix-bus");
  return ids;
}

function tickSeconds(manifest: SongManifest, targetTick: number): number {
  const tempos = manifest.tempos.map((tempo) => ({ tick: tick(manifest, tempo.position), bpm: tempo.bpm }));
  let seconds = 0;
  let currentTick = 0;
  let tempoIndex = 0;
  while (currentTick < targetTick) {
    const active = tempos[tempoIndex]!;
    const next = tempos[tempoIndex + 1];
    const segmentEnd = Math.min(targetTick, next?.tick ?? targetTick);
    seconds += ((segmentEnd - currentTick) * 60) / (480 * active.bpm);
    currentTick = segmentEnd;
    if (next && currentTick >= next.tick) tempoIndex += 1;
  }
  return seconds;
}

function addVocalIssues(
  manifest: SongManifest,
  issues: SongPreflightIssue[],
  includePerformanceWarnings: boolean,
): number {
  let vocalEvents = 0;
  for (const track of manifest.vocal_tracks) {
    for (const part of track.parts) {
      for (const note of part.notes) {
        if (!note.phoneme_locked) {
          issues.push(issue(
            "PHONEME_UNLOCKED",
            "warning",
            "phoneme",
            `Direct vocal event ${note.id} is not phoneme-locked.`,
            [track.id, part.id, note.id],
            "Lock the explicitly reviewed pronunciation before unattended render, or document why Editor re-pronunciation is desired.",
            note.position,
          ));
        }
      }
      for (const phrase of part.phrases) for (const cell of phrase.cells) {
        if (!cell.rest && cell.phoneme_locked === false) {
          issues.push(issue(
            "PHONEME_UNLOCKED",
            "warning",
            "phoneme",
            `Phrase cell ${cell.id} explicitly disables phoneme locking.`,
            [track.id, part.id, phrase.id, cell.id],
            "Lock the reviewed phrase-cell pronunciation before unattended render.",
          ));
        }
      }
    }
    const orderedParts = [...track.parts].sort((left, right) => tick(manifest, left.start) - tick(manifest, right.start));
    for (let index = 1; index < orderedParts.length; index += 1) {
      const previous = orderedParts[index - 1]!;
      const current = orderedParts[index]!;
      if (tick(manifest, previous.end) > tick(manifest, current.start)) {
        issues.push(issue(
          "PART_OVERLAP",
          "error",
          "vocal",
          `Vocal parts ${previous.id} and ${current.id} overlap on track ${track.id}.`,
          [track.id, previous.id, current.id],
          "Move or shorten one part before build/render.",
          current.start,
        ));
      }
    }

    const events = manifestExpectedVocalEvents(manifest, track.id);
    vocalEvents += events.length;
    const eventsByPart = new Map<string, typeof events>();
    for (const event of events) {
      const selected = eventsByPart.get(event.partId) ?? [];
      selected.push(event);
      eventsByPart.set(event.partId, selected);
      const unknown = event.phonemes.split(/\s+/u).filter(Boolean)
        .filter((token) => !JAPANESE_PHONEMES.has(token));
      if (unknown.length > 0) {
        issues.push(issue(
          "PHONEME_OUTSIDE_JAPANESE_INVENTORY",
          "warning",
          "phoneme",
          `Event ${event.id} uses phoneme token(s) not in the bundled V3 Japanese inventory: ${unknown.join(", ")}.`,
          [track.id, event.partId, event.id],
          "Confirm the selected voice language and audition; do not silently replace explicit phonemes.",
          event.position,
        ));
      }
      if (includePerformanceWarnings && (event.noteNumber < 48 || event.noteNumber > 84)) {
        issues.push(issue(
          "VOCAL_EXTREME_RANGE",
          "warning",
          "performance",
          `Event ${event.id} is MIDI ${event.noteNumber}, outside the conservative C3-C6 IA_ROCKS working range.`,
          [track.id, event.partId, event.id],
          "Audition the register or transpose the phrase; this is a warning, not an automatic rewrite.",
          event.position,
        ));
      }
      const startTick = tick(manifest, event.position);
      const durationMilliseconds = (tickSeconds(manifest, startTick + event.duration)
        - tickSeconds(manifest, startTick)) * 1000;
      if (includePerformanceWarnings && durationMilliseconds < 65) {
        issues.push(issue(
          "RAPID_VOCAL_EVENT",
          "warning",
          "performance",
          `Event ${event.id} is only ${durationMilliseconds.toFixed(1)} ms; consonant identity may be unresolved.`,
          [track.id, event.partId, event.id],
          "Keep only when stylistically intentional, then verify with an isolated section render.",
          event.position,
        ));
      }
    }
    for (const [partId, partEvents] of eventsByPart) {
      partEvents.sort((left, right) => tick(manifest, left.position) - tick(manifest, right.position));
      for (let index = 1; index < partEvents.length; index += 1) {
        const previous = partEvents[index - 1]!;
        const current = partEvents[index]!;
        const previousEnd = tick(manifest, previous.position) + previous.duration;
        const currentStart = tick(manifest, current.position);
        if (previousEnd > currentStart) {
          issues.push(issue(
            "VOCAL_EVENT_OVERLAP",
            "error",
            "vocal",
            `Events ${previous.id} and ${current.id} overlap inside vocal part ${partId}.`,
            [track.id, partId, previous.id, current.id],
            "Shorten, move, or remove one event; direct notes and compiled phrase cells share one native lane.",
            current.position,
          ));
        }
      }
      if (includePerformanceWarnings && partEvents.length > 1) {
        let runStart = partEvents[0]!;
        let runEndTick = tick(manifest, runStart.position) + runStart.duration;
        for (let index = 1; index <= partEvents.length; index += 1) {
          const current = partEvents[index];
          const currentStart = current ? tick(manifest, current.position) : Number.POSITIVE_INFINITY;
          if (current && currentStart - runEndTick < 120) {
            runEndTick = Math.max(runEndTick, currentStart + current.duration);
            continue;
          }
          const runStartTick = tick(manifest, runStart.position);
          const runSeconds = tickSeconds(manifest, runEndTick) - tickSeconds(manifest, runStartTick);
          if (runSeconds > 12) {
            issues.push(issue(
              "LONG_UNBROKEN_VOCAL_RUN",
              "warning",
              "performance",
              `Vocal part ${partId} contains a ${runSeconds.toFixed(1)} s run without a clear breath gap.`,
              [track.id, partId],
              "Consider a rest/breath opportunity or intentionally mark the phrase for close audition.",
              runStart.position,
            ));
          }
          if (current) {
            runStart = current;
            runEndTick = currentStart + current.duration;
          }
        }
      }
    }
    if (includePerformanceWarnings && events.length > 1) {
      const ordered = [...events].sort((left, right) => tick(manifest, left.position) - tick(manifest, right.position));
      let extremeRangeEvents = 0;
      let weightedTicks = 0;
      let extremeTicks = 0;
      let lastDensityIssueSecond = Number.NEGATIVE_INFINITY;
      let densityStart = 0;
      for (const [index, event] of ordered.entries()) {
        weightedTicks += event.duration;
        if (event.noteNumber < 52 || event.noteNumber > 79) {
          extremeRangeEvents += 1;
          extremeTicks += event.duration;
        }
        const previous = ordered[index - 1];
        if (previous) {
          const previousEnd = tick(manifest, previous.position) + previous.duration;
          const gap = tick(manifest, event.position) - previousEnd;
          const leap = Math.abs(event.noteNumber - previous.noteNumber);
          if (leap > 12 && gap < 480) {
            issues.push(issue(
              "EXTREME_MELODIC_LEAP",
              "warning",
              "performance",
              `Events ${previous.id}→${event.id} leap ${leap} semitones with only ${Math.max(0, gap)} ticks of preparation.`,
              [track.id, previous.partId, previous.id, event.id],
              "Keep the leap only when expressive; otherwise change register, add a preparation tone/rest, or audition the isolated section.",
              event.position,
            ));
          }
        }
        const startSecond = tickSeconds(manifest, tick(manifest, event.position));
        while (densityStart < index) {
          const candidateSecond = tickSeconds(manifest, tick(manifest, ordered[densityStart]!.position));
          if (startSecond - candidateSecond <= 1) break;
          densityStart += 1;
        }
        const eventsPerSecond = index - densityStart + 1;
        if (eventsPerSecond >= 11 && startSecond - lastDensityIssueSecond >= 1) {
          lastDensityIssueSecond = startSecond;
          issues.push(issue(
            "HIGH_MORA_DENSITY",
            "warning",
            "performance",
            `${eventsPerSecond} voiced events begin within one second near ${startSecond.toFixed(2)} s on ${track.id}.`,
            [track.id, ...ordered.slice(densityStart, index + 1).map((entry) => entry.id)],
            "Check consonant identity in a section preview; alternate dense cells with rests/held vowels instead of globally slowing the song.",
            event.position,
          ));
        }
        const firstPhoneme = event.phonemes.split(/\s+/u).find(Boolean) ?? "";
        const beginsWithConsonant = !["a", "i", "M", "e", "o", "N", "-"].includes(firstPhoneme);
        const startTick = tick(manifest, event.position);
        const eventMilliseconds = (tickSeconds(manifest, startTick + event.duration)
          - tickSeconds(manifest, startTick)) * 1000;
        if (beginsWithConsonant && eventMilliseconds < 95) {
          issues.push(issue(
            "CONSONANT_COLLISION_RISK",
            "warning",
            "performance",
            `Consonant-led event ${event.id} (${firstPhoneme}) has only ${eventMilliseconds.toFixed(1)} ms.`,
            [track.id, event.partId, event.id],
            "Audition diction; consider reallocating duration from a neighboring vowel while preserving the intended rhythm.",
            event.position,
          ));
        }
      }
      if (weightedTicks > 0 && extremeTicks / weightedTicks > 0.35) {
        issues.push(issue(
          "VOCAL_TESSITURA_STRAIN",
          "warning",
          "performance",
          `${extremeRangeEvents}/${ordered.length} events and ${((extremeTicks / weightedTicks) * 100).toFixed(1)}% of voiced ticks lie outside E3–G5 on ${track.id}.`,
          [track.id],
          "Review the sustained tessitura, not only isolated extrema; transpose or redistribute harmony where appropriate.",
        ));
      }
    }
  }
  return vocalEvents;
}

function addHarmonyIssues(
  manifest: SongManifest,
  issues: SongPreflightIssue[],
  includePerformanceWarnings: boolean,
): void {
  const chords = manifest.harmony.chord_changes.map((chord) => ({
    chord,
    start: tick(manifest, chord.position),
    end: tick(manifest, chord.position) + chord.duration_ticks,
    parsed: parseChordSymbol(chord.symbol),
  }));
  for (const entry of chords) {
    if (!entry.parsed) {
      issues.push(issue(
        "CHORD_SYMBOL_UNPARSED",
        "warning",
        "harmony",
        `Chord ${entry.chord.id} uses unsupported symbol ${entry.chord.symbol}.`,
        [entry.chord.id],
        "Use a conventional root/quality/slash symbol or treat harmony annotations as unavailable for this event.",
        entry.chord.position,
      ));
    } else if (entry.parsed.unsupportedExtensions.length > 0) {
      issues.push(issue(
        "CHORD_EXTENSION_PARTIAL",
        "info",
        "harmony",
        `Chord ${entry.chord.id} was parsed with unsupported token(s): ${entry.parsed.unsupportedExtensions.join(", ")}.`,
        [entry.chord.id],
        "Confirm pitch-class interpretation before using chord-tone annotations as a compositional constraint.",
        entry.chord.position,
      ));
    }
  }
  if (!includePerformanceWarnings || chords.length === 0) return;
  const byTrack = manifest.vocal_tracks.map((track) => ({
    track,
    events: manifestExpectedVocalEvents(manifest, track.id),
  }));
  for (const { track, events } of byTrack) for (const event of events) {
    const start = tick(manifest, event.position);
    const chord = chords.find((entry) => start >= entry.start && start < entry.end && entry.parsed);
    if (!chord?.parsed || isChordTone(event.noteNumber, chord.parsed)) continue;
    const durationSeconds = tickSeconds(manifest, start + event.duration) - tickSeconds(manifest, start);
    if (durationSeconds >= 0.65) {
      issues.push(issue(
        "SUSTAINED_NON_CHORD_TONE",
        "info",
        "harmony",
        `Event ${event.id} sustains a non-chord pitch for ${durationSeconds.toFixed(2)} s over ${chord.chord.symbol}.`,
        [track.id, event.partId, event.id, chord.chord.id],
        "This may be an intentional suspension/color tone; verify its preparation and resolution rather than auto-correcting it.",
        event.position,
      ));
    }
  }
  for (let leftIndex = 0; leftIndex < byTrack.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < byTrack.length; rightIndex += 1) {
      const left = byTrack[leftIndex]!;
      const right = byTrack[rightIndex]!;
      let rightStartIndex = 0;
      for (const leftEvent of left.events) {
        const leftStart = tick(manifest, leftEvent.position);
        const leftEnd = leftStart + leftEvent.duration;
        while (rightStartIndex < right.events.length) {
          const candidate = right.events[rightStartIndex]!;
          if (tick(manifest, candidate.position) + candidate.duration > leftStart) break;
          rightStartIndex += 1;
        }
        for (let index = rightStartIndex; index < right.events.length; index += 1) {
          const rightEvent = right.events[index]!;
          const rightStart = tick(manifest, rightEvent.position);
          if (rightStart >= leftEnd) break;
          const interval = Math.abs(leftEvent.noteNumber - rightEvent.noteNumber) % 12;
          if (interval === 1 || interval === 11) {
            issues.push(issue(
              "VOCAL_HARMONY_MINOR_SECOND",
              "warning",
              "harmony",
              `Simultaneous events ${leftEvent.id}/${rightEvent.id} form a minor second between ${left.track.id} and ${right.track.id}.`,
              [left.track.id, right.track.id, leftEvent.id, rightEvent.id],
              "Keep only as an intentional clash; otherwise revise voicing/octave or shorten the overlap.",
              rightEvent.position,
            ));
          }
        }
      }
    }
  }
}

function addArrangementIssues(manifest: SongManifest, songEndTick: number, issues: SongPreflightIssue[]): void {
  for (const track of manifest.accompaniment.tracks) {
    if (track.kind === "pitched") {
      for (const note of track.notes) {
        const start = tick(manifest, note.position);
        if (start + note.duration > songEndTick) {
          issues.push(issue(
            "ARRANGEMENT_EVENT_PAST_SONG_END",
            "error",
            "arrangement",
            `Instrument note ${note.id} extends past the semantic song end.`,
            [track.id, note.id],
            "Shorten the note or extend the final section explicitly.",
            note.position,
          ));
        }
      }
      for (const pattern of track.patterns) {
        const patternEnd = tick(manifest, { measure: pattern.measures, beat: 0, tick: 0 });
        for (const note of pattern.notes) {
          const start = tick(manifest, note.offset);
          if (start + note.duration > patternEnd) {
            issues.push(issue(
              "PATTERN_EVENT_OUT_OF_BOUNDS",
              "error",
              "arrangement",
              `Pattern note ${note.id} extends past ${pattern.id}'s ${pattern.measures}-measure boundary.`,
              [track.id, pattern.id, note.id],
              "Move/shorten the pattern event or increase pattern.measures.",
              note.offset,
            ));
          }
        }
      }
    } else {
      for (const hit of track.hits) {
        if (tick(manifest, hit.position) + hit.duration > songEndTick) {
          issues.push(issue(
            "ARRANGEMENT_EVENT_PAST_SONG_END",
            "error",
            "arrangement",
            `Drum hit ${hit.id} extends past the semantic song end.`,
            [track.id, hit.id],
            "Move the hit or extend the final section explicitly.",
            hit.position,
          ));
        }
      }
      for (const pattern of track.patterns) {
        const patternEnd = tick(manifest, { measure: pattern.measures, beat: 0, tick: 0 });
        for (const hit of pattern.hits) {
          if (tick(manifest, hit.offset) + hit.duration > patternEnd) {
            issues.push(issue(
              "PATTERN_EVENT_OUT_OF_BOUNDS",
              "error",
              "arrangement",
              `Pattern hit ${hit.id} extends past ${pattern.id}'s ${pattern.measures}-measure boundary.`,
              [track.id, pattern.id, hit.id],
              "Move/shorten the pattern hit or increase pattern.measures.",
              hit.offset,
            ));
          }
        }
      }
    }
    for (const placement of track.placements) {
      const pattern = track.patterns.find((candidate) => candidate.id === placement.pattern_id);
      if (!pattern) continue;
      const endMeasure = placement.start.measure + pattern.measures * placement.repeats;
      const end = tick(manifest, { measure: endMeasure, beat: placement.start.beat, tick: placement.start.tick });
      if (end > songEndTick) {
        issues.push(issue(
          "PLACEMENT_PAST_SONG_END",
          "error",
          "arrangement",
          `Placement ${placement.id} ends after the semantic song end.`,
          [track.id, placement.id, pattern.id],
          "Reduce repeats, move the placement, or extend the final section.",
          placement.start,
        ));
      }
    }
  }
}

async function verifyArtifact(
  artifact: ManifestArtifact,
  knownIds: ReadonlySet<string>,
  issues: SongPreflightIssue[],
): Promise<void> {
  for (const dependency of artifact.dependencies) {
    if (!knownIds.has(dependency)) {
      issues.push(issue(
        "ARTIFACT_DEPENDENCY_MISSING",
        "error",
        "artifact",
        `Artifact ${artifact.id} references missing dependency ${dependency}.`,
        [artifact.id, dependency],
        "Rebuild/re-record the artifact from existing stable objects.",
      ));
    }
  }
  try {
    const path = await resolveReadablePath(artifact.path);
    const digest = await fileSha256(path);
    if (digest.sha256 !== artifact.sha256 || digest.bytes !== artifact.bytes) {
      issues.push(issue(
        "ARTIFACT_DIGEST_MISMATCH",
        "error",
        "artifact",
        `Artifact ${artifact.id} no longer matches its recorded SHA-256/size.`,
        [artifact.id],
        "Do not use this file; restore it or rebuild a new immutable artifact.",
      ));
    }
  } catch (error) {
    issues.push(issue(
      "ARTIFACT_UNREADABLE",
      "error",
      "artifact",
      `Artifact ${artifact.id} is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      [artifact.id],
      "Restore the file or rebuild a new artifact before selecting this dependency.",
    ));
  }
}

function gate(issues: readonly SongPreflightIssue[], codes: readonly string[]): ReadinessGate {
  const selected = issues.filter((entry) => entry.severity === "error" && codes.includes(entry.code));
  return { ready: selected.length === 0, blockers: [...new Set(selected.map((entry) => entry.code))] };
}

export async function preflightSongManifest(
  manifestPath: string,
  options: SongPreflightOptions,
): Promise<SongPreflightResult> {
  const loaded = await loadSongManifest(manifestPath);
  const manifest = loaded.manifest;
  const issues: SongPreflightIssue[] = [];
  const songEndTick = Math.max(...manifest.sections.map((section) => tick(manifest, section.end)));
  const theory = analyzeManifestTheory(manifest);
  const theoryProposals = options.theoryProposalOptions
    ? proposeTheoryRepairs(manifest, options.theoryProposalOptions, theory)
    : undefined;
  const creativeReadiness = analyzeCompositionIntent(manifest);
  const releasePolicy = evaluateReleasePolicy(manifest.composition_guidance, theory, creativeReadiness);

  const vocalEvents = addVocalIssues(manifest, issues, options.includePerformanceWarnings);
  addHarmonyIssues(manifest, issues, options.includePerformanceWarnings);
  addArrangementIssues(manifest, songEndTick, issues);

  if (manifest.vocal_tracks.length === 0) {
    issues.push(issue(
      "NO_VOCAL_TRACK",
      "error",
      "vocal",
      "The manifest has no vocal track.",
      [],
      "Add at least one vocal part before build.",
    ));
  }
  if (!manifest.accompaniment.tracks.some((track) => track.kind === "pitched")) {
    issues.push(issue(
      "NO_PITCHED_ARRANGEMENT_TRACK",
      "error",
      "arrangement",
      "The current renderer requires at least one pitched accompaniment track.",
      [],
      "Add a pitched arrangement track, even if the intended texture is sparse.",
    ));
  }
  for (const track of manifest.vocal_tracks) {
    if (track.comment.length > 256) {
      issues.push(issue(
        "NATIVE_TRACK_COMMENT_TOO_LONG",
        "error",
        "vocal",
        `Vocal track ${track.id} comment has ${track.comment.length} characters; native VSQX accepts at most 256.`,
        [track.id],
        "Shorten the native track comment and keep full provenance in manifest artifacts, review notes, or phrase linguistic_source.",
      ));
    }
    for (const part of track.parts) {
      if (part.comment.length <= 256) continue;
      issues.push(issue(
        "NATIVE_PART_COMMENT_TOO_LONG",
        "error",
        "vocal",
        `Vocal part ${part.id} comment has ${part.comment.length} characters; native VSQX accepts at most 256.`,
        [track.id, part.id],
        "Shorten the native part comment and keep full provenance in manifest artifacts, review notes, or phrase linguistic_source.",
      ));
    }
    if (track.mixer.pan <= 4 || track.mixer.pan >= 123) {
      issues.push(issue(
        "EXTREME_VOCAL_PAN",
        "warning",
        "mix",
        `Vocal track ${track.id} uses pan ${track.mixer.pan} (64 is center).`,
        [track.id],
        "Keep only if the extreme channel placement is intentional; verify stereo balance before delivery.",
      ));
    }
    const voice = manifest.voices.find((candidate) => candidate.id === track.voice_id);
    if (voice && options.verifiedVoiceComponentIds && !options.verifiedVoiceComponentIds.has(voice.component_id)) {
      issues.push(issue(
        "VOICE_NOT_VERIFIED",
        "error",
        "host",
        `Voice ${voice.name}/${voice.component_id} has not been verified for the current Editor fingerprint.`,
        [voice.id, track.id],
        "Run the explicit voice probe or select a cached verified singer before original-Editor render.",
      ));
    }
  }

  for (const chord of manifest.harmony.chord_changes) {
    if (tick(manifest, chord.position) + chord.duration_ticks > songEndTick) {
      issues.push(issue(
        "CHORD_PAST_SONG_END",
        "warning",
        "harmony",
        `Chord ${chord.id} extends past the semantic song end.`,
        [chord.id],
        "Shorten the harmony event or extend the final section.",
        chord.position,
      ));
    }
  }

  const knownIds = allStableIds(manifest);
  const currentMixArtifacts = currentMixArtifactIds(manifest);
  for (const artifact of manifest.artifacts) {
    if (artifact.source_composition_hash !== manifest.composition_hash) {
      issues.push(issue(
        "STALE_ARTIFACT",
        "warning",
        "artifact",
        `Artifact ${artifact.id} belongs to an older composition hash.`,
        [artifact.id],
        "Keep it only as history; do not select it for a current render/mix dependency.",
      ));
    }
    if (
      artifact.source_composition_hash === manifest.composition_hash
      && ["mix", "delivery"].includes(artifact.role)
      && !currentMixArtifacts.has(artifact.id)
    ) {
      issues.push(issue(
        artifact.role === "mix" ? "STALE_MIX_ARTIFACT" : "STALE_DELIVERY_ARTIFACT",
        "warning",
        "artifact",
        `Artifact ${artifact.id} no longer matches the current mix intent/dependency chain.`,
        [artifact.id],
        artifact.role === "mix"
          ? "Render a new stem mix from current stems and mix_hash before mastering."
          : "Master a current mix/master dependency into a new immutable delivery artifact.",
      ));
    }
  }
  const checkedArtifacts = manifest.artifacts.filter((artifact) =>
    options.artifactCheck === "all"
      || (options.artifactCheck === "current" && artifact.source_composition_hash === manifest.composition_hash));
  if (options.artifactCheck !== "none") {
    await Promise.all(checkedArtifacts.map((artifact) => verifyArtifact(artifact, knownIds, issues)));
  }

  // Prefer the richer shared analyzer whenever an older workflow lint emits the
  // same stable code. This keeps one severity/fingerprint source without
  // removing unrelated legacy structural checks in the same migration.
  const theoryCodes = new Set(
    [...theory.issues, ...theory.ignoredIssues].map((entry) => entry.code),
  );
  const mergedIssues = [
    ...issues.filter((entry) => !theoryCodes.has(entry.code)),
    ...theory.issues.map(theoryPreflightIssue),
  ];

  const currentArtifacts = manifest.artifacts.filter((artifact) =>
    artifact.source_composition_hash === manifest.composition_hash
    && (!["mix", "delivery"].includes(artifact.role) || currentMixArtifacts.has(artifact.id)));
  const currentRoles = new Set(currentArtifacts.map((artifact) => artifact.role));
  const scoreCodes = [
    "PART_OVERLAP", "VOCAL_EVENT_OVERLAP", "ARRANGEMENT_EVENT_PAST_SONG_END",
    "PATTERN_EVENT_OUT_OF_BOUNDS", "PLACEMENT_PAST_SONG_END", "NO_VOCAL_TRACK",
    "NO_PITCHED_ARRANGEMENT_TRACK",
  ];
  const theoryScoreCodes = theory.issues
    .filter((entry) => theoryFindingBlocks(entry, "score"))
    .map((entry) => entry.code);
  const theoryBuildCodes = theory.issues
    .filter((entry) => theoryFindingBlocks(entry, "build"))
    .map((entry) => entry.code);
  const score = gate(mergedIssues, [...scoreCodes, ...theoryScoreCodes]);
  const build = gate(mergedIssues, [
    ...scoreCodes,
    ...theoryBuildCodes,
    "NATIVE_TRACK_COMMENT_TOO_LONG",
    "NATIVE_PART_COMMENT_TOO_LONG",
  ]);
  const renderBlockers = [...build.blockers];
  if (!currentRoles.has("vsqx")) renderBlockers.push("CURRENT_VSQX_REQUIRED");
  if (mergedIssues.some((entry) => entry.code === "VOICE_NOT_VERIFIED" && entry.severity === "error")) {
    renderBlockers.push("VOICE_NOT_VERIFIED");
  }
  const mixBlockers: string[] = [];
  if (!currentRoles.has("vocal_stem")) mixBlockers.push("CURRENT_VOCAL_STEM_REQUIRED");
  if (!currentRoles.has("instrument_stem")) mixBlockers.push("CURRENT_INSTRUMENT_STEM_REQUIRED");
  const deliveryBlockers: string[] = [];
  deliveryBlockers.push(...build.blockers);
  if (!currentRoles.has("delivery")) deliveryBlockers.push("CURRENT_DELIVERY_REQUIRED");
  if (mergedIssues.some((entry) => entry.domain === "artifact" && entry.severity === "error")) {
    deliveryBlockers.push("ARTIFACT_INTEGRITY_ERROR");
  }
  deliveryBlockers.push(...releasePolicy.blockers);

  const sorted = [...mergedIssues].sort((left, right) => {
    const severityOrder: Record<PreflightSeverity, number> = { error: 0, warning: 1, info: 2 };
    return severityOrder[left.severity] - severityOrder[right.severity]
      || left.domain.localeCompare(right.domain)
      || left.code.localeCompare(right.code)
      || left.objectIds.join("\0").localeCompare(right.objectIds.join("\0"));
  });
  return {
    path: loaded.path,
    revision: manifest.revision,
    compositionHash: manifest.composition_hash,
    mixHash: manifest.mix_hash,
    songEndTick,
    counts: {
      sections: manifest.sections.length,
      vocalTracks: manifest.vocal_tracks.length,
      vocalParts: manifest.vocal_tracks.reduce((sum, track) => sum + track.parts.length, 0),
      vocalEvents,
      arrangementTracks: manifest.accompaniment.tracks.length,
      artifacts: manifest.artifacts.length,
      errors: sorted.filter((entry) => entry.severity === "error").length,
      warnings: sorted.filter((entry) => entry.severity === "warning").length,
      infos: sorted.filter((entry) => entry.severity === "info").length,
      theoryIssues: theory.issues.length,
      creativeFindings: creativeReadiness.findings.length,
    },
    readiness: {
      score,
      build,
      render: { ready: renderBlockers.length === 0, blockers: [...new Set(renderBlockers)] },
      mix: { ready: mixBlockers.length === 0, blockers: mixBlockers },
      delivery: { ready: deliveryBlockers.length === 0, blockers: [...new Set(deliveryBlockers)] },
    },
    theory,
    ...(theoryProposals ? { theoryProposals } : {}),
    creativeReadiness,
    releasePolicy,
    checkedArtifactIds: checkedArtifacts.map((artifact) => artifact.id),
    issues: sorted,
  };
}

export function assertSongBuildPreflight(result: SongPreflightResult): void {
  if (result.readiness.build.ready) return;
  const details = result.issues
    .filter((entry) => entry.severity === "error" && result.readiness.build.blockers.includes(entry.code))
    .map((entry) => `${entry.code}: ${entry.message}`)
    .join("; ");
  throw new Error(`Song preflight rejected build: ${details}`);
}
