import { homedir } from "node:os";
import { join } from "node:path";

/** Server identity reported to MCP clients. */
export const SERVER_NAME = "kozocom-google-mcp-server";
export const SERVER_VERSION = "0.1.0";

/** Full read/write Drive scope — gates the `drive_*` tools. */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
/** Full read/write Sheets scope — gates the `sheets_*` tools. */
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

/** Sign-in scopes, always requested. Let us show which account is signed in. */
export const IDENTITY_SCOPES = ["https://www.googleapis.com/auth/userinfo.email", "openid"];

/**
 * OAuth scopes requested at login. Full read/write for both Drive and Sheets.
 * Google's granular consent screen lets the user grant only some of these; the
 * server then registers only the tools whose scope was actually granted (see
 * `selectGoogleTools`). Changing these requires re-running login (delete the
 * cached token first).
 */
export const SCOPES = [DRIVE_SCOPE, SHEETS_SCOPE, ...IDENTITY_SCOPES];

/**
 * Every environment variable this server reads, by name. `constants.ts` is the
 * single place that touches `process.env`; consumers import the resolved values
 * (or the lazy getters) below — never the raw vars. One naming style: `ENV.*`.
 */
export const ENV = {
  /** Directory holding the OAuth client config + cached token. */
  CONFIG_DIR: "TERRA_MCP_DIR",
  /** Path to a Google OAuth client JSON; overrides the embedded client. */
  OAUTH_CREDENTIALS: "GOOGLE_OAUTH_CREDENTIALS",
  /** Path to the cached OAuth token (access + refresh). */
  OAUTH_TOKEN: "GOOGLE_OAUTH_TOKEN",
  /** "1" → run in safe mode: register only read-only tools. */
  SAFE_MODE: "TERRA_MCP_SAFE_MODE",
  /** Path to the SQLite policy/allowlist database. */
  POLICY_DB: "TERRA_MCP_POLICY_DB",
  /** Initial policy mode used when the database has none stored yet. */
  POLICY_MODE: "TERRA_MCP_POLICY_MODE",
  /** Port the `terra-mcp admin` web console listens on. */
  ADMIN_PORT: "TERRA_MCP_ADMIN_PORT",
  /** Directory holding the built admin SPA assets (overrides auto-detection). */
  ADMIN_STATIC_DIR: "TERRA_MCP_ADMIN_STATIC_DIR",
} as const;

/** Directory holding the optional OAuth client config and cached token. */
export const CONFIG_DIR = process.env[ENV.CONFIG_DIR] ?? join(homedir(), ".terra-mcp");

/** Path to an optional downloaded Google OAuth client JSON. */
export const CLIENT_SECRET_PATH =
  process.env[ENV.OAUTH_CREDENTIALS] ?? join(CONFIG_DIR, "client_secret.json");

/** Path to the cached OAuth token (access + refresh). */
export const TOKEN_PATH = process.env[ENV.OAUTH_TOKEN] ?? join(CONFIG_DIR, "token.json");

/**
 * Whether `GOOGLE_OAUTH_CREDENTIALS` was set explicitly (vs. falling back to the
 * default path). Read lazily — tests stub the env at runtime, and "explicit?" is
 * a runtime question, so this is evaluated per call, not frozen at import.
 */
export const hasExplicitCredentialsPath = (): boolean =>
  process.env[ENV.OAUTH_CREDENTIALS] !== undefined;

/**
 * OAuth token-exchange proxy. Google "Desktop" clients are confidential — the
 * token endpoint requires `client_secret` even with PKCE. To keep the secret out
 * of the published package, the CLI does the PKCE authorize step itself and posts
 * the resulting `code` (and later, refresh tokens) to this Worker, which holds the
 * secret and completes the exchange. See the `quang-mcp-auth-proxy` repo.
 */
export const TOKEN_PROXY_URL =
  "https://quang-mcp-auth-proxy.getting-started-worker.workers.dev/token";

/**
 * Shared deterrent key sent to the proxy in `x-proxy-key`. This ships in the
 * package, so it is NOT a secret — just a casual-abuse speed bump. The real
 * protection is PKCE (binds each auth code to the CLI that started the flow).
 */
export const PROXY_SHARED_KEY =
  "f80350f60e2c7950b72f3041c673d1194d45efa38217237ecc7bf87530f093d5";

/** Maximum characters returned in a single tool response before truncation. */
export const CHARACTER_LIMIT = 25000;

/**
 * Path to the SQLite database holding the resource allowlist (grants) and the
 * policy mode. Lives beside the cached token under {@link CONFIG_DIR}. Both the
 * MCP server and the `admin` web console open this same file (SQLite WAL makes
 * the two processes safe), so a grant added in the UI is seen by the server on
 * its next tool call — no restart, no cache to invalidate.
 */
export const POLICY_DB_PATH = process.env[ENV.POLICY_DB] ?? join(CONFIG_DIR, "policy.db");

/**
 * The policy mode used the first time the database is created (before the user
 * has chosen one in the admin console). `read_open` is the friendly default:
 * the agent may read anything the account can, but may only write/delete/create
 * where the user has granted access. See `PolicyMode` for the full meaning.
 */
export const DEFAULT_POLICY_MODE = process.env[ENV.POLICY_MODE] ?? "read_open";

/** Port the `terra-mcp admin` web console listens on (default 4717). */
export const ADMIN_PORT = Number(process.env[ENV.ADMIN_PORT] ?? 4717);

/** Explicit override for the built admin SPA directory, when set. Lazy. */
export const getAdminStaticDir = (): string | undefined => process.env[ENV.ADMIN_STATIC_DIR];

/**
 * Whether this process runs in safe mode (dangerous tools not registered). The
 * `config` CLI command emits `TERRA_MCP_SAFE_MODE` in the generated MCP config so
 * AI clients can't destroy data.
 */
export const SAFE_MODE = process.env[ENV.SAFE_MODE] === "1";
