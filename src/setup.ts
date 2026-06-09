import { access, mkdir, readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stderr as output } from "node:process";
import { CLIENT_SECRET_PATH, CONFIG_DIR } from "./constants.js";
import { getAuthStatus } from "./auth.js";
import { EMBEDDED_OAUTH_CLIENT } from "./generated/oauth-client.js";
import { DANGEROUS_TOOL_NAMES, READ_ONLY_TOOL_NAMES } from "./tools/google.js";

const SERVER_KEY = "kozocom-google";

type ClientName = "codex" | "claude" | "copilot" | "all";

interface SetupOptions {
  client?: ClientName;
  yes?: boolean;
}

interface McpSnippetOptions {
  client: ClientName;
  command?: string;
  args?: string[];
  credentialsPath?: string | null;
  /**
   * When true, the emitted config disables the dangerous (mutating) tools using
   * each client's own mechanism, leaving only the read-only tools enabled.
   */
  safeMode?: boolean;
}

const PACKAGE_NAME = "kozocom-mcp-google";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Render a TOML string array one item per line (trailing comma — valid TOML). */
function tomlStringArray(items: readonly string[]): string {
  if (!items.length) return "[]";
  return `[\n${items.map((item) => `  ${JSON.stringify(item)},`).join("\n")}\n]`;
}

function codexSnippet(command: string, args: string[], credentialsPath: string | null, safeMode: boolean): string {
  const lines = [
    `[mcp_servers.${SERVER_KEY}]`,
    `command = ${JSON.stringify(command)}`,
    `args = ${JSON.stringify(args)}`,
  ];
  if (credentialsPath) {
    lines.push(`env = { GOOGLE_OAUTH_CREDENTIALS = ${JSON.stringify(credentialsPath)} }`);
  }
  if (safeMode) {
    // Codex gates tools natively via enabled_tools / disabled_tools.
    lines.push(`enabled_tools = ${tomlStringArray(READ_ONLY_TOOL_NAMES)}`);
    lines.push(`disabled_tools = ${tomlStringArray(DANGEROUS_TOOL_NAMES)}`);
  }
  return lines.join("\n");
}

function claudeSnippet(command: string, args: string[], credentialsPath: string | null, safeMode: boolean): string {
  const env = credentialsPath ? `--env GOOGLE_OAUTH_CREDENTIALS=${shellQuote(credentialsPath)} ` : "";
  const add = `claude mcp add ${SERVER_KEY} ${env}-- ${[command, ...args].map(shellQuote).join(" ")}`;
  if (!safeMode) return add;
  // Claude Code gates MCP tools via permission rules in .claude/settings.json.
  const deny = JSON.stringify(
    { permissions: { deny: DANGEROUS_TOOL_NAMES.map((name) => `mcp__${SERVER_KEY}__${name}`) } },
    null,
    2,
  );
  return `${add}\n\nThen deny the dangerous tools in .claude/settings.json:\n\n${deny}`;
}

function copilotSnippet(command: string, args: string[], credentialsPath: string | null, safeMode: boolean): string {
  return JSON.stringify(
    {
      servers: {
        [SERVER_KEY]: {
          type: "stdio",
          command,
          args,
          ...(credentialsPath ? { env: { GOOGLE_OAUTH_CREDENTIALS: credentialsPath } } : {}),
          // VS Code has no per-tool config key, so the read-only set is named
          // here for clarity; toggle the rest off in the Copilot tools picker.
          ...(safeMode ? { tools: [...READ_ONLY_TOOL_NAMES] } : {}),
        },
      },
    },
    null,
    2,
  );
}

