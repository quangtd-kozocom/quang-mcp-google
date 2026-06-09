#!/usr/bin/env node
import { Command, Option } from "commander";
import { clearToken, getAuthStatus, runLoginFlow } from "./google/auth.js";
import { SERVER_VERSION, TOKEN_PATH } from "./config/constants.js";
import { startServer } from "./index.js";
import { type ClientName, configReport, parseClient, runSetup } from "./setup/setup.js";

const CLIENT_CHOICES = ["codex", "claude", "copilot", "kiro", "all"] as const;

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

async function logout(): Promise<void> {
  const removed = await clearToken();
  console.error(removed ? `Signed out — cached token deleted (${TOKEN_PATH}).` : "No cached token to remove.");
}

async function status(): Promise<void> {
  const result = await getAuthStatus();
  if (!result.authenticated) {
    console.error("Not signed in. Run `quang-mcp auth login` to sign in.");
    return;
  }
  console.error(`Signed in${result.email ? ` as ${result.email}` : ""}.`);
  if (result.scopes?.length) console.error(`Granted scopes: ${result.scopes.join(", ")}`);
  if (result.expiryDate) console.error(`Access token expires: ${new Date(result.expiryDate).toISOString()}`);
}

function buildProgram(): Command {
  const program = new Command();

  program
    .name("quang-mcp")
    .description("Kozocom Google Drive & Sheets MCP server")
    .version(SERVER_VERSION);

  // Default action (`quang-mcp` with no subcommand) starts the server.
  program
    .command("start", { isDefault: true })
    .alias("server")
    .description("Start the MCP server over stdio")
    .action(async () => {
      await startServer();
    });

  // `auth` group: manage the cached Google OAuth credentials.
  const auth = program.command("auth").description("Manage Google sign-in (login / logout / status)");
  auth
    .command("login")
    .description("Sign in to Google and cache the OAuth token")
    .action(async () => {
      await login();
    });
  auth
    .command("logout")
    .description("Delete the cached Google OAuth token")
    .action(async () => {
      await logout();
    });
  auth
    .command("status")
    .description("Show the signed-in account, scopes, and token expiry")
    .action(async () => {
      await status();
    });

  program
    .command("setup")
    .description("Check setup and print MCP config (sign in with `auth login`)")
    .addOption(
      new Option("-c, --client <client>", "MCP client to configure").choices(CLIENT_CHOICES),
    )
    .option("-y, --yes", "Accept defaults without prompting")
    .action(async (opts: { client?: ClientName; yes?: boolean }) => {
      await runSetup({ client: opts.client, yes: opts.yes });
    });

  program
    .command("client [agent]")
    .description("Print MCP config for a coding agent with dangerous tools disabled")
    .option("--include-dangerous", "Keep destructive tools enabled (not recommended)", false)
    .action((agent: string | undefined, opts: { includeDangerous: boolean }) => {
      const client = parseClient(agent) ?? "all";
      console.log(configReport({ client, safeMode: !opts.includeDangerous }));
    });

  return program;
}

buildProgram()
  .parseAsync(process.argv)
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
