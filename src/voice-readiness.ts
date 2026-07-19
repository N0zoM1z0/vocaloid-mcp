import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { PROJECT_ROOT, resolveWritablePath } from "./paths.js";
import {
  inspectRenderHost,
  renderProjectToWav,
  type RenderHostFingerprint,
  type RenderRuntimeOptions,
} from "./render.js";
import { fileSha256 } from "./song-manifest.js";
import { discoverVoices } from "./voices.js";
import { createSong } from "./vsqx.js";
import {
  inspectVoiceRegistration,
  type VoiceRegistrationInspection,
  type VoiceRegistrationStatus,
} from "./voice-registration.js";


const CACHE_SCHEMA = "vocaloid-mcp/voice-readiness/v1";
const DEFAULT_CACHE_PATH = join(PROJECT_ROOT, "build/runtime/voice-readiness.json");
const VERIFIED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UNAVAILABLE_TTL_MS = 24 * 60 * 60 * 1000;
const ERROR_TTL_MS = 10 * 60 * 1000;

export type VoiceProbeStatus = "verified" | "unavailable" | "error";

export interface VoiceProbeRecord {
  componentId: string;
  voiceName: string;
  status: VoiceProbeStatus;
  checkedAt: string;
  expiresAt: string;
  hostCacheKey: string;
  editorSha256: string;
  editorVersion: string;
  helperSha256: string;
  reason: string;
  registrationStatus?: VoiceRegistrationStatus;
  projectSha256?: string;
  renderSha256?: string;
  renderDurationSeconds?: number;
}

interface VoiceReadinessCache {
  schema: typeof CACHE_SCHEMA;
  updatedAt: string;
  records: VoiceProbeRecord[];
}

export interface VoiceReadinessSnapshot {
  path: string;
  host: RenderHostFingerprint;
  records: VoiceProbeRecord[];
  verifiedComponentIds: string[];
}

function cachePath(): string {
  return process.env.VOCALOID_VOICE_CACHE_PATH ?? DEFAULT_CACHE_PATH;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function validRecord(value: unknown): value is VoiceProbeRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<VoiceProbeRecord>;
  return typeof record.componentId === "string"
    && record.componentId.length === 16
    && typeof record.voiceName === "string"
    && ["verified", "unavailable", "error"].includes(record.status ?? "")
    && typeof record.checkedAt === "string"
    && Number.isFinite(Date.parse(record.checkedAt))
    && typeof record.expiresAt === "string"
    && Number.isFinite(Date.parse(record.expiresAt))
    && typeof record.hostCacheKey === "string"
    && typeof record.editorSha256 === "string"
    && typeof record.editorVersion === "string"
    && typeof record.helperSha256 === "string"
    && typeof record.reason === "string";
}

