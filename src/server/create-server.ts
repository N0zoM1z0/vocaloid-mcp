import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { registerResources } from "./resources.js";
import { registerCompositionTools } from "./tools/composition.js";
import { registerHostTools } from "./tools/host.js";
import { registerManifestTools } from "./tools/manifest.js";
import { registerRenderTools } from "./tools/render.js";
import { registerReviewTools } from "./tools/review.js";

export const SERVER_NAME = "vocaloid-mcp-server";
export const SERVER_VERSION = "1.1.0";

/** Build the VOCALOID MCP server with every resource, prompt, and tool registered. */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerResources(server);
  registerHostTools(server);
  registerCompositionTools(server);
  registerManifestTools(server);
  registerRenderTools(server);
  registerReviewTools(server);
  return server;
}
