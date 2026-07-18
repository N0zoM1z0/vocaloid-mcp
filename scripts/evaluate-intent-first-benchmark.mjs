#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateIntentFirstBenchmark } from "../dist/src/evaluation/intent-first-benchmark.js";


const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_SPEC = resolve(
  REPOSITORY_ROOT,
  "benchmarks/intent-first/withheld-answer-anchor-v1.spec.json",
);

function usage() {
  return [
    "Usage:",
    "  npm run eval:intent-first -- --manifest=<path> --trace=<path> [--spec=<path>] [--output=<path>] [--require-pass]",
    "",
    "The command evaluates existing isolated-session evidence. It does not compose music or create a listening decision.",
  ].join("\n");
}

function parseArguments(values) {
  const parsed = { spec: DEFAULT_SPEC, requirePass: false };
  for (const value of values) {
    if (value === "--help" || value === "-h") return { help: true };
    if (value === "--require-pass") {
      parsed.requirePass = true;
      continue;
    }
    const match = /^--([a-z-]+)=(.+)$/u.exec(value);
    if (!match) throw new Error(`Unknown argument ${value}\n\n${usage()}`);
    const [, key, raw] = match;
    if (key === "manifest" || key === "trace" || key === "spec" || key === "output") {
      parsed[key] = resolve(REPOSITORY_ROOT, raw);
    } else {
      throw new Error(`Unknown argument --${key}\n\n${usage()}`);
    }
  }
  return parsed;
}

function assertInsideRepository(path, label) {
  const delta = relative(REPOSITORY_ROOT, path);
  if (delta === ".." || delta.startsWith(`..${sep}`)) {
    throw new Error(`${label} must remain inside ${REPOSITORY_ROOT}`);
  }
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${label} ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const args = parseArguments(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}
if (!args.manifest) throw new Error(`--manifest is required\n\n${usage()}`);
if (!args.trace) throw new Error(`--trace is required; isolation cannot be inferred from a manifest\n\n${usage()}`);
for (const [label, path] of [["manifest", args.manifest], ["trace", args.trace], ["spec", args.spec]]) {
  assertInsideRepository(path, label);
}
if (args.output) assertInsideRepository(args.output, "output");

const [spec, trace] = await Promise.all([
  readJson(args.spec, "benchmark spec"),
  readJson(args.trace, "benchmark trace"),
]);
const result = await evaluateIntentFirstBenchmark(args.manifest, spec, trace);
const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (args.output) await writeFile(args.output, serialized, { encoding: "utf8", flag: "wx" });
process.stdout.write(serialized);

if (result.status === "failed" || (args.requirePass && result.status !== "passed")) {
  process.exitCode = 1;
}
