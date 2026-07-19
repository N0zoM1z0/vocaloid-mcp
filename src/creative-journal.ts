import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { z } from "zod";

import { optionalSongIntentHash } from "./intent/hash.js";
import {
  manifestObjectFingerprints,
} from "./manifest-history.js";
import { resolveReadablePath, resolveWritablePath } from "./paths.js";
import {
  fileSha256,
  currentMixArtifactIds,
  loadSongManifest,
  type ManifestArtifact,
  type SongManifest,
} from "./song-manifest.js";


const JOURNAL_SCHEMA = "vocaloid-creative-decision-journal/v1" as const;
const PACKAGE_SCHEMA = "vocaloid-creative-record-package/v1" as const;
const MAX_JOURNAL_BYTES = 16 * 1024 * 1024;
const MAX_JOURNAL_ENTRIES = 10_000;
const MAX_ENTRY_BYTES = 64 * 1024;

const StableIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,95}$/u);
const FingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const ShortTextSchema = z.string().min(1).max(1000);
const LongTextSchema = z.string().min(1).max(4000);
const UniqueIdListSchema = z.array(StableIdSchema).max(512).superRefine((values, context) => {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", message: "ID lists must not contain duplicates" });
  }
});

export const CreativeDecisionPhaseSchema = z.enum([
  "brief",
  "intent",
  "form",
  "meter_tempo",
  "harmony",
  "melody",
  "note_allocation",
  "ia_delivery",
  "harmony_vocals",
  "arrangement",
  "mix",
  "audition",
  "revision",
  "delivery",
  "retrospective",
]);

export const CreativeDecisionKindSchema = z.enum([
  "framing",
  "selection",
  "adjustment",
  "evaluation",
  "retrospective",
]);

export const CreativeDecisionCurrentnessSchema = z.enum([
  "current",
  "stale",
  "superseded",
]);

const CreativeAlternativeSchema = z.object({
  option: ShortTextSchema,
  disposition: z.enum(["selected", "rejected", "deferred"]),
  reason: LongTextSchema,
}).strict();

const CreativeDryRunEvidenceSchema = z.object({
  source_revision: z.number().int().min(1),
  predicted_revision: z.number().int().min(1),
  total_changes: z.number().int().min(0),
  introduced_issue_codes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,95}$/u)).max(256).default([]),
  resolved_issue_codes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,95}$/u)).max(256).default([]),
}).strict();

const CreativeMetricDeltaSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9._-]{1,95}$/u),
  before: z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]),
  after: z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]),
}).strict();

const CreativeDecisionEvidenceSchema = z.object({
  constraints: z.array(ShortTextSchema).max(32).default([]),
  observations: z.array(ShortTextSchema).min(1).max(64),
  theory_issue_codes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,95}$/u)).max(256).default([]),
  metric_deltas: z.array(CreativeMetricDeltaSchema).max(128).default([]),
  dry_run: CreativeDryRunEvidenceSchema.optional(),
}).strict();

const CreativeDecisionAuthorSchema = z.object({
  type: z.enum(["agent", "human"]),
  name: z.string().min(1).max(128),
  session_id: z.string().min(1).max(256).optional(),
}).strict();

const CreativeDecisionFieldsSchema = z.object({
  id: StableIdSchema,
  phase: CreativeDecisionPhaseSchema,
  kind: CreativeDecisionKindSchema,
  title: z.string().min(1).max(256),
  objective: LongTextSchema,
  decision: LongTextSchema,
  rationale: LongTextSchema.describe(
    "Concise auditable reasoning and evidence summary; never a raw hidden chain-of-thought transcript",
  ),
  alternatives: z.array(CreativeAlternativeSchema).max(12).default([]),
  expected_audible_effect: LongTextSchema,
  actual_result: LongTextSchema.optional(),
  next_step: LongTextSchema.optional(),
  affected_object_ids: UniqueIdListSchema.default([]),
  artifact_ids: UniqueIdListSchema.default([]),
  listening_question_id: StableIdSchema.optional(),
  hypothesis_family: z.enum([
    "melody", "rhythm", "harmony", "delivery", "arrangement", "timbre_mix",
  ]).optional(),
  hash_dependencies: z.array(z.enum(["intent", "composition", "mix"])).max(3).default([])
    .superRefine((values, context) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", message: "hash_dependencies must not contain duplicates" });
      }
    }),
  supersedes_decision_ids: UniqueIdListSchema.default([]),
  evidence: CreativeDecisionEvidenceSchema,
  outcome: z.enum([
    "planned", "implemented", "auditioned", "revision_requested", "deferred", "delivered",
  ]),
  author: CreativeDecisionAuthorSchema,
}).strict();
const CREATIVE_DECISION_FIELD_NAMES = CreativeDecisionFieldsSchema.keyof().options;

