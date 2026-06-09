#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SAFE_MODE, SERVER_NAME, SERVER_VERSION } from "./config/constants.js";
import { registerGoogleTools } from "./services/registry.js";

export async function startServer(): Promise<void> {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  registerGoogleTools(server, { safeMode: SAFE_MODE });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so it doesn't corrupt the stdio JSON-RPC stream.
  console.error(
    `${SERVER_NAME} v${SERVER_VERSION} running on stdio${SAFE_MODE ? " (safe mode: dangerous tools disabled)" : ""}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer().catch((error) => {
    console.error("Fatal error starting kozocom-google MCP server:", error);
    process.exit(1);
  });
}