export function mcpConfigSnippet({
  client,
  command = "npx",
  args = ["-y", "-p", PACKAGE_NAME, "kozocom-mcp"],
  credentialsPath = null,
  safeMode = false,
}: McpSnippetOptions): string {
  const codex = codexSnippet(command, args, credentialsPath, safeMode);
  const claude = claudeSnippet(command, args, credentialsPath, safeMode);
  const copilot = copilotSnippet(command, args, credentialsPath, safeMode);

  const sections: Record<ClientName, string> = {
    codex: `Codex (~/.codex/config.toml):\n\n${codex}`,
    claude: `Claude Code:\n\n${claude}`,
    copilot: `GitHub Copilot / VS Code (.vscode/mcp.json or global mcp.json):\n\n${copilot}`,
    all: `Codex (~/.codex/config.toml):\n\n${codex}\n\nClaude Code:\n\n${claude}\n\nGitHub Copilot / VS Code (.vscode/mcp.json or global mcp.json):\n\n${copilot}`,
  };

  return sections[client];
}

interface ConfigReportOptions {
  client: ClientName;
  /** Disable dangerous (destructive) tools in the emitted config. Default true. */
  safeMode?: boolean;
}

/**
 * The full text printed by the `config` command: the MCP snippet plus, in safe
 * mode, a note listing the read-only tools that stay enabled and the dangerous
 * tools that are disabled.
 */
export function configReport({ client, safeMode = true }: ConfigReportOptions): string {
  const snippet = mcpConfigSnippet({ client, safeMode });
  if (!safeMode) return snippet;
  return `${snippet}\n\nEnabled (read-only) tools:\n${bulletList(
    READ_ONLY_TOOL_NAMES,
  )}\n\nDisabled (dangerous) tools:\n${bulletList(DANGEROUS_TOOL_NAMES)}`;
}

function bulletList(names: readonly string[]): string {
  return names.map((name) => `  - ${name}`).join("\n");
}

export type { ClientName, SetupOptions };

export function parseClient(value: string | undefined): ClientName | undefined {
  if (!value) return undefined;
  if (value === "codex" || value === "claude" || value === "copilot" || value === "all") return value;
  throw new Error(`Unknown client "${value}". Use codex, claude, copilot, or all.`);
}

async function prompt(question: string, fallback: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${question} [${fallback}]: `);
    return answer.trim() || fallback;
  } finally {
    rl.close();
  }
}

async function chooseClient(defaultClient: ClientName, yes: boolean): Promise<ClientName> {
  if (yes) return defaultClient;
  const answer = await prompt("Which MCP client? codex, claude, copilot, or all", defaultClient);
  return parseClient(answer) ?? defaultClient;
}

export async function runSetup(options: SetupOptions = {}): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });

  console.error(`Config directory: ${CONFIG_DIR}`);
  console.error(`OAuth client secret: ${CLIENT_SECRET_PATH}`);

  if (!(await exists(CLIENT_SECRET_PATH))) {
    if (EMBEDDED_OAUTH_CLIENT) {
      console.error("OAuth client secret: using embedded internal Desktop OAuth client.");
    } else {
      console.error(
        "\nNo OAuth client secret was found. Install a package built with the embedded internal OAuth client, or save a Google OAuth Desktop app client here:",
      );
      console.error(`  ${CLIENT_SECRET_PATH}`);
      console.error("\nSee SETUP.md for details.");
    }
  } else if (!(await isFile(CLIENT_SECRET_PATH))) {
    throw new Error(`OAuth client secret path exists but is not a file: ${CLIENT_SECRET_PATH}`);
  } else {
    const secret = await readFile(CLIENT_SECRET_PATH, "utf8");
    JSON.parse(secret);
    console.error("OAuth client secret found.");
  }

  const status = await getAuthStatus();
  if (status.authenticated) {
    console.error(`Google auth: signed in${status.email ? ` as ${status.email}` : ""}.`);
  } else {
    console.error("Google auth: not signed in. Run `kozocom-mcp auth login` to sign in.");
  }

  const client = options.client ?? (await chooseClient("all", options.yes ?? false));
  console.error("\nAdd this MCP configuration:\n");
  console.error(mcpConfigSnippet({ client }));
}
