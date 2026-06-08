import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { clearToken, getAuthStatus, runLoginFlow } from "../auth.js";
import { errorResult, handleGoogleError, toolResult } from "../format.js";
import { registerAll, tool, type ToolRegistration } from "./define.js";

const loginInput = {
  open_browser: z
    .boolean()
    .default(true)
    .describe("Open the system browser automatically (default true)"),
};

const loginTool = tool({
  name: "google_login",
  title: "Sign in to Google",
  description: `Start the Google OAuth login flow so this server can access your Drive and Sheets.

Opens your default browser to Google's consent screen. After you click "Allow", the
access + refresh token is cached locally (~/.kozocom-mcp/token.json) and reused on later
runs — you only do this once. This tool blocks until you finish in the browser (or it times out).

Args:
  - open_browser (boolean): Automatically open the browser (default: true). If false, the
    consent URL is returned for you to open manually.

Returns:
  { "authenticated": true, "email": string|null, "scopes": string[] }

Use when: a tool reports "Not authenticated", or to switch accounts (run google_logout first).`,
  inputSchema: loginInput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  run: async ({ open_browser }) => {
    let consentUrl = "";
    try {
      const result = await runLoginFlow({
        openBrowser: open_browser,
        onUrl: (url) => {
          consentUrl = url;
          console.error(`\n[kozocom-mcp] Open this URL to sign in:\n${url}\n`);
        },
      });
      return toolResult(
        `Signed in${result.email ? ` as ${result.email}` : ""}. Granted scopes: ${result.scopes.join(", ")}`,
        { authenticated: true, email: result.email ?? null, scopes: result.scopes },
      );
    } catch (error) {
      const base = handleGoogleError(error);
      return errorResult(consentUrl ? `${base}\n\nOpen this URL manually to sign in: ${consentUrl}` : base);
    }
  },
});

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
      : "Not authenticated. Run the google_login tool to sign in.";
    return toolResult(text, {
      authenticated: status.authenticated,
      email: status.email ?? null,
      scopes: status.scopes ?? null,
      expiry_date: status.expiryDate ?? null,
    });
  },
});

const logoutTool = tool({
  name: "google_logout",
  title: "Sign out of Google",
  description: `Delete the cached Google token. The next Drive/Sheets call will require google_login again.

Args: none.

Returns: { "logged_out": boolean }  // false if no token was cached`,
  inputSchema: {},
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  run: async () => {
    const removed = await clearToken();
    return toolResult(
      removed ? "Signed out — cached token deleted." : "No cached token to remove.",
      { logged_out: removed },
    );
  },
});

export const authTools: readonly ToolRegistration[] = [loginTool, authStatusTool, logoutTool];

export function registerAuthTools(server: McpServer): void {
  registerAll(server, authTools);
}
