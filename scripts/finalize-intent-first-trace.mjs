#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  intentFirstMutationFingerprint,
  IntentFirstBenchmarkTraceSchema,
} from "../dist/src/evaluation/intent-first-benchmark.js";


const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const SAFE_NON_ACTION_ITEMS = new Set(["agent_message", "reasoning", "plan", "todo_list"]);
const VOCALOID_ITEMS = new Set(["mcp_tool_call", "mcp_resource_call"]);

function usage() {
  return [
    "Usage:",
    "  node scripts/finalize-intent-first-trace.mjs --trace=<raw.trace.json> --client-transcript=<codex.jsonl> --output=<final.trace.json>",
    "",
    "The output is created immutably. Unknown completed/started item types fail closed as non-VOCALOID tool use.",
  ].join("\n");
}

function argumentsFrom(values) {
  const result = {};
  for (const value of values) {
    if (value === "--help" || value === "-h") return { help: true };
    const match = /^--(trace|client-transcript|output)=(.+)$/u.exec(value);
    if (!match) throw new Error(`Unknown argument ${value}\n\n${usage()}`);
    result[match[1]] = resolve(REPOSITORY_ROOT, match[2]);
  }
  return result;
}

function assertInsideRepository(path, label) {
  const delta = relative(REPOSITORY_ROOT, path);
  if (delta === ".." || delta.startsWith(`..${sep}`)) {
    throw new Error(`${label} must remain inside ${REPOSITORY_ROOT}`);
  }
}

function auditClientTranscript(buffer) {
  const seenVocaloid = new Set();
  const seenNonVocaloid = new Map();
  const startedToolOrder = [];
  const toolItems = new Map();
  const lines = buffer.toString("utf8").split(/\r?\n/u).filter((line) => line.trim().length > 0);
  for (const [index, line] of lines.entries()) {
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid Codex JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (event.type !== "item.started" && event.type !== "item.completed") continue;
    const item = event.item;
    if (!item || typeof item.type !== "string") {
      throw new Error(`Codex JSONL line ${index + 1} has an item event without a typed item`);
    }
    const id = typeof item.id === "string" ? item.id : `line-${index + 1}`;
    if (VOCALOID_ITEMS.has(item.type) && item.server === "vocaloid") {
      if (event.type === "item.started" && item.type === "mcp_tool_call" && !toolItems.has(id)) {
        startedToolOrder.push(id);
        toolItems.set(id, item);
      }
      if (event.type === "item.completed") {
        seenVocaloid.add(id);
        if (item.type === "mcp_tool_call") {
          if (!toolItems.has(id)) startedToolOrder.push(id);
          toolItems.set(id, item);
        }
      }
      continue;
    }
    if (SAFE_NON_ACTION_ITEMS.has(item.type)) continue;
    seenNonVocaloid.set(id, item.type);
  }
  const toolCalls = startedToolOrder.map((id) => toolItems.get(id)).filter(Boolean).map((item) => {
    const args = item.arguments ?? {};
    const action = typeof args.action === "string" ? args.action : undefined;
    const dry_run = item.tool === "vocaloid_edit_song" && typeof args.payload?.dry_run === "boolean"
      ? args.payload.dry_run
      : undefined;
    const mutation_fingerprint = item.tool === "vocaloid_edit_song" && action && args.payload
      ? intentFirstMutationFingerprint(action, args.payload)
      : undefined;
    const structured = item.result?.structured_content ?? item.result?.structuredContent;
    const ok = item.error == null && item.status !== "failed"
      && item.result?.isError !== true && structured?.ok !== false;
    return {
      name: item.tool,
      ...(action ? { action } : {}),
      ...(dry_run !== undefined ? { dry_run } : {}),
      ...(mutation_fingerprint ? { mutation_fingerprint } : {}),
      ok,
    };
  });
  return {
    audit: {
      format: "codex-jsonl/v1",
      sha256: createHash("sha256").update(buffer).digest("hex"),
      bytes: buffer.length,
      vocaloid_mcp_calls: seenVocaloid.size,
      non_vocaloid_tool_calls: seenNonVocaloid.size,
      non_vocaloid_item_types: [...new Set(seenNonVocaloid.values())].sort(),
    },
    toolCalls,
  };
}

const args = argumentsFrom(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}
for (const key of ["trace", "client-transcript", "output"]) {
  if (!args[key]) throw new Error(`--${key} is required\n\n${usage()}`);
  assertInsideRepository(args[key], key);
}
if (args.output === args.trace || args.output === args["client-transcript"]) {
  throw new Error("--output must be a new path; raw evidence is immutable");
}

const [rawTrace, transcript] = await Promise.all([
  readFile(args.trace, "utf8"),
  readFile(args["client-transcript"]),
]);
const trace = IntentFirstBenchmarkTraceSchema.parse(JSON.parse(rawTrace));
if (trace.client_transcript) throw new Error("Input trace is already finalized with a client transcript audit");
const audited = auditClientTranscript(transcript);
const traceToolCalls = trace.steps.filter((step) => step.actor === "agent" && step.operation === "tool");
const traceToolCallsMatched = traceToolCalls.length === audited.toolCalls.length
  && traceToolCalls.every((step, index) => {
    const call = audited.toolCalls[index];
    return call !== undefined
      && step.name === call.name
      && step.action === call.action
      && step.dry_run === call.dry_run
      && step.mutation_fingerprint === call.mutation_fingerprint
      && step.ok === call.ok;
  });
const client_transcript = {
  ...audited.audit,
  trace_tool_calls_matched: traceToolCallsMatched,
};
const finalized = IntentFirstBenchmarkTraceSchema.parse({ ...trace, client_transcript });
await writeFile(args.output, `${JSON.stringify(finalized, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify({
  output: args.output,
  client_transcript,
  clean: client_transcript.non_vocaloid_tool_calls === 0 && traceToolCallsMatched,
}, null, 2)}\n`);
if (client_transcript.non_vocaloid_tool_calls > 0 || !traceToolCallsMatched) process.exitCode = 1;
