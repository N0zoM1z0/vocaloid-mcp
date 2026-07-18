import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";


const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("stdio MCP lists and executes the core VSQX workflow", async (context) => {
  const temporary = await mkdtemp(join(ROOT, ".test-mcp-"));
  context.after(async () => rm(temporary, { recursive: true, force: true }));
  const outputPath = join(temporary, "mcp-created.vsqx");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, "dist/src/index.js")],
    stderr: "pipe",
  });
  const client = new Client({ name: "vocaloid-mcp-smoke", version: "0.1.0" });
  context.after(async () => client.close());
  await client.connect(transport);

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    [
      "vocaloid_add_control_points",
      "vocaloid_add_notes",
      "vocaloid_create_project",
      "vocaloid_inspect_project",
      "vocaloid_list_control_points",
      "vocaloid_list_notes",
      "vocaloid_list_voices",
      "vocaloid_render_wav",
      "vocaloid_update_note_expressions",
      "vocaloid_validate_project",
    ],
  );

  const created = await client.callTool({
    name: "vocaloid_create_project",
    arguments: {
      output_path: outputPath,
      format: "vsq4",
      voice: { name: "IA", component_id: "BLRGDDR4M3WM2LC6" },
      sequence_name: "MCP Protocol Smoke",
      notes: [
        {
          tick: 0,
          duration: 480,
          note_number: 60,
          lyric: "ら",
          phonemes: "a",
          vibrato: {
            type: 13,
            length: 50,
            depth: [{ position: 32768, value: 55 }],
            rate: [{ position: 32768, value: 52 }],
          },
        },
        { tick: 480, duration: 480, note_number: 62, lyric: "ら", phonemes: "a" },
      ],
      control_curves: [
        { curve: "DYN", points: [{ tick: 0, value: 64 }, { tick: 480, value: 72 }] },
      ],
      response_format: "json",
    },
  });
  assert.notEqual(created.isError, true);
  assert.equal((created.structuredContent as { ok?: boolean } | undefined)?.ok, true);

  const validation = await client.callTool({
    name: "vocaloid_validate_project",
    arguments: { path: outputPath, response_format: "json" },
  });
  assert.notEqual(validation.isError, true);
  const validationData = validation.structuredContent as {
    data?: { valid?: boolean; format?: string };
  };
  assert.equal(validationData.data?.valid, true);
  assert.equal(validationData.data?.format, "vsq4");

  const notes = await client.callTool({
    name: "vocaloid_list_notes",
    arguments: { path: outputPath, limit: 1, response_format: "json" },
  });
  assert.notEqual(notes.isError, true);
  const noteData = notes.structuredContent as {
    data?: { page?: { total?: number; count?: number; has_more?: boolean } };
  };
  assert.equal(noteData.data?.page?.total, 2);
  assert.equal(noteData.data?.page?.count, 1);
  assert.equal(noteData.data?.page?.has_more, true);

  const tunedPath = join(temporary, "mcp-tuned.vsqx");
  const tuned = await client.callTool({
    name: "vocaloid_update_note_expressions",
    arguments: {
      input_path: outputPath,
      output_path: tunedPath,
      updates: [
        {
          note_index: 1,
          velocity: 55,
          expression: {
            accent: 70,
            decay: 45,
            bend_depth: 15,
            bend_length: 20,
            rise_portamento: true,
          },
          vibrato: { type: 1, length: 60 },
        },
      ],
      response_format: "json",
    },
  });
  assert.notEqual(tuned.isError, true);
  assert.equal((tuned.structuredContent as { ok?: boolean } | undefined)?.ok, true);

  const refusedRender = await client.callTool({
    name: "vocaloid_render_wav",
    arguments: {
      input_path: join(temporary, "missing.vsqx"),
      output_path: join(temporary, "must-not-exist.wav"),
      response_format: "json",
    },
  });
  assert.equal(refusedRender.isError, true);
});
