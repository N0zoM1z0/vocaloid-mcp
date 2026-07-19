import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
  evaluateIntentFirstBenchmark,
  intentFirstMutationFingerprint,
  IntentFirstBenchmarkSpecSchema,
  IntentFirstBenchmarkTraceSchema,
  type IntentFirstBenchmarkSpec,
  type IntentFirstBenchmarkTrace,
} from "../src/evaluation/intent-first-benchmark.js";
import { songIntentHash } from "../src/intent/hash.js";
import { alignJapanesePhrase, japaneseG2P } from "../src/japanese.js";
import {
  addSongManifestReviewNote,
  bindSongManifestPhraseRealization,
  createSongManifest,
  fileSha256,
  loadSongManifest,
  recordSongManifestArtifacts,
  setSongManifestCompositionGuidance,
  setSongManifestCompositionIntent,
  upsertSongManifestArrangementTrack,
  upsertSongManifestVocalPart,
  type ManifestArtifact,
  type ManifestVocalPart,
} from "../src/song-manifest.js";


const SPEC_PATH = join(
  process.cwd(),
  "benchmarks/intent-first/withheld-answer-anchor-v1.spec.json",
);
const CREATED_AT = "2026-07-19T08:00:00.000Z";
const execFileAsync = promisify(execFile);

async function benchmarkSpec(): Promise<IntentFirstBenchmarkSpec> {
  return IntentFirstBenchmarkSpecSchema.parse(JSON.parse(await readFile(SPEC_PATH, "utf8")));
}

function alignedPhrase(
  lyric: IntentFirstBenchmarkSpec["lyrics"][number],
  startMeasure: number,
): ManifestVocalPart["phrases"][number] {
  const morae = japaneseG2P({ text: lyric.surface_text, reading: lyric.reading }).units.length;
  return alignJapanesePhrase({
    text: lyric.surface_text,
    reading: lyric.reading,
    phrase_id: `phrase-${lyric.role}`,
    start: { measure: startMeasure, beat: 0 },
    allocation: "sequential",
    note_slots: Array.from({ length: morae }, (_unused, index) => ({
      id: `cell-${lyric.role}-${String(index + 1).padStart(2, "0")}`,
      duration: 240,
      note_number: [60, 64, 67, 64][index % 4]!,
      gate_percent: 92,
      velocity: 64,
    })),
  }).phrase;
}

function editPair(
  trace: IntentFirstBenchmarkTrace["steps"],
  action: string,
  fingerprintIndex: number,
): void {
  const mutation_fingerprint = String(fingerprintIndex).padStart(64, "0");
  trace.push({
    sequence: trace.length + 1,
    actor: "agent",
    operation: "tool",
    name: "vocaloid_edit_song",
    action,
    dry_run: true,
    mutation_fingerprint,
    ok: true,
  });
  trace.push({
    sequence: trace.length + 1,
    actor: "agent",
    operation: "tool",
    name: "vocaloid_edit_song",
    action,
    dry_run: false,
    mutation_fingerprint,
    ok: true,
  });
}

