import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { authTools } from "./auth.js";
import { registerAll, type ToolRegistration } from "./define.js";
import { driveTools } from "./drive.js";
import { sheetsTools } from "./sheets.js";

/** Every Google tool exposed by this server, in registration order. */
export const googleTools: readonly ToolRegistration[] = [...authTools, ...driveTools, ...sheetsTools];

export function registerGoogleTools(server: McpServer): void {
  registerAll(server, googleTools);
}
