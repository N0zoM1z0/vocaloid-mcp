#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import {
  intentFirstMutationFingerprint,
  IntentFirstBenchmarkTraceSchema,
} from "../dist/src/evaluation/intent-first-benchmark.js";


const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const SERVER_PATH = join(REPOSITORY_ROOT, "dist/src/index.js");
const STABLE_ID = /^[a-z0-9][a-z0-9._-]{0,95}$/u;
const PROHIBITED_RESOURCE = /(?:vocaloid:\/\/styles(?:\/|$)|corpus|nearest[_ -]?reference|reference[_ -]?track|style[_ -]?profile)/iu;

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function insideRepository(path, label) {
  const delta = relative(REPOSITORY_ROOT, path);
  if (delta === ".." || delta.startsWith(`..${sep}`)) {
    throw new Error(`${label} must remain inside ${REPOSITORY_ROOT}`);
  }
}

function collectObjectIds(value) {
  const ids = new Set();
  const visit = (entry, parentKey = "") => {
    if (Array.isArray(entry)) {
      for (const item of entry) visit(item, parentKey);
      return;
    }
    if (!entry || typeof entry !== "object") return;
    if (typeof entry.id === "string" && STABLE_ID.test(entry.id)
      && ("role" in entry || /(?:artifact|note|review|object)s?$/iu.test(parentKey))) {
      ids.add(entry.id);
    }
    for (const [key, child] of Object.entries(entry)) {
      if (typeof child === "string" && STABLE_ID.test(child)
        && /(?:artifact|note|review|object)(?:_|)[iI]d$/u.test(key)) {
        ids.add(child);
      } else if (Array.isArray(child) && /(?:artifact|note|review|object)(?:_|)[iI]ds$/u.test(key)) {
        for (const candidate of child) if (typeof candidate === "string" && STABLE_ID.test(candidate)) {
          ids.add(candidate);
        }
      }
      visit(child, key);
      if (ids.size >= 256) return;
    }
  };
  visit(value);
  return [...ids].slice(0, 256).sort();
}

function callSucceeded(message) {
  if (message.error) return false;
  const result = message.result;
  return result?.isError !== true && result?.structuredContent?.ok !== false;
}

function callErrorCode(message) {
  const candidates = [
    message.error?.data?.code,
    message.result?.structuredContent?.error?.code,
    message.result?.structuredContent?.code,
  ];
  return candidates.find((candidate) => typeof candidate === "string" && /^[A-Z][A-Z0-9_]{1,95}$/u.test(candidate))
    ?? "TOOL_CALL_FAILED";
}

const tracePath = resolve(REPOSITORY_ROOT, requiredEnvironment("INTENT_FIRST_TRACE_PATH"));
insideRepository(tracePath, "INTENT_FIRST_TRACE_PATH");
if (await access(tracePath).then(() => true, () => false)) {
  throw new Error(`Trace output already exists: ${tracePath}`);
}
await mkdir(dirname(tracePath), { recursive: true });
const lockPath = `${tracePath}.lock`;
const lock = await open(lockPath, "wx");
await lock.close();

const benchmarkId = requiredEnvironment("INTENT_FIRST_BENCHMARK_ID");
const sessionId = process.env.INTENT_FIRST_SESSION_ID?.trim()
  || `session-${Date.now()}-${process.pid}`;
const startedAt = new Date().toISOString();
const steps = [];
const pending = new Map();
let clientName = "unknown-mcp-client";
let finalized = false;
let childClosed = false;

const server = spawn(process.execPath, [SERVER_PATH], {
  cwd: REPOSITORY_ROOT,
  env: { ...process.env, VOCALOID_MCP_PROFILE: "production" },
  stdio: ["pipe", "pipe", "pipe"],
});
server.stderr.pipe(process.stderr);

