#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "kozocom-mcp",
  version: "0.1.0",
});

// Example tool — replace with real tools.
server.registerTool(
  "ping",
  {
    title: "Ping",
    description: "Echoes back the provided message.",
    inputSchema: {
      message: z.string().describe("Message to echo back"),
    },
  },
  async ({ message }) => ({
    content: [{ type: "text", text: `pong: ${message}` }],
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr so it doesn't corrupt the stdio JSON-RPC stream.
  console.error("kozocom-mcp server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting kozocom-mcp:", error);
  process.exit(1);
});