export const CreativeDecisionInputSchema = CreativeDecisionFieldsSchema.superRefine((entry, context) => {
  if (entry.affected_object_ids.length === 0
    && entry.artifact_ids.length === 0
    && entry.hash_dependencies.length === 0) {
    context.addIssue({
      code: "custom",
      message: "A decision must bind at least one stable object, artifact, or manifest hash dependency",
    });
  }
  if (entry.supersedes_decision_ids.includes(entry.id)) {
    context.addIssue({
      code: "custom",
      path: ["supersedes_decision_ids"],
      message: "A decision cannot supersede itself",
    });
  }
});

const CreativeDecisionBindingSchema = z.object({
  manifest_path: z.string().min(1).max(4096),
  manifest_revision: z.number().int().min(1),
  content_hash: FingerprintSchema,
  composition_hash: FingerprintSchema,
  mix_hash: FingerprintSchema,
  intent_hash: FingerprintSchema.nullable(),
  object_fingerprints: z.record(StableIdSchema, FingerprintSchema),
  artifacts: z.array(z.object({
    id: StableIdSchema,
    role: z.string().min(1).max(64),
    sha256: FingerprintSchema,
    bytes: z.number().int().min(1),
  }).strict()).max(512),
}).strict();

export const CreativeDecisionRecordSchema = CreativeDecisionFieldsSchema.extend({
  schema: z.literal(JOURNAL_SCHEMA),
  sequence: z.number().int().min(1),
  created_at: z.string().datetime(),
  song_id: StableIdSchema,
  binding: CreativeDecisionBindingSchema,
  previous_entry_hash: FingerprintSchema.nullable(),
  entry_hash: FingerprintSchema,
}).strict();

export const CreativeJournalDeliverableInputSchema = z.object({
  role: z.enum(["song", "vsqx", "preview", "other"]),
  artifact_id: StableIdSchema,
  published_path: z.string().min(1).max(4096).optional(),
}).strict();

export type CreativeDecisionInput = z.infer<typeof CreativeDecisionInputSchema>;
export type CreativeDecisionRecord = z.infer<typeof CreativeDecisionRecordSchema>;
export type CreativeDecisionPhase = z.infer<typeof CreativeDecisionPhaseSchema>;
export type CreativeDecisionCurrentness = z.infer<typeof CreativeDecisionCurrentnessSchema>;
export type CreativeJournalDeliverableInput = z.infer<typeof CreativeJournalDeliverableInputSchema>;

export interface CreativeDecisionResolution {
  entry: CreativeDecisionRecord;
  currentness: CreativeDecisionCurrentness;
  staleReasons: string[];
}

export interface CreativeJournalCompletenessDimension {
  id: "intent" | "theory" | "note_allocation" | "ia_delivery" | "arrangement";
  label: string;
  requiredPhases: CreativeDecisionPhase[];
  currentEntryIds: string[];
  complete: boolean;
}

