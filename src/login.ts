#!/usr/bin/env node
/**
 * Standalone OAuth login: `pnpm login` (after build) or `pnpm login:dev`.
 * Opens the browser, captures the consent redirect, and caches the token so the
 * MCP server can use it. Run this once during setup.
 */
import { runLoginFlow } from "./auth.js";
import { TOKEN_PATH } from "./constants.js";

async function main(): Promise<void> {
  console.error("Starting Google sign-in… a browser window will open.\n");
  const result = await runLoginFlow({
    openBrowser: true,
    onUrl: (url) => {
      console.error(`If the browser didn't open, visit:\n${url}\n`);
    },
  });
  console.error(`\n✅ Signed in${result.email ? ` as ${result.email}` : ""}.`);
  console.error(`Token saved to ${TOKEN_PATH}`);
  console.error(`Granted scopes: ${result.scopes.join(", ")}`);
}

main().catch((error) => {
  console.error(`\n❌ Login failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
