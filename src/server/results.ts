import { z } from "zod";

import { EditorBusyError } from "../editor-lease.js";
import { type ResponseFormat } from "../types.js";

export const ResponseFormatSchema = z
  .enum(["markdown", "json"])
  .default("markdown");
export const PathSchema = z
  .string()
  .min(1)
  .max(4096)
  .describe("Absolute or repository-relative path");
const WorkflowErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  suggested_action: z.string(),
}).strict();

export function workflowOutputSchema<T extends z.ZodType>(data: T) {
  // MCP output schemas must have an object root. The SDK intentionally ignores a
  // root discriminated union, which would make typed workflow results disappear
  // from tools/list even though runtime validation still succeeded locally.
  return z.object({
    ok: z.boolean(),
    data: data.optional(),
    error: WorkflowErrorSchema.optional(),
    warnings: z.array(z.string()),
  }).strict();
}

export function workflowResult<T>(
  data: T,
  responseFormat: ResponseFormat,
  summary: string,
  warnings: string[] = [],
) {
  const output = { ok: true as const, data, warnings };
  const text = responseFormat === "json"
    ? JSON.stringify(output, null, 2)
    : [
        `## ${summary}`,
        "",
        "```json",
        JSON.stringify(data, null, 2),
        "```",
        ...(warnings.length > 0 ? ["", `Warnings: ${warnings.join("; ")}`] : []),
      ].join("\n");
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: output,
  };
}

export function workflowError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  let code = "WORKFLOW_FAILED";
  let retryable = false;
  let suggestedAction = "Inspect the diagnostic, correct the named input or host boundary, then retry once.";
  if (error instanceof EditorBusyError) {
    code = error.code;
    retryable = true;
    suggestedAction = `Wait for request ${error.owner.requestId} to finish or cancel that request; do not launch another Editor.`;
  } else if (error instanceof Error && error.name === "AbortError") {
    code = "CANCELLED";
    suggestedAction = "No retry is required; issue a new bounded request only if the render is still wanted.";
  } else if (/stale manifest revision/iu.test(message)) {
    code = "STALE_REVISION";
    retryable = true;
    suggestedAction = "Inspect the manifest again and retry using its current revision after reconciling intervening changes.";
  } else if (/already exists/iu.test(message)) {
    code = "OUTPUT_EXISTS";
    suggestedAction = "Choose a new song/revision-bearing immutable output filename.";
  } else if (/fingerprint|version\/hash mismatch/iu.test(message)) {
    code = "UNVERIFIED_EDITOR_BUILD";
    suggestedAction = "Verify this exact Editor build/localization before explicitly opting into unknown-build automation.";
  } else if (/preflight/iu.test(message)) {
    code = "PREFLIGHT_BLOCKED";
    retryable = true;
    suggestedAction = "Call vocaloid_preflight_song, repair every error-level issue in the named scope, then retry.";
  } else if (/sha-256|digest|content hash|composition hash/iu.test(message)) {
    code = "PROVENANCE_MISMATCH";
    suggestedAction = "Do not use the changed artifact; restore it or build a new immutable artifact from the current manifest.";
  }
  const output = {
    ok: false as const,
    error: { code, message, retryable, suggested_action: suggestedAction },
    warnings: [] as string[],
  };
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error [${code}]: ${message}\nNext: ${suggestedAction}` }],
    structuredContent: output,
  };
}
