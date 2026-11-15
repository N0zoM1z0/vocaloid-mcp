import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { inspectEditorLease } from "../../editor-lease.js";
import { probeVoice, readVoiceReadiness } from "../../voice-readiness.js";
import {
  ResponseFormatSchema,
  workflowError,
  workflowOutputSchema,
  workflowResult,
} from "../results.js";
import { HostReadinessDataOutputSchema, VoiceProbeDataOutputSchema } from "../schemas.js";

export function registerHostTools(server: McpServer): void {
  server.registerTool(
    "vocaloid_host_readiness",
    {
      title: "Inspect VOCALOID Host Readiness",
      description: "Read the Editor/helper fingerprint, host render lease, and verified voice cache without launching VOCALOID.",
      inputSchema: z.object({
        include_expired_voice_records: z.boolean().default(false)
          .describe("Include expired historical records for diagnosis; they never count as verified"),
        allow_unknown_editor: z.boolean().default(false)
          .describe("Allow fingerprint inspection of an unknown build; this does not authorize a render"),
        response_format: ResponseFormatSchema,
      }).strict(),
      outputSchema: workflowOutputSchema(HostReadinessDataOutputSchema),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        const [readiness, editorLease] = await Promise.all([
          readVoiceReadiness(params.allow_unknown_editor, params.include_expired_voice_records),
          inspectEditorLease(),
        ]);
        return workflowResult(
          {
            editorLease,
            voiceCachePath: readiness.path,
            verifiedComponentIds: readiness.verifiedComponentIds,
            voiceRecords: readiness.records,
            host: readiness.host,
          },
          params.response_format,
          `${readiness.verifiedComponentIds.length} voice(s) verified for Editor ${readiness.host.editorVersion}`,
        );
      } catch (error) {
        return workflowError(error);
      }
    },
  );

  server.registerTool(
    "vocaloid_probe_voice",
    {
      title: "Probe Voice in Original Editor",
      description: "Verify one local voice with a bounded temporary render in the original Editor; cache the result by voice and host fingerprint.",
      inputSchema: z.object({
        component_id: z.string().length(16).describe("Exact 16-character VVD component ID"),
        force: z.boolean().default(false).describe("Ignore a non-expired matching cache entry"),
        timeout_seconds: z.number().int().min(30).max(180).default(120),
        allow_unknown_editor: z.boolean().default(false)
          .describe("Explicit opt-in for a manually verified but not yet allow-listed Editor fingerprint"),
        response_format: ResponseFormatSchema,
      }).strict(),
      outputSchema: workflowOutputSchema(VoiceProbeDataOutputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (params, extra) => {
      try {
        const progressToken = extra._meta?.progressToken;
        const result = await probeVoice({
          componentId: params.component_id,
          force: params.force,
          timeoutSeconds: params.timeout_seconds,
          allowUnknownEditor: params.allow_unknown_editor,
          runtime: {
            requestId: String(extra.requestId),
            signal: extra.signal,
            allowUnknownEditor: params.allow_unknown_editor,
            ...(progressToken !== undefined
              ? {
                  progress: async (update) => extra.sendNotification({
                    method: "notifications/progress",
                    params: {
                      progressToken,
                      progress: update.progress,
                      total: update.total,
                      message: `${update.stage}: ${update.message}`,
                    },
                  }),
                }
              : {}),
          },
        });
        const warnings = result.record.status === "verified" ? [] : [result.record.reason];
        return workflowResult(
          result,
          params.response_format,
          `${result.record.voiceName} availability is ${result.record.status}${result.cached ? " (cached)" : ""}`,
          warnings,
        );
      } catch (error) {
        return workflowError(error);
      }
    },
  );
}
