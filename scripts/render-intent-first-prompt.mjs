#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { IntentFirstBenchmarkSpecSchema } from "../dist/src/evaluation/intent-first-benchmark.js";


const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const SPEC_PATH = resolve(
  REPOSITORY_ROOT,
  "benchmarks/intent-first/withheld-answer-anchor-v1.spec.json",
);
const spec = IntentFirstBenchmarkSpecSchema.parse(JSON.parse(await readFile(SPEC_PATH, "utf8")));
const runArgument = process.argv.slice(2).find((value) => value.startsWith("--run-id="));
if (!runArgument || process.argv.slice(2).some((value) => !value.startsWith("--run-id="))) {
  throw new Error("Usage: npm run --silent eval:intent-first:prompt -- --run-id=<stable-lowercase-id>");
}
const runId = runArgument.slice("--run-id=".length);
if (!/^[a-z0-9][a-z0-9._-]{0,95}$/u.test(runId)) {
  throw new Error("--run-id must be a stable lowercase ID");
}
const outputRoot = `build/benchmarks/${runId}`;

const prompt = `You are taking an isolated intent-first VOCALOID composition benchmark.

Use only the configured VOCALOID production MCP. You have no shell, direct filesystem, network, other MCP, local IA corpus, style profile, reference track, or prior song. Do not ask for or access any of them. Read only the MCP capability, composition-intent, music-theory, and selected edit-action contracts that you need.

Your task is not merely to make IA sing. Preserve this question throughout the attempt:

${spec.fixed_intent.anchor.listening_question.question}

Copy the fixed song, section, and anchor declaration exactly into canonical composition_intent before the first score or arrangement mutation. You choose the melody, harmony, rhythm, register, note allocation, delivery realization, and arrangement. Do not invent an IA style target and do not optimize similarity to any existing song.

Use only new paths under ${outputRoot}. The canonical manifest path is ${outputRoot}/${runId}.song.json. Give every VSQX/WAV/preview a new run- and revision-bearing filename; never overwrite an audio artifact. The harness created the directory before this session.

Use dry_run before every vocaloid_edit_song write. Preserve the supplied Japanese surface text and reading separately. Complete a bounded ${spec.acceptance.minimum_audition_seconds}–${spec.acceptance.maximum_audition_seconds} second anchor through lead_solo, lead_harmony, and minimal_band; build one loudness-matched A/B that changes only one named hypothesis family. Resolve all policy-required theory warnings through a score repair or an exact current exception with a concrete listening rationale.

When technical evidence is ready, stop and request human listening. Never create, infer, or report a human keep/reject/revise decision. Do not create final delivery before a matching human review exists.

Fixed benchmark contract:

${JSON.stringify(spec, null, 2)}
`;

process.stdout.write(prompt);
