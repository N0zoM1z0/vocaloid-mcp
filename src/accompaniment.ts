import { execFile } from "node:child_process";
import { access, copyFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";

import { resolveReadablePath, resolveWritablePath } from "./paths.js";
import type {
  MusicalPosition,
  SongTempoInput,
  SongTimeSignatureInput,
} from "./vsqx.js";
import { musicalPositionToTick } from "./vsqx.js";
import { analyzeWav, type WavAnalysis } from "./wav.js";


const execFileAsync = promisify(execFile);
const RESOLUTION = 480;
const DEFAULT_FLUIDSYNTH = "/usr/bin/fluidsynth";
const DEFAULT_SOUNDFONT = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const MELODIC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

export interface AccompanimentNoteInput {
  position: MusicalPosition;
  duration: number;
  noteNumber: number;
  velocity?: number;
}

export interface AccompanimentTrackInput {
  name: string;
  program: number;
  volume?: number;
  pan?: number;
  notes: AccompanimentNoteInput[];
}

export interface DrumHitInput {
  position: MusicalPosition;
  noteNumber: number;
  velocity?: number;
  duration?: number;
}

export interface RenderAccompanimentOptions {
  outputPath: string;
  timeSignatures: SongTimeSignatureInput[];
  tempos: SongTempoInput[];
  end: MusicalPosition;
  tracks: AccompanimentTrackInput[];
  drums?: DrumHitInput[];
  sampleRate: 44_100 | 48_000 | 96_000;
  gain: number;
  reverb: boolean;
  chorus: boolean;
  soundfontPath?: string;
  overwrite: boolean;
}

export interface AccompanimentRenderResult extends WavAnalysis {
  outputPath: string;
  backupPath?: string;
  soundfontPath: string;
  tracks: number;
  notes: number;
  drumHits: number;
  endTick: number;
}

interface MidiEvent {
  tick: number;
  priority: number;
  bytes: number[];
}

function assertIntegerRange(value: number, minimum: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer in ${minimum}..${maximum}, got ${value}`);
  }
}

function encodeVariableLength(value: number): number[] {
  assertIntegerRange(value, 0, 0x0fff_ffff, "MIDI delta time");
  const output = [value & 0x7f];
  let remaining = value >>> 7;
  while (remaining > 0) {
    output.unshift((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  return output;
}

function uint32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function trackChunk(events: MidiEvent[], endTick: number): Buffer {
  const ordered = [...events].sort(
    (left, right) => left.tick - right.tick || left.priority - right.priority,
  );
  const bytes: number[] = [];
  let previousTick = 0;
  for (const event of ordered) {
    if (event.tick < previousTick || event.tick > endTick) {
      throw new Error(`MIDI event tick ${event.tick} is outside 0..${endTick}`);
    }
    bytes.push(...encodeVariableLength(event.tick - previousTick), ...event.bytes);
    previousTick = event.tick;
  }
  bytes.push(...encodeVariableLength(endTick - previousTick), 0xff, 0x2f, 0x00);
  return Buffer.from([...Buffer.from("MTrk", "ascii"), ...uint32(bytes.length), ...bytes]);
}

function metaText(type: number, value: string): number[] {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.length > 255) throw new Error("MIDI metadata text exceeds 255 bytes");
  return [0xff, type, ...encodeVariableLength(encoded.length), ...encoded];
}

function conductorTrack(
  signatures: readonly SongTimeSignatureInput[],
  tempos: readonly SongTempoInput[],
  endTick: number,
): Buffer {
  const events: MidiEvent[] = [{ tick: 0, priority: 0, bytes: metaText(0x03, "Conductor") }];
  for (const signature of signatures) {
    const denominatorPower = Math.log2(signature.denominator);
    events.push({
      tick: musicalPositionToTick(signatures, { measure: signature.measure, beat: 0 }),
      priority: 1,
      bytes: [0xff, 0x58, 0x04, signature.numerator, denominatorPower, 24, 8],
    });
  }
  for (const tempo of tempos) {
    const microseconds = Math.round(60_000_000 / tempo.bpm);
    events.push({
      tick: musicalPositionToTick(signatures, tempo.position),
      priority: 2,
      bytes: [
        0xff,
        0x51,
        0x03,
        (microseconds >>> 16) & 0xff,
        (microseconds >>> 8) & 0xff,
        microseconds & 0xff,
      ],
    });
  }
  return trackChunk(events, endTick);
}

function instrumentTrack(
  track: AccompanimentTrackInput,
  channel: number,
  signatures: readonly SongTimeSignatureInput[],
  endTick: number,
): Buffer {
  const events: MidiEvent[] = [
    { tick: 0, priority: 0, bytes: metaText(0x03, track.name) },
    { tick: 0, priority: 1, bytes: [0xc0 | channel, track.program] },
    { tick: 0, priority: 2, bytes: [0xb0 | channel, 7, track.volume ?? 100] },
    { tick: 0, priority: 3, bytes: [0xb0 | channel, 10, track.pan ?? 64] },
  ];
  for (const note of track.notes) {
    const start = musicalPositionToTick(signatures, note.position);
    const end = start + note.duration;
    if (end > endTick) throw new Error(`${track.name} note at tick ${start} ends after song end`);
    events.push(
      { tick: start, priority: 20, bytes: [0x90 | channel, note.noteNumber, note.velocity ?? 88] },
      { tick: end, priority: 10, bytes: [0x80 | channel, note.noteNumber, 0] },
    );
  }
  return trackChunk(events, endTick);
}

function drumTrack(
  hits: readonly DrumHitInput[],
  signatures: readonly SongTimeSignatureInput[],
  endTick: number,
): Buffer {
  const events: MidiEvent[] = [{ tick: 0, priority: 0, bytes: metaText(0x03, "Drums") }];
  for (const hit of hits) {
    const start = musicalPositionToTick(signatures, hit.position);
    const end = start + (hit.duration ?? 60);
    if (end > endTick) throw new Error(`Drum hit at tick ${start} ends after song end`);
    events.push(
      { tick: start, priority: 20, bytes: [0x99, hit.noteNumber, hit.velocity ?? 96] },
      { tick: end, priority: 10, bytes: [0x89, hit.noteNumber, 0] },
    );
  }
  return trackChunk(events, endTick);
}

function midiFile(options: RenderAccompanimentOptions, endTick: number): Buffer {
  const tracks = [
    conductorTrack(options.timeSignatures, options.tempos, endTick),
    ...options.tracks.map((track, index) =>
      instrumentTrack(track, MELODIC_CHANNELS[index]!, options.timeSignatures, endTick),
    ),
    ...((options.drums?.length ?? 0) > 0
      ? [drumTrack(options.drums ?? [], options.timeSignatures, endTick)]
      : []),
  ];
  const header = Buffer.from([
    ...Buffer.from("MThd", "ascii"),
    0x00, 0x00, 0x00, 0x06,
    0x00, 0x01,
    (tracks.length >>> 8) & 0xff, tracks.length & 0xff,
    (RESOLUTION >>> 8) & 0xff, RESOLUTION & 0xff,
  ]);
  return Buffer.concat([header, ...tracks]);
}

function validateOptions(options: RenderAccompanimentOptions): number {
  if (options.timeSignatures.length < 1 || options.timeSignatures[0]?.measure !== 0) {
    throw new Error("timeSignatures must begin at measure 0");
  }
  let previousMeasure = -1;
  for (const [index, signature] of options.timeSignatures.entries()) {
    assertIntegerRange(signature.measure, 0, 100_000, `timeSignatures[${index}].measure`);
    assertIntegerRange(signature.numerator, 1, 32, `timeSignatures[${index}].numerator`);
    if (![1, 2, 4, 8, 16, 32].includes(signature.denominator)) {
      throw new Error(`timeSignatures[${index}].denominator is unsupported`);
    }
    if (signature.measure <= previousMeasure) throw new Error("timeSignatures must be strictly ordered");
    previousMeasure = signature.measure;
  }
  if (options.tempos.length < 1) throw new Error("tempos must not be empty");
  let previousTempoTick = -1;
  for (const [index, tempo] of options.tempos.entries()) {
    if (!Number.isFinite(tempo.bpm) || tempo.bpm < 20 || tempo.bpm > 400) {
      throw new Error(`tempos[${index}].bpm must be in 20..400`);
    }
    const tick = musicalPositionToTick(options.timeSignatures, tempo.position);
    if (tick <= previousTempoTick) throw new Error("tempos must be strictly ordered");
    previousTempoTick = tick;
  }
  if (previousTempoTick < 0 || musicalPositionToTick(options.timeSignatures, options.tempos[0]!.position) !== 0) {
    throw new Error("tempos must begin at song position 0:0:0");
  }
  if (options.tracks.length < 1 || options.tracks.length > MELODIC_CHANNELS.length) {
    throw new Error(`tracks must contain 1..${MELODIC_CHANNELS.length} entries`);
  }
  for (const [trackIndex, track] of options.tracks.entries()) {
    if (track.name.length < 1 || track.name.length > 255) {
      throw new Error(`tracks[${trackIndex}].name must contain 1..255 characters`);
    }
    assertIntegerRange(track.program, 0, 127, `tracks[${trackIndex}].program`);
    assertIntegerRange(track.volume ?? 100, 0, 127, `tracks[${trackIndex}].volume`);
    assertIntegerRange(track.pan ?? 64, 0, 127, `tracks[${trackIndex}].pan`);
    for (const [noteIndex, note] of track.notes.entries()) {
      musicalPositionToTick(options.timeSignatures, note.position);
      assertIntegerRange(note.duration, 1, 2_147_483_647, `tracks[${trackIndex}].notes[${noteIndex}].duration`);
      assertIntegerRange(note.noteNumber, 0, 127, `tracks[${trackIndex}].notes[${noteIndex}].noteNumber`);
      assertIntegerRange(note.velocity ?? 88, 1, 127, `tracks[${trackIndex}].notes[${noteIndex}].velocity`);
    }
  }
  for (const [index, hit] of (options.drums ?? []).entries()) {
    musicalPositionToTick(options.timeSignatures, hit.position);
    assertIntegerRange(hit.noteNumber, 0, 127, `drums[${index}].noteNumber`);
    assertIntegerRange(hit.velocity ?? 96, 1, 127, `drums[${index}].velocity`);
    assertIntegerRange(hit.duration ?? 60, 1, 2_147_483_647, `drums[${index}].duration`);
  }
  if (!Number.isFinite(options.gain) || options.gain <= 0 || options.gain > 10) {
    throw new Error(`gain must be greater than 0 and at most 10, got ${options.gain}`);
  }
  const endTick = musicalPositionToTick(options.timeSignatures, options.end);
  if (endTick < 1) throw new Error("end must be after song position 0:0:0");
  return endTick;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function renderAccompaniment(
  options: RenderAccompanimentOptions,
): Promise<AccompanimentRenderResult> {
  const endTick = validateOptions(options);
  const outputPath = await resolveWritablePath(options.outputPath);
  if (extname(outputPath).toLowerCase() !== ".wav") {
    throw new Error(`Output path must end in .wav: ${outputPath}`);
  }
  const outputExists = await exists(outputPath);
  if (outputExists && !options.overwrite) {
    throw new Error(`Output already exists: ${outputPath}. Set overwrite=true to replace it.`);
  }
  const fluidsynth = process.env.FLUIDSYNTH_PATH ?? DEFAULT_FLUIDSYNTH;
  if (!(await exists(fluidsynth))) throw new Error(`FluidSynth is unavailable: ${fluidsynth}`);
  const soundfont = options.soundfontPath
    ? await resolveReadablePath(options.soundfontPath)
    : DEFAULT_SOUNDFONT;
  if (!(await exists(soundfont))) throw new Error(`SoundFont is unavailable: ${soundfont}`);

  const unique = `${process.pid}-${Date.now()}`;
  const temporaryMidi = join(dirname(outputPath), `.${basename(outputPath)}.${unique}.mid`);
  const temporaryWav = join(dirname(outputPath), `.${basename(outputPath)}.${unique}.wav`);
  try {
    await writeFile(temporaryMidi, midiFile(options, endTick), { flag: "wx" });
    try {
      await execFileAsync(
        fluidsynth,
        [
          "-ni",
          "-q",
          "-F", temporaryWav,
          "-T", "wav",
          "-O", "s16",
          "-r", String(options.sampleRate),
          "-g", String(options.gain),
          "-R", options.reverb ? "1" : "0",
          "-C", options.chorus ? "1" : "0",
          soundfont,
          temporaryMidi,
        ],
        { timeout: 300_000, maxBuffer: 1024 * 1024 },
      );
    } catch (error) {
      if (typeof error === "object" && error !== null) {
        const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim() : "";
        if (stderr) throw new Error(`FluidSynth render failed: ${stderr}`);
      }
      throw error;
    }
    const analysis = await analyzeWav(temporaryWav);
    if (analysis.audioFormat !== "pcm" || analysis.bitsPerSample !== 16 || analysis.channels !== 2) {
      throw new Error("FluidSynth did not produce a 16-bit PCM stereo WAV");
    }
    if (analysis.silent) {
      throw new Error(`Rendered accompaniment is effectively silent (peak=${analysis.peak}, rms=${analysis.rms})`);
    }
    let backupPath: string | undefined;
    if (outputExists) {
      backupPath = `${outputPath}.bak-${new Date().toISOString().replaceAll(":", "-")}`;
      await copyFile(outputPath, backupPath);
    }
    await rename(temporaryWav, outputPath);
    return {
      ...analysis,
      path: outputPath,
      outputPath,
      ...(backupPath ? { backupPath } : {}),
      soundfontPath: soundfont,
      tracks: options.tracks.length,
      notes: options.tracks.reduce((sum, track) => sum + track.notes.length, 0),
      drumHits: options.drums?.length ?? 0,
      endTick,
    };
  } finally {
    await unlink(temporaryMidi).catch(() => undefined);
    await unlink(temporaryWav).catch(() => undefined);
  }
}
