import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

import { FROM_ZERO_AGENT_EXAMPLE } from "../agent-examples.js";
import { renderCompositionAgentPrompt } from "../composition-brief.js";
import { PROJECT_ROOT, resolveReadablePath } from "../paths.js";
import { PHRASE_GRAMMAR_BUNDLES, phraseGrammarIndex } from "../phrase-grammar.js";
import { getStylePalette, STYLE_PALETTES, stylePaletteSummaries } from "../style-palettes.js";
import {
  CREATIVE_JOURNAL_ACTION_NAMES,
  CreativeJournalActionRequestSchema,
  EDIT_SONG_ACTION_NAMES,
  EditMutationActionSchema,
  EditSongActionRequestSchema,
  PHRASE_GRAMMAR_ACTION_NAMES,
  PhraseGrammarInputSchema,
} from "./schemas.js";

export function registerResources(server: McpServer): void {
  server.registerPrompt(
    "vocaloid_compose_from_intent",
    {
      title: "Compose a complete VOCALOID song from one intent file",
      description: "Loads the stable composition-agent workflow plus one validated, repo-local intents/*.intent.json brief.",
      argsSchema: {
        intent_file: z.string().min(1).max(4096).describe("Path to one *.intent.json file inside the repository intents directory"),
      },
    },
    async ({ intent_file }) => {
      const rendered = await renderCompositionAgentPrompt(intent_file);
      return {
        description: `Fresh composition task ${rendered.brief.run_id}`,
        messages: [{ role: "user", content: { type: "text", text: rendered.prompt } }],
      };
    },
  );

  server.registerResource(
    "vocaloid-style-palette-index",
    "vocaloid://styles",
    {
      title: "VOCALOID Production Style Palettes",
      description: "Compact index of agent-facing composition, IA_ROCKS performance, arrangement, groove, mix, and renderer-boundary guidance.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(stylePaletteSummaries(), null, 2) }],
    }),
  );

  for (const palette of STYLE_PALETTES) {
    server.registerResource(
      `vocaloid-style-${palette.id}`,
      palette.uri,
      {
        title: palette.title,
        description: palette.description,
        mimeType: "application/json",
      },
      async (uri) => ({
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(getStylePalette(palette.id), null, 2),
        }],
      }),
    );
  }

  server.registerResource(
    "vocaloid-phrase-grammar",
    "vocaloid://phrase-grammar",
    {
      title: "Deterministic vocal phrase grammar DSL",
      description: "Versioned role, entry, contour, rhythm, motion, cadence, development, allocation, articulation, space, and IA/genre bundle vocabulary for agent-selected phrase plans.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(phraseGrammarIndex(), null, 2) }],
    }),
  );

  server.registerResource(
    "vocaloid-phrase-grammar-bundle",
    new ResourceTemplate("vocaloid://phrase-grammar/bundle/{id}", {
      list: undefined,
      complete: { id: () => PHRASE_GRAMMAR_BUNDLES.map((bundle) => bundle.id) },
    }),
    {
      title: "One vocal phrase grammar bundle",
      description: "A bounded IA/genre/delivery component palette. Bundles offer choices and variation axes; they do not generate notes.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const requested = variables.id;
      const id = Array.isArray(requested) ? requested[0] : requested;
      const bundle = PHRASE_GRAMMAR_BUNDLES.find((candidate) => candidate.id === id);
      if (!bundle) throw new Error(`Unknown phrase-grammar bundle ${String(id)}`);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(bundle, null, 2) }] };
    },
  );

  server.registerResource(
    "vocaloid-composition-intent-contract",
    "vocaloid://composition-intent-contract",
    {
      title: "Composition intent and anchor-listening contract",
      description: "Intent hierarchy, hash/review binding, symbolic evidence limits, and the 20–30 second anchor-passage discipline.",
      mimeType: "text/markdown; charset=utf-8",
    },
    async (uri) => {
      const path = await resolveReadablePath("notes/composition-intent-contract.md");
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown; charset=utf-8", text: await readFile(path, "utf8") }],
      };
    },
  );

  server.registerResource(
    "vocaloid-music-theory-policy",
    "vocaloid://music-theory-policy",
    {
      title: "Core music-theory policy",
      description: "Deterministic symbolic evidence, severity, exception, anti-copy, and corpus/style boundaries.",
      mimeType: "text/markdown; charset=utf-8",
    },
    async (uri) => {
      const path = await resolveReadablePath("notes/music-theory-policy.md");
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown; charset=utf-8", text: await readFile(path, "utf8") }],
      };
    },
  );

  server.registerResource(
    "vocaloid-edit-song-contract",
    "vocaloid://edit-song-contract",
    {
      title: "Strict vocaloid_edit_song action contract",
      description: "On-demand action-specific JSON Schema for the compact production mutation envelope.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({
          schema: "vocaloid-edit-song-contract/v1",
          invocation: {
            action: "Select one action from the schema discriminator",
            payload: "Place every action-specific field except action/response_format here",
            response_format: "markdown or json",
          },
          actions: ["expand_tempo_curve", ...EditMutationActionSchema.options].map((action) => ({
            action,
            schema_uri: `vocaloid://edit-song-contract/${action}`,
          })),
        }, null, 2),
      }],
    }),
  );

  server.registerResource(
    "vocaloid-creative-journal-contract",
    "vocaloid://creative-journal-contract",
    {
      title: "Strict creative decision journal action contract",
      description: "On-demand action-specific JSON Schema for recording, reading, reporting, and publishing creative decisions.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({
          schema: "vocaloid-creative-journal-contract/v1",
          invocation: {
            action: "Select one action from the schema discriminator",
            payload: "Place every action-specific field except action/response_format here",
            response_format: "markdown or json",
          },
          actions: CREATIVE_JOURNAL_ACTION_NAMES.map((action) => ({
            action,
            schema_uri: `vocaloid://creative-journal-contract/${action}`,
          })),
        }, null, 2),
      }],
    }),
  );

  server.registerResource(
    "vocaloid-creative-decision-journal",
    "vocaloid://creative-decision-journal",
    {
      title: "Creative decision journal policy",
      description: "The auditable intent → theory → note allocation → IA delivery → arrangement record, freshness, and publication policy.",
      mimeType: "text/markdown; charset=utf-8",
    },
    async (uri) => {
      const path = await resolveReadablePath("notes/creative-decision-journal.md");
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown; charset=utf-8", text: await readFile(path, "utf8") }],
      };
    },
  );

  const optionalHanairoLyricsPath = "artifacts/evals/[Lyrics] Hanairo Biyori.txt";
  if (existsSync(resolve(PROJECT_ROOT, optionalHanairoLyricsPath))) {
    server.registerResource(
      "hanairo-biyori-lyrics",
      "vocaloid://lyrics/hanairo-biyori",
      {
        title: "花色日和 — authoritative supplied lyrics",
        description: "Optional user-supplied lyric authority for the local wa-rock-hanairo evaluation; preserve verbatim and add readings/phonemes as separate provenance.",
        mimeType: "text/plain; charset=utf-8",
      },
      async (uri) => {
        const path = await resolveReadablePath(optionalHanairoLyricsPath);
        return {
          contents: [{ uri: uri.href, mimeType: "text/plain; charset=utf-8", text: await readFile(path, "utf8") }],
        };
      },
    );
  }

  server.registerResource(
    "vocaloid-capabilities",
    "vocaloid://capabilities",
    {
      title: "VOCALOID MCP capability map",
      description: "The production workflow, contracts, renderer boundaries, and agent usage contract.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({
          canonical_workflow: [
            "Read the composition-intent contract, core theory policy, phrase-grammar DSL, and any authoritative lyric resource",
            "Check host readiness and cached IA_ROCKS availability",
            "Create or import a canonical manifest",
            "Declare song/section intent plus 1-3 anchor phrase purposes, semantic focuses, transitions, delivery arcs, and single listening questions",
            "Append a concise hash-bound journal decision after intent, each theory stage, note allocation, IA delivery, and arrangement",
            "Select and validate phrase-grammar components for each phrase role, then establish lead melody and Japanese note allocation without runtime corpus access",
            "Align explicit Japanese readings; preserve original lyric provenance",
            "Use vocaloid_edit_song dry_run=true, then apply with the returned current revision",
            "Run vocaloid_preflight_song; when repair hypotheses are useful, request 3-8 theory-only proposals and hold each group's listening question constant",
            "Run vocaloid_phrase_grammar analyze_manifest and disposition phrase entry/motion/contour/rhythm concentration before delivery",
            "Set composition guidance when release must require exact theory-warning disposition and/or current anchor intent review",
            "Evaluate a selected proposal through vocaloid_edit_song dry_run and inspect actual theory/intent deltas before a separate write",
            "Repeat preflight until the requested readiness gate passes",
            "Build VSQX/backing and render either stems or a manifest master",
            "Render a 20-30 second lead_solo, lead_harmony, and minimal_band anchor ladder",
            "Run one-question loudness-matched A/B and attach an explicit digest-bound keep/reject/revise review",
            "Master only after the separate releasePolicy is ready; when transparency risk is reported, compare premaster and delivery at equal loudness before publishing",
            "Publish the complete journal/report/manifest package bound to the final song and VSQX artifacts",
          ],
          examples: ["vocaloid://examples/from-zero"],
          contracts: {
            edit_song: "vocaloid://edit-song-contract",
            composition_intent: "vocaloid://composition-intent-contract",
            music_theory: "vocaloid://music-theory-policy",
            phrase_grammar: "vocaloid://phrase-grammar",
            creative_journal: "vocaloid://creative-journal-contract",
          },
          agent_contract: {
            canonical_source: "*.song.json manifest",
            concurrency: "optimistic expected_revision plus a host-wide VOCALOID Editor render lease",
            mutation: "read the edit contract, send one bounded action payload, and dry-run for predicted theory/intent deltas before writing",
            provenance: "composition_hash, mix_hash, file SHA-256, dependency hashes, Editor/helper fingerprints",
            lyrics: "original surface text, explicit kana reading, alignment, and V3 phonemes remain distinct evidence",
            creative_judgement: "symbolic/audio metrics locate evidence; only an explicit listening author records keep/reject/revise",
            creative_record: "append-only hash chain with stable-object/artifact/hash bindings; stale decisions remain visible and final packages require complete current core coverage",
            proposals: "read-only revision/hash-bound A/B/C hypotheses; no corpus/profile access, no direct write, mandatory edit dry-run and listening check",
            release_policy: "optional/backward-compatible; required warnings need exact current exceptions, required intent review blocks only final delivery",
            phrase_grammar: "unordered style/genre option vocabulary with melody_material=absent; the agent composes final notes from intent/prosody/harmony/form and optional blueprints are analyzed without generating notes",
            library_boundary: "production agents cannot query the local song library; offline analysis may only curate human-reviewed, non-reconstructive DSL components",
          },
          renderer_boundaries: {
            vocal: "Original VOCALOID3 Editor with a verified IA_ROCKS voice probe",
            accompaniment: "FluidSynth plus GeneralUser/FluidR3-style GM SoundFont is a composition draft renderer",
            authentic_instruments: "Use external sampled/VST or recorded renderers for idiomatic shamisen, koto, shakuhachi, guitar, and orchestral articulation",
          },
        }, null, 2),
      }],
    }),
  );

  server.registerResource(
    "vocaloid-example-from-zero",
    "vocaloid://examples/from-zero",
    {
      title: "From-zero call example",
      description: "Exact minimal payload shapes for Japanese alignment, previewed IA_ROCKS vocal insertion, arrangement insertion, and preflight.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(FROM_ZERO_AGENT_EXAMPLE, null, 2),
      }],
    }),
  );

  server.registerResource(
    "vocaloid-phrase-grammar-action-contract",
    new ResourceTemplate("vocaloid://phrase-grammar-contract/{action}", {
      list: undefined,
      complete: { action: () => [...PHRASE_GRAMMAR_ACTION_NAMES] },
    }),
    {
      title: "One vocaloid_phrase_grammar action payload schema",
      description: "Strict on-demand JSON Schema for one phrase-grammar action.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const requested = variables.action;
      const action = Array.isArray(requested) ? requested[0] : requested;
      if (!action || !PHRASE_GRAMMAR_ACTION_NAMES.includes(action as (typeof PHRASE_GRAMMAR_ACTION_NAMES)[number])) {
        throw new Error(`Unknown vocaloid_phrase_grammar contract action ${String(action)}`);
      }
      const option = PhraseGrammarInputSchema.options.find(
        (candidate) => candidate.shape.action.value === action,
      );
      if (!option) throw new Error(`Missing vocaloid_phrase_grammar contract for ${action}`);
      const payloadSchema = structuredClone(z.toJSONSchema(option, { target: "draft-7", io: "input" })) as {
        properties?: Record<string, unknown>;
        required?: string[];
        [key: string]: unknown;
      };
      if (payloadSchema.properties) {
        delete payloadSchema.properties.action;
        delete payloadSchema.properties.response_format;
      }
      if (payloadSchema.required) {
        payloadSchema.required = payloadSchema.required.filter(
          (field) => field !== "action" && field !== "response_format",
        );
      }
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(payloadSchema, null, 2),
        }],
      };
    },
  );

  server.registerResource(
    "vocaloid-creative-journal-action-contract",
    new ResourceTemplate("vocaloid://creative-journal-contract/{action}", {
      list: undefined,
      complete: { action: () => [...CREATIVE_JOURNAL_ACTION_NAMES] },
    }),
    {
      title: "One vocaloid_creative_journal action payload schema",
      description: "Strict on-demand JSON Schema for one compact journal payload.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const requested = variables.action;
      const action = Array.isArray(requested) ? requested[0] : requested;
      if (!action || !CREATIVE_JOURNAL_ACTION_NAMES.includes(
        action as (typeof CREATIVE_JOURNAL_ACTION_NAMES)[number],
      )) {
        throw new Error(`Unknown vocaloid_creative_journal contract action ${String(action)}`);
      }
      const option = CreativeJournalActionRequestSchema.options.find(
        (candidate) => candidate.shape.action.value === action,
      );
      if (!option) throw new Error(`Missing vocaloid_creative_journal contract for ${action}`);
      const payloadSchema = structuredClone(z.toJSONSchema(option, { target: "draft-7", io: "input" })) as {
        properties?: Record<string, unknown>;
        required?: string[];
        [key: string]: unknown;
      };
      if (payloadSchema.properties) {
        delete payloadSchema.properties.action;
        delete payloadSchema.properties.response_format;
      }
      if (payloadSchema.required) {
        payloadSchema.required = payloadSchema.required.filter(
          (field) => field !== "action" && field !== "response_format",
        );
      }
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(payloadSchema, null, 2) }],
      };
    },
  );

  server.registerResource(
    "vocaloid-edit-song-action-contract",
    new ResourceTemplate("vocaloid://edit-song-contract/{action}", {
      list: undefined,
      complete: { action: () => [...EDIT_SONG_ACTION_NAMES] },
    }),
    {
      title: "One vocaloid_edit_song action payload schema",
      description: "Strict on-demand JSON Schema for one compact mutation payload.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const requested = variables.action;
      const action = Array.isArray(requested) ? requested[0] : requested;
      if (!action || !EDIT_SONG_ACTION_NAMES.includes(action as (typeof EDIT_SONG_ACTION_NAMES)[number])) {
        throw new Error(`Unknown vocaloid_edit_song contract action ${String(action)}`);
      }
      const option = EditSongActionRequestSchema.options.find(
        (candidate) => candidate.shape.action.value === action,
      );
      if (!option) throw new Error(`Missing vocaloid_edit_song contract for ${action}`);
      const payloadSchema = structuredClone(z.toJSONSchema(option, { target: "draft-7", io: "input" })) as {
        properties?: Record<string, unknown>;
        required?: string[];
        [key: string]: unknown;
      };
      if (payloadSchema.properties) {
        delete payloadSchema.properties.action;
        delete payloadSchema.properties.response_format;
      }
      if (payloadSchema.required) {
        payloadSchema.required = payloadSchema.required.filter(
          (field) => field !== "action" && field !== "response_format",
        );
      }
      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({
            schema: "vocaloid-edit-song-action/v1",
            action,
            invocation: { action, payload: "Validate against payloadSchema", response_format: "markdown or json" },
            payloadSchema,
          }, null, 2),
        }],
      };
    },
  );
}
