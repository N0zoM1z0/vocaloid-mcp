import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";


export const REPOSITORY_ROOT = resolve(import.meta.dirname, "../..");
const SERVER_ENTRYPOINT = resolve(REPOSITORY_ROOT, "dist/src/index.js");
export const DEFAULT_MCP_TIMEOUT_MS = 900_000;

function dataOf(result, label) {
  const structured = result.structuredContent;
  if (!structured || structured.ok !== true) {
    const fallback = result.content?.find((entry) => entry.type === "text")?.text;
    const diagnostic = structured?.error?.message
      ?? structured?.warnings?.join("; ")
      ?? fallback
      ?? "unknown MCP failure";
    throw new Error(`${label} failed: ${diagnostic}`);
  }
  return structured.data;
}

export function normalizeEditExchange(action, before, previewEnvelope, appliedEnvelope) {
  if (!Number.isInteger(before?.revision)) {
    throw new Error(`Inspected manifest has no integer revision before ${action}`);
  }
  if (previewEnvelope?.kind !== "mutation_preview" || previewEnvelope.action !== action
    || !previewEnvelope.preview) {
    throw new Error(`Unexpected dry-run response for ${action}`);
  }
  if (appliedEnvelope?.kind !== "mutation_applied" || appliedEnvelope.action !== action
    || !appliedEnvelope.write) {
    throw new Error(`Unexpected applied response for ${action}`);
  }
  const preview = previewEnvelope.preview;
  const applied = appliedEnvelope.write;
  if (!Number.isInteger(preview.source?.revision)
    || !Number.isInteger(preview.predicted?.revision)
    || !Number.isInteger(preview.totalChanges)) {
    throw new Error(`Dry-run response for ${action} is missing integer revision/change fields`);
  }
  if (!Number.isInteger(applied.revision) || !Number.isInteger(appliedEnvelope.totalChanges)) {
    throw new Error(`Applied response for ${action} is missing integer revision/change fields`);
  }
  if (preview.source?.revision !== before.revision) {
    throw new Error(
      `Dry-run source revision ${String(preview.source?.revision)} does not match inspected revision ${before.revision}`,
    );
  }
  if (preview.predicted?.revision !== applied.revision) {
    throw new Error(
      `Dry-run predicted revision ${String(preview.predicted?.revision)} but apply wrote ${String(applied.revision)}`,
    );
  }
  if (preview.totalChanges !== appliedEnvelope.totalChanges) {
    throw new Error(
      `Dry-run predicted ${String(preview.totalChanges)} change(s) but apply reported ${String(appliedEnvelope.totalChanges)}`,
    );
  }
  return {
    before,
    preview,
    applied,
    evidence: appliedEnvelope.evidence ?? null,
    summary: {
      sourceRevision: before.revision,
      predictedRevision: preview.predicted.revision,
      appliedRevision: applied.revision,
      totalChanges: preview.totalChanges,
      compositionHash: applied.compositionHash,
      mixHash: applied.mixHash,
      contentHash: applied.contentHash,
    },
    raw: { preview: previewEnvelope, applied: appliedEnvelope },
  };
}

export class ProductionMcpClient {
  constructor(options = {}) {
    this.timeout = options.timeout ?? DEFAULT_MCP_TIMEOUT_MS;
    this.client = new Client({
      name: options.name ?? "vocaloid-composition-session",
      version: "1.0.0",
    });
    this.transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_ENTRYPOINT],
      cwd: REPOSITORY_ROOT,
      env: { ...process.env },
      stderr: options.stderr ?? "inherit",
    });
  }

  async connect() {
    await this.client.connect(this.transport);
    return this;
  }

  async close() {
    await this.client.close();
  }

  async resource(uri) {
    const result = await this.client.readResource({ uri });
    if (!result.contents?.[0]) throw new Error(`Missing MCP resource ${uri}`);
    return result.contents[0];
  }

  async jsonResource(uri) {
    const resource = await this.resource(uri);
    if (typeof resource.text !== "string") throw new Error(`MCP resource ${uri} is not textual JSON`);
    try {
      return JSON.parse(resource.text);
    } catch (error) {
      throw new Error(`MCP resource ${uri} contains invalid JSON`, { cause: error });
    }
  }

  async tools() {
    const result = await this.client.listTools();
    return result.tools;
  }

  async tool(name) {
    const selected = (await this.tools()).find((candidate) => candidate.name === name);
    if (!selected) throw new Error(`Production MCP does not expose tool ${name}`);
    return selected;
  }

  async call(name, arguments_, options = {}) {
    const label = options.label ?? name;
    if (!options.quiet) process.stderr.write(`→ ${label}\n`);
    const timeout = options.timeout ?? this.timeout;
    const result = await this.client.callTool(
      {
        name,
        arguments: {
          ...arguments_,
          ...(arguments_.response_format === undefined ? { response_format: "json" } : {}),
        },
      },
      undefined,
      {
        timeout,
        maxTotalTimeout: options.maxTotalTimeout ?? timeout,
        resetTimeoutOnProgress: true,
        onprogress: options.quiet ? undefined : (progress) => {
          const total = progress.total ?? 100;
          const percent = total > 0 ? Math.round((progress.progress / total) * 100) : progress.progress;
          process.stderr.write(`  ${label}: ${percent}%${progress.message ? ` — ${progress.message}` : ""}\n`);
        },
      },
    );
    return dataOf(result, label);
  }

  async inspect(manifestPath, options = {}) {
    return this.call("vocaloid_inspect_song_manifest", { path: manifestPath }, { ...options, quiet: options.quiet ?? true });
  }

  async edit(manifestPath, action, payload, options = {}) {
    await this.resource(`vocaloid://edit-song-contract/${action}`);
    const before = await this.inspect(manifestPath);
    const common = {
      input_path: manifestPath,
      output_path: manifestPath,
      expected_revision: before.revision,
      overwrite: true,
      ...payload,
    };
    const previewEnvelope = await this.call("vocaloid_edit_song", {
      action,
      payload: { ...common, dry_run: true },
    }, { ...options, label: options.previewLabel ?? `dry-run ${action}` });
    const appliedEnvelope = await this.call("vocaloid_edit_song", {
      action,
      payload: { ...common, dry_run: false },
    }, { ...options, label: options.label ?? `apply ${action}` });
    return normalizeEditExchange(action, before, previewEnvelope, appliedEnvelope);
  }

  async recordDecisionIfAbsent(manifestPath, decision, options = {}) {
    await this.resource("vocaloid://creative-journal-contract/record_if_absent");
    const manifest = await this.inspect(manifestPath);
    return this.call("vocaloid_creative_journal", {
      action: "record_if_absent",
      payload: {
        manifest_path: manifestPath,
        expected_revision: manifest.revision,
        decision,
        dry_run: false,
      },
    }, { ...options, label: options.label ?? `journal ${decision.id}` });
  }
}

export async function withProductionMcp(task, options = {}) {
  const mcp = await new ProductionMcpClient(options).connect();
  try {
    return await task(mcp);
  } finally {
    await mcp.close();
  }
}