export interface CreativeJournalCompleteness {
  coreReady: boolean;
  coverage: number;
  dimensions: CreativeJournalCompletenessDimension[];
  adjustmentEntryIds: string[];
  auditionEntryIds: string[];
  humanListeningStatus: "pending" | "recorded";
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function valueHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function recordHash(record: Omit<CreativeDecisionRecord, "entry_hash">): string {
  return valueHash(record);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function creativeJournalPath(manifestPath: string): string {
  if (!manifestPath.endsWith(".song.json")) {
    throw new Error(`Creative journals require a .song.json manifest: ${manifestPath}`);
  }
  return `${manifestPath.slice(0, -".song.json".length)}.creative-journal.jsonl`;
}

export function creativeReportPath(manifestPath: string): string {
  if (!manifestPath.endsWith(".song.json")) {
    throw new Error(`Creative reports require a .song.json manifest: ${manifestPath}`);
  }
  return `${manifestPath.slice(0, -".song.json".length)}.creative-report.md`;
}

function serializeJournal(entries: readonly CreativeDecisionRecord[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length > 0 ? "\n" : "");
}

async function readJournal(path: string, songId: string): Promise<CreativeDecisionRecord[]> {
  if (!(await exists(path))) return [];
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`Expected creative journal file: ${path}`);
  if (info.size > MAX_JOURNAL_BYTES) {
    throw new Error(`Creative journal exceeds ${MAX_JOURNAL_BYTES} byte safety limit`);
  }
  const lines = (await readFile(path, "utf8")).split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length > MAX_JOURNAL_ENTRIES) {
    throw new Error(`Creative journal exceeds ${MAX_JOURNAL_ENTRIES} entry safety limit`);
  }
  const entries: CreativeDecisionRecord[] = [];
  const ids = new Set<string>();
  let previousHash: string | null = null;
  for (const [index, line] of lines.entries()) {
    if (Buffer.byteLength(line) > MAX_ENTRY_BYTES) {
      throw new Error(`Creative journal line ${index + 1} exceeds ${MAX_ENTRY_BYTES} byte safety limit`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `Invalid creative journal JSON at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const entry = CreativeDecisionRecordSchema.parse(raw);
    if (entry.sequence !== index + 1) {
      throw new Error(`Creative journal sequence ${entry.sequence} does not match line ${index + 1}`);
    }
    if (entry.song_id !== songId) {
      throw new Error(`Creative journal entry ${entry.id} belongs to ${entry.song_id}, expected ${songId}`);
    }
    if (entry.previous_entry_hash !== previousHash) {
      throw new Error(`Creative journal chain mismatch before ${entry.id}`);
    }
    const { entry_hash: _storedHash, ...withoutHash } = entry;
    const actualHash = recordHash(withoutHash);
    if (actualHash !== entry.entry_hash) {
      throw new Error(`Creative journal entry hash mismatch for ${entry.id}`);
    }
    if (ids.has(entry.id)) throw new Error(`Duplicate creative journal decision ID ${entry.id}`);
    for (const supersededId of entry.supersedes_decision_ids) {
      if (!ids.has(supersededId)) {
        throw new Error(`Creative decision ${entry.id} supersedes unknown or later decision ${supersededId}`);
      }
    }
    ids.add(entry.id);
    entries.push(entry);
    previousHash = entry.entry_hash;
  }
  return entries;
}

async function withJournalLock<T>(journalPath: string, task: () => Promise<T>): Promise<T> {
  const lockPath = `${journalPath}.lock`;
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      lock = await open(lockPath, "wx");
      break;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
      if (code !== "EEXIST") throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    }
  }
  if (!lock) throw new Error(`Creative journal is busy: ${journalPath}`);
  try {
    return await task();
  } finally {
    await lock.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
  }
}

function artifactBindings(manifest: SongManifest, ids: readonly string[]) {
  return ids.map((id) => {
    const artifact = manifest.artifacts.find((candidate) => candidate.id === id);
    if (!artifact) throw new Error(`Creative decision references unknown artifact ${id}`);
    return { id: artifact.id, role: artifact.role, sha256: artifact.sha256, bytes: artifact.bytes };
  });
}

function objectBindings(manifest: SongManifest, ids: readonly string[]): Record<string, string> {
  const fingerprints = manifestObjectFingerprints(manifest);
  return Object.fromEntries(ids.map((id) => {
    const fingerprint = fingerprints.get(id);
    if (!fingerprint) throw new Error(`Creative decision references unknown stable object ${id}`);
    return [id, fingerprint];
  }));
}

function createRecord(
  manifestPath: string,
  manifest: SongManifest,
  entries: readonly CreativeDecisionRecord[],
  input: CreativeDecisionInput,
): CreativeDecisionRecord {
  const parsed = CreativeDecisionInputSchema.parse(input);
  if (entries.some((entry) => entry.id === parsed.id)) {
    throw new Error(`Creative decision ID ${parsed.id} already exists; journals are append-only`);
  }
  const knownIds = new Set(entries.map((entry) => entry.id));
  for (const supersededId of parsed.supersedes_decision_ids) {
    if (!knownIds.has(supersededId)) {
      throw new Error(`Creative decision ${parsed.id} supersedes unknown decision ${supersededId}`);
    }
  }
  if (parsed.listening_question_id) {
    const fingerprints = manifestObjectFingerprints(manifest);
    if (!fingerprints.has(parsed.listening_question_id)) {
      throw new Error(`Creative decision references unknown listening question ${parsed.listening_question_id}`);
    }
  }
  const withoutHash = {
    ...parsed,
    schema: JOURNAL_SCHEMA,
    sequence: entries.length + 1,
    created_at: new Date().toISOString(),
    song_id: manifest.song_id,
    binding: {
      manifest_path: manifestPath,
      manifest_revision: manifest.revision,
      content_hash: manifest.content_hash,
      composition_hash: manifest.composition_hash,
      mix_hash: manifest.mix_hash,
      intent_hash: optionalSongIntentHash(manifest.composition_intent),
      object_fingerprints: objectBindings(manifest, parsed.affected_object_ids),
      artifacts: artifactBindings(manifest, parsed.artifact_ids),
    },
    previous_entry_hash: entries.at(-1)?.entry_hash ?? null,
  } satisfies Omit<CreativeDecisionRecord, "entry_hash">;
  return CreativeDecisionRecordSchema.parse({ ...withoutHash, entry_hash: recordHash(withoutHash) });
}

async function persistJournal(path: string, entries: readonly CreativeDecisionRecord[]): Promise<void> {
  const serialized = serializeJournal(entries);
  if (Buffer.byteLength(serialized) > MAX_JOURNAL_BYTES) {
    throw new Error(`Creative journal exceeds ${MAX_JOURNAL_BYTES} byte safety limit`);
  }
  const temporary = join(dirname(path), `.${basename(path)}.tmp-${process.pid}-${randomUUID()}`);
  try {
    await writeFile(temporary, serialized, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function recordCreativeDecision(options: {
  manifestPath: string;
  expectedRevision: number;
  decision: CreativeDecisionInput;
  dryRun?: boolean;
}) {
  const loaded = await loadSongManifest(options.manifestPath);
  if (loaded.manifest.revision !== options.expectedRevision) {
    throw new Error(
      `Stale manifest revision ${options.expectedRevision}; current revision is ${loaded.manifest.revision}`,
    );
  }
  const path = await resolveWritablePath(creativeJournalPath(loaded.path));
  return withJournalLock(path, async () => {
    const entries = await readJournal(path, loaded.manifest.song_id);
    const entry = createRecord(loaded.path, loaded.manifest, entries, options.decision);
    if (!options.dryRun) await persistJournal(path, [...entries, entry]);
    return {
      action: "record" as const,
      dryRun: options.dryRun ?? false,
      journalPath: path,
      entry,
      entryCount: entries.length + 1,
      chainHead: entry.entry_hash,
    };
  });
}

function inputFieldsOf(entry: CreativeDecisionRecord): CreativeDecisionInput {
  return CreativeDecisionInputSchema.parse(Object.fromEntries(
    CREATIVE_DECISION_FIELD_NAMES.map((name) => [name, entry[name]]),
  ));
}

export async function recordCreativeDecisionIfAbsent(options: {
  manifestPath: string;
  expectedRevision: number;
  decision: CreativeDecisionInput;
  dryRun?: boolean;
}) {
  const loaded = await loadSongManifest(options.manifestPath);
  if (loaded.manifest.revision !== options.expectedRevision) {
    throw new Error(
      `Stale manifest revision ${options.expectedRevision}; current revision is ${loaded.manifest.revision}`,
    );
  }
  const path = await resolveWritablePath(creativeJournalPath(loaded.path));
  return withJournalLock(path, async () => {
    const entries = await readJournal(path, loaded.manifest.song_id);
    const parsed = CreativeDecisionInputSchema.parse(options.decision);
    const existing = entries.find((entry) => entry.id === parsed.id);
    if (existing) {
      if (valueHash(inputFieldsOf(existing)) !== valueHash(parsed)) {
        throw new Error(
          `Creative decision ID ${parsed.id} already exists with different content; append a new decision or explicit supersession`,
        );
      }
      return {
        action: "record_if_absent" as const,
        dryRun: options.dryRun ?? false,
        alreadyExisted: true,
        journalPath: path,
        entry: existing,
        entryCount: entries.length,
        chainHead: entries.at(-1)?.entry_hash ?? existing.entry_hash,
      };
    }
    const entry = createRecord(loaded.path, loaded.manifest, entries, parsed);
    if (!options.dryRun) await persistJournal(path, [...entries, entry]);
    return {
      action: "record_if_absent" as const,
      dryRun: options.dryRun ?? false,
      alreadyExisted: false,
      journalPath: path,
      entry,
      entryCount: entries.length + 1,
      chainHead: entry.entry_hash,
    };
  });
}

export function resolveCreativeDecisionCurrentness(
  entry: CreativeDecisionRecord,
  manifest: SongManifest,
  supersededIds = new Set<string>(),
): CreativeDecisionResolution {
  const reasons: string[] = [];
  if (entry.hash_dependencies.includes("intent")
    && entry.binding.intent_hash !== optionalSongIntentHash(manifest.composition_intent)) {
    reasons.push("INTENT_HASH_CHANGED");
  }
  if (entry.hash_dependencies.includes("composition")
    && entry.binding.composition_hash !== manifest.composition_hash) {
    reasons.push("COMPOSITION_HASH_CHANGED");
  }
  if (entry.hash_dependencies.includes("mix") && entry.binding.mix_hash !== manifest.mix_hash) {
    reasons.push("MIX_HASH_CHANGED");
  }
  const currentObjects = manifestObjectFingerprints(manifest);
  for (const [id, expected] of Object.entries(entry.binding.object_fingerprints)) {
    const actual = currentObjects.get(id);
    if (!actual) reasons.push(`OBJECT_MISSING:${id}`);
    else if (actual !== expected) reasons.push(`OBJECT_FINGERPRINT_CHANGED:${id}`);
  }
  for (const expected of entry.binding.artifacts) {
    const actual = manifest.artifacts.find((artifact) => artifact.id === expected.id);
    if (!actual) reasons.push(`ARTIFACT_MISSING:${expected.id}`);
    else if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) {
      reasons.push(`ARTIFACT_DIGEST_CHANGED:${expected.id}`);
    }
  }
  return {
    entry,
    currentness: supersededIds.has(entry.id) ? "superseded" : reasons.length > 0 ? "stale" : "current",
    staleReasons: reasons,
  };
}

function completeness(
  resolutions: readonly CreativeDecisionResolution[],
  manifest: SongManifest,
): CreativeJournalCompleteness {
  const current = resolutions.filter((resolution) => resolution.currentness === "current");
  const dimensions: CreativeJournalCompletenessDimension[] = [
    { id: "intent", label: "Intent", requiredPhases: ["intent"], currentEntryIds: [], complete: false },
    {
      id: "theory",
      label: "Theory / form / harmony / melody",
      requiredPhases: ["form", "meter_tempo", "harmony", "melody"],
      currentEntryIds: [],
      complete: false,
    },
    {
      id: "note_allocation",
      label: "Japanese note allocation",
      requiredPhases: ["note_allocation"],
      currentEntryIds: [],
      complete: false,
    },
    {
      id: "ia_delivery",
      label: "IA delivery",
      requiredPhases: ["ia_delivery"],
      currentEntryIds: [],
      complete: false,
    },
    {
      id: "arrangement",
      label: "Arrangement",
      requiredPhases: ["arrangement"],
      currentEntryIds: [],
      complete: false,
    },
  ];
  for (const dimension of dimensions) {
    dimension.currentEntryIds = current
      .filter((resolution) => dimension.requiredPhases.includes(resolution.entry.phase))
      .map((resolution) => resolution.entry.id);
    dimension.complete = dimension.requiredPhases.every((phase) =>
      current.some((resolution) => resolution.entry.phase === phase));
  }
  const completeCount = dimensions.filter((dimension) => dimension.complete).length;
  const humanListeningStatus = (manifest.review_notes ?? []).some((note) =>
    note.author_type === "human" && note.intent_fidelity !== undefined)
    ? "recorded" as const
    : "pending" as const;
  return {
    coreReady: completeCount === dimensions.length,
    coverage: completeCount / dimensions.length,
    dimensions,
    adjustmentEntryIds: current
      .filter((resolution) => resolution.entry.kind === "adjustment")
      .map((resolution) => resolution.entry.id),
    auditionEntryIds: current
      .filter((resolution) => resolution.entry.phase === "audition")
      .map((resolution) => resolution.entry.id),
    humanListeningStatus,
  };
}

export async function listCreativeDecisions(options: {
  manifestPath: string;
  phases?: CreativeDecisionPhase[];
  currentness?: CreativeDecisionCurrentness;
  offset?: number;
  limit?: number;
}) {
  const loaded = await loadSongManifest(options.manifestPath);
  const path = creativeJournalPath(loaded.path);
  const entries = await readJournal(path, loaded.manifest.song_id);
  const supersededIds = new Set(entries.flatMap((entry) => entry.supersedes_decision_ids));
  const allResolutions = entries.map((entry) =>
    resolveCreativeDecisionCurrentness(entry, loaded.manifest, supersededIds));
  const filtered = allResolutions.filter((resolution) =>
    (!options.phases || options.phases.includes(resolution.entry.phase))
    && (!options.currentness || options.currentness === resolution.currentness));
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 20;
  const items = filtered.slice(offset, offset + limit);
  return {
    action: "list" as const,
    journalPath: path,
    manifestPath: loaded.path,
    manifestRevision: loaded.manifest.revision,
    chainHead: entries.at(-1)?.entry_hash ?? null,
    total: filtered.length,
    count: items.length,
    offset,
    items,
    hasMore: offset + items.length < filtered.length,
    ...(offset + items.length < filtered.length ? { nextOffset: offset + items.length } : {}),
    completeness: completeness(allResolutions, loaded.manifest),
  };
}

function markdownText(value: string): string {
  return value.replaceAll("\r", "").trim();
}

export function renderCreativeJournalMarkdown(options: {
  manifestPath: string;
  manifest: SongManifest;
  resolutions: CreativeDecisionResolution[];
  deliverables?: Array<{
    role: string;
    artifactId: string;
    path: string;
    sha256: string;
    bytes: number;
  }>;
}): string {
  const { manifest, resolutions } = options;
  const status = completeness(resolutions, manifest);
  const lines = [
    `# ${manifest.title} — Creative Decision Record`,
    "",
    "> This report stores concise, auditable creative rationale and evidence. It is not a raw model chain-of-thought transcript.",
    "",
    "## Current binding",
    "",
    `- Song ID: \`${manifest.song_id}\``,
    `- Manifest: \`${options.manifestPath}\``,
    `- Revision: ${manifest.revision}`,
    `- Intent SHA-256: \`${optionalSongIntentHash(manifest.composition_intent) ?? "none"}\``,
    `- Composition SHA-256: \`${manifest.composition_hash}\``,
    `- Mix SHA-256: \`${manifest.mix_hash}\``,
    `- Journal coverage: ${(status.coverage * 100).toFixed(0)}% (${status.coreReady ? "core complete" : "incomplete"})`,
    `- Human listening: ${status.humanListeningStatus}`,
    "",
    "## intent → theory → note allocation → IA delivery → arrangement",
    "",
    "| Dimension | Required phases | Current decisions | Status |",
    "| --- | --- | --- | --- |",
    ...status.dimensions.map((dimension) =>
      `| ${dimension.label} | ${dimension.requiredPhases.join(", ")} | ${dimension.currentEntryIds.join(", ") || "—"} | ${dimension.complete ? "complete" : "missing"} |`),
  ];
  if (options.deliverables && options.deliverables.length > 0) {
    lines.push("", "## Bound deliverables", "");
    for (const deliverable of options.deliverables) {
      lines.push(
        `- ${deliverable.role}: \`${deliverable.path}\` — artifact \`${deliverable.artifactId}\`, SHA-256 \`${deliverable.sha256}\`, ${deliverable.bytes} bytes`,
      );
    }
  }
  lines.push("", "## Decision timeline", "");
  for (const resolution of resolutions) {
    const entry = resolution.entry;
    lines.push(
      `### ${entry.sequence}. ${entry.title}`,
      "",
      `- ID: \`${entry.id}\``,
      `- Phase / kind: \`${entry.phase}\` / \`${entry.kind}\``,
      `- Author: ${entry.author.name} (${entry.author.type})`,
      `- Recorded: ${entry.created_at}`,
      `- Outcome: \`${entry.outcome}\``,
      `- Currentness: \`${resolution.currentness}\`${resolution.staleReasons.length > 0 ? ` — ${resolution.staleReasons.join(", ")}` : ""}`,
      `- Bound revision: ${entry.binding.manifest_revision}`,
      "",
      "**Objective**",
      "",
      markdownText(entry.objective),
      "",
      "**Decision**",
      "",
      markdownText(entry.decision),
      "",
      "**Rationale**",
      "",
      markdownText(entry.rationale),
      "",
      "**Expected audible effect**",
      "",
      markdownText(entry.expected_audible_effect),
    );
    if (entry.alternatives.length > 0) {
      lines.push("", "**Alternatives considered**", "");
      for (const alternative of entry.alternatives) {
        lines.push(`- **${alternative.disposition}:** ${alternative.option} — ${alternative.reason}`);
      }
    }
    lines.push("", "**Evidence / observations**", "");
    for (const observation of entry.evidence.observations) lines.push(`- ${observation}`);
    for (const constraint of entry.evidence.constraints) lines.push(`- Constraint: ${constraint}`);
    if (entry.evidence.theory_issue_codes.length > 0) {
      lines.push(`- Theory issues: ${entry.evidence.theory_issue_codes.map((code) => `\`${code}\``).join(", ")}`);
    }
    if (entry.actual_result) lines.push("", "**Actual result**", "", markdownText(entry.actual_result));
    if (entry.next_step) lines.push("", "**Next step**", "", markdownText(entry.next_step));
    if (entry.affected_object_ids.length > 0) {
      lines.push("", `Affected objects: ${entry.affected_object_ids.map((id) => `\`${id}\``).join(", ")}`);
    }
    if (entry.artifact_ids.length > 0) {
      lines.push("", `Artifacts: ${entry.artifact_ids.map((id) => `\`${id}\``).join(", ")}`);
    }
    lines.push("");
  }
  lines.push(
    "## Review status",
    "",
    status.humanListeningStatus === "recorded"
      ? "A hash-bound human intent-fidelity listening decision exists in the current manifest."
      : "Human listening is still pending. Technical evidence and agent rationale do not self-approve the creative result.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

export async function writeCreativeJournalReport(options: {
  manifestPath: string;
  outputPath?: string;
  overwrite?: boolean;
}) {
  const loaded = await loadSongManifest(options.manifestPath);
  const journalPath = creativeJournalPath(loaded.path);
  const entries = await readJournal(journalPath, loaded.manifest.song_id);
  const supersededIds = new Set(entries.flatMap((entry) => entry.supersedes_decision_ids));
  const resolutions = entries.map((entry) =>
    resolveCreativeDecisionCurrentness(entry, loaded.manifest, supersededIds));
  const outputPath = await resolveWritablePath(options.outputPath ?? creativeReportPath(loaded.path));
  const outputExists = await exists(outputPath);
  if (outputExists && !options.overwrite) {
    throw new Error(`Creative report already exists: ${outputPath}. Set overwrite=true to replace it.`);
  }
  const report = renderCreativeJournalMarkdown({
    manifestPath: loaded.path,
    manifest: loaded.manifest,
    resolutions,
  });
  let backupPath: string | undefined;
  if (outputExists) {
    backupPath = `${outputPath}.bak-${new Date().toISOString().replaceAll(":", "-")}`;
    await rename(outputPath, backupPath);
  }
  const temporary = join(dirname(outputPath), `.${basename(outputPath)}.tmp-${process.pid}-${randomUUID()}`);
  try {
    await writeFile(temporary, report, { encoding: "utf8", flag: "wx" });
    await rename(temporary, outputPath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if (backupPath) await rename(backupPath, outputPath).catch(() => undefined);
    throw error;
  }
  return {
    action: "report" as const,
    journalPath,
    reportPath: outputPath,
    ...(backupPath ? { backupPath } : {}),
    bytes: Buffer.byteLength(report),
    entryCount: entries.length,
    completeness: completeness(resolutions, loaded.manifest),
  };
}

function currentArtifact(manifest: SongManifest, id: string): ManifestArtifact {
  const artifact = manifest.artifacts.find((candidate) => candidate.id === id);
  if (!artifact) throw new Error(`Creative record deliverable references unknown artifact ${id}`);
  if (artifact.source_composition_hash !== manifest.composition_hash) {
    throw new Error(`Creative record deliverable ${id} is stale for the current composition`);
  }
  if (["mix", "delivery"].includes(artifact.role)
    && !currentMixArtifactIds(manifest).has(artifact.id)) {
    throw new Error(`Creative record deliverable ${id} is stale for the current mix`);
  }
  return artifact;
}

async function resolveDeliverables(
  manifest: SongManifest,
  inputs: readonly CreativeJournalDeliverableInput[],
) {
  const resolved = [];
  for (const input of inputs) {
    const artifact = currentArtifact(manifest, input.artifact_id);
    if (input.role === "song" && artifact.role !== "delivery") {
      throw new Error(`Creative record song deliverable ${artifact.id} must have manifest role delivery`);
    }
    if (input.role === "vsqx" && artifact.role !== "vsqx") {
      throw new Error(`Creative record VSQX deliverable ${artifact.id} must have manifest role vsqx`);
    }
    const path = input.published_path
      ? await resolveReadablePath(input.published_path)
      : await resolveReadablePath(artifact.path);
    const digest = await fileSha256(path);
    if (digest.sha256 !== artifact.sha256 || digest.bytes !== artifact.bytes) {
      throw new Error(
        `Published ${input.role} ${path} does not match artifact ${artifact.id} digest/size`,
      );
    }
    resolved.push({
      role: input.role,
      artifactId: artifact.id,
      artifactRole: artifact.role,
      sourcePath: artifact.path,
      publishedPath: path,
      sha256: digest.sha256,
      bytes: digest.bytes,
      sourceRevision: artifact.source_revision,
      sourceCompositionHash: artifact.source_composition_hash,
    });
  }
  return resolved;
}

export async function publishCreativeRecordPackage(options: {
  manifestPath: string;
  expectedRevision: number;
  outputDirectory: string;
  deliverables: CreativeJournalDeliverableInput[];
  overwrite?: boolean;
}) {
  const loaded = await loadSongManifest(options.manifestPath);
  if (loaded.manifest.revision !== options.expectedRevision) {
    throw new Error(
      `Stale manifest revision ${options.expectedRevision}; current revision is ${loaded.manifest.revision}`,
    );
  }
  const journalPath = creativeJournalPath(loaded.path);
  const entries = await readJournal(journalPath, loaded.manifest.song_id);
  if (entries.length === 0) throw new Error("Cannot publish an empty creative decision journal");
  const supersededIds = new Set(entries.flatMap((entry) => entry.supersedes_decision_ids));
  const resolutions = entries.map((entry) =>
    resolveCreativeDecisionCurrentness(entry, loaded.manifest, supersededIds));
  const journalCompleteness = completeness(resolutions, loaded.manifest);
  if (!journalCompleteness.coreReady) {
    const missing = journalCompleteness.dimensions
      .filter((dimension) => !dimension.complete)
      .map((dimension) => dimension.id);
    throw new Error(`Creative journal is incomplete; missing current dimensions: ${missing.join(", ")}`);
  }
  const deliverables = await resolveDeliverables(loaded.manifest, options.deliverables);
  if (!deliverables.some((deliverable) => deliverable.role === "vsqx")) {
    throw new Error("Creative record package requires a current VSQX deliverable");
  }
  if (!deliverables.some((deliverable) => deliverable.role === "song")) {
    throw new Error("Creative record package requires a current song delivery");
  }

  const outputDirectory = await resolveWritablePath(options.outputDirectory);
  const outputExists = await exists(outputDirectory);
  if (outputExists && !options.overwrite) {
    throw new Error(`Creative record directory already exists: ${outputDirectory}. Set overwrite=true to replace it.`);
  }
  const temporaryDirectory = join(
    dirname(outputDirectory),
    `.${basename(outputDirectory)}.tmp-${process.pid}-${randomUUID()}`,
  );
  const stem = loaded.manifest.slug;
  const manifestName = `${stem}.song.json`;
  const journalName = `${stem}.creative-journal.jsonl`;
  const reportName = `${stem}.creative-report.md`;
  const indexName = `${stem}.creative-record.json`;
  const report = renderCreativeJournalMarkdown({
    manifestPath: loaded.path,
    manifest: loaded.manifest,
    resolutions,
    deliverables: deliverables.map((entry) => ({
      role: entry.role,
      artifactId: entry.artifactId,
      path: entry.publishedPath,
      sha256: entry.sha256,
      bytes: entry.bytes,
    })),
  });
  let backupDirectory: string | undefined;
  try {
    await mkdir(temporaryDirectory, { recursive: false });
    await Promise.all([
      writeFile(join(temporaryDirectory, manifestName), `${JSON.stringify(loaded.manifest, null, 2)}\n`, "utf8"),
      writeFile(join(temporaryDirectory, journalName), serializeJournal(entries), "utf8"),
      writeFile(join(temporaryDirectory, reportName), report, "utf8"),
    ]);
    const files = [];
    for (const name of [manifestName, journalName, reportName]) {
      const digest = await fileSha256(join(temporaryDirectory, name));
      files.push({ name, ...digest });
    }
    const index = {
      schema: PACKAGE_SCHEMA,
      published_at: new Date().toISOString(),
      song_id: loaded.manifest.song_id,
      slug: loaded.manifest.slug,
      title: loaded.manifest.title,
      manifest: {
        revision: loaded.manifest.revision,
        content_hash: loaded.manifest.content_hash,
        composition_hash: loaded.manifest.composition_hash,
        mix_hash: loaded.manifest.mix_hash,
        intent_hash: optionalSongIntentHash(loaded.manifest.composition_intent),
      },
      journal: {
        entries: entries.length,
        chain_head: entries.at(-1)!.entry_hash,
        completeness: journalCompleteness,
      },
      deliverables,
      files,
    };
    await writeFile(join(temporaryDirectory, indexName), `${JSON.stringify(index, null, 2)}\n`, "utf8");
    if (outputExists) {
      backupDirectory = `${outputDirectory}.bak-${new Date().toISOString().replaceAll(":", "-")}`;
      await rename(outputDirectory, backupDirectory);
    }
    await rename(temporaryDirectory, outputDirectory);
    return {
      action: "publish" as const,
      packageDirectory: outputDirectory,
      ...(backupDirectory ? { backupDirectory } : {}),
      indexPath: join(outputDirectory, indexName),
      manifestPath: join(outputDirectory, manifestName),
      journalPath: join(outputDirectory, journalName),
      reportPath: join(outputDirectory, reportName),
      entryCount: entries.length,
      chainHead: entries.at(-1)!.entry_hash,
      completeness: journalCompleteness,
      deliverables,
    };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    if (backupDirectory && !(await exists(outputDirectory))) {
      await rename(backupDirectory, outputDirectory).catch(() => undefined);
    }
    throw error;
  }
}