function reserveStep(request) {
  if (request.id === undefined || request.id === null) return undefined;
  if (request.method === "tools/call") {
    const name = String(request.params?.name ?? "");
    const args = request.params?.arguments ?? {};
    const action = typeof args.action === "string" ? args.action : undefined;
    const dryRun = name === "vocaloid_edit_song" && typeof args.payload?.dry_run === "boolean"
      ? args.payload.dry_run
      : undefined;
    const fingerprint = name === "vocaloid_edit_song" && action && args.payload
      ? intentFirstMutationFingerprint(action, args.payload)
      : undefined;
    const step = {
      sequence: steps.length + 1,
      actor: "agent",
      operation: "tool",
      name,
      ...(action ? { action } : {}),
      ...(dryRun !== undefined ? { dry_run: dryRun } : {}),
      ...(fingerprint ? { mutation_fingerprint: fingerprint } : {}),
      ok: false,
      error_code: "SESSION_ENDED",
    };
    steps.push(step);
    pending.set(String(request.id), step);
    return step;
  }
  if (request.method === "resources/read") {
    const step = {
      sequence: steps.length + 1,
      actor: "agent",
      operation: "resource",
      name: String(request.params?.uri ?? ""),
      ok: false,
      error_code: "SESSION_ENDED",
    };
    steps.push(step);
    pending.set(String(request.id), step);
    return step;
  }
  return undefined;
}

function completeStep(message) {
  if (message.id === undefined || message.id === null) return;
  const step = pending.get(String(message.id));
  if (!step) return;
  pending.delete(String(message.id));
  const ok = callSucceeded(message);
  step.ok = ok;
  if (ok) {
    delete step.error_code;
    const objectIds = collectObjectIds(message.result?.structuredContent?.data);
    if (objectIds.length > 0) step.object_ids = objectIds;
  } else {
    step.error_code = callErrorCode(message);
  }
}

async function finalize(exitCode = 0) {
  if (finalized) return;
  finalized = true;
  const trace = IntentFirstBenchmarkTraceSchema.parse({
    schema: "vocaloid-intent-first-benchmark-trace/v1",
    benchmark_id: benchmarkId,
    client: clientName,
    profile: "production",
    session: {
      id: sessionId,
      producer: "vocaloid-intent-first-harness",
      version: "1.0.0",
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    },
    isolation: {
      fresh_workspace: true,
      shell_access: "forbidden",
      network_access: "forbidden",
      other_mcp_access: "forbidden",
      corpus_mounted: false,
    },
    steps,
  });
  const temporary = `${tracePath}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, `${JSON.stringify(trace, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, tracePath);
  } finally {
    await unlink(temporary).catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
  }
  process.exitCode = exitCode;
}

const clientLines = createInterface({ input: process.stdin, crlfDelay: Infinity });
clientLines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    server.stdin.write(`${line}\n`);
    return;
  }
  if (message.method === "initialize" && typeof message.params?.clientInfo?.name === "string") {
    const version = typeof message.params.clientInfo.version === "string"
      ? `/${message.params.clientInfo.version}`
      : "";
    clientName = `${message.params.clientInfo.name}${version}`.slice(0, 256);
  }
  const step = reserveStep(message);
  if (step?.operation === "resource" && PROHIBITED_RESOURCE.test(step.name)) {
    step.error_code = "PROHIBITED_EVIDENCE_ACCESS";
    pending.delete(String(message.id));
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32_001, message: "Intent-first benchmark forbids corpus/style/reference resources" },
    })}\n`);
    return;
  }
  server.stdin.write(`${line}\n`);
});
clientLines.on("close", () => server.stdin.end());

const serverLines = createInterface({ input: server.stdout, crlfDelay: Infinity });
serverLines.on("line", (line) => {
  try {
    completeStep(JSON.parse(line));
  } catch {
    // Preserve protocol bytes even if a future server notification is not JSON-RPC shaped.
  }
  process.stdout.write(`${line}\n`);
});

server.on("close", async (code) => {
  childClosed = true;
  await finalize(code ?? 0);
});
server.on("error", async (error) => {
  process.stderr.write(`intent-first proxy failed to launch MCP server: ${error.message}\n`);
  await finalize(1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (!childClosed) server.kill(signal);
    await finalize(signal === "SIGINT" ? 130 : 143);
  });
}
