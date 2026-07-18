import {
  createSongManifest,
  fileSha256,
  loadSongManifest,
  recordSongManifestArtifacts,
  upsertSongManifestVocalPart,
} from "./song-manifest.js";
import {
  inspectProject,
  listControlPoints,
  listNotes,
  musicalTickToPosition,
} from "./vsqx.js";
import type { CurveName } from "./types.js";


const CURVES = new Set<CurveName>(["DYN", "BRE", "BRI", "CLE", "GEN", "POR", "PIT", "PBS"]);

function id(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 72);
  return normalized || fallback;
}

function position(
  signatures: Array<{ measure: number; numerator: number; denominator: number }>,
  tick: number,
) {
  const value = musicalTickToPosition(signatures, Math.max(0, tick));
  return { measure: value.measure, beat: value.beat, tick: value.tick ?? 0 };
}

function firstMeasureTicks(signature: { numerator: number; denominator: number }): number {
  return signature.numerator * (480 * 4 / signature.denominator);
}

export interface ImportVsqxOptions {
  sourcePath: string;
  outputManifestPath: string;
  songId: string;
  slug: string;
  title?: string;
  overwrite: boolean;
  sampleRate: 44_100 | 48_000 | 96_000;
  accompanimentGain: number;
}

export async function importVsqxToSongManifest(options: ImportVsqxOptions) {
  const summary = await inspectProject(options.sourcePath);
  if (summary.tracks.length === 0) throw new Error("VSQX import requires at least one vocal track");
  if (summary.timeSignatures.length === 0 || summary.tempos.length === 0) {
    throw new Error("VSQX import requires a time signature and tempo map");
  }
  const warnings = [...summary.diagnostics];
  if (summary.resolution !== 480) {
    warnings.push(`Scaled source resolution ${summary.resolution} PPQ to canonical 480 PPQ with integer rounding.`);
  }
  if (summary.audioParts.length > 0) {
    warnings.push(
      `${summary.audioParts.length} native WAV part(s) were not converted into canonical arrangement tracks; source paths remain available in the import report.`,
    );
  }
  const scale = 480 / summary.resolution;
  const scaled = (tick: number): number => Math.max(0, Math.round(tick * scale));
  const allowedDenominators = new Set([1, 2, 4, 8, 16, 32]);
  if (summary.timeSignatures.some((signature) => !allowedDenominators.has(signature.denominator))) {
    throw new Error("VSQX uses a time-signature denominator outside 1/2/4/8/16/32");
  }
  const signatures = summary.timeSignatures as Array<{
    measure: number;
    numerator: number;
    denominator: 1 | 2 | 4 | 8 | 16 | 32;
  }>;
  const preMeasureTicks = summary.preMeasure * firstMeasureTicks(signatures[0]!);
  const tempoTicks = new Set<number>();
  const tempos = [];
  for (const [index, tempo] of summary.tempos.entries()) {
    const songTick = index === 0 ? 0 : Math.max(0, scaled(tempo.tick) - preMeasureTicks);
    if (tempoTicks.has(songTick)) {
      warnings.push(`Skipped source tempo ${tempo.bpm} BPM at duplicate canonical tick ${songTick}.`);
      continue;
    }
    tempoTicks.add(songTick);
    tempos.push({ position: position(signatures, songTick), bpm: tempo.bpm });
  }
  tempos.sort((left, right) => {
    const a = left.position;
    const b = right.position;
    return a.measure - b.measure || a.beat - b.beat || a.tick - b.tick;
  });

  let endTick = 1;
  for (const track of summary.tracks) for (const part of track.parts) {
    endTick = Math.max(endTick, Math.max(0, scaled(part.tick) - preMeasureTicks) + scaled(part.playTime));
  }
  await createSongManifest({
    outputPath: options.outputManifestPath,
    songId: options.songId,
    slug: options.slug,
    title: options.title ?? summary.sequenceName ?? options.songId,
    format: summary.format,
    preMeasure: summary.preMeasure,
    timeSignatures: signatures,
    tempos,
    sections: [{
      id: "imported-song",
      name: "Imported Song",
      kind: "custom",
      start: { measure: 0, beat: 0, tick: 0 },
      end: position(signatures, endTick),
      energy: 0.5,
      description: `Canonical import of ${summary.path}; semantic sections require agent review.`,
    }],
    sampleRate: options.sampleRate,
    gain: options.accompanimentGain,
    reverb: false,
    chorus: false,
    overwrite: options.overwrite,
  });

  let revision = 1;
  let importedNotes = 0;
  let importedControls = 0;
  let importedParts = 0;
  const voiceIds = new Map<string, string>();
  for (const [index, voice] of summary.voices.entries()) {
    const base = `voice-${id(voice.name, `imported-${index}`)}`;
    let candidate = base;
    let suffix = 2;
    while ([...voiceIds.values()].includes(candidate)) candidate = `${base}-${suffix++}`;
    voiceIds.set(`${voice.bankSelect}:${voice.programChange}`, candidate);
  }

  for (const track of summary.tracks) {
    for (const part of track.parts) {
      const singer = part.singer;
      const voice = singer
        ? summary.voices.find((candidate) => candidate.bankSelect === singer.bankSelect
          && candidate.programChange === singer.programChange)
        : summary.voices[0];
      if (!voice) throw new Error(`Could not resolve singer for track ${track.trackNumber} part ${part.index}`);
      const slot = `${voice.bankSelect}:${voice.programChange}`;
      const voiceId = voiceIds.get(slot)!;
      const trackId = `import-vocal-${track.trackNumber}-${voiceId}`.slice(0, 96);
      if (singer && track.parts[0]?.singer
        && (singer.bankSelect !== track.parts[0].singer.bankSelect
          || singer.programChange !== track.parts[0].singer.programChange)) {
        warnings.push(`Split original track ${track.trackNumber} by part singer slot ${slot}; canonical tracks currently bind one voice.`);
      }
      const notePage = await listNotes(summary.path, track.trackNumber, part.index, undefined, undefined, 0, 100_000);
      if (notePage.page.has_more) throw new Error("VSQX part exceeds the 100,000-note import safety limit");
      if (notePage.page.items.length === 0) {
        warnings.push(`Skipped empty vocal part on track ${track.trackNumber}, part ${part.index}.`);
        continue;
      }
      const controlPage = await listControlPoints(summary.path, track.trackNumber, part.index, undefined, undefined, undefined, 0, 100_000);
      if (controlPage.page.has_more) throw new Error("VSQX part exceeds the 100,000-control import safety limit");
      const partStart = Math.max(0, scaled(part.tick) - preMeasureTicks);
      const partEnd = partStart + scaled(part.playTime);
      const prefix = `import-t${track.trackNumber}-p${part.index}`;
      const controls = new Map<CurveName, Array<{ id: string; position: ReturnType<typeof position>; value: number }>>();
      for (const control of controlPage.page.items) {
        if (!CURVES.has(control.curve as CurveName)) {
          warnings.push(`Skipped unsupported control curve ${control.curve} in ${prefix}.`);
          continue;
        }
        const curve = control.curve as CurveName;
        const points = controls.get(curve) ?? [];
        points.push({
          id: `${prefix}-${curve.toLowerCase()}-${control.index}`,
          position: position(signatures, partStart + scaled(control.tick)),
          value: control.value,
        });
        controls.set(curve, points);
        importedControls += 1;
      }
      await upsertSongManifestVocalPart(
        options.outputManifestPath,
        options.outputManifestPath,
        revision,
        {
          id: voiceId,
          name: voice.name,
          component_id: voice.componentId,
          bank_select: voice.bankSelect,
          program_change: voice.programChange,
          parameters: Object.fromEntries(Object.entries(voice.parameters ?? {}).map(([key, value]) => [key, Math.round(value)])),
        },
        {
          id: trackId,
          name: track.name || `Imported Track ${track.trackNumber + 1}`,
          comment: `Imported from VSQX track ${track.trackNumber}; singer changes are split by voice slot.`,
          voice_id: voiceId,
        },
        {
          id: `${prefix}-part`,
          section_id: "imported-song",
          name: part.name || `Imported Part ${part.index + 1}`,
          comment: `Source project tick ${part.tick}, playTime ${part.playTime}; imported without copying unsupported native extensions.`,
          start: position(signatures, partStart),
          end: position(signatures, partEnd),
          notes: notePage.page.items.map((note) => {
            importedNotes += 1;
            const vibratoType = note.style.vibType ?? 0;
            const vibratoLength = note.style.vibLen ?? 0;
            const style = Object.fromEntries(Object.entries(note.style)
              .filter(([key]) => !["vibType", "vibLen"].includes(key)));
            return {
              id: `${prefix}-n${note.index}`,
              position: position(signatures, partStart + scaled(note.tick)),
              duration: Math.max(1, scaled(note.duration)),
              note_number: note.noteNumber,
              lyric: note.lyric,
              phonemes: note.phonemes,
              phoneme_locked: note.phonemeLocked,
              velocity: note.velocity,
              style,
              ...(vibratoType > 0
                ? {
                    vibrato: {
                      type: vibratoType,
                      length: vibratoLength,
                      depth: note.styleSequences.vibDep ?? [],
                      rate: note.styleSequences.vibRate ?? [],
                    },
                  }
                : {}),
            };
          }),
          control_curves: [...controls.entries()].map(([curve, points]) => ({
            id: `${prefix}-${curve.toLowerCase()}-curve`,
            curve,
            points,
          })),
        },
        true,
      );
      revision += 1;
      importedParts += 1;
    }
  }

  const manifest = (await loadSongManifest(options.outputManifestPath)).manifest;
  const sourceDigest = await fileSha256(summary.path);
  const sourceArtifact = {
    id: `import-source-r${manifest.revision}`,
    role: "analysis" as const,
    path: summary.path,
    ...sourceDigest,
    source_revision: manifest.revision,
    source_composition_hash: manifest.composition_hash,
    dependencies: [],
    metadata: {
      kind: "vsqx-import-source",
      source_format: summary.format,
      source_resolution: summary.resolution,
      imported_parts: importedParts,
      imported_notes: importedNotes,
      imported_controls: importedControls,
      warning_count: warnings.length,
    },
    created_at: new Date().toISOString(),
  };
  const recorded = await recordSongManifestArtifacts(
    options.outputManifestPath,
    manifest.revision,
    manifest.composition_hash,
    [sourceArtifact],
  );
  return {
    source: summary,
    manifestPath: recorded.write.path,
    manifestRevision: recorded.write.revision,
    manifestContentHash: recorded.write.contentHash,
    compositionHash: recorded.write.compositionHash,
    imported: { tracks: summary.tracks.length, parts: importedParts, notes: importedNotes, controls: importedControls },
    warnings,
    sourceArtifact,
  };
}