function traceForFixture(includeHumanAndDelivery: boolean): IntentFirstBenchmarkTrace {
  const steps: IntentFirstBenchmarkTrace["steps"] = [{
    sequence: 1,
    actor: "agent",
    operation: "resource",
    name: "vocaloid://composition-intent-contract",
    ok: true,
  }];
  [
    "set_composition_intent",
    "upsert_vocal_part",
    "upsert_vocal_part",
    "upsert_arrangement",
    "upsert_arrangement",
    "upsert_arrangement",
    "bind_phrase_realization",
    "set_composition_guidance",
  ].forEach((action, index) => editPair(steps, action, index + 1));
  const toolStep = (name: string, action: string, object_ids: string[]) => steps.push({
    sequence: steps.length + 1,
    actor: "agent",
    operation: "tool",
    name,
    action,
    object_ids,
    ok: true,
  });
  toolStep("vocaloid_build_song_manifest", "build", ["vsqx-current"]);
  toolStep("vocaloid_render_manifest_master", "render", ["master-hypothesis-a"]);
  toolStep("vocaloid_render_manifest_master", "render", ["master-hypothesis-b"]);
  toolStep("vocaloid_review_audio", "anchor_preview", ["preview-lead-solo"]);
  toolStep("vocaloid_review_audio", "anchor_preview", ["preview-lead-harmony"]);
  toolStep("vocaloid_review_audio", "anchor_preview", ["preview-minimal-band"]);
  toolStep("vocaloid_review_audio", "compare_anchor_ab", ["preview-ab-a", "preview-ab-b"]);
  if (includeHumanAndDelivery) {
    steps.push({
      sequence: steps.length + 1,
      actor: "human",
      operation: "tool",
      name: "vocaloid_review_song",
      action: "add",
      object_ids: ["review-anchor-human"],
      ok: true,
    });
    toolStep("vocaloid_master_manifest_delivery", "master", ["delivery-current"]);
  }
  return IntentFirstBenchmarkTraceSchema.parse({
    schema: "vocaloid-intent-first-benchmark-trace/v1",
    benchmark_id: "withheld-answer-anchor-v1",
    client: "synthetic-contract-test",
    profile: "production",
    session: {
      id: includeHumanAndDelivery ? "fixture-complete" : "fixture-awaiting-listener",
      producer: "vocaloid-intent-first-harness",
      version: "1.0.0",
      started_at: "2026-07-19T08:00:00.000Z",
      completed_at: "2026-07-19T08:10:00.000Z",
    },
    client_transcript: {
      format: "codex-jsonl/v1",
      sha256: "a".repeat(64),
      bytes: 4096,
      vocaloid_mcp_calls: steps.filter((step) => step.actor === "agent" && step.operation === "tool").length,
      non_vocaloid_tool_calls: 0,
      non_vocaloid_item_types: [],
      trace_tool_calls_matched: true,
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
}

async function artifact(
  directory: string,
  manifestRevision: number,
  compositionHash: string,
  id: string,
  role: ManifestArtifact["role"],
  dependencies: string[],
  metadata: ManifestArtifact["metadata"],
): Promise<ManifestArtifact> {
  const path = join(directory, `${id}.${role === "vsqx" ? "vsqx" : "wav"}`);
  await writeFile(path, `synthetic benchmark artifact ${id}\n`, { flag: "wx" });
  const digest = await fileSha256(path);
  return {
    id,
    role,
    path,
    ...digest,
    source_revision: manifestRevision,
    source_composition_hash: compositionHash,
    dependencies,
    metadata,
    created_at: CREATED_AT,
  };
}

async function createBenchmarkFixture(
  directory: string,
  includeHumanAndDelivery: boolean,
): Promise<{ manifestPath: string; trace: IntentFirstBenchmarkTrace }> {
  const spec = await benchmarkSpec();
  const manifestPath = join(directory, "withheld-answer-anchor-v1.song.json");
  await createSongManifest({
    outputPath: manifestPath,
    songId: spec.manifest.song_id,
    slug: spec.manifest.slug,
    title: spec.manifest.title,
    format: "vsq3",
    preMeasure: 1,
    timeSignatures: [{ measure: 0, numerator: 4, denominator: 4 }],
    tempos: [{ position: { measure: 0, beat: 0 }, bpm: 96 }],
    sections: [{
      id: "anchor-chorus",
      name: "Anchor Chorus",
      kind: "chorus",
      start: { measure: 0, beat: 0 },
      end: { measure: 8, beat: 0 },
    }],
    keyChanges: [{
      id: "key-c-major",
      position: { measure: 0, beat: 0 },
      tonic: "C",
      mode: "major",
    }],
    chordChanges: [{
      id: "chord-c-major",
      position: { measure: 0, beat: 0 },
      symbol: "C",
      duration_ticks: 15_360,
    }],
    sampleRate: 44_100,
    gain: 0.2,
    reverb: false,
    chorus: false,
    overwrite: false,
  });
  await setSongManifestCompositionIntent(manifestPath, manifestPath, 1, {
    schema: "vocaloid-composition-intent/v1",
    song: spec.fixed_intent.song,
    sections: [spec.fixed_intent.section],
    phrase_directions: [spec.fixed_intent.anchor],
  }, true);

  const phrases = [
    alignedPhrase(spec.lyrics.find((lyric) => lyric.role === "lead_in")!, 0),
    alignedPhrase(spec.lyrics.find((lyric) => lyric.role === "anchor")!, 2),
    alignedPhrase(spec.lyrics.find((lyric) => lyric.role === "release")!, 5),
  ];
  await upsertSongManifestVocalPart(
    manifestPath,
    manifestPath,
    2,
    { id: "voice-ia-rocks", name: spec.voice.name, component_id: spec.voice.component_id },
    { id: "lead-vocal", name: "Lead Vocal", voice_id: "voice-ia-rocks" },
    {
      id: "lead-anchor-part",
      section_id: "anchor-chorus",
      name: "Lead Anchor",
      start: { measure: 0, beat: 0 },
      end: { measure: 8, beat: 0 },
      phrases,
      control_curves: [{
        id: "lead-dyn",
        curve: "DYN",
        points: [
          { id: "lead-dyn-start", position: { measure: 0, beat: 0 }, value: 55 },
          { id: "lead-dyn-focus", position: { measure: 3, beat: 0 }, value: 72 },
          { id: "lead-dyn-release", position: { measure: 6, beat: 0 }, value: 58 },
        ],
      }],
    },
    true,
  );
  await upsertSongManifestVocalPart(
    manifestPath,
    manifestPath,
    3,
    { id: "voice-ia-rocks", name: spec.voice.name, component_id: spec.voice.component_id },
    { id: "harmony-vocal", name: "Harmony Vocal", voice_id: "voice-ia-rocks" },
    {
      id: "harmony-anchor-part",
      section_id: "anchor-chorus",
      name: "Harmony Anchor",
      start: { measure: 2, beat: 0 },
      end: { measure: 5, beat: 0 },
      notes: [
        { id: "harmony-c3", position: { measure: 2, beat: 0 }, duration: 720, note_number: 48, lyric: "あ", phonemes: "a" },
        { id: "harmony-e3", position: { measure: 3, beat: 0 }, duration: 720, note_number: 52, lyric: "あ", phonemes: "a" },
        { id: "harmony-g3", position: { measure: 4, beat: 0 }, duration: 720, note_number: 55, lyric: "あ", phonemes: "a" },
      ],
    },
    true,
  );
  await upsertSongManifestArrangementTrack(manifestPath, manifestPath, 4, {
    kind: "pitched",
    id: "bass",
    name: "Finger Bass",
    program: 33,
    notes: Array.from({ length: 8 }, (_unused, measure) => ({
      id: `bass-${measure + 1}`,
      position: { measure, beat: 1 },
      duration: 1200,
      note_number: measure % 2 === 0 ? 36 : 43,
      velocity: 72,
    })),
  }, true);
  await upsertSongManifestArrangementTrack(manifestPath, manifestPath, 5, {
    kind: "pitched",
    id: "piano",
    name: "Core Piano",
    program: 0,
    notes: Array.from({ length: 4 }, (_unused, index) => [72, 76, 79].map((note, voice) => ({
      id: `piano-${index + 1}-${voice + 1}`,
      position: { measure: index * 2, beat: 0 },
      duration: 3360,
      note_number: note,
      velocity: 60,
    }))).flat(),
  }, true);
  await upsertSongManifestArrangementTrack(manifestPath, manifestPath, 6, {
    kind: "drums",
    id: "drums",
    name: "Minimal Drums",
    hits: Array.from({ length: 8 }, (_unused, measure) => [
      { id: `kick-${measure + 1}`, position: { measure, beat: 0 }, note_number: 36, velocity: 76, duration: 60 },
      { id: `snare-${measure + 1}`, position: { measure, beat: 2 }, note_number: 38, velocity: 68, duration: 60 },
    ]).flat(),
  }, true);
  const anchorPhrase = phrases.find((phrase) => phrase.id === "phrase-anchor")!;
  await bindSongManifestPhraseRealization(
    manifestPath,
    manifestPath,
    7,
    spec.fixed_intent.anchor.id,
    {
      vocal_phrase_ids: [anchorPhrase.id],
      lyric_unit_ids: anchorPhrase.lyrics.map((lyric) => lyric.id),
      semantic_focus_object_ids: anchorPhrase.lyrics.slice(-4).map((lyric) => lyric.id),
      chord_ids: ["chord-c-major"],
      track_ids: ["lead-vocal", "harmony-vocal", "bass", "piano", "drums"],
    },
    true,
  );
  await setSongManifestCompositionGuidance(manifestPath, manifestPath, 8, {
    theory_ruleset_id: "core/v1",
    strictness: "balanced",
    harmonic_language: "tonal",
    required_review_severities: spec.acceptance.required_review_severities,
    intent_review_policy: {
      mode: "required_for_delivery",
      require_song_intent: true,
      require_section_intent: true,
      minimum_anchor_phrases: 1,
      require_current_audition_review: true,
    },
    exceptions: [],
  }, true);

  const scored = (await loadSongManifest(manifestPath)).manifest;
  const intentHash = songIntentHash(scored.composition_intent!);
  const sharedPreview = {
    audition_kind: "anchor_passage",
    phrase_direction_id: spec.fixed_intent.anchor.id,
    listening_question_id: spec.fixed_intent.anchor.listening_question.id,
    intent_hash: intentHash,
    section_id: "anchor-chorus",
    passage_duration_seconds: 25,
  } as const;
  const artifacts = await Promise.all([
    artifact(directory, scored.revision, scored.composition_hash, "vsqx-current", "vsqx", [], {
      builder: "song-manifest",
    }),
    artifact(directory, scored.revision, scored.composition_hash, "master-hypothesis-a", "master", ["vsqx-current"], {
      renderer: "vocaloid3-original-editor",
    }),
    artifact(directory, scored.revision, scored.composition_hash, "master-hypothesis-b", "master", ["vsqx-current"], {
      renderer: "vocaloid3-original-editor",
    }),
    artifact(directory, scored.revision, scored.composition_hash, "preview-lead-solo", "preview", ["master-hypothesis-b", "anchor-cannot-say", "anchor-chorus"], {
      ...sharedPreview,
      renderer: "ffmpeg-anchor-preview",
      audition_layer: "lead_solo",
    }),
    artifact(directory, scored.revision, scored.composition_hash, "preview-lead-harmony", "preview", ["master-hypothesis-b", "anchor-cannot-say", "anchor-chorus"], {
      ...sharedPreview,
      renderer: "ffmpeg-anchor-preview",
      audition_layer: "lead_harmony",
    }),
    artifact(directory, scored.revision, scored.composition_hash, "preview-minimal-band", "preview", ["master-hypothesis-b", "anchor-cannot-say", "anchor-chorus"], {
      ...sharedPreview,
      renderer: "ffmpeg-anchor-preview",
      audition_layer: "minimal_band",
    }),
    artifact(directory, scored.revision, scored.composition_hash, "preview-ab-a", "preview", ["master-hypothesis-a", "anchor-cannot-say", "anchor-chorus"], {
      ...sharedPreview,
      renderer: "ffmpeg-anchor-loudness-match",
      audition_layer: "full_layers",
      comparison_kind: "single_question_ab",
      hypothesis_family: "delivery",
      pair_id: "anchor-delivery-pair",
      side: "A",
      target_lufs: -18,
      source_artifact: "master-hypothesis-a",
    }),
    artifact(directory, scored.revision, scored.composition_hash, "preview-ab-b", "preview", ["master-hypothesis-b", "anchor-cannot-say", "anchor-chorus"], {
      ...sharedPreview,
      renderer: "ffmpeg-anchor-loudness-match",
      audition_layer: "full_layers",
      comparison_kind: "single_question_ab",
      hypothesis_family: "delivery",
      pair_id: "anchor-delivery-pair",
      side: "B",
      target_lufs: -18,
      source_artifact: "master-hypothesis-b",
    }),
  ]);
  await recordSongManifestArtifacts(manifestPath, 9, scored.composition_hash, artifacts);

  if (includeHumanAndDelivery) {
    const auditioned = (await loadSongManifest(manifestPath)).manifest;
    const selected = auditioned.artifacts.find((entry) => entry.id === "preview-ab-b")!;
    const comparison = auditioned.artifacts.find((entry) => entry.id === "preview-ab-a")!;
    await addSongManifestReviewNote(manifestPath, 10, {
      id: "review-anchor-human",
      author_type: "human",
      author_name: "benchmark-listener",
      observation: "I can hear the unsaid request in version B, while its released ending avoids turning the line into an order.",
      section_id: "anchor-chorus",
      object_ids: ["anchor-cannot-say", ...anchorPhrase.lyrics.slice(-4).map((lyric) => lyric.id)],
      artifact_ids: [selected.id, comparison.id],
      intent_fidelity: {
        review_kind: "intent_fidelity",
        phrase_direction_id: "anchor-cannot-say",
        listening_question_id: "question-restraint-readable",
        intent_hash: intentHash,
        composition_hash: auditioned.composition_hash,
        artifact_id: selected.id,
        artifact_sha256: selected.sha256,
        comparison_artifacts: [{ artifact_id: comparison.id, artifact_sha256: comparison.sha256 }],
        hypothesis_family: "delivery",
        outcome: "keep",
      },
    });
    const reviewed = (await loadSongManifest(manifestPath)).manifest;
    const delivery = await artifact(
      directory,
      reviewed.revision,
      reviewed.composition_hash,
      "delivery-current",
      "delivery",
      ["master-hypothesis-b"],
      {
        renderer: "ffmpeg-loudnorm-two-pass",
        release_policy_enabled: true,
        release_policy_ready: true,
        theory_ruleset_id: "core/v1",
        intent_review_policy: "required_for_delivery",
      },
    );
    await recordSongManifestArtifacts(manifestPath, 11, reviewed.composition_hash, [delivery]);
  }
  return { manifestPath, trace: traceForFixture(includeHumanAndDelivery) };
}

test("intent-first benchmark contracts are strict and mutation fingerprints ignore only dry_run", async () => {
  const spec = await benchmarkSpec();
  assert.equal(spec.fixed_intent.anchor.listening_question.id, "question-restraint-readable");
  assert.throws(
    () => IntentFirstBenchmarkSpecSchema.parse({ ...spec, unknown_field: true }),
    /Unrecognized key/u,
  );
  const write = {
    input_path: "song.song.json",
    output_path: "song.song.json",
    expected_revision: 2,
    overwrite: true,
    dry_run: false,
    phrase_direction_id: "anchor-cannot-say",
  };
  assert.equal(
    intentFirstMutationFingerprint("bind_phrase_realization", { ...write, dry_run: true }),
    intentFirstMutationFingerprint("bind_phrase_realization", write),
  );
  assert.notEqual(
    intentFirstMutationFingerprint("bind_phrase_realization", write),
    intentFirstMutationFingerprint("bind_phrase_realization", { ...write, expected_revision: 3 }),
  );
});

test("synthetic theory-only evidence passes only with matching human and post-listening delivery trace", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-intent-first-complete-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const fixture = await createBenchmarkFixture(temporary, true);
  const result = await evaluateIntentFirstBenchmark(fixture.manifestPath, await benchmarkSpec(), fixture.trace);
  assert.equal(result.status, "passed", JSON.stringify(result, null, 2));
  assert.deepEqual(result.gates, { gate1: "pass", gate2: "pass", gate2a: "pass" });
  assert.equal(result.metrics.humanConfirmedAnchors, 1);
  assert.equal(result.checks.find((entry) => entry.id === "review.human_keep")?.status, "pass");
});

test("complete technical audition remains awaiting human listening and prohibited evidence fails isolation", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-intent-first-awaiting-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const fixture = await createBenchmarkFixture(temporary, false);
  const spec = await benchmarkSpec();
  const awaiting = await evaluateIntentFirstBenchmark(fixture.manifestPath, spec, fixture.trace);
  assert.equal(awaiting.status, "awaiting_human_listening", JSON.stringify(awaiting, null, 2));
  assert.equal(awaiting.gates.gate2a, "pending");
  assert.equal(awaiting.metrics.humanConfirmedAnchors, 0);
  assert.equal(awaiting.checks.find((entry) => entry.id === "review.human_keep")?.status, "pending");

  const contaminated = structuredClone(fixture.trace);
  contaminated.steps.push({
    sequence: contaminated.steps.length + 1,
    actor: "agent",
    operation: "resource",
    name: "vocaloid://styles",
    ok: true,
  });
  const failed = await evaluateIntentFirstBenchmark(fixture.manifestPath, spec, contaminated);
  assert.equal(failed.status, "failed");
  assert.equal(failed.checks.find((entry) => entry.id === "isolation.no_corpus_style_reference")?.status, "fail");
});

test("benchmark evaluator keeps corpus and style modules outside its import boundary", async () => {
  const source = await readFile(
    join(process.cwd(), "src/evaluation/intent-first-benchmark.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:corpus|style)[^"']*["']/u);
});

test("stdio isolation proxy records real production calls and blocks style resources", async (context) => {
  const temporary = await mkdtemp(join(process.cwd(), ".test-intent-first-proxy-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const tracePath = join(temporary, "proxy.trace.json");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), "scripts/intent-first-mcp-proxy.mjs")],
    env: {
      INTENT_FIRST_TRACE_PATH: tracePath,
      INTENT_FIRST_BENCHMARK_ID: "withheld-answer-anchor-v1",
      INTENT_FIRST_SESSION_ID: "proxy-contract-test",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "intent-first-proxy-test", version: "1.0.0" });
  await client.connect(transport);
  const capabilities = await client.readResource({ uri: "vocaloid://capabilities" });
  assert.equal(capabilities.contents.length, 1);
  await assert.rejects(
    client.readResource({ uri: "vocaloid://styles" }),
    /forbids corpus\/style\/reference resources/u,
  );
  const invalid = await client.callTool({
    name: "vocaloid_edit_song",
    arguments: {
      action: "set_composition_intent",
      payload: { dry_run: true },
      response_format: "json",
    },
  });
  assert.equal(invalid.isError, true);
  await client.close();

  let raw: string | undefined;
  for (let attempt = 0; attempt < 80 && raw === undefined; attempt += 1) {
    raw = await readFile(tracePath, "utf8").catch(() => undefined);
    if (raw === undefined) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(raw, "proxy did not atomically finalize its trace");
  const trace = IntentFirstBenchmarkTraceSchema.parse(JSON.parse(raw));
  assert.equal(trace.client, "intent-first-proxy-test/1.0.0");
  assert.deepEqual(trace.steps.map((step) => [step.operation, step.name, step.ok]), [
    ["resource", "vocaloid://capabilities", true],
    ["resource", "vocaloid://styles", false],
    ["tool", "vocaloid_edit_song", false],
  ]);
  assert.equal(trace.steps[1]?.error_code, "PROHIBITED_EVIDENCE_ACCESS");
  assert.match(trace.steps[2]?.mutation_fingerprint ?? "", /^[a-f0-9]{64}$/u);

  const transcriptPath = join(temporary, "codex.jsonl");
  const finalizedPath = join(temporary, "proxy.final.trace.json");
  await writeFile(transcriptPath, [
    JSON.stringify({ type: "thread.started", thread_id: "fixture" }),
    JSON.stringify({
      type: "item.completed",
      item: {
        id: "mcp-1",
        type: "mcp_tool_call",
        server: "vocaloid",
        tool: "vocaloid_edit_song",
        arguments: {
          action: "set_composition_intent",
          payload: { dry_run: true },
          response_format: "json",
        },
        result: { isError: true, structured_content: { ok: false } },
        error: null,
        status: "completed",
      },
    }),
    JSON.stringify({ type: "item.completed", item: { id: "message-1", type: "agent_message", text: "done" } }),
    "",
  ].join("\n"), { flag: "wx" });
  await execFileAsync(process.execPath, [
    join(process.cwd(), "scripts/finalize-intent-first-trace.mjs"),
    `--trace=${tracePath}`,
    `--client-transcript=${transcriptPath}`,
    `--output=${finalizedPath}`,
  ]);
  const finalized = IntentFirstBenchmarkTraceSchema.parse(JSON.parse(await readFile(finalizedPath, "utf8")));
  assert.equal(finalized.client_transcript?.vocaloid_mcp_calls, 1);
  assert.equal(finalized.client_transcript?.non_vocaloid_tool_calls, 0);
  assert.equal(finalized.client_transcript?.trace_tool_calls_matched, true);

  const dirtyTranscriptPath = join(temporary, "codex-dirty.jsonl");
  const dirtyFinalizedPath = join(temporary, "proxy.dirty.final.trace.json");
  await writeFile(dirtyTranscriptPath, [
    JSON.stringify({
      type: "item.completed",
      item: {
        id: "mcp-1",
        type: "mcp_tool_call",
        server: "vocaloid",
        tool: "vocaloid_edit_song",
        arguments: {
          action: "set_composition_intent",
          payload: { dry_run: true },
          response_format: "json",
        },
        result: { isError: true, structured_content: { ok: false } },
        error: null,
        status: "completed",
      },
    }),
    JSON.stringify({
      type: "item.completed",
      item: { id: "shell-1", type: "command_execution", command: "pwd" },
    }),
    "",
  ].join("\n"), { flag: "wx" });
  await assert.rejects(execFileAsync(process.execPath, [
    join(process.cwd(), "scripts/finalize-intent-first-trace.mjs"),
    `--trace=${tracePath}`,
    `--client-transcript=${dirtyTranscriptPath}`,
    `--output=${dirtyFinalizedPath}`,
  ]));
  const dirty = IntentFirstBenchmarkTraceSchema.parse(JSON.parse(await readFile(dirtyFinalizedPath, "utf8")));
  assert.equal(dirty.client_transcript?.non_vocaloid_tool_calls, 1);
  assert.deepEqual(dirty.client_transcript?.non_vocaloid_item_types, ["command_execution"]);
});
