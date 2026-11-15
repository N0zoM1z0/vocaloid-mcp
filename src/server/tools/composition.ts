import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  listCreativeDecisions,
  publishCreativeRecordPackage,
  recordCreativeDecision,
  recordCreativeDecisionIfAbsent,
  writeCreativeJournalReport,
} from "../../creative-journal.js";
import { alignJapanesePhrase, JapanesePhraseAlignmentInputSchema } from "../../japanese.js";
import { analyzeManifestPhraseGrammar } from "../../phrase-grammar-analysis.js";
import { listPhraseGrammar, validatePhraseGrammarBlueprint } from "../../phrase-grammar.js";
import { loadSongManifest } from "../../song-manifest.js";
import {
  ResponseFormatSchema,
  workflowError,
  workflowOutputSchema,
  workflowResult,
} from "../results.js";
import {
  CreativeJournalActionRequestSchema,
  CreativeJournalDataOutputSchema,
  CreativeJournalInputSchema,
  JapaneseAlignmentDataOutputSchema,
  PhraseGrammarDataOutputSchema,
  PhraseGrammarInputSchema,
  PhraseGrammarToolInputSchema,
} from "../schemas.js";

export function registerCompositionTools(server: McpServer): void {
  server.registerTool(
    "vocaloid_phrase_grammar",
    {
      title: "Browse, Validate, or Analyze Vocal Phrase Grammar",
      description: "Browse phrase choices, validate a blueprint, or analyze diversity; never generates melody.",
      inputSchema: PhraseGrammarToolInputSchema,
      outputSchema: workflowOutputSchema(PhraseGrammarDataOutputSchema),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (envelope) => {
      try {
        const params = PhraseGrammarInputSchema.parse({
          ...envelope.payload,
          action: envelope.action,
          response_format: envelope.response_format,
        });
        if (params.action === "catalog") {
          const catalog = listPhraseGrammar({
            ...(params.category ? { category: params.category } : {}),
            ...(params.bundle_id ? { bundleId: params.bundle_id } : {}),
            ...(params.query ? { query: params.query } : {}),
            offset: params.offset,
            limit: params.limit,
          });
          return workflowResult(
            { action: "catalog" as const, ...catalog },
            params.response_format,
            `Returned ${catalog.count}/${catalog.total} phrase-grammar component(s)`,
          );
        }
        if (params.action === "validate_blueprint") {
          const validation = validatePhraseGrammarBlueprint(params.blueprint);
          return workflowResult(
            { action: "validate_blueprint" as const, ...validation },
            params.response_format,
            `Validated phrase-grammar blueprint ${validation.blueprint.id}`,
          );
        }
        const loaded = await loadSongManifest(params.manifest_path);
        const report = analyzeManifestPhraseGrammar(loaded.manifest, {
          ...(params.track_id ? { trackId: params.track_id } : {}),
          maximumPairExamples: params.maximum_pair_examples,
        });
        return workflowResult(
          { action: "analyze_manifest" as const, path: loaded.path, revision: loaded.manifest.revision, ...report },
          params.response_format,
          `Analyzed ${report.summary.phrases} vocal phrase(s); ${report.summary.warnings} phrase-grammar warning(s)`,
        );
      } catch (error) {
        return workflowError(error);
      }
    },
  );

  server.registerTool(
    "vocaloid_align_japanese_phrase",
    {
      title: "Align Japanese Morae to Vocal Rhythm",
      description: "Align Japanese morae to stable rhythm slots as a manifest-compatible phrase, with explicit melisma and small-っ timing decisions.",
      inputSchema: JapanesePhraseAlignmentInputSchema.extend({ response_format: ResponseFormatSchema }).strict(),
      outputSchema: workflowOutputSchema(JapaneseAlignmentDataOutputSchema),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const { response_format, ...input } = params;
        const result = alignJapanesePhrase(input);
        return workflowResult(
          result,
          response_format,
          `Aligned ${result.alignment.lyric_units} morae to ${result.alignment.voiced_slots} voiced slots`,
          result.warnings,
        );
      } catch (error) {
        return workflowError(error);
      }
    },
  );

  server.registerTool(
    "vocaloid_creative_journal",
    {
      title: "Creative Decision Journal",
      description: "Append/resume, query, report, or publish decisions.",
      inputSchema: CreativeJournalInputSchema,
      outputSchema: workflowOutputSchema(CreativeJournalDataOutputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (envelope) => {
      try {
        const params = CreativeJournalActionRequestSchema.parse({
          ...envelope.payload,
          action: envelope.action,
          response_format: envelope.response_format,
        });
        if (params.action === "record") {
          const result = await recordCreativeDecision({
            manifestPath: params.manifest_path,
            expectedRevision: params.expected_revision,
            decision: params.decision,
            dryRun: params.dry_run,
          });
          return workflowResult(
            result,
            params.response_format,
            `${params.dry_run ? "Validated" : "Recorded"} creative decision ${result.entry.id}`,
          );
        }
        if (params.action === "record_if_absent") {
          const result = await recordCreativeDecisionIfAbsent({
            manifestPath: params.manifest_path,
            expectedRevision: params.expected_revision,
            decision: params.decision,
            dryRun: params.dry_run,
          });
          return workflowResult(
            result,
            params.response_format,
            result.alreadyExisted
              ? `Verified existing creative decision ${result.entry.id}`
              : `${params.dry_run ? "Validated" : "Recorded"} creative decision ${result.entry.id}`,
          );
        }
        if (params.action === "list") {
          const result = await listCreativeDecisions({
            manifestPath: params.manifest_path,
            ...(params.phases ? { phases: params.phases } : {}),
            ...(params.currentness ? { currentness: params.currentness } : {}),
            offset: params.offset,
            limit: params.limit,
          });
          return workflowResult(
            result,
            params.response_format,
            `Read ${result.count} of ${result.total} creative decisions`,
          );
        }
        if (params.action === "report") {
          const result = await writeCreativeJournalReport({
            manifestPath: params.manifest_path,
            ...(params.output_path ? { outputPath: params.output_path } : {}),
            overwrite: params.overwrite,
          });
          return workflowResult(
            result,
            params.response_format,
            `Wrote ${result.entryCount}-decision creative report`,
          );
        }
        const result = await publishCreativeRecordPackage({
          manifestPath: params.manifest_path,
          expectedRevision: params.expected_revision,
          outputDirectory: params.output_directory,
          deliverables: params.deliverables,
          overwrite: params.overwrite,
        });
        return workflowResult(
          result,
          params.response_format,
          `Published complete ${result.entryCount}-decision creative record package`,
        );
      } catch (error) {
        return workflowError(error);
      }
    },
  );
}
