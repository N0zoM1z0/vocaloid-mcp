import type { SongManifest } from "../song-manifest.js";
import { rhythmValueTicks } from "../vocal-phrase.js";
import type { DomainAnalysis, SymbolicIndex } from "./events.js";
import { secondsAtTick, secondsBetweenTicks } from "./events.js";
import { timelineTick } from "./timeline.js";


const VOWEL_PHONEMES = new Set(["a", "i", "M", "e", "o"]);

function beginsWithConsonant(phonemes: string): boolean {
  const first = phonemes.split(/\s+/u).find(Boolean);
  return first !== undefined && !VOWEL_PHONEMES.has(first) && first !== "N" && first !== "N\\" && first !== "-";
}

function endsWithExtendableVowel(phonemes: string): boolean {
  const tokens = phonemes.split(/\s+/u).filter(Boolean);
  return VOWEL_PHONEMES.has(tokens.at(-1) ?? "");
}

export function analyzePerformance(manifest: SongManifest, index: SymbolicIndex): DomainAnalysis {
  const findings: DomainAnalysis["findings"] = [];
  const metrics: DomainAnalysis["metrics"] = [];
  for (const track of manifest.vocal_tracks) {
    const events = index.vocalEventsByTrack.get(track.id) ?? [];
    if (events.length > 0) {
      const durations = events.map((event) => secondsBetweenTicks(index, event.startTick, event.endTick) * 1000);
      metrics.push({
        id: `note_allocation.mean_duration.${track.id}`,
        domain: "note_allocation",
        value: Number((durations.reduce((sum, value) => sum + value, 0) / durations.length).toFixed(4)),
        unit: "milliseconds",
        objectIds: [track.id],
      });
      let windowStart = 0;
      let maximumDensity = 0;
      for (const [eventIndex, event] of events.entries()) {
        const startSeconds = secondsAtTick(index, event.startTick);
        while (windowStart < eventIndex
          && startSeconds - secondsAtTick(index, events[windowStart]!.startTick) > 1) windowStart += 1;
        const density = eventIndex - windowStart + 1;
        maximumDensity = Math.max(maximumDensity, density);
        if (density >= 11 && (eventIndex === events.length - 1
          || secondsAtTick(index, events[eventIndex + 1]!.startTick) - startSeconds > 1)) {
          findings.push({
            code: "VOCAL_ONSET_DENSITY_RISK",
            ruleVersion: "1.0.0",
            severity: "warning",
            domain: "note_allocation",
            confidence: 0.9,
            message: `${density} voiced events begin within one second on ${track.id}.`,
            objectIds: [track.id, ...events.slice(windowStart, eventIndex + 1).map((entry) => entry.id)],
            startTick: events[windowStart]!.startTick,
            endTick: event.endTick,
            source: "symbolic vocal onset density and tempo map",
            details: { events_per_second: density },
            suggestion: "Redistribute consonants, holds, and rests instead of globally changing tempo.",
            repairKind: "rhythm",
          });
        }
      }
      metrics.push({
        id: `note_allocation.max_onsets_per_second.${track.id}`,
        domain: "note_allocation",
        value: maximumDensity,
        unit: "events_per_second",
        objectIds: [track.id],
      });
    }

    let newMoraCells = 0;
    let minimumMoraDurationMilliseconds = Number.POSITIVE_INFINITY;
    let consonantCells = 0;
    let minimumConsonantBudgetMilliseconds = Number.POSITIVE_INFINITY;
    let melismaCells = 0;
    let unsuitableMelismaCells = 0;
    for (const part of track.parts) {
      for (const phrase of part.phrases) {
        let currentTick = timelineTick(manifest, phrase.start);
        let sequentialLyricIndex = 0;
        let previousLyricIndex: number | null = null;
        for (const cell of phrase.cells) {
          const stepTicks = rhythmValueTicks(typeof cell.duration === "number"
            ? cell.duration
            : {
                denominator: cell.duration.denominator,
                dots: cell.duration.dots,
                ...(cell.duration.tuplet
                  ? { tuplet: { played: cell.duration.tuplet.played, inTimeOf: cell.duration.tuplet.in_time_of } }
                  : {}),
              });
          if (cell.rest) {
            currentTick += stepTicks;
            previousLyricIndex = null;
            continue;
          }
          const lyricIndex = cell.lyric_index ?? sequentialLyricIndex;
          const lyric = phrase.lyrics[lyricIndex];
          const continuation = phrase.allocation === "explicit"
            && cell.lyric === undefined
            && cell.phonemes === undefined
            && previousLyricIndex === lyricIndex;
          const phonemes = cell.phonemes ?? (continuation ? "-" : lyric?.phonemes ?? "");
          const durationTicks = Math.max(1, Math.floor((stepTicks * cell.gate_percent) / 100));
          const durationMilliseconds = secondsBetweenTicks(index, currentTick, currentTick + durationTicks) * 1000;
          const objectIds = [track.id, part.id, phrase.id, cell.id, ...(lyric ? [lyric.id] : [])];
          if (!continuation) {
            newMoraCells += 1;
            minimumMoraDurationMilliseconds = Math.min(minimumMoraDurationMilliseconds, durationMilliseconds);
          }
          if (!continuation && durationMilliseconds < 80) {
            findings.push({
              code: "MORA_DURATION_UNSINGABLE",
              ruleVersion: "1.0.0",
              severity: "warning",
              domain: "note_allocation",
              confidence: 0.9,
              message: `${cell.id} gives a new lyric unit only ${durationMilliseconds.toFixed(1)} ms.`,
              objectIds,
              startTick: currentTick,
              endTick: currentTick + durationTicks,
              source: "phrase mora allocation, gate, and tempo map",
              details: { duration_ms: Number(durationMilliseconds.toFixed(4)), gate_percent: cell.gate_percent },
              suggestion: "Borrow duration from an adjacent vowel/rest or reduce local onset density.",
              repairKind: "rhythm",
            });
          }
          const consonantOnset = !continuation && beginsWithConsonant(phonemes);
          if (consonantOnset) {
            consonantCells += 1;
            minimumConsonantBudgetMilliseconds = Math.min(
              minimumConsonantBudgetMilliseconds,
              durationMilliseconds,
            );
          }
          if (consonantOnset && durationMilliseconds < 110) {
            findings.push({
              code: "CONSONANT_LEAD_TIME_INSUFFICIENT",
              ruleVersion: "1.0.0",
              severity: "warning",
              domain: "note_allocation",
              confidence: 0.85,
              message: `${cell.id} begins with ${phonemes.split(/\s+/u)[0]} but has only ${durationMilliseconds.toFixed(1)} ms.`,
              objectIds,
              startTick: currentTick,
              endTick: currentTick + durationTicks,
              source: "explicit Japanese phonemes and symbolic duration",
              details: { duration_ms: Number(durationMilliseconds.toFixed(4)), phonemes },
              suggestion: "Create consonant lead time by reallocating a neighboring vowel while preserving the phrase grid.",
              repairKind: "rhythm",
            });
          }
          if (continuation) melismaCells += 1;
          if (continuation && lyric && !endsWithExtendableVowel(lyric.phonemes)) {
            unsuitableMelismaCells += 1;
            findings.push({
              code: "MELISMA_PHONEME_UNSUITABLE",
              ruleVersion: "1.0.0",
              severity: "warning",
              domain: "note_allocation",
              confidence: 0.95,
              message: `${cell.id} continues ${lyric.id}, whose phonemes ${lyric.phonemes} do not end in an extendable vowel.`,
              objectIds,
              startTick: currentTick,
              source: "explicit repeated lyric index and phoneme inventory",
              details: { phonemes: lyric.phonemes },
              suggestion: "Move the melisma to an open vowel or allocate the following mora explicitly.",
              repairKind: "rhythm",
            });
          }
          currentTick += stepTicks;
          previousLyricIndex = lyricIndex;
          if (phrase.allocation === "sequential") sequentialLyricIndex += 1;
        }
      }
    }
    if (newMoraCells > 0) {
      metrics.push({
        id: `note_allocation.minimum_mora_duration.${track.id}`,
        domain: "note_allocation",
        value: Number(minimumMoraDurationMilliseconds.toFixed(4)),
        unit: "milliseconds",
        objectIds: [track.id],
      });
    }
    if (consonantCells > 0) {
      metrics.push({
        id: `note_allocation.minimum_consonant_budget.${track.id}`,
        domain: "note_allocation",
        value: Number(minimumConsonantBudgetMilliseconds.toFixed(4)),
        unit: "milliseconds",
        objectIds: [track.id],
      });
    }
    if (melismaCells > 0) {
      metrics.push({
        id: `note_allocation.unsuitable_melisma_ratio.${track.id}`,
        domain: "note_allocation",
        value: Number((unsuitableMelismaCells / melismaCells).toFixed(6)),
        unit: "ratio",
        objectIds: [track.id],
      });
    }
  }
  const vocalEventsById = new Map(index.vocalEvents.map((event) => [event.id, event]));
  const vibratoFindingEvents = new Set<string>();
  const gestureTargetIds = new Set<string>();
  for (const event of index.vocalEvents) {
    if (!event.vibrato || event.vibrato.length <= 0) continue;
    gestureTargetIds.add(event.id);
    const durationMilliseconds = secondsBetweenTicks(index, event.startTick, event.endTick) * 1000;
    if (durationMilliseconds >= 350) continue;
    vibratoFindingEvents.add(event.id);
    findings.push({
      code: "VIBRATO_NOTE_TOO_SHORT",
      ruleVersion: "1.0.0",
      severity: "warning",
      domain: "performance",
      confidence: 0.9,
      message: `${event.id} applies vibrato to a ${durationMilliseconds.toFixed(1)} ms note.`,
      objectIds: [event.trackId, event.partId, event.id],
      startTick: event.startTick,
      endTick: event.endTick,
      source: "compiled vocal event vibrato and tempo map",
      details: { duration_ms: Number(durationMilliseconds.toFixed(4)), vibrato_length: event.vibrato.length },
      suggestion: "Delay/remove vibrato on the short note or lengthen the semantic sustain after listening in isolation.",
      repairKind: "review",
    });
  }
  for (const track of manifest.vocal_tracks) for (const part of track.parts) {
    for (const gesture of part.tuning_gestures ?? []) {
      for (const eventId of gesture.event_ids) gestureTargetIds.add(eventId);
      if (gesture.type === "vibrato") {
        for (const eventId of gesture.event_ids) {
          const event = vocalEventsById.get(eventId);
          if (!event || vibratoFindingEvents.has(eventId)) continue;
          const durationMilliseconds = secondsBetweenTicks(index, event.startTick, event.endTick) * 1000;
          if (durationMilliseconds >= 350) continue;
          vibratoFindingEvents.add(eventId);
          findings.push({
            code: "VIBRATO_NOTE_TOO_SHORT",
            ruleVersion: "1.0.0",
            severity: "warning",
            domain: "performance",
            confidence: 0.9,
            message: `${gesture.id} targets ${eventId}, a ${durationMilliseconds.toFixed(1)} ms note.`,
            objectIds: [track.id, part.id, gesture.id, eventId],
            startTick: event.startTick,
            endTick: event.endTick,
            source: "persistent tuning gesture and tempo map",
            details: {
              duration_ms: Number(durationMilliseconds.toFixed(4)),
              vibrato_length_percent: gesture.length_percent,
            },
            suggestion: "Delay/remove vibrato on the short note or move it to the phrase's semantic sustain.",
            repairKind: "review",
          });
        }
      } else if (gesture.type === "pitch_scoop" && gesture.depth_cents > 200) {
        const linked = gesture.event_ids.map((id) => vocalEventsById.get(id)).filter((event) => event !== undefined);
        const first = linked.sort((left, right) => left.startTick - right.startTick)[0];
        findings.push({
          code: "SCOOP_DEPTH_CONTEXT_RISK",
          ruleVersion: "1.0.0",
          severity: "warning",
          domain: "performance",
          confidence: 0.8,
          message: `${gesture.id} uses a ${gesture.depth_cents}-cent ${gesture.direction} scoop across ${gesture.event_ids.length} event(s).`,
          objectIds: [track.id, part.id, gesture.id, ...gesture.event_ids].slice(0, 256),
          ...(first ? { startTick: first.startTick, endTick: first.endTick } : {}),
          source: "persistent pitch-scoop gesture",
          details: {
            depth_cents: gesture.depth_cents,
            duration_percent: gesture.duration_percent,
            target_events: gesture.event_ids.length,
          },
          suggestion: "Audition whether the scoop supports the phrase direction; reduce depth/duration if pitch identity is obscured.",
          repairKind: "review",
        });
      }
    }
  }
  metrics.push({
    id: "performance.gesture_target_coverage",
    domain: "performance",
    value: index.vocalEvents.length > 0
      ? Number((gestureTargetIds.size / index.vocalEvents.length).toFixed(6))
      : 0,
    unit: "ratio",
    objectIds: manifest.vocal_tracks.map((track) => track.id),
  });
  return { findings, metrics };
}
