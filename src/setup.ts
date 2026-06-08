import { access, mkdir, readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stderr as output } from "node:process";
import { CLIENT_SECRET_PATH, CONFIG_DIR } from "./constants.js";
import { getAuthStatus, runLoginFlow } from "./auth.js";

type ClientName = "codex" | "claude" | "copilot" | "all";

interface SetupOptions {
  client?: ClientName;
  login?: boolean;
  yes?: boolean;
}

interface McpSnippetOptions {
  client: ClientName;
  command?: string;
  args?: string[];
  credentialsPath?: string;
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

export function mcpConfigSnippet({
  client,
  command = "npx",
  args = ["-y", PACKAGE_NAME],
  credentialsPath = CLIENT_SECRET_PATH,
}: McpSnippetOptions): string {
  const codex = `[mcp_servers.kozocom-google]
command = ${JSON.stringify(command)}
args = ${JSON.stringify(args)}
env = { GOOGLE_OAUTH_CREDENTIALS = ${JSON.stringify(credentialsPath)} }`;

  const claudeCommand = `claude mcp add kozocom-google --env GOOGLE_OAUTH_CREDENTIALS=${shellQuote(
    credentialsPath,
  )} -- ${[command, ...args].map(shellQuote).join(" ")}`;

  const copilot = JSON.stringify(
    {
      servers: {
        "kozocom-google": {
          type: "stdio",
          command,
          args,
          env: { GOOGLE_OAUTH_CREDENTIALS: credentialsPath },
        },
      },
    },
    null,
    2,
  );

  const sections: Record<ClientName, string> = {
    codex: `Codex (~/.codex/config.toml):\n\n${codex}`,
    claude: `Claude Code:\n\n${claudeCommand}`,
    copilot: `GitHub Copilot / VS Code (.vscode/mcp.json or global mcp.json):\n\n${copilot}`,
    all: `Codex (~/.codex/config.toml):\n\n${codex}\n\nClaude Code:\n\n${claudeCommand}\n\nGitHub Copilot / VS Code (.vscode/mcp.json or global mcp.json):\n\n${copilot}`,
  };

  return sections[client];
}

function parseClient(value: string | undefined): ClientName | undefined {
  if (!value) return undefined;
  if (value === "codex" || value === "claude" || value === "copilot" || value === "all") return value;
  throw new Error(`Unknown client "${value}". Use codex, claude, copilot, or all.`);
}

export function parseSetupArgs(args: readonly string[]): SetupOptions {
  const options: SetupOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case "--client":
        if (!args[i + 1]) throw new Error("--client requires codex, claude, copilot, or all.");
        options.client = parseClient(args[i + 1]);
        i += 1;
        break;
      case "--yes":
      case "-y":
        options.yes = true;
        break;
      case "--login":
        options.login = true;
        break;
      case "--no-login":
        options.login = false;
        break;
      default:
        throw new Error(`Unknown setup option "${arg}".`);
    }
  }
  return options;
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

async function shouldLogin(defaultValue: boolean, yes: boolean): Promise<boolean> {
  if (yes) return defaultValue;
  const answer = await prompt("Run Google login now? yes or no", defaultValue ? "yes" : "no");
  return ["y", "yes", "true", "1"].includes(answer.toLowerCase());
}

export async function runSetup(options: SetupOptions = {}): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });

  console.error(`Config directory: ${CONFIG_DIR}`);
  console.error(`OAuth client secret: ${CLIENT_SECRET_PATH}`);

  if (!(await exists(CLIENT_SECRET_PATH))) {
    console.error(
      "\nNo OAuth client secret was found. Create a Google OAuth Desktop app client, then save the downloaded JSON here:",
    );
    console.error(`  ${CLIENT_SECRET_PATH}`);
    console.error("\nSee SETUP.md for the Google Cloud click-through.");
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
    console.error("Google auth: not signed in.");
    const login = options.login ?? (await shouldLogin(await exists(CLIENT_SECRET_PATH), options.yes ?? false));
    if (login) {
      const result = await runLoginFlow({
        openBrowser: true,
        onUrl: (url) => {
          console.error(`If the browser didn't open, visit:\n${url}\n`);
        },
      });
      console.error(`Signed in${result.email ? ` as ${result.email}` : ""}.`);
    }
  }

  const client = options.client ?? (await chooseClient("all", options.yes ?? false));
  console.error("\nAdd this MCP configuration:\n");
  console.error(mcpConfigSnippet({ client }));
}
