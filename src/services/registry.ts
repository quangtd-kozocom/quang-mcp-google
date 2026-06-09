import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { authTools } from "./auth/tools.js";
import { isReadOnlyTool, registerAll, type ToolRegistration } from "../core/tool.js";
import { driveTools } from "./drive/tools.js";
import { sheetsTools } from "./sheets/tools.js";

/** Every Google tool exposed by this server, in registration order. */
export const googleTools: readonly ToolRegistration[] = [...authTools, ...driveTools, ...sheetsTools];

/**
 * The tools exposed for a given safety level. In safe mode only the read-only
 * tools are kept; every mutating tool (create/write/delete, login/logout) is
 * dropped so a client can browse but never change anything. See
 * {@link isReadOnlyTool}.
 */
export function selectGoogleTools(safeMode: boolean): readonly ToolRegistration[] {
  return safeMode ? googleTools.filter(isReadOnlyTool) : googleTools;
}

/** Read-only tool names — the only ones enabled in safe mode (registration order). */
export const READ_ONLY_TOOL_NAMES: readonly string[] = googleTools
  .filter(isReadOnlyTool)
  .map((t) => t.toolName);

/** Mutating ("dangerous") tool names — disabled in safe mode (registration order). */
export const DANGEROUS_TOOL_NAMES: readonly string[] = googleTools
  .filter((t) => !isReadOnlyTool(t))
  .map((t) => t.toolName);

export function registerGoogleTools(server: McpServer, options: { safeMode?: boolean } = {}): void {
  registerAll(server, selectGoogleTools(options.safeMode ?? false));
}
