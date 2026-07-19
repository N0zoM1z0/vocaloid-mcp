import { readFile, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { z } from "zod";

import { PROJECT_ROOT, resolveReadablePath } from "./paths.js";


const StableIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/u);
const ShortTextSchema = z.string().min(1).max(1000);
const LongTextSchema = z.string().min(1).max(4000);

const TempoRangeSchema = z.object({
  min: z.number().min(20).max(400),
  max: z.number().min(20).max(400),
  preferred: z.number().min(20).max(400).optional(),
}).strict().superRefine((range, context) => {
  if (range.min > range.max) {
    context.addIssue({ code: "custom", message: "tempo_bpm.min must be <= tempo_bpm.max" });
  }
  if (range.preferred !== undefined && (range.preferred < range.min || range.preferred > range.max)) {
    context.addIssue({ code: "custom", path: ["preferred"], message: "preferred BPM must be inside min..max" });
  }
});

const DurationRangeSchema = z.object({
  min: z.number().min(20).max(900),
  max: z.number().min(20).max(900),
}).strict().refine((range) => range.min <= range.max, {
  message: "target_duration_seconds.min must be <= target_duration_seconds.max",
});

export const CompositionBriefSchema = z.object({
  schema: z.literal("vocaloid-composition-brief/v1"),
  id: StableIdSchema,
  run_id: StableIdSchema,
  intent: z.object({
    core: ShortTextSchema,
    scene: LongTextSchema,
    emotional_color: LongTextSchema,
    dramatic_motion: LongTextSchema,
    perspective: ShortTextSchema,
    listener_question: z.string().min(10).max(1000),
  }).strict(),
  musical_constraints: z.object({
    target_duration_seconds: DurationRangeSchema,
    tempo_bpm: TempoRangeSchema,
    meter_preferences: z.array(z.string().regex(/^\d{1,2}\/\d{1,2}$/u)).min(1).max(8),
    primary_genre: z.string().min(1).max(128),
    style_tags: z.array(z.string().min(1).max(128)).max(16),
    voice: z.object({
      id: StableIdSchema,
      name: z.string().min(1).max(128),
      component_id: z.string().regex(/^[A-Z0-9]{16}$/u),
    }).strict(),
    lyric_language: z.enum(["Japanese"]),
    lyric_mode: z.enum(["agent_original", "user_supplied"]),
    supplied_lyrics: z.string().min(1).max(20_000).optional(),
    arrangement_hints: z.array(ShortTextSchema).max(16),
    must_avoid: z.array(ShortTextSchema).max(16),
  }).strict().superRefine((constraints, context) => {
    if (constraints.lyric_mode === "user_supplied" && constraints.supplied_lyrics === undefined) {
      context.addIssue({ code: "custom", path: ["supplied_lyrics"], message: "user_supplied lyrics require supplied_lyrics" });
    }
    if (constraints.lyric_mode === "agent_original" && constraints.supplied_lyrics !== undefined) {
      context.addIssue({ code: "custom", path: ["supplied_lyrics"], message: "agent_original lyrics must not include supplied_lyrics" });
    }
  }),
  source_boundaries: z.object({
    local_ia_corpus: z.literal("forbidden"),
    prior_song_artifacts: z.literal("forbidden"),
    reference_tracks_or_melodies: z.literal("forbidden"),
    phrase_grammar_usage: z.literal("selection_only"),
  }).strict(),
  evaluation: z.object({
    fresh_session: z.literal(true),
    human_listening_disposition: z.literal("pending"),
    record_framework_issues: z.literal(true),
  }).strict(),
}).strict();

export type CompositionBrief = z.infer<typeof CompositionBriefSchema>;

const INTENT_ROOT = resolve(PROJECT_ROOT, "intents");
const PROMPT_PATH = "prompts/vocaloid-composition-agent.md";
const INTENT_TOKEN = "{{INTENT_FILE}}";
const BRIEF_TOKEN = "{{COMPOSITION_BRIEF_JSON}}";

function isInside(path: string, root: string): boolean {
  const delta = relative(root, path);
  return delta === "" || (!delta.startsWith(`..${sep}`) && delta !== "..");
}

export async function loadCompositionBrief(intentFile: string): Promise<{
  path: string;
  projectRelativePath: string;
  brief: CompositionBrief;
}> {
  const path = await resolveReadablePath(intentFile);
  const actualIntentRoot = await realpath(INTENT_ROOT);
  if (!isInside(path, actualIntentRoot) || !path.endsWith(".intent.json")) {
    throw new Error(`Composition intent must be a *.intent.json file inside ${actualIntentRoot}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not parse composition intent ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    path,
    projectRelativePath: relative(PROJECT_ROOT, path).split(sep).join("/"),
    brief: CompositionBriefSchema.parse(raw),
  };
}

function replaceExactlyOnce(source: string, token: string, value: string): string {
  const first = source.indexOf(token);
  if (first < 0 || source.indexOf(token, first + token.length) >= 0) {
    throw new Error(`Canonical composition prompt must contain ${token} exactly once`);
  }
  return source.replace(token, () => value);
}

export async function renderCompositionAgentPrompt(intentFile: string): Promise<{
  prompt: string;
  promptPath: string;
  intentPath: string;
  brief: CompositionBrief;
}> {
  const [{ brief, projectRelativePath }, promptPath] = await Promise.all([
    loadCompositionBrief(intentFile),
    resolveReadablePath(PROMPT_PATH),
  ]);
  let prompt = await readFile(promptPath, "utf8");
  prompt = replaceExactlyOnce(prompt, INTENT_TOKEN, projectRelativePath);
  prompt = replaceExactlyOnce(prompt, BRIEF_TOKEN, JSON.stringify(brief, null, 2));
  return { prompt, promptPath, intentPath: projectRelativePath, brief };
}
