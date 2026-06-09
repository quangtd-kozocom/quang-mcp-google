import { homedir } from "node:os";
import { join } from "node:path";

/** Server identity reported to MCP clients. */
export const SERVER_NAME = "kozocom-google-mcp-server";
export const SERVER_VERSION = "0.1.0";

/**
 * OAuth scopes requested at login. Full read/write for both Drive and Sheets.
 * Changing these requires re-running the login flow (delete the cached token).
 */
export const SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
  // Returned automatically; lets us show which account is signed in.
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

/** Directory holding the OAuth client secret and cached token. */
export const CONFIG_DIR = process.env.KOZOCOM_MCP_DIR ?? join(homedir(), ".kozocom-mcp");

/** Path to the downloaded Google OAuth client secret (Desktop app type). */
export const CLIENT_SECRET_PATH =
  process.env.GOOGLE_OAUTH_CREDENTIALS ?? join(CONFIG_DIR, "client_secret.json");

/** Path to the cached OAuth token (access + refresh). */
export const TOKEN_PATH = process.env.GOOGLE_OAUTH_TOKEN ?? join(CONFIG_DIR, "token.json");

/** Maximum characters returned in a single tool response before truncation. */
export const CHARACTER_LIMIT = 25000;

/**
 * Env var that, when set to "1", runs the server in safe mode: irreversible,
 * destructive tools (delete/clear) are not registered. The `config` CLI command
 * emits this in the generated MCP config so AI clients can't destroy data.
 */
const SAFE_MODE_ENV = "KOZOCOM_MCP_SAFE_MODE";

/** Whether this process is running with dangerous tools disabled. */
export const SAFE_MODE = process.env[SAFE_MODE_ENV] === "1";
