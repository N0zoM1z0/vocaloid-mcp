import { execFile } from "node:child_process";
import {
  access,
  copyFile,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { promisify } from "node:util";

import {
  DOMImplementation,
  DOMParser,
  XMLSerializer,
  type Document,
  type Element,
  type Node,
} from "@xmldom/xmldom";

import { resolveReadablePath, resolveWritablePath } from "./paths.js";
import { analyzeWav } from "./wav.js";
import type {
  ControlPointInfo,
  ControlPointInput,
  CurveName,
  NormalizedControlPoint,
  NoteExpressionUpdate,
  NoteInfo,
  NoteInput,
  Pagination,
  PartSummary,
  ProjectSummary,
  TrackSummary,
  VoiceInfo,
  VsqxFormat,
  WriteResult,
} from "./types.js";


const execFileAsync = promisify(execFile);
const MAX_PROJECT_BYTES = 50 * 1024 * 1024;
const XSI_NAMESPACE = "http://www.w3.org/2001/XMLSchema-instance";

const FORMAT_NAMESPACE: Record<VsqxFormat, string> = {
  vsq3: "http://www.yamaha.co.jp/vocaloid/schema/vsq3/",
  vsq4: "http://www.yamaha.co.jp/vocaloid/schema/vsq4/",
};

const V4_CURVE_IDS: Record<CurveName, string> = {
  DYN: "D",
  BRE: "B",
  BRI: "R",
  CLE: "C",
  GEN: "G",
  POR: "T",
  PIT: "P",
  PBS: "S",
};
const V4_CURVE_NAMES = new Map(
  Object.entries(V4_CURVE_IDS).map(([name, id]) => [id, name]),
);

const CURVE_RANGES: Record<CurveName, readonly [number, number]> = {
  DYN: [0, 127],
  BRE: [0, 127],
  BRI: [0, 127],
  CLE: [0, 127],
  GEN: [0, 127],
  POR: [0, 127],
  PIT: [-8192, 8191],
  PBS: [0, 24],
};

const DEFAULT_NOTE_STYLE: Readonly<Record<string, number>> = {
  accent: 50,
  bendDep: 8,
  bendLen: 0,
  decay: 50,
  fallPort: 0,
  opening: 127,
  risePort: 0,
  vibLen: 0,
  vibType: 0,
};

interface LoadedProject {
  path: string;
  document: Document;
  root: Element;
  format: VsqxFormat;
  namespace: string;
}

interface PartSelection {
  track: Element;
  part: Element;
  partStart: number;
}

export interface CreateProjectOptions {
  outputPath: string;
  format: VsqxFormat;
  voice: VoiceInfo;
  bankSelect: number;
  programChange: number;
  sequenceName: string;
  trackName: string;
  partName: string;
  bpm: number;
  numerator: number;
  denominator: number;
  preMeasure: number;
  notes: NoteInput[];
  controlCurves?: Partial<Record<CurveName, ControlPointInput[]>>;
  overwrite: boolean;
}

export interface MusicalPosition {
  /** Zero-based song measure, excluding the VSQX pre-measure count-in. */
  measure: number;
  /** Zero-based beat within the measure, measured in the active denominator. */
  beat: number;
  /** Additional ticks within the beat. */
  tick?: number;
}

export interface SongTimeSignatureInput {
  measure: number;
  numerator: number;
  denominator: number;
}

export interface SongTempoInput {
  position: MusicalPosition;
  bpm: number;
}

export type PositionedNoteInput = Omit<NoteInput, "tick"> & {
  position: MusicalPosition;
};

export interface PositionedControlPointInput {
  position: MusicalPosition;
  value: number;
}

export interface SongPartInput {
  name: string;
  comment?: string;
  start: MusicalPosition;
  end: MusicalPosition;
  notes: PositionedNoteInput[];
  controlCurves?: Partial<Record<CurveName, PositionedControlPointInput[]>>;
}

export interface SongMixerInput {
  volume?: number;
  pan?: number;
  mute?: boolean;
  solo?: boolean;
  sendLevel?: number;
  sendEnabled?: boolean;
}

export interface VocalMixerUnitInfo {
  trackNumber: number;
  trackName: string;
  volume: number;
  pan: number;
  panPosition: "left" | "center" | "right";
  panOffsetFromCenter: number;
  mute: boolean;
  solo: boolean;
  sendLevel: number;
  sendEnabled: boolean;
}

export interface VocalMixerUpdate {
  trackNumber: number;
  volume?: number;
  pan?: number;
  mute?: boolean;
  solo?: boolean;
  sendLevel?: number;
  sendEnabled?: boolean;
}

export interface SongTrackInput {
  name: string;
  comment?: string;
  voice: VoiceInfo;
  bankSelect: number;
  programChange: number;
  mixer?: SongMixerInput;
  parts: SongPartInput[];
}

export interface SongAudioPartInput {
  name: string;
  comment?: string;
  kind: "mono" | "stereo";
  filePath: string;
  start: MusicalPosition;
}

export interface CreateSongOptions {
  outputPath: string;
  format: VsqxFormat;
  sequenceName: string;
  preMeasure: number;
  timeSignatures: SongTimeSignatureInput[];
  tempos: SongTempoInput[];
  tracks: SongTrackInput[];
  audioParts?: SongAudioPartInput[];
  overwrite: boolean;
}

interface MixerTrackInput extends SongMixerInput {
  trackNumber: number;
}

interface ResolvedSongAudioPart extends SongAudioPartInput {
  windowsFilePath: string;
  sampleRate: number;
  bitsPerSample: number;
  channels: number;
  playTime: number;
}

function elementChildren(parent: Node): Element[] {
  const output: Element[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1) output.push(node as Element);
  }
  return output;
}

function localName(element: Element): string {
  return element.localName || element.nodeName.split(":").at(-1) || element.nodeName;
}

function directChildren(parent: Node, name: string): Element[] {
  return elementChildren(parent).filter((element) => localName(element) === name);
}

function firstChild(parent: Node, name: string): Element | null {
  return directChildren(parent, name)[0] ?? null;
}

function requiredChild(parent: Node, name: string): Element {
  const child = firstChild(parent, name);
  if (!child) throw new Error(`Malformed VSQX: missing <${name}>`);
  return child;
}

function text(parent: Node, name: string, fallback = ""): string {
  return firstChild(parent, name)?.textContent ?? fallback;
}

