#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { registerGoogleTools } from "./tools/google.js";

const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
});

registerGoogleTools(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so it doesn't corrupt the stdio JSON-RPC stream.
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}

main().catch((error) => {
  console.error("Fatal error starting kozocom-google MCP server:", error);
  process.exit(1);
});