async function readCache(): Promise<VoiceReadinessCache> {
  const path = cachePath();
  if (!(await exists(path))) {
    return { schema: CACHE_SCHEMA, updatedAt: new Date(0).toISOString(), records: [] };
  }
  try {
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    if (typeof raw !== "object" || raw === null) throw new Error("root must be an object");
    const candidate = raw as Partial<VoiceReadinessCache>;
    if (candidate.schema !== CACHE_SCHEMA || !Array.isArray(candidate.records)) {
      throw new Error("schema/records mismatch");
    }
    return {
      schema: CACHE_SCHEMA,
      updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date(0).toISOString(),
      records: candidate.records.filter(validRecord),
    };
  } catch (error) {
    throw new Error(`Invalid voice-readiness cache ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeCache(cache: VoiceReadinessCache): Promise<void> {
  const path = await resolveWritablePath(cachePath());
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${Date.now()}`);
  try {
    await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function recordKey(componentId: string, hostCacheKey: string): string {
  return createHash("sha256").update(`${componentId}\0${hostCacheKey}`).digest("hex");
}

function sameRecord(left: VoiceProbeRecord, componentId: string, hostCacheKey: string): boolean {
  return recordKey(left.componentId, left.hostCacheKey) === recordKey(componentId, hostCacheKey);
}

export async function readVoiceReadiness(
  allowUnknownEditor = false,
  includeExpired = false,
): Promise<VoiceReadinessSnapshot> {
  const [host, cache] = await Promise.all([
    inspectRenderHost(allowUnknownEditor),
    readCache(),
  ]);
  const now = Date.now();
  const records = cache.records.filter((record) =>
    record.hostCacheKey === host.cacheKey
      && (includeExpired || Date.parse(record.expiresAt) > now));
  return {
    path: cachePath(),
    host,
    records,
    verifiedComponentIds: records
      .filter((record) => record.status === "verified" && Date.parse(record.expiresAt) > now)
      .map((record) => record.componentId),
  };
}

export async function verifiedVoiceComponentIds(
  allowUnknownEditor = false,
): Promise<ReadonlySet<string>> {
  const snapshot = await readVoiceReadiness(allowUnknownEditor);
  return new Set(snapshot.verifiedComponentIds);
}

export interface ProbeVoiceOptions {
  componentId: string;
  force: boolean;
  timeoutSeconds: number;
  allowUnknownEditor: boolean;
  runtime?: RenderRuntimeOptions;
}

export interface ProbeVoiceResult {
  cached: boolean;
  cachePath: string;
  record: VoiceProbeRecord;
  host: RenderHostFingerprint;
  registration: VoiceRegistrationInspection;
}

export function findVoiceIdentityCollision(
  records: readonly VoiceProbeRecord[],
  componentId: string,
  hostCacheKey: string,
  renderSha256: string,
): VoiceProbeRecord | undefined {
  return records.find((record) => record.componentId !== componentId
    && record.hostCacheKey === hostCacheKey
    && record.status === "verified"
    && record.renderSha256 === renderSha256);
}

async function persistProbeRecord(
  cache: VoiceReadinessCache,
  record: VoiceProbeRecord,
): Promise<void> {
  await writeCache({
    schema: CACHE_SCHEMA,
    updatedAt: new Date().toISOString(),
    records: [
      ...cache.records.filter((candidate) => !sameRecord(candidate, record.componentId, record.hostCacheKey)),
      record,
    ].sort((left, right) => left.componentId.localeCompare(right.componentId)
      || left.hostCacheKey.localeCompare(right.hostCacheKey)),
  });
}

export async function probeVoice(options: ProbeVoiceOptions): Promise<ProbeVoiceResult> {
  const componentId = options.componentId.trim();
  if (componentId.length !== 16) throw new Error("componentId must contain exactly 16 characters");
  const [host, voices, cache, registration] = await Promise.all([
    inspectRenderHost(options.allowUnknownEditor),
    discoverVoices(),
    readCache(),
    inspectVoiceRegistration(componentId),
  ]);
  const voice = voices.find((candidate) => candidate.componentId === componentId);
  if (!voice) throw new Error(`No local VVD metadata for voice component ${componentId}`);
  const now = Date.now();
  const cached = cache.records.find((record) => sameRecord(record, componentId, host.cacheKey));
  if (registration.status === "activation_incomplete" || registration.status === "not_registered") {
    const checkedAt = new Date().toISOString();
    const record: VoiceProbeRecord = {
      componentId,
      voiceName: voice.name,
      status: "unavailable",
      checkedAt,
      expiresAt: new Date(Date.parse(checkedAt) + UNAVAILABLE_TTL_MS).toISOString(),
      hostCacheKey: host.cacheKey,
      editorSha256: host.editorSha256,
      editorVersion: host.editorVersion,
      helperSha256: host.helperSha256,
      reason: registration.reason,
      registrationStatus: registration.status,
    };
    await persistProbeRecord(cache, record);
    return { cached: false, cachePath: cachePath(), record, host, registration };
  }
  if (!options.force && cached && Date.parse(cached.expiresAt) > now) {
    return { cached: true, cachePath: cachePath(), record: cached, host, registration };
  }

  const runtimeDirectory = join(PROJECT_ROOT, "build/runtime");
  await mkdir(runtimeDirectory, { recursive: true });
  const temporary = await mkdtemp(join(runtimeDirectory, ".voice-probe-"));
  const projectPath = join(temporary, `${voice.name.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-") || "voice"}.vsqx`);
  const outputPath = join(temporary, "voice-probe.wav");
  let record: VoiceProbeRecord;
  try {
    await createSong({
      outputPath: projectPath,
      format: "vsq3",
      sequenceName: `Voice Probe ${voice.name}`,
      preMeasure: 1,
      timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
      tempos: [{ position: { measure: 0, beat: 0, tick: 0 }, bpm: 120 }],
      tracks: [{
        name: voice.name,
        voice: { name: voice.name, componentId: voice.componentId },
        bankSelect: 0,
        programChange: 0,
        mixer: { pan: 64, volume: 0, sendEnabled: false },
        parts: [{
          name: "Bounded availability probe",
          start: { measure: 0, beat: 0, tick: 0 },
          end: { measure: 1, beat: 0, tick: 0 },
          notes: [{
            position: { measure: 0, beat: 0, tick: 0 },
            duration: 720,
            noteNumber: 69,
            lyric: "ら",
            phonemes: "4 a",
            phonemeLocked: true,
            velocity: 64,
          }],
        }],
      }],
      overwrite: false,
    });
    const projectDigest = await fileSha256(projectPath);
    try {
      const render = await renderProjectToWav(
        projectPath,
        outputPath,
        options.timeoutSeconds,
        false,
        false,
        { ...options.runtime, allowUnknownEditor: options.allowUnknownEditor },
      );
      const renderDigest = await fileSha256(outputPath);
      const checkedAt = new Date().toISOString();
      const collision = findVoiceIdentityCollision(
        cache.records,
        componentId,
        host.cacheKey,
        renderDigest.sha256,
      );
      record = collision ? {
        componentId,
        voiceName: voice.name,
        status: "error",
        checkedAt,
        expiresAt: new Date(Date.parse(checkedAt) + ERROR_TTL_MS).toISOString(),
        hostCacheKey: host.cacheKey,
        editorSha256: host.editorSha256,
        editorVersion: host.editorVersion,
        helperSha256: host.helperSha256,
        reason: `Voice identity is unverified: rendered WAV exactly matches ${collision.voiceName} (${collision.componentId}); possible singer fallback.`,
        registrationStatus: registration.status,
        projectSha256: projectDigest.sha256,
        renderSha256: renderDigest.sha256,
        renderDurationSeconds: render.durationSeconds,
      } : {
        componentId,
        voiceName: voice.name,
        status: "verified",
        checkedAt,
        expiresAt: new Date(Date.parse(checkedAt) + VERIFIED_TTL_MS).toISOString(),
        hostCacheKey: host.cacheKey,
        editorSha256: host.editorSha256,
        editorVersion: host.editorVersion,
        helperSha256: host.helperSha256,
        reason: "Original VOCALOID3 Editor rendered the generated locked-phoneme probe as verified non-silent audio.",
        registrationStatus: registration.status,
        projectSha256: projectDigest.sha256,
        renderSha256: renderDigest.sha256,
        renderDurationSeconds: render.durationSeconds,
      };
    } catch (error) {
      if (options.runtime?.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const unavailable = message.includes("singer_unavailable")
        || message.includes("selected singer is unavailable");
      const checkedAt = new Date().toISOString();
      record = {
        componentId,
        voiceName: voice.name,
        status: unavailable ? "unavailable" : "error",
        checkedAt,
        expiresAt: new Date(
          Date.parse(checkedAt) + (unavailable ? UNAVAILABLE_TTL_MS : ERROR_TTL_MS),
        ).toISOString(),
        hostCacheKey: host.cacheKey,
        editorSha256: host.editorSha256,
        editorVersion: host.editorVersion,
        helperSha256: host.helperSha256,
        reason: message,
        registrationStatus: registration.status,
        projectSha256: projectDigest.sha256,
      };
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }

  await persistProbeRecord(cache, record!);
  return { cached: false, cachePath: cachePath(), record: record!, host, registration };
}