function integer(parent: Node, name: string, fallback = 0): number {
  const raw = text(parent, name, String(fallback));
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function setText(parent: Node, name: string, value: string | number): void {
  const child = requiredChild(parent, name);
  while (child.firstChild) child.removeChild(child.firstChild);
  const document = child.ownerDocument;
  if (!document) throw new Error(`Malformed VSQX: <${name}> has no owner document`);
  child.appendChild(document.createTextNode(String(value)));
}

function appendElement(
  document: Document,
  namespace: string,
  parent: Node,
  name: string,
  value?: string | number,
): Element {
  const element = document.createElementNS(namespace, name);
  if (value !== undefined) element.appendChild(document.createTextNode(String(value)));
  parent.appendChild(element);
  return element;
}

function appendCdataElement(
  document: Document,
  namespace: string,
  parent: Node,
  name: string,
  value: string,
): Element {
  if (value.includes("]]>")) {
    throw new Error(`${name} cannot contain the CDATA terminator ]]>`);
  }
  const element = document.createElementNS(namespace, name);
  element.appendChild(document.createCDATASection(value));
  parent.appendChild(element);
  return element;
}

function assertIntegerRange(value: number, minimum: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer in ${minimum}..${maximum}, got ${value}`);
  }
}

function validateNotes(notes: NoteInput[]): void {
  for (const [index, note] of notes.entries()) {
    assertIntegerRange(note.tick, 0, 2_147_483_647, `notes[${index}].tick`);
    assertIntegerRange(note.duration, 1, 2_147_483_647, `notes[${index}].duration`);
    assertIntegerRange(note.noteNumber, 0, 127, `notes[${index}].noteNumber`);
    assertIntegerRange(note.velocity ?? 64, 0, 127, `notes[${index}].velocity`);
    if (note.lyric.length > 32) throw new Error(`notes[${index}].lyric exceeds 32 characters`);
    if ((note.phonemes ?? "").length > 32) {
      throw new Error(`notes[${index}].phonemes exceeds 32 characters`);
    }
    if (note.vibrato) validateVibrato(note.vibrato, `notes[${index}].vibrato`);
  }
}

function validateNormalizedPoints(points: NormalizedControlPoint[], name: string): void {
  const positions = new Set<number>();
  for (const [index, point] of points.entries()) {
    assertIntegerRange(point.position, 0, 65_536, `${name}[${index}].position`);
    assertIntegerRange(point.value, 0, 127, `${name}[${index}].value`);
    if (positions.has(point.position)) {
      throw new Error(`${name} contains duplicate position ${point.position}`);
    }
    positions.add(point.position);
  }
}

function validateVibrato(vibrato: Partial<NonNullable<NoteInput["vibrato"]>>, name: string): void {
  if (vibrato.type !== undefined) assertIntegerRange(vibrato.type, 0, 16, `${name}.type`);
  if (vibrato.length !== undefined) assertIntegerRange(vibrato.length, 0, 100, `${name}.length`);
  if (vibrato.depth !== undefined) validateNormalizedPoints(vibrato.depth, `${name}.depth`);
  if (vibrato.rate !== undefined) validateNormalizedPoints(vibrato.rate, `${name}.rate`);
  if (vibrato.type === 0 && vibrato.length !== undefined && vibrato.length !== 0) {
    throw new Error(`${name}.length must be 0 when vibrato type is 0`);
  }
}

function detectFormat(root: Element): VsqxFormat {
  const name = localName(root);
  if (name === "vsq3" || name === "vsq4") return name;
  throw new Error(`Unsupported VSQX root <${name}>; expected <vsq3> or <vsq4>`);
}

export async function loadProject(inputPath: string): Promise<LoadedProject> {
  const path = await resolveReadablePath(inputPath);
  const data = await readFile(path);
  if (data.byteLength > MAX_PROJECT_BYTES) {
    throw new Error(`VSQX exceeds ${MAX_PROJECT_BYTES} byte safety limit: ${path}`);
  }
  const errors: string[] = [];
  const document = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") errors.push(message);
    },
  }).parseFromString(data.toString("utf8"), "application/xml");
  if (errors.length > 0) throw new Error(`Invalid XML: ${errors.join("; ")}`);
  const root = document.documentElement;
  if (!root) throw new Error("Invalid XML: missing document element");
  const format = detectFormat(root);
  const namespace = root.namespaceURI ?? FORMAT_NAMESPACE[format];
  if (namespace !== FORMAT_NAMESPACE[format]) {
    throw new Error(`Unexpected ${format} namespace: ${namespace}`);
  }
  return { path, document, root, format, namespace };
}

function voiceFields(format: VsqxFormat): {
  bank: string;
  program: string;
  id: string;
  name: string;
  param: string;
} {
  return format === "vsq4"
    ? { bank: "bs", program: "pc", id: "id", name: "name", param: "vPrm" }
    : {
        bank: "vBS",
        program: "vPC",
        id: "compID",
        name: "vVoiceName",
        param: "vVoiceParam",
      };
}

function readVoices(project: LoadedProject): ProjectSummary["voices"] {
  const fields = voiceFields(project.format);
  const table = requiredChild(project.root, "vVoiceTable");
  return directChildren(table, "vVoice").map((voice) => ({
    name: text(voice, fields.name),
    componentId: text(voice, fields.id),
    bankSelect: integer(voice, fields.bank),
    programChange: integer(voice, fields.program),
  }));
}

function trackFields(format: VsqxFormat): {
  number: string;
  name: string;
  part: string;
  partTick: string;
  partName: string;
  control: string;
} {
  return format === "vsq4"
    ? {
        number: "tNo",
        name: "name",
        part: "vsPart",
        partTick: "t",
        partName: "name",
        control: "cc",
      }
    : {
        number: "vsTrackNo",
        name: "trackName",
        part: "musicalPart",
        partTick: "posTick",
        partName: "partName",
        control: "mCtrl",
      };
}

function noteFields(format: VsqxFormat): {
  tick: string;
  duration: string;
  number: string;
  velocity: string;
  lyric: string;
  phonemes: string;
  style: string;
  styleValue: string;
} {
  return format === "vsq4"
    ? {
        tick: "t",
        duration: "dur",
        number: "n",
        velocity: "v",
        lyric: "y",
        phonemes: "p",
        style: "nStyle",
        styleValue: "v",
      }
    : {
        tick: "posTick",
        duration: "durTick",
        number: "noteNum",
        velocity: "velocity",
        lyric: "lyric",
        phonemes: "phnms",
        style: "noteStyle",
        styleValue: "attr",
      };
}

function readNote(note: Element, format: VsqxFormat, index: number): NoteInfo {
  const fields = noteFields(format);
  const tick = integer(note, fields.tick);
  const duration = integer(note, fields.duration);
  const phoneme = requiredChild(note, fields.phonemes);
  const style: Record<string, number> = {};
  const styleSequences: Record<string, NormalizedControlPoint[]> = {};
  const styleElement = firstChild(note, fields.style);
  if (styleElement) {
    for (const value of directChildren(styleElement, fields.styleValue)) {
      const id = value.getAttribute("id");
      if (id) style[id] = Number.parseInt(value.textContent ?? "0", 10);
    }
    const sequenceName = format === "vsq4" ? "seq" : "seqAttr";
    for (const sequence of directChildren(styleElement, sequenceName)) {
      const id = sequence.getAttribute("id");
      if (!id) continue;
      const pointName = format === "vsq4" ? "cc" : "elem";
      styleSequences[id] = directChildren(sequence, pointName).map((point) => ({
        position: integer(point, format === "vsq4" ? "p" : "posNrm"),
        value: integer(point, format === "vsq4" ? "v" : "elv"),
      }));
    }
  }
  return {
    index,
    tick,
    duration,
    endTick: tick + duration,
    noteNumber: integer(note, fields.number),
    velocity: integer(note, fields.velocity, 64),
    lyric: text(note, fields.lyric),
    phonemes: phoneme.textContent ?? "",
    phonemeLocked: phoneme.getAttribute("lock") === "1",
    style,
    styleSequences,
  };
}

function readPartSummary(part: Element, project: LoadedProject, index: number): PartSummary {
  const fields = trackFields(project.format);
  const singer = firstChild(part, "singer");
  return {
    index,
    name: text(part, fields.partName),
    tick: integer(part, fields.partTick),
    playTime: integer(part, "playTime"),
    noteCount: directChildren(part, "note").length,
    controlPointCount: directChildren(part, fields.control).length,
    singer: singer
      ? {
          bankSelect: integer(singer, project.format === "vsq4" ? "bs" : "vBS"),
          programChange: integer(singer, project.format === "vsq4" ? "pc" : "vPC"),
        }
      : null,
  };
}

function readTrackSummary(track: Element, project: LoadedProject): TrackSummary {
  const fields = trackFields(project.format);
  const parts = directChildren(track, fields.part).map((part, index) =>
    readPartSummary(part, project, index),
  );
  return {
    trackNumber: integer(track, fields.number),
    name: text(track, fields.name),
    partCount: parts.length,
    noteCount: parts.reduce((sum, part) => sum + part.noteCount, 0),
    controlPointCount: parts.reduce((sum, part) => sum + part.controlPointCount, 0),
    parts,
  };
}

function readAudioParts(project: LoadedProject): ProjectSummary["audioParts"] {
  const format4 = project.format === "vsq4";
  const tracks: Array<{ kind: "mono" | "stereo"; name: string }> = format4
    ? [
        { kind: "mono", name: "monoTrack" },
        { kind: "stereo", name: "stTrack" },
      ]
    : [
        { kind: "mono", name: "seTrack" },
        { kind: "stereo", name: "karaokeTrack" },
      ];
  return tracks.flatMap(({ kind, name }) => {
    const track = firstChild(project.root, name);
    if (!track) return [];
    return directChildren(track, "wavPart").map((part, index) => ({
      kind,
      index,
      name: text(part, format4 ? "name" : "partName"),
      tick: integer(part, format4 ? "t" : "posTick"),
      playTime: integer(part, "playTime"),
      sampleRate: integer(part, format4 ? "fs" : "sampleRate"),
      bitsPerSample: integer(part, format4 ? "rs" : "sampleReso"),
      channels: integer(part, format4 ? "nCh" : "channels"),
      filePath: text(part, "filePath"),
    }));
  });
}

function projectDiagnostics(project: LoadedProject): string[] {
  const diagnostics: string[] = [];
  const fields = trackFields(project.format);
  const trackNumbers = new Set<number>();
  for (const track of directChildren(project.root, "vsTrack")) {
    const trackNumber = integer(track, fields.number);
    if (trackNumbers.has(trackNumber)) diagnostics.push(`Duplicate track number ${trackNumber}`);
    trackNumbers.add(trackNumber);
    for (const [partIndex, part] of directChildren(track, fields.part).entries()) {
      const playTime = integer(part, "playTime");
      const notes = directChildren(part, "note")
        .map((note, index) => readNote(note, project.format, index))
        .sort((left, right) => left.tick - right.tick || left.index - right.index);
      let previousEnd = -1;
      for (const note of notes) {
        if (note.tick < previousEnd) {
          diagnostics.push(
            `Track ${trackNumber} part ${partIndex}: note ${note.index} overlaps the previous note`,
          );
        }
        if (note.endTick > playTime) {
          diagnostics.push(
            `Track ${trackNumber} part ${partIndex}: note ${note.index} ends after playTime`,
          );
        }
        previousEnd = Math.max(previousEnd, note.endTick);
      }
    }
  }
  return diagnostics;
}

export async function inspectProject(inputPath: string): Promise<ProjectSummary> {
  const project = await loadProject(inputPath);
  const master = requiredChild(project.root, "masterTrack");
  const format4 = project.format === "vsq4";
  const tracks = directChildren(project.root, "vsTrack").map((track) =>
    readTrackSummary(track, project),
  );
  return {
    path: project.path,
    format: project.format,
    namespace: project.namespace,
    vendor: text(project.root, "vender"),
    version: text(project.root, "version"),
    sequenceName: text(master, "seqName"),
    resolution: integer(master, "resolution"),
    preMeasure: integer(master, "preMeasure"),
    voices: readVoices(project),
    tempos: directChildren(master, "tempo").map((tempo) => ({
      tick: integer(tempo, format4 ? "t" : "posTick"),
      bpm: integer(tempo, format4 ? "v" : "bpm") / 100,
    })),
    timeSignatures: directChildren(master, "timeSig").map((signature) => ({
      measure: integer(signature, format4 ? "m" : "posMes"),
      numerator: integer(signature, format4 ? "nu" : "nume"),
      denominator: integer(signature, format4 ? "de" : "denomi"),
    })),
    tracks,
    audioParts: readAudioParts(project),
    diagnostics: projectDiagnostics(project),
  };
}

function selectPart(
  project: LoadedProject,
  trackNumber: number,
  partIndex: number,
): PartSelection {
  const fields = trackFields(project.format);
  const track = directChildren(project.root, "vsTrack").find(
    (candidate) => integer(candidate, fields.number) === trackNumber,
  );
  if (!track) throw new Error(`Track number ${trackNumber} was not found`);
  const part = directChildren(track, fields.part)[partIndex];
  if (!part) throw new Error(`Track ${trackNumber} has no part at index ${partIndex}`);
  return { track, part, partStart: integer(part, fields.partTick) };
}

function paginate<T>(items: T[], offset: number, limit: number): Pagination<T> {
  const page = items.slice(offset, offset + limit);
  const hasMore = offset + page.length < items.length;
  return {
    total: items.length,
    count: page.length,
    offset,
    items: page,
    has_more: hasMore,
    ...(hasMore ? { next_offset: offset + page.length } : {}),
  };
}

export async function listNotes(
  inputPath: string,
  trackNumber: number,
  partIndex: number,
  startTick: number | undefined,
  endTick: number | undefined,
  offset: number,
  limit: number,
): Promise<{ partStart: number; page: Pagination<NoteInfo> }> {
  const project = await loadProject(inputPath);
  const selection = selectPart(project, trackNumber, partIndex);
  const notes = directChildren(selection.part, "note")
    .map((note, index) => readNote(note, project.format, index))
    .filter((note) => startTick === undefined || note.endTick > startTick)
    .filter((note) => endTick === undefined || note.tick < endTick)
    .sort((left, right) => left.tick - right.tick || left.index - right.index);
  return { partStart: selection.partStart, page: paginate(notes, offset, limit) };
}

function normalizeCurveId(format: VsqxFormat, id: string): string {
  return format === "vsq4" ? (V4_CURVE_NAMES.get(id) ?? id) : id;
}

function encodedCurveId(format: VsqxFormat, curve: CurveName): string {
  return format === "vsq4" ? V4_CURVE_IDS[curve] : curve;
}

function readControl(control: Element, format: VsqxFormat, index: number): ControlPointInfo {
  const valueName = format === "vsq4" ? "v" : "attr";
  const tickName = format === "vsq4" ? "t" : "posTick";
  const value = requiredChild(control, valueName);
  return {
    index,
    tick: integer(control, tickName),
    value: Number.parseInt(value.textContent ?? "0", 10),
    curve: normalizeCurveId(format, value.getAttribute("id") ?? ""),
  };
}

export async function listControlPoints(
  inputPath: string,
  trackNumber: number,
  partIndex: number,
  curve: CurveName | undefined,
  startTick: number | undefined,
  endTick: number | undefined,
  offset: number,
  limit: number,
): Promise<{ partStart: number; page: Pagination<ControlPointInfo> }> {
  const project = await loadProject(inputPath);
  const selection = selectPart(project, trackNumber, partIndex);
  const controlName = trackFields(project.format).control;
  const controls = directChildren(selection.part, controlName)
    .map((control, index) => readControl(control, project.format, index))
    .filter((control) => curve === undefined || control.curve === curve)
    .filter((control) => startTick === undefined || control.tick >= startTick)
    .filter((control) => endTick === undefined || control.tick < endTick)
    .sort((left, right) => left.tick - right.tick || left.index - right.index);
  return { partStart: selection.partStart, page: paginate(controls, offset, limit) };
}

function appendVoice(
  document: Document,
  namespace: string,
  parent: Node,
  format: VsqxFormat,
  voice: VoiceInfo,
  bankSelect: number,
  programChange: number,
): void {
  const fields = voiceFields(format);
  const entry = appendElement(document, namespace, parent, "vVoice");
  appendElement(document, namespace, entry, fields.bank, bankSelect);
  appendElement(document, namespace, entry, fields.program, programChange);
  appendCdataElement(document, namespace, entry, fields.id, voice.componentId);
  appendCdataElement(document, namespace, entry, fields.name, voice.name);
  const parameters = appendElement(document, namespace, entry, fields.param);
  for (const [name, value] of Object.entries({ bre: 0, bri: 0, cle: 0, gen: 0, ope: 0 })) {
    appendElement(document, namespace, parameters, name, value);
  }
}

function appendMixer(
  document: Document,
  namespace: string,
  root: Node,
  format: VsqxFormat,
  tracks: readonly MixerTrackInput[] = [{ trackNumber: 0 }],
): void {
  const mixer = appendElement(document, namespace, root, "mixer");
  if (format === "vsq4") {
    const master = appendElement(document, namespace, mixer, "masterUnit");
    appendElement(document, namespace, master, "oDev", 0);
    appendElement(document, namespace, master, "rLvl", 0);
    appendElement(document, namespace, master, "vol", 0);
    for (const track of tracks) {
      const unit = appendElement(document, namespace, mixer, "vsUnit");
      for (const [name, value] of Object.entries({
        tNo: track.trackNumber,
        iGin: 0,
        sLvl: track.sendLevel ?? -898,
        sEnable: track.sendEnabled ? 1 : 0,
        m: track.mute ? 1 : 0,
        s: track.solo ? 1 : 0,
        pan: track.pan ?? 64,
        vol: track.volume ?? 0,
      })) appendElement(document, namespace, unit, name, value);
    }
    const mono = appendElement(document, namespace, mixer, "monoUnit");
    for (const [name, value] of Object.entries({
      iGin: 0,
      sLvl: -898,
      sEnable: 0,
      m: 0,
      s: 0,
      pan: 64,
      vol: 0,
    })) appendElement(document, namespace, mono, name, value);
    const stereo = appendElement(document, namespace, mixer, "stUnit");
    for (const [name, value] of Object.entries({ iGin: 0, m: 0, s: 0, vol: 0 })) {
      appendElement(document, namespace, stereo, name, value);
    }
  } else {
    const master = appendElement(document, namespace, mixer, "masterUnit");
    appendElement(document, namespace, master, "outDev", 0);
    appendElement(document, namespace, master, "retLevel", 0);
    appendElement(document, namespace, master, "vol", 0);
    for (const track of tracks) {
      const unit = appendElement(document, namespace, mixer, "vsUnit");
      for (const [name, value] of Object.entries({
        vsTrackNo: track.trackNumber,
        inGain: 0,
        sendLevel: track.sendLevel ?? -898,
        sendEnable: track.sendEnabled ? 1 : 0,
        mute: track.mute ? 1 : 0,
        solo: track.solo ? 1 : 0,
        pan: track.pan ?? 64,
        vol: track.volume ?? 0,
      })) appendElement(document, namespace, unit, name, value);
    }
    const se = appendElement(document, namespace, mixer, "seUnit");
    for (const [name, value] of Object.entries({
      inGain: 0,
      sendLevel: -898,
      sendEnable: 0,
      mute: 0,
      solo: 0,
      pan: 64,
      vol: 0,
    })) appendElement(document, namespace, se, name, value);
    const karaoke = appendElement(document, namespace, mixer, "karaokeUnit");
    for (const [name, value] of Object.entries({ inGain: 0, mute: 0, solo: 0, vol: 0 })) {
      appendElement(document, namespace, karaoke, name, value);
    }
  }
}

function mixerUnitFields(format: VsqxFormat): {
  trackNumber: string;
  volume: string;
  pan: string;
  mute: string;
  solo: string;
  sendLevel: string;
  sendEnabled: string;
} {
  return format === "vsq4"
    ? {
        trackNumber: "tNo",
        volume: "vol",
        pan: "pan",
        mute: "m",
        solo: "s",
        sendLevel: "sLvl",
        sendEnabled: "sEnable",
      }
    : {
        trackNumber: "vsTrackNo",
        volume: "vol",
        pan: "pan",
        mute: "mute",
        solo: "solo",
        sendLevel: "sendLevel",
        sendEnabled: "sendEnable",
      };
}

function vocalTrackNames(project: LoadedProject): Map<number, string> {
  const fields = trackFields(project.format);
  return new Map(
    directChildren(project.root, "vsTrack").map((track) => [
      integer(track, fields.number),
      text(track, fields.name),
    ]),
  );
}

function readVocalMixerUnits(project: LoadedProject): VocalMixerUnitInfo[] {
  const mixer = requiredChild(project.root, "mixer");
  const fields = mixerUnitFields(project.format);
  const trackNames = vocalTrackNames(project);
  return directChildren(mixer, "vsUnit")
    .map((unit) => {
      const trackNumber = integer(unit, fields.trackNumber);
      const pan = integer(unit, fields.pan);
      return {
        trackNumber,
        trackName: trackNames.get(trackNumber) ?? `Track ${trackNumber}`,
        volume: integer(unit, fields.volume),
        pan,
        panPosition: pan === 64 ? "center" as const : pan < 64 ? "left" as const : "right" as const,
        panOffsetFromCenter: pan - 64,
        mute: integer(unit, fields.mute) !== 0,
        solo: integer(unit, fields.solo) !== 0,
        sendLevel: integer(unit, fields.sendLevel),
        sendEnabled: integer(unit, fields.sendEnabled) !== 0,
      };
    })
    .sort((left, right) => left.trackNumber - right.trackNumber);
}

function appendNote(
  document: Document,
  namespace: string,
  part: Node,
  format: VsqxFormat,
  note: NoteInput,
): Element {
  const fields = noteFields(format);
  const element = appendElement(document, namespace, part, "note");
  appendElement(document, namespace, element, fields.tick, note.tick);
  appendElement(document, namespace, element, fields.duration, note.duration);
  appendElement(document, namespace, element, fields.number, note.noteNumber);
  appendElement(document, namespace, element, fields.velocity, note.velocity ?? 64);
  appendCdataElement(document, namespace, element, fields.lyric, note.lyric);
  const phonemes = appendCdataElement(
    document,
    namespace,
    element,
    fields.phonemes,
    note.phonemes ?? note.lyric,
  );
  if (note.phonemeLocked) phonemes.setAttribute("lock", "1");
  const style = appendElement(document, namespace, element, fields.style);
  const styleValues = {
    ...DEFAULT_NOTE_STYLE,
    ...note.style,
    ...(note.vibrato
      ? { vibLen: note.vibrato.length, vibType: note.vibrato.type }
      : {}),
  };
  for (const [id, value] of Object.entries(styleValues)) {
    const attribute = appendElement(document, namespace, style, fields.styleValue, value);
    attribute.setAttribute("id", id);
  }
  if (note.vibrato) {
    appendStyleSequence(document, namespace, style, format, "vibDep", note.vibrato.depth ?? []);
    appendStyleSequence(document, namespace, style, format, "vibRate", note.vibrato.rate ?? []);
  }
  return element;
}

function appendStyleSequence(
  document: Document,
  namespace: string,
  style: Node,
  format: VsqxFormat,
  id: "vibDep" | "vibRate",
  points: NormalizedControlPoint[],
): Element | null {
  if (points.length === 0) return null;
  const sequence = appendElement(
    document,
    namespace,
    style,
    format === "vsq4" ? "seq" : "seqAttr",
  );
  sequence.setAttribute("id", id);
  for (const point of [...points].sort((left, right) => left.position - right.position)) {
    const entry = appendElement(
      document,
      namespace,
      sequence,
      format === "vsq4" ? "cc" : "elem",
    );
    appendElement(
      document,
      namespace,
      entry,
      format === "vsq4" ? "p" : "posNrm",
      point.position,
    );
    appendElement(
      document,
      namespace,
      entry,
      format === "vsq4" ? "v" : "elv",
      point.value,
    );
  }
  return sequence;
}

function appendStyleAndSinger(
  document: Document,
  namespace: string,
  part: Node,
  format: VsqxFormat,
  bankSelect: number,
  programChange: number,
): void {
  const style = appendElement(
    document,
    namespace,
    part,
    format === "vsq4" ? "sPlug" : "stylePlugin",
  );
  appendCdataElement(
    document,
    namespace,
    style,
    format === "vsq4" ? "id" : "stylePluginID",
    "ACA9C502-A04B-42b5-B2EB-5CEA36D16FCE",
  );
  appendCdataElement(
    document,
    namespace,
    style,
    format === "vsq4" ? "name" : "stylePluginName",
    "VOCALOID2 Compatible Style",
  );
  appendCdataElement(document, namespace, style, "version", "3.0.0.1");
  const partStyle = appendElement(
    document,
    namespace,
    part,
    format === "vsq4" ? "pStyle" : "partStyle",
  );
  const styleValueName = format === "vsq4" ? "v" : "attr";
  for (const [id, value] of Object.entries({
    accent: 50,
    bendDep: 8,
    bendLen: 0,
    decay: 50,
    fallPort: 0,
    opening: 127,
    risePort: 0,
  })) {
    const valueElement = appendElement(document, namespace, partStyle, styleValueName, value);
    valueElement.setAttribute("id", id);
  }
  const singer = appendElement(document, namespace, part, "singer");
  appendElement(document, namespace, singer, format === "vsq4" ? "t" : "posTick", 0);
  appendElement(document, namespace, singer, format === "vsq4" ? "bs" : "vBS", bankSelect);
  appendElement(document, namespace, singer, format === "vsq4" ? "pc" : "vPC", programChange);
}

function createDocument(options: CreateProjectOptions): LoadedProject {
  validateNotes(options.notes);
  assertIntegerRange(options.bankSelect, 0, 127, "bankSelect");
  assertIntegerRange(options.programChange, 0, 127, "programChange");
  const namespace = FORMAT_NAMESPACE[options.format];
  const document = new DOMImplementation().createDocument(namespace, options.format, null);
  const root = document.documentElement;
  if (!root) throw new Error("Could not create VSQX document root");
  root.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:xsi", XSI_NAMESPACE);
  root.setAttributeNS(
    XSI_NAMESPACE,
    "xsi:schemaLocation",
    `${namespace} ${options.format}.xsd`,
  );
  appendCdataElement(document, namespace, root, "vender", "Yamaha corporation");
  appendCdataElement(
    document,
    namespace,
    root,
    "version",
    options.format === "vsq4" ? "4.0.0.3" : "3.0.0.11",
  );
  const voices = appendElement(document, namespace, root, "vVoiceTable");
  appendVoice(
    document,
    namespace,
    voices,
    options.format,
    options.voice,
    options.bankSelect,
    options.programChange,
  );
  appendMixer(document, namespace, root, options.format);

  const master = appendElement(document, namespace, root, "masterTrack");
  appendCdataElement(document, namespace, master, "seqName", options.sequenceName);
  appendCdataElement(
    document,
    namespace,
    master,
    "comment",
    "Created by vocaloid-mcp-server",
  );
  appendElement(document, namespace, master, "resolution", 480);
  appendElement(document, namespace, master, "preMeasure", options.preMeasure);
  const signature = appendElement(document, namespace, master, "timeSig");
  appendElement(document, namespace, signature, options.format === "vsq4" ? "m" : "posMes", 0);
  appendElement(document, namespace, signature, options.format === "vsq4" ? "nu" : "nume", options.numerator);
  appendElement(document, namespace, signature, options.format === "vsq4" ? "de" : "denomi", options.denominator);
  const tempo = appendElement(document, namespace, master, "tempo");
  appendElement(document, namespace, tempo, options.format === "vsq4" ? "t" : "posTick", 0);
  appendElement(document, namespace, tempo, options.format === "vsq4" ? "v" : "bpm", Math.round(options.bpm * 100));

  const track = appendElement(document, namespace, root, "vsTrack");
  appendElement(document, namespace, track, options.format === "vsq4" ? "tNo" : "vsTrackNo", 0);
  appendCdataElement(
    document,
    namespace,
    track,
    options.format === "vsq4" ? "name" : "trackName",
    options.trackName,
  );
  appendCdataElement(document, namespace, track, "comment", "Vocal track");
  const part = appendElement(
    document,
    namespace,
    track,
    options.format === "vsq4" ? "vsPart" : "musicalPart",
  );
  const measureTicks = Math.round((480 * 4 * options.numerator) / options.denominator);
  appendElement(
    document,
    namespace,
    part,
    options.format === "vsq4" ? "t" : "posTick",
    options.preMeasure * measureTicks,
  );
  const playTime = Math.max(
    measureTicks * 4,
    ...options.notes.map((note) => note.tick + note.duration),
  );
  appendElement(document, namespace, part, "playTime", playTime);
  appendCdataElement(
    document,
    namespace,
    part,
    options.format === "vsq4" ? "name" : "partName",
    options.partName,
  );
  appendCdataElement(document, namespace, part, "comment", "Musical part");
  appendStyleAndSinger(
    document,
    namespace,
    part,
    options.format,
    options.bankSelect,
    options.programChange,
  );
  const project = {
    path: options.outputPath,
    document,
    root,
    format: options.format,
    namespace,
  };
  const controls = Object.entries(options.controlCurves ?? {}) as Array<
    [CurveName, ControlPointInput[]]
  >;
  for (const [curve, points] of controls) validateControlPoints(curve, points);
  for (const [curve, points] of controls) {
    for (const point of [...points].sort((left, right) => left.tick - right.tick)) {
      createControl(project, part, curve, point);
    }
  }
  for (const note of [...options.notes].sort((left, right) => left.tick - right.tick)) {
    appendNote(document, namespace, part, options.format, note);
  }
  if (options.format === "vsq4") {
    appendElement(document, namespace, root, "monoTrack");
    appendElement(document, namespace, root, "stTrack");
  } else {
    appendElement(document, namespace, root, "seTrack");
    appendElement(document, namespace, root, "karaokeTrack");
  }
  return project;
}

const SONG_RESOLUTION = 480;

function measureTicks(signature: SongTimeSignatureInput): number {
  return Math.round((SONG_RESOLUTION * 4 * signature.numerator) / signature.denominator);
}

function activeTimeSignature(
  signatures: readonly SongTimeSignatureInput[],
  measure: number,
): SongTimeSignatureInput {
  let active = signatures[0];
  if (!active) throw new Error("timeSignatures must not be empty");
  for (const signature of signatures) {
    if (signature.measure > measure) break;
    active = signature;
  }
  return active;
}

function measureStartTick(
  signatures: readonly SongTimeSignatureInput[],
  targetMeasure: number,
): number {
  let tick = 0;
  for (let index = 0; index < signatures.length; index += 1) {
    const signature = signatures[index];
    if (!signature || signature.measure >= targetMeasure) break;
    const nextMeasure = signatures[index + 1]?.measure ?? targetMeasure;
    const endMeasure = Math.min(nextMeasure, targetMeasure);
    tick += (endMeasure - signature.measure) * measureTicks(signature);
  }
  return tick;
}

function songPositionTick(
  signatures: readonly SongTimeSignatureInput[],
  position: MusicalPosition,
  name: string,
): number {
  assertIntegerRange(position.measure, 0, 100_000, `${name}.measure`);
  const signature = activeTimeSignature(signatures, position.measure);
  assertIntegerRange(position.beat, 0, signature.numerator - 1, `${name}.beat`);
  const ticksPerBeat = (SONG_RESOLUTION * 4) / signature.denominator;
  assertIntegerRange(position.tick ?? 0, 0, ticksPerBeat - 1, `${name}.tick`);
  return measureStartTick(signatures, position.measure)
    + position.beat * ticksPerBeat
    + (position.tick ?? 0);
}

export function musicalPositionToTick(
  signatures: readonly SongTimeSignatureInput[],
  position: MusicalPosition,
): number {
  return songPositionTick(signatures, position, "position");
}

export function musicalTickToPosition(
  signatures: readonly SongTimeSignatureInput[],
  tick: number,
): MusicalPosition {
  assertIntegerRange(tick, 0, 2_147_483_647, "tick");
  if (signatures.length === 0 || signatures[0]?.measure !== 0) {
    throw new Error("time signatures must begin at measure 0");
  }
  let segmentStartTick = 0;
  for (let index = 0; index < signatures.length; index += 1) {
    const signature = signatures[index]!;
    const nextMeasure = signatures[index + 1]?.measure;
    const ticksPerMeasure = measureTicks(signature);
    const segmentMeasures = nextMeasure === undefined
      ? Number.POSITIVE_INFINITY
      : nextMeasure - signature.measure;
    const segmentTicks = segmentMeasures * ticksPerMeasure;
    if (tick < segmentStartTick + segmentTicks) {
      const withinSegment = tick - segmentStartTick;
      const measureOffset = Math.floor(withinSegment / ticksPerMeasure);
      const withinMeasure = withinSegment - measureOffset * ticksPerMeasure;
      const ticksPerBeat = (SONG_RESOLUTION * 4) / signature.denominator;
      const beat = Math.floor(withinMeasure / ticksPerBeat);
      return {
        measure: signature.measure + measureOffset,
        beat,
        tick: withinMeasure - beat * ticksPerBeat,
      };
    }
    segmentStartTick += segmentTicks;
  }
  throw new Error(`Could not map tick ${tick} to a musical position`);
}

function audioDurationTicks(
  signatures: readonly SongTimeSignatureInput[],
  tempos: readonly SongTempoInput[],
  startPosition: MusicalPosition,
  durationSeconds: number,
): number {
  const startTick = songPositionTick(signatures, startPosition, "audio.start");
  const tempoEvents = tempos.map((tempo, index) => ({
    tick: songPositionTick(signatures, tempo.position, `tempos[${index}].position`),
    bpm: tempo.bpm,
  }));
  let currentTick = startTick;
  let remaining = durationSeconds;
  let tempoIndex = 0;
  for (let index = 0; index < tempoEvents.length; index += 1) {
    if (tempoEvents[index]!.tick <= startTick) tempoIndex = index;
    else break;
  }
  while (remaining > 0) {
    const active = tempoEvents[tempoIndex]!;
    const next = tempoEvents[tempoIndex + 1];
    if (next && next.tick > currentTick) {
      const secondsToNext = ((next.tick - currentTick) * 60) / (SONG_RESOLUTION * active.bpm);
      if (remaining > secondsToNext) {
        remaining -= secondsToNext;
        currentTick = next.tick;
        tempoIndex += 1;
        continue;
      }
    }
    currentTick += Math.round((remaining * SONG_RESOLUTION * active.bpm) / 60);
    remaining = 0;
  }
  return Math.max(1, currentTick - startTick);
}

async function windowsFilePath(path: string): Promise<string> {
  const { stdout } = await execFileAsync("wslpath", ["-w", path], {
    timeout: 10_000,
    maxBuffer: 64 * 1024,
  });
  const converted = stdout.trim();
  if (!converted) throw new Error(`Could not convert WAV path for Windows: ${path}`);
  if (converted.length > 260) throw new Error(`Windows WAV path exceeds 260 characters: ${converted}`);
  return converted;
}

async function resolveSongAudioParts(
  options: CreateSongOptions,
): Promise<ResolvedSongAudioPart[]> {
  const output: ResolvedSongAudioPart[] = [];
  for (const [index, audio] of (options.audioParts ?? []).entries()) {
    const source = await resolveReadablePath(audio.filePath);
    if (extname(source).toLowerCase() !== ".wav") {
      throw new Error(`audioParts[${index}].filePath must end in .wav: ${source}`);
    }
    const analysis = await analyzeWav(source);
    if (analysis.audioFormat !== "pcm") {
      throw new Error(`audioParts[${index}] must use PCM WAV for VOCALOID3 import`);
    }
    if (![44_100, 48_000, 96_000].includes(analysis.sampleRate)) {
      throw new Error(
        `audioParts[${index}] sample rate ${analysis.sampleRate} is unsupported by VSQX; use 44100, 48000, or 96000 Hz`,
      );
    }
    if (analysis.bitsPerSample !== 16) {
      throw new Error(
        `audioParts[${index}] resolution ${analysis.bitsPerSample} is unsupported by VOCALOID3 import; use 16-bit PCM`,
      );
    }
    const expectedChannels = audio.kind === "mono" ? 1 : 2;
    if (analysis.channels !== expectedChannels) {
      throw new Error(
        `audioParts[${index}] is declared ${audio.kind} but contains ${analysis.channels} channels`,
      );
    }
    output.push({
      ...audio,
      filePath: source,
      windowsFilePath: await windowsFilePath(source),
      sampleRate: analysis.sampleRate,
      bitsPerSample: analysis.bitsPerSample,
      channels: analysis.channels,
      playTime: audioDurationTicks(
        options.timeSignatures,
        options.tempos,
        audio.start,
        analysis.durationSeconds,
      ),
    });
  }
  return output;
}

function validateSongOptions(options: CreateSongOptions): void {
  assertIntegerRange(options.preMeasure, 0, 127, "preMeasure");
  if (options.sequenceName.length < 1 || options.sequenceName.length > 256) {
    throw new Error("sequenceName must contain 1..256 characters");
  }
  if (options.timeSignatures.length < 1) throw new Error("timeSignatures must not be empty");
  if (options.tempos.length < 1) throw new Error("tempos must not be empty");
  if (options.tracks.length < 1 || options.tracks.length > 16) {
    throw new Error(`tracks must contain 1..16 entries, got ${options.tracks.length}`);
  }
  if ((options.audioParts?.length ?? 0) > 256) {
    throw new Error(`audioParts must contain at most 256 entries, got ${options.audioParts?.length}`);
  }

  let previousMeasure = -1;
  for (const [index, signature] of options.timeSignatures.entries()) {
    assertIntegerRange(signature.measure, 0, 100_000, `timeSignatures[${index}].measure`);
    assertIntegerRange(signature.numerator, 1, 32, `timeSignatures[${index}].numerator`);
    if (![1, 2, 4, 8, 16, 32].includes(signature.denominator)) {
      throw new Error(`timeSignatures[${index}].denominator must be 1, 2, 4, 8, 16, or 32`);
    }
    if (signature.measure <= previousMeasure) {
      throw new Error("timeSignatures must be strictly ordered by measure without duplicates");
    }
    previousMeasure = signature.measure;
  }
  if (options.timeSignatures[0]?.measure !== 0) {
    throw new Error("timeSignatures must begin at measure 0");
  }

  let previousTempoTick = -1;
  for (const [index, tempo] of options.tempos.entries()) {
    if (!Number.isFinite(tempo.bpm) || tempo.bpm < 20 || tempo.bpm > 400) {
      throw new Error(`tempos[${index}].bpm must be in 20..400, got ${tempo.bpm}`);
    }
    const tick = songPositionTick(options.timeSignatures, tempo.position, `tempos[${index}].position`);
    if (tick <= previousTempoTick) {
      throw new Error("tempos must be strictly ordered by position without duplicates");
    }
    previousTempoTick = tick;
  }
  const firstTempo = options.tempos[0]?.position;
  if (!firstTempo || firstTempo.measure !== 0 || firstTempo.beat !== 0 || (firstTempo.tick ?? 0) !== 0) {
    throw new Error("tempos must begin at measure 0, beat 0, tick 0");
  }

  for (const [index, audio] of (options.audioParts ?? []).entries()) {
    if (audio.name.length < 1 || audio.name.length > 256) {
      throw new Error(`audioParts[${index}].name must contain 1..256 characters`);
    }
    if ((audio.comment ?? "").length > 256) {
      throw new Error(`audioParts[${index}].comment exceeds 256 characters`);
    }
    songPositionTick(options.timeSignatures, audio.start, `audioParts[${index}].start`);
  }

  const voiceSlots = new Map<string, string>();
  for (const [trackIndex, track] of options.tracks.entries()) {
    if (track.name.length < 1 || track.name.length > 256) {
      throw new Error(`tracks[${trackIndex}].name must contain 1..256 characters`);
    }
    if ((track.comment ?? "").length > 256) {
      throw new Error(`tracks[${trackIndex}].comment exceeds 256 characters`);
    }
    if (track.voice.componentId.length !== 16) {
      throw new Error(`tracks[${trackIndex}].voice.componentId must contain exactly 16 characters`);
    }
    assertIntegerRange(track.bankSelect, 0, 127, `tracks[${trackIndex}].bankSelect`);
    assertIntegerRange(track.programChange, 0, 127, `tracks[${trackIndex}].programChange`);
    const slot = `${track.bankSelect}:${track.programChange}`;
    const installed = voiceSlots.get(slot);
    if (installed && installed !== track.voice.componentId) {
      throw new Error(
        `Voice slot ${slot} is assigned to both ${installed} and ${track.voice.componentId}`,
      );
    }
    voiceSlots.set(slot, track.voice.componentId);
    if (track.mixer?.volume !== undefined) {
      assertIntegerRange(track.mixer.volume, -898, 600, `tracks[${trackIndex}].mixer.volume`);
    }
    if (track.mixer?.pan !== undefined) {
      assertIntegerRange(track.mixer.pan, 0, 127, `tracks[${trackIndex}].mixer.pan`);
    }
    if (track.mixer?.sendLevel !== undefined) {
      assertIntegerRange(track.mixer.sendLevel, -898, 0, `tracks[${trackIndex}].mixer.sendLevel`);
    }
    if (track.parts.length < 1) throw new Error(`tracks[${trackIndex}].parts must not be empty`);

    let previousPartEnd = -1;
    for (const [partIndex, part] of track.parts.entries()) {
      const prefix = `tracks[${trackIndex}].parts[${partIndex}]`;
      if (part.name.length < 1 || part.name.length > 256) {
        throw new Error(`${prefix}.name must contain 1..256 characters`);
      }
      if ((part.comment ?? "").length > 256) throw new Error(`${prefix}.comment exceeds 256 characters`);
      const start = songPositionTick(options.timeSignatures, part.start, `${prefix}.start`);
      const end = songPositionTick(options.timeSignatures, part.end, `${prefix}.end`);
      if (end <= start) throw new Error(`${prefix}.end must be after start`);
      if (start < previousPartEnd) throw new Error(`${prefix} overlaps the previous part on its track`);
      previousPartEnd = end;

      const relativeNotes: NoteInput[] = part.notes.map((note, noteIndex) => {
        const absolute = songPositionTick(
          options.timeSignatures,
          note.position,
          `${prefix}.notes[${noteIndex}].position`,
        );
        if (absolute < start || absolute >= end) {
          throw new Error(`${prefix}.notes[${noteIndex}] starts outside its part`);
        }
        if (absolute + note.duration > end) {
          throw new Error(`${prefix}.notes[${noteIndex}] ends outside its part`);
        }
        return { ...note, tick: absolute - start };
      });
      validateNotes(relativeNotes);
      const orderedNotes = [...relativeNotes].sort((left, right) => left.tick - right.tick);
      let previousNoteEnd = -1;
      for (const note of orderedNotes) {
        if (note.tick < previousNoteEnd) throw new Error(`${prefix}.notes overlap; use another track for polyphony`);
        previousNoteEnd = note.tick + note.duration;
      }

      for (const [curve, points] of Object.entries(part.controlCurves ?? {}) as Array<
        [CurveName, PositionedControlPointInput[]]
      >) {
        const relativePoints = points.map((point, pointIndex) => {
          const absolute = songPositionTick(
            options.timeSignatures,
            point.position,
            `${prefix}.controlCurves.${curve}[${pointIndex}].position`,
          );
          if (absolute < start || absolute >= end) {
            throw new Error(`${prefix}.controlCurves.${curve}[${pointIndex}] is outside its part`);
          }
          return { tick: absolute - start, value: point.value };
        });
        validateControlPoints(curve, relativePoints);
      }
    }
  }
}

function createSongDocument(
  options: CreateSongOptions,
  audioParts: readonly ResolvedSongAudioPart[],
): LoadedProject {
  validateSongOptions(options);
  const namespace = FORMAT_NAMESPACE[options.format];
  const document = new DOMImplementation().createDocument(namespace, options.format, null);
  const root = document.documentElement;
  if (!root) throw new Error("Could not create VSQX document root");
  root.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:xsi", XSI_NAMESPACE);
  root.setAttributeNS(XSI_NAMESPACE, "xsi:schemaLocation", `${namespace} ${options.format}.xsd`);
  appendCdataElement(document, namespace, root, "vender", "Yamaha corporation");
  appendCdataElement(
    document,
    namespace,
    root,
    "version",
    options.format === "vsq4" ? "4.0.0.3" : "3.0.0.11",
  );

  const voices = appendElement(document, namespace, root, "vVoiceTable");
  const appendedVoiceSlots = new Set<string>();
  for (const track of options.tracks) {
    const slot = `${track.bankSelect}:${track.programChange}`;
    if (appendedVoiceSlots.has(slot)) continue;
    appendVoice(
      document,
      namespace,
      voices,
      options.format,
      track.voice,
      track.bankSelect,
      track.programChange,
    );
    appendedVoiceSlots.add(slot);
  }
  appendMixer(
    document,
    namespace,
    root,
    options.format,
    options.tracks.map((track, trackNumber) => ({ trackNumber, ...track.mixer })),
  );

  const master = appendElement(document, namespace, root, "masterTrack");
  appendCdataElement(document, namespace, master, "seqName", options.sequenceName);
  appendCdataElement(document, namespace, master, "comment", "Created by vocaloid-mcp-server");
  appendElement(document, namespace, master, "resolution", SONG_RESOLUTION);
  appendElement(document, namespace, master, "preMeasure", options.preMeasure);
  for (const signature of options.timeSignatures) {
    const element = appendElement(document, namespace, master, "timeSig");
    appendElement(document, namespace, element, options.format === "vsq4" ? "m" : "posMes", signature.measure);
    appendElement(document, namespace, element, options.format === "vsq4" ? "nu" : "nume", signature.numerator);
    appendElement(document, namespace, element, options.format === "vsq4" ? "de" : "denomi", signature.denominator);
  }
  const preMeasureTicks = options.preMeasure * measureTicks(options.timeSignatures[0]!);
  for (const [index, tempo] of options.tempos.entries()) {
    const element = appendElement(document, namespace, master, "tempo");
    const songTick = songPositionTick(options.timeSignatures, tempo.position, `tempos[${index}].position`);
    const projectTick = index === 0 ? 0 : preMeasureTicks + songTick;
    appendElement(document, namespace, element, options.format === "vsq4" ? "t" : "posTick", projectTick);
    appendElement(document, namespace, element, options.format === "vsq4" ? "v" : "bpm", Math.round(tempo.bpm * 100));
  }

  const project: LoadedProject = {
    path: options.outputPath,
    document,
    root,
    format: options.format,
    namespace,
  };
  const fields = trackFields(options.format);
  for (const [trackNumber, trackInput] of options.tracks.entries()) {
    const track = appendElement(document, namespace, root, "vsTrack");
    appendElement(document, namespace, track, fields.number, trackNumber);
    appendCdataElement(document, namespace, track, fields.name, trackInput.name);
    appendCdataElement(document, namespace, track, "comment", trackInput.comment ?? "Vocal track");
    const orderedParts = [...trackInput.parts].sort(
      (left, right) => songPositionTick(options.timeSignatures, left.start, "part.start")
        - songPositionTick(options.timeSignatures, right.start, "part.start"),
    );
    for (const partInput of orderedParts) {
      const partStartSongTick = songPositionTick(options.timeSignatures, partInput.start, "part.start");
      const partEndSongTick = songPositionTick(options.timeSignatures, partInput.end, "part.end");
      const part = appendElement(document, namespace, track, fields.part);
      appendElement(document, namespace, part, fields.partTick, preMeasureTicks + partStartSongTick);
      appendElement(document, namespace, part, "playTime", partEndSongTick - partStartSongTick);
      appendCdataElement(document, namespace, part, fields.partName, partInput.name);
      appendCdataElement(document, namespace, part, "comment", partInput.comment ?? "Musical part");
      appendStyleAndSinger(
        document,
        namespace,
        part,
        options.format,
        trackInput.bankSelect,
        trackInput.programChange,
      );
      for (const [curve, points] of Object.entries(partInput.controlCurves ?? {}) as Array<
        [CurveName, PositionedControlPointInput[]]
      >) {
        for (const point of points) {
          createControl(project, part, curve, {
            tick: songPositionTick(options.timeSignatures, point.position, "control.position")
              - partStartSongTick,
            value: point.value,
          });
        }
      }
      const notes = partInput.notes.map((note) => ({
        ...note,
        tick: songPositionTick(options.timeSignatures, note.position, "note.position")
          - partStartSongTick,
      }));
      for (const note of notes.sort((left, right) => left.tick - right.tick)) {
        appendNote(document, namespace, part, options.format, note);
      }
    }
  }
  const appendAudioTrack = (kind: "mono" | "stereo", trackName: string): void => {
    const audioTrack = appendElement(document, namespace, root, trackName);
    for (const audio of audioParts.filter((entry) => entry.kind === kind)) {
      const part = appendElement(document, namespace, audioTrack, "wavPart");
      appendElement(
        document,
        namespace,
        part,
        options.format === "vsq4" ? "t" : "posTick",
        preMeasureTicks + songPositionTick(options.timeSignatures, audio.start, "audio.start"),
      );
      appendElement(document, namespace, part, "playTime", audio.playTime);
      appendCdataElement(
        document,
        namespace,
        part,
        options.format === "vsq4" ? "name" : "partName",
        audio.name,
      );
      appendCdataElement(document, namespace, part, "comment", audio.comment ?? "Audio accompaniment");
      appendElement(
        document,
        namespace,
        part,
        options.format === "vsq4" ? "fs" : "sampleRate",
        audio.sampleRate,
      );
      appendElement(
        document,
        namespace,
        part,
        options.format === "vsq4" ? "rs" : "sampleReso",
        audio.bitsPerSample,
      );
      appendElement(
        document,
        namespace,
        part,
        options.format === "vsq4" ? "nCh" : "channels",
        audio.channels,
      );
      appendCdataElement(document, namespace, part, "filePath", audio.windowsFilePath);
    }
  };
  if (options.format === "vsq4") {
    appendAudioTrack("mono", "monoTrack");
    appendAudioTrack("stereo", "stTrack");
  } else {
    appendAudioTrack("mono", "seTrack");
    appendAudioTrack("stereo", "karaokeTrack");
  }
  return project;
}

function serialize(project: LoadedProject): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${new XMLSerializer().serializeToString(project.root)}\n`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function persist(
  project: LoadedProject,
  requestedOutputPath: string,
  overwrite: boolean,
): Promise<WriteResult> {
  const outputPath = await resolveWritablePath(requestedOutputPath);
  const outputExists = await exists(outputPath);
  if (outputExists && !overwrite) {
    throw new Error(`Output already exists: ${outputPath}. Set overwrite=true to replace it.`);
  }
  let backupPath: string | undefined;
  if (outputExists) {
    backupPath = `${outputPath}.bak-${new Date().toISOString().replaceAll(":", "-")}`;
    await copyFile(outputPath, backupPath);
  }
  const xml = serialize(project);
  const temporary = join(
    dirname(outputPath),
    `.${basename(outputPath)}.tmp-${process.pid}-${Date.now()}`,
  );
  try {
    await writeFile(temporary, xml, { encoding: "utf8", flag: "wx" });
    await rename(temporary, outputPath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return {
    outputPath,
    ...(backupPath ? { backupPath } : {}),
    bytes: Buffer.byteLength(xml),
    format: project.format,
  };
}

export async function inspectProjectMixer(inputPath: string): Promise<{
  path: string;
  format: VsqxFormat;
  panSemantics: string;
  vocalUnits: VocalMixerUnitInfo[];
}> {
  const project = await loadProject(inputPath);
  return {
    path: project.path,
    format: project.format,
    panSemantics: "0=hard left, 64=center, 127=hard right",
    vocalUnits: readVocalMixerUnits(project),
  };
}

function validateMixerUpdates(updates: VocalMixerUpdate[]): void {
  if (updates.length === 0) throw new Error("updates must not be empty");
  const tracks = new Set<number>();
  for (const [index, update] of updates.entries()) {
    assertIntegerRange(update.trackNumber, 0, 127, `updates[${index}].trackNumber`);
    if (tracks.has(update.trackNumber)) {
      throw new Error(`updates contains duplicate trackNumber ${update.trackNumber}`);
    }
    tracks.add(update.trackNumber);
    if (
      update.volume === undefined
      && update.pan === undefined
      && update.mute === undefined
      && update.solo === undefined
      && update.sendLevel === undefined
      && update.sendEnabled === undefined
    ) {
      throw new Error(`updates[${index}] must change at least one mixer field`);
    }
    if (update.volume !== undefined) {
      assertIntegerRange(update.volume, -898, 600, `updates[${index}].volume`);
    }
    if (update.pan !== undefined) {
      assertIntegerRange(update.pan, 0, 127, `updates[${index}].pan`);
    }
    if (update.sendLevel !== undefined) {
      assertIntegerRange(update.sendLevel, -898, 0, `updates[${index}].sendLevel`);
    }
  }
}

export async function updateProjectMixer(
  inputPath: string,
  outputPath: string,
  updates: VocalMixerUpdate[],
  overwrite: boolean,
): Promise<WriteResult & {
  panSemantics: string;
  before: VocalMixerUnitInfo[];
  after: VocalMixerUnitInfo[];
  updatedTrackNumbers: number[];
}> {
  validateMixerUpdates(updates);
  const project = await loadProject(inputPath);
  const before = readVocalMixerUnits(project);
  const mixer = requiredChild(project.root, "mixer");
  const fields = mixerUnitFields(project.format);
  const units = new Map(
    directChildren(mixer, "vsUnit").map((unit) => [integer(unit, fields.trackNumber), unit]),
  );
  for (const update of updates) {
    const unit = units.get(update.trackNumber);
    if (!unit) {
      throw new Error(
        `Mixer has no vocal unit for track ${update.trackNumber}; available tracks: ${[...units.keys()].sort((a, b) => a - b).join(", ")}`,
      );
    }
    if (update.volume !== undefined) setText(unit, fields.volume, update.volume);
    if (update.pan !== undefined) setText(unit, fields.pan, update.pan);
    if (update.mute !== undefined) setText(unit, fields.mute, update.mute ? 1 : 0);
    if (update.solo !== undefined) setText(unit, fields.solo, update.solo ? 1 : 0);
    if (update.sendLevel !== undefined) setText(unit, fields.sendLevel, update.sendLevel);
    if (update.sendEnabled !== undefined) {
      setText(unit, fields.sendEnabled, update.sendEnabled ? 1 : 0);
    }
  }
  const after = readVocalMixerUnits(project);
  const result = await persist(project, outputPath, overwrite);
  return {
    ...result,
    panSemantics: "0=hard left, 64=center, 127=hard right",
    before,
    after,
    updatedTrackNumbers: updates.map((update) => update.trackNumber),
  };
}

export async function createProject(options: CreateProjectOptions): Promise<WriteResult> {
  const project = createDocument(options);
  return persist(project, options.outputPath, options.overwrite);
}

export async function createSong(
  options: CreateSongOptions,
): Promise<WriteResult & {
  tracks: number;
  parts: number;
  notes: number;
  controlPoints: number;
  audioParts: number;
}> {
  validateSongOptions(options);
  const audioParts = await resolveSongAudioParts(options);
  const project = createSongDocument(options, audioParts);
  const result = await persist(project, options.outputPath, options.overwrite);
  return {
    ...result,
    tracks: options.tracks.length,
    audioParts: audioParts.length,
    parts: options.tracks.reduce((sum, track) => sum + track.parts.length, 0),
    notes: options.tracks.reduce(
      (sum, track) => sum + track.parts.reduce((partSum, part) => partSum + part.notes.length, 0),
      0,
    ),
    controlPoints: options.tracks.reduce(
      (sum, track) => sum + track.parts.reduce(
        (partSum, part) => partSum + Object.values(part.controlCurves ?? {})
          .reduce((curveSum, points) => curveSum + (points?.length ?? 0), 0),
        0,
      ),
      0,
    ),
  };
}

function reorderDirectChildren(
  parent: Element,
  name: string,
  nodes: Element[],
  beforeNames: string[],
): void {
  for (const node of directChildren(parent, name)) parent.removeChild(node);
  const before = elementChildren(parent).find((node) => beforeNames.includes(localName(node))) ?? null;
  for (const node of nodes) parent.insertBefore(node, before);
}

export async function addNotesToProject(
  inputPath: string,
  outputPath: string,
  trackNumber: number,
  partIndex: number,
  notes: NoteInput[],
  overwrite: boolean,
): Promise<WriteResult & { added: number; totalNotes: number }> {
  validateNotes(notes);
  const project = await loadProject(inputPath);
  const selection = selectPart(project, trackNumber, partIndex);
  const allNotes = directChildren(selection.part, "note");
  for (const note of notes) {
    allNotes.push(appendNote(project.document, project.namespace, selection.part, project.format, note));
  }
  allNotes.sort((left, right) => {
    const fields = noteFields(project.format);
    return integer(left, fields.tick) - integer(right, fields.tick);
  });
  reorderDirectChildren(selection.part, "note", allNotes, ["plane"]);
  const fields = noteFields(project.format);
  const maximumEnd = allNotes.reduce(
    (maximum, note) => Math.max(maximum, integer(note, fields.tick) + integer(note, fields.duration)),
    0,
  );
  if (maximumEnd > integer(selection.part, "playTime")) {
    setText(selection.part, "playTime", maximumEnd);
  }
  const result = await persist(project, outputPath, overwrite);
  return { ...result, added: notes.length, totalNotes: allNotes.length };
}

function replaceElementText(element: Element, value: string, cdata: boolean): void {
  while (element.firstChild) element.removeChild(element.firstChild);
  const document = element.ownerDocument;
  if (!document) throw new Error(`Malformed VSQX: <${localName(element)}> has no owner document`);
  element.appendChild(cdata ? document.createCDATASection(value) : document.createTextNode(value));
}

function setStyleValue(
  project: LoadedProject,
  style: Element,
  id: string,
  value: number,
): void {
  const valueName = project.format === "vsq4" ? "v" : "attr";
  let entry = directChildren(style, valueName).find((candidate) => candidate.getAttribute("id") === id);
  if (!entry) {
    entry = project.document.createElementNS(project.namespace, valueName);
    entry.setAttribute("id", id);
    const firstSequence = elementChildren(style).find((candidate) => {
      const name = localName(candidate);
      return name === "seq" || name === "seqAttr";
    }) ?? null;
    style.insertBefore(entry, firstSequence);
  }
  replaceElementText(entry, String(value), false);
}

function replaceStyleSequence(
  project: LoadedProject,
  style: Element,
  id: "vibDep" | "vibRate",
  points: NormalizedControlPoint[],
): void {
  const sequenceName = project.format === "vsq4" ? "seq" : "seqAttr";
  for (const sequence of directChildren(style, sequenceName)) {
    if (sequence.getAttribute("id") === id) style.removeChild(sequence);
  }
  appendStyleSequence(project.document, project.namespace, style, project.format, id, points);
}

function validateNoteExpressionUpdates(updates: NoteExpressionUpdate[]): void {
  const indices = new Set<number>();
  const styleRanges: Record<string, readonly [number, number]> = {
    accent: [0, 100],
    bendDep: [0, 100],
    bendLen: [0, 100],
    decay: [0, 100],
    fallPort: [0, 1],
    opening: [0, 127],
    risePort: [0, 1],
  };
  for (const [updateIndex, update] of updates.entries()) {
    assertIntegerRange(update.noteIndex, 0, 2_147_483_647, `updates[${updateIndex}].noteIndex`);
    if (indices.has(update.noteIndex)) {
      throw new Error(`updates contains duplicate noteIndex ${update.noteIndex}`);
    }
    indices.add(update.noteIndex);
    if (update.velocity !== undefined) {
      assertIntegerRange(update.velocity, 0, 127, `updates[${updateIndex}].velocity`);
    }
    if ((update.lyric ?? "").length > 32) {
      throw new Error(`updates[${updateIndex}].lyric exceeds 32 characters`);
    }
    if ((update.phonemes ?? "").length > 32) {
      throw new Error(`updates[${updateIndex}].phonemes exceeds 32 characters`);
    }
    for (const [id, value] of Object.entries(update.style ?? {})) {
      const range = styleRanges[id];
      if (!range || value === undefined) continue;
      assertIntegerRange(value, range[0], range[1], `updates[${updateIndex}].style.${id}`);
    }
    if (update.vibrato) validateVibrato(update.vibrato, `updates[${updateIndex}].vibrato`);
  }
}

export async function updateNoteExpressionsInProject(
  inputPath: string,
  outputPath: string,
  trackNumber: number,
  partIndex: number,
  updates: NoteExpressionUpdate[],
  overwrite: boolean,
): Promise<WriteResult & { updated: number; noteIndices: number[]; totalNotes: number }> {
  validateNoteExpressionUpdates(updates);
  const project = await loadProject(inputPath);
  const selection = selectPart(project, trackNumber, partIndex);
  const notes = directChildren(selection.part, "note");
  const fields = noteFields(project.format);
  for (const update of updates) {
    const note = notes[update.noteIndex];
    if (!note) {
      throw new Error(
        `Track ${trackNumber} part ${partIndex} has no note at index ${update.noteIndex}`,
      );
    }
    if (update.velocity !== undefined) setText(note, fields.velocity, update.velocity);
    if (update.lyric !== undefined) replaceElementText(requiredChild(note, fields.lyric), update.lyric, true);
    if (update.phonemes !== undefined) {
      replaceElementText(requiredChild(note, fields.phonemes), update.phonemes, true);
    }
    if (update.phonemeLocked !== undefined) {
      const phonemes = requiredChild(note, fields.phonemes);
      if (update.phonemeLocked) phonemes.setAttribute("lock", "1");
      else phonemes.removeAttribute("lock");
    }
    let style = firstChild(note, fields.style);
    if (!style) style = appendElement(project.document, project.namespace, note, fields.style);
    for (const [id, value] of Object.entries(update.style ?? {})) {
      if (value !== undefined) setStyleValue(project, style, id, value);
    }
    if (update.vibrato) {
      if (update.vibrato.type !== undefined) {
        setStyleValue(project, style, "vibType", update.vibrato.type);
      }
      if (update.vibrato.length !== undefined) {
        setStyleValue(project, style, "vibLen", update.vibrato.length);
      }
      if (update.vibrato.depth !== undefined) {
        replaceStyleSequence(project, style, "vibDep", update.vibrato.depth);
      }
      if (update.vibrato.rate !== undefined) {
        replaceStyleSequence(project, style, "vibRate", update.vibrato.rate);
      }
      if (update.vibrato.type === 0) {
        setStyleValue(project, style, "vibLen", 0);
        replaceStyleSequence(project, style, "vibDep", []);
        replaceStyleSequence(project, style, "vibRate", []);
      }
    }
  }
  const result = await persist(project, outputPath, overwrite);
  return {
    ...result,
    updated: updates.length,
    noteIndices: updates.map((update) => update.noteIndex),
    totalNotes: notes.length,
  };
}

function createControl(
  project: LoadedProject,
  part: Element,
  curve: CurveName,
  point: ControlPointInput,
): Element {
  const format4 = project.format === "vsq4";
  const control = appendElement(
    project.document,
    project.namespace,
    part,
    format4 ? "cc" : "mCtrl",
  );
  appendElement(
    project.document,
    project.namespace,
    control,
    format4 ? "t" : "posTick",
    point.tick,
  );
  const value = appendElement(
    project.document,
    project.namespace,
    control,
    format4 ? "v" : "attr",
    point.value,
  );
  value.setAttribute("id", encodedCurveId(project.format, curve));
  return control;
}

function validateControlPoints(curve: CurveName, points: ControlPointInput[]): void {
  const [minimum, maximum] = CURVE_RANGES[curve];
  const ticks = new Set<number>();
  for (const [index, point] of points.entries()) {
    assertIntegerRange(point.tick, 0, 2_147_483_647, `points[${index}].tick`);
    assertIntegerRange(point.value, minimum, maximum, `points[${index}].value`);
    if (ticks.has(point.tick)) throw new Error(`${curve} points contain duplicate tick ${point.tick}`);
    ticks.add(point.tick);
  }
}

export async function addControlPointsToProject(
  inputPath: string,
  outputPath: string,
  trackNumber: number,
  partIndex: number,
  curve: CurveName,
  points: ControlPointInput[],
  replaceRange: boolean,
  overwrite: boolean,
): Promise<WriteResult & { curve: CurveName; added: number; totalControlPoints: number }> {
  validateControlPoints(curve, points);
  const project = await loadProject(inputPath);
  const selection = selectPart(project, trackNumber, partIndex);
  const controlName = trackFields(project.format).control;
  let controls = directChildren(selection.part, controlName);
  if (replaceRange && points.length > 0) {
    const start = Math.min(...points.map((point) => point.tick));
    const end = Math.max(...points.map((point) => point.tick));
    controls = controls.filter((control, index) => {
      const info = readControl(control, project.format, index);
      return info.curve !== curve || info.tick < start || info.tick > end;
    });
  }
  const keyed = new Map<string, Element>();
  for (const [index, control] of controls.entries()) {
    const info = readControl(control, project.format, index);
    keyed.set(`${info.curve}:${info.tick}`, control);
  }
  for (const point of points) {
    const control = createControl(project, selection.part, curve, point);
    keyed.set(`${curve}:${point.tick}`, control);
  }
  controls = [...keyed.values()].sort((left, right) => {
    const leftInfo = readControl(left, project.format, 0);
    const rightInfo = readControl(right, project.format, 0);
    return leftInfo.tick - rightInfo.tick || leftInfo.curve.localeCompare(rightInfo.curve);
  });
  reorderDirectChildren(selection.part, controlName, controls, ["note", "plane"]);
  const result = await persist(project, outputPath, overwrite);
  return {
    ...result,
    curve,
    added: points.length,
    totalControlPoints: controls.length,
  };
}

export async function validateProject(
  inputPath: string,
  requestedSchemaPath?: string,
): Promise<{
  valid: boolean;
  format: VsqxFormat;
  schemaPath: string | null;
  diagnostics: string[];
}> {
  const project = await loadProject(inputPath);
  const diagnostics = projectDiagnostics(project);
  const defaultSchema = `/mnt/d/Vocaloid/Vocaloid3FE/${project.format}.xsd`;
  let schemaPath: string | null = null;
  try {
    schemaPath = await resolveReadablePath(requestedSchemaPath ?? defaultSchema);
  } catch (error) {
    if (requestedSchemaPath) throw error;
    diagnostics.push(
      `XSD schema is unavailable at ${defaultSchema}; only structural checks were run`,
    );
  }
  if (schemaPath) {
    try {
      await execFileAsync("xmllint", ["--noout", "--schema", schemaPath, project.path], {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      diagnostics.push(`XSD validation failed: ${detail}`);
    }
  }
  return {
    valid: diagnostics.length === 0,
    format: project.format,
    schemaPath,
    diagnostics,
  };
}
