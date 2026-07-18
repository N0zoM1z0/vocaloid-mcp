export type VsqxFormat = "vsq3" | "vsq4";

export type ResponseFormat = "markdown" | "json";

export interface VoiceInfo {
  name: string;
  componentId: string;
  formatVersion?: string;
  path?: string;
  parameters?: Record<string, number>;
}

export interface NoteInput {
  tick: number;
  duration: number;
  noteNumber: number;
  lyric: string;
  phonemes?: string;
  phonemeLocked?: boolean;
  velocity?: number;
  style?: Record<string, number>;
  vibrato?: VibratoInput;
}

export interface NoteInfo extends Required<Omit<NoteInput, "style" | "vibrato">> {
  index: number;
  endTick: number;
  style: Record<string, number>;
  styleSequences: Record<string, NormalizedControlPoint[]>;
}

export interface NormalizedControlPoint {
  /** Position across the whole note, 0..65536. */
  position: number;
  /** Vibrato depth/rate value, 0..127. */
  value: number;
}

export interface VibratoInput {
  /** 0 is off; 1..16 select the built-in V3/V4 vibrato types. */
  type: number;
  /** Percentage of the note occupied by vibrato, measured from the note end. */
  length: number;
  depth?: NormalizedControlPoint[];
  rate?: NormalizedControlPoint[];
}

export interface NoteExpressionUpdate {
  noteIndex: number;
  velocity?: number;
  lyric?: string;
  phonemes?: string;
  phonemeLocked?: boolean;
  style?: Partial<Record<
    | "accent"
    | "bendDep"
    | "bendLen"
    | "decay"
    | "fallPort"
    | "opening"
    | "risePort",
    number
  >>;
  vibrato?: Partial<VibratoInput>;
}

export type CurveName =
  | "DYN"
  | "BRE"
  | "BRI"
  | "CLE"
  | "GEN"
  | "POR"
  | "PIT"
  | "PBS";

export interface ControlPointInput {
  tick: number;
  value: number;
}

export interface ControlPointInfo extends ControlPointInput {
  index: number;
  curve: CurveName | string;
}

export interface Pagination<T> {
  total: number;
  count: number;
  offset: number;
  items: T[];
  has_more: boolean;
  next_offset?: number;
}

export interface TrackSummary {
  trackNumber: number;
  name: string;
  partCount: number;
  noteCount: number;
  controlPointCount: number;
  parts: PartSummary[];
}

export interface PartSummary {
  index: number;
  name: string;
  tick: number;
  playTime: number;
  noteCount: number;
  controlPointCount: number;
  singer: { bankSelect: number; programChange: number } | null;
}

export interface ProjectSummary {
  path: string;
  format: VsqxFormat;
  namespace: string;
  vendor: string;
  version: string;
  sequenceName: string;
  resolution: number;
  preMeasure: number;
  voices: Array<VoiceInfo & { bankSelect: number; programChange: number }>;
  tempos: Array<{ tick: number; bpm: number }>;
  timeSignatures: Array<{ measure: number; numerator: number; denominator: number }>;
  tracks: TrackSummary[];
  diagnostics: string[];
}

export interface WriteResult {
  outputPath: string;
  backupPath?: string;
  bytes: number;
  format: VsqxFormat;
}
