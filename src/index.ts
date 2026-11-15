#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./server/create-server.js";

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  console.error("vocaloid-mcp-server running via stdio");
}

main().catch((error: unknown) => {
  console.error("vocaloid-mcp-server failed:", error);
  process.exitCode = 1;
});
