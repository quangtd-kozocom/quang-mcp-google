import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAuthStatus } from "../auth.js";
import { toolResult } from "../format.js";
import { registerAll, tool, type ToolRegistration } from "./define.js";

const authStatusTool = tool({
  name: "google_auth_status",
  title: "Check Google sign-in status",
  description: `Report whether the server has working Google credentials and for which account.

Args: none.

Returns:
  {
    "authenticated": boolean,
    "email": string|null,        // signed-in account
    "scopes": string[]|null,     // granted OAuth scopes
    "expiry_date": number|null   // access-token expiry (epoch ms); auto-refreshed when valid
  }`,
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  run: async () => {
    const status = await getAuthStatus();
    const text = status.authenticated
      ? `Authenticated${status.email ? ` as ${status.email}` : ""}.`
      : "Not authenticated. Run `kozocom-mcp auth login` in a terminal to sign in.";
    return toolResult(text, {
      authenticated: status.authenticated,
      email: status.email ?? null,
      scopes: status.scopes ?? null,
      expiry_date: status.expiryDate ?? null,
    });
  },
});

export const authTools: readonly ToolRegistration[] = [authStatusTool];

export function registerAuthTools(server: McpServer): void {
  registerAll(server, authTools);
}
