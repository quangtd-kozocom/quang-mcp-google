#!/usr/bin/env node
import { runLoginFlow } from "./auth.js";
import { TOKEN_PATH } from "./constants.js";
import { startServer } from "./index.js";
import { parseSetupArgs, runSetup } from "./setup.js";

function printHelp(): void {
  console.error(`Usage:
  kozocom-mcp              Start the MCP server over stdio
  kozocom-mcp start        Start the MCP server over stdio
  kozocom-mcp login        Sign in to Google and cache the OAuth token
  kozocom-mcp setup        Check setup, optionally sign in, and print MCP config

Setup options:
  --client codex|claude|copilot|all
  --login / --no-login
  --yes, -y`);
}

async function login(): Promise<void> {
  console.error("Starting Google sign-in... a browser window will open.\n");
  const result = await runLoginFlow({
    openBrowser: true,
    onUrl: (url) => {
      console.error(`If the browser didn't open, visit:\n${url}\n`);
    },
  });
  console.error(`\nSigned in${result.email ? ` as ${result.email}` : ""}.`);
  console.error(`Token saved to ${TOKEN_PATH}`);
  console.error(`Granted scopes: ${result.scopes.join(", ")}`);
}

async function main(): Promise<void> {
  const [command = "start", ...args] = process.argv.slice(2);
  switch (command) {
    case "start":
    case "server":
      await startServer();
      break;
    case "login":
      await login();
      break;
    case "setup":
      await runSetup(parseSetupArgs(args));
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      throw new Error(`Unknown command "${command}". Run kozocom-mcp --help.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
