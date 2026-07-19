import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { PROJECT_ROOT } from "./paths.js";


const DEFAULT_LOCK_PATH = join(PROJECT_ROOT, "build/runtime/vocaloid-editor-render.lock");
const STALE_MILLISECONDS = 20 * 60 * 1000;

interface LeaseRecord {
  leaseId: string;
  ownerPid: number;
  requestId: string;
  acquiredAt: string;
}

export interface EditorLeaseSnapshot extends LeaseRecord {
  path: string;
  ownerAlive: boolean;
  ageMilliseconds: number;
}

export interface EditorLease extends EditorLeaseSnapshot {
  release(): Promise<void>;
}

export class EditorBusyError extends Error {
  readonly code = "EDITOR_BUSY";
  readonly owner: EditorLeaseSnapshot;

  constructor(owner: EditorLeaseSnapshot) {
    super(
      `VOCALOID Editor is busy under request ${owner.requestId} (PID ${owner.ownerPid}, `
      + `lease age ${Math.round(owner.ageMilliseconds / 1000)}s). Wait for that bounded render to finish or cancel it.`,
    );
    this.name = "EditorBusyError";
    this.owner = owner;
  }
}

function lockPath(): string {
  return process.env.VOCALOID_EDITOR_LOCK_PATH ?? DEFAULT_LOCK_PATH;
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseLease(value: unknown): LeaseRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<LeaseRecord>;
  if (
    typeof candidate.leaseId !== "string"
    || !Number.isInteger(candidate.ownerPid)
    || typeof candidate.requestId !== "string"
    || typeof candidate.acquiredAt !== "string"
  ) return null;
  const timestamp = Date.parse(candidate.acquiredAt);
  if (!Number.isFinite(timestamp)) return null;
  return candidate as LeaseRecord;
}

async function readSnapshot(path = lockPath()): Promise<EditorLeaseSnapshot | null> {
  try {
    const [raw, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const record = parseLease(parsed);
    if (!record) {
      return {
        path,
        leaseId: "malformed",
        ownerPid: -1,
        requestId: "unknown",
        acquiredAt: info.mtime.toISOString(),
        ownerAlive: false,
        ageMilliseconds: Math.max(0, Date.now() - info.mtimeMs),
      };
    }
    return {
      path,
      ...record,
      ownerAlive: processAlive(record.ownerPid),
      ageMilliseconds: Math.max(0, Date.now() - Date.parse(record.acquiredAt)),
    };
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function inspectEditorLease(): Promise<EditorLeaseSnapshot | null> {
  return readSnapshot();
}

async function removeStaleLease(snapshot: EditorLeaseSnapshot): Promise<boolean> {
  const malformedAndOld = snapshot.leaseId === "malformed"
    && snapshot.ageMilliseconds >= STALE_MILLISECONDS;
  const recordedOwnerIsDead = snapshot.leaseId !== "malformed" && !snapshot.ownerAlive;
  if (!recordedOwnerIsDead && !malformedAndOld) return false;
  const current = await readSnapshot(snapshot.path);
  if (!current || current.leaseId !== snapshot.leaseId) return false;
  if (current.leaseId === "malformed") {
    if (current.ageMilliseconds < STALE_MILLISECONDS) return false;
  } else if (current.ownerAlive) {
    return false;
  }
  await unlink(snapshot.path).catch(() => undefined);
  return true;
}

export async function acquireEditorLease(requestId: string): Promise<EditorLease> {
  if (!requestId.trim()) throw new Error("Editor lease requestId must not be empty");
  const path = lockPath();
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const record: LeaseRecord = {
      leaseId: randomUUID(),
      ownerPid: process.pid,
      requestId,
      acquiredAt: new Date().toISOString(),
    };
    try {
      const handle = await open(path, "wx");
      try {
        await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
      } finally {
        await handle.close();
      }
      const snapshot: EditorLeaseSnapshot = {
        path,
        ...record,
        ownerAlive: true,
        ageMilliseconds: 0,
      };
      let released = false;
      return {
        ...snapshot,
        async release(): Promise<void> {
          if (released) return;
          released = true;
          const current = await readSnapshot(path);
          if (current?.leaseId === record.leaseId) await unlink(path).catch(() => undefined);
        },
      };
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
      const owner = await readSnapshot(path);
      if (!owner) continue;
      if (attempt === 0 && await removeStaleLease(owner)) continue;
      throw new EditorBusyError(owner);
    }
  }
  const owner = await readSnapshot(path);
  if (owner) throw new EditorBusyError(owner);
  throw new Error("Could not acquire VOCALOID Editor render lease after stale-lock recovery");
}
