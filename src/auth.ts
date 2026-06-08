import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import open from "open";
import { google } from "googleapis";
import { CLIENT_SECRET_PATH, CONFIG_DIR, SCOPES, TOKEN_PATH } from "./constants.js";
import { NotAuthenticatedError } from "./format.js";

export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
type Credentials = Parameters<OAuth2Client["setCredentials"]>[0];

interface ClientSecret {
  client_id: string;
  client_secret: string;
}

export interface AuthStatus {
  authenticated: boolean;
  email?: string;
  scopes?: string[];
  expiryDate?: number;
}

export interface LoginOptions {
  /** Open the system browser automatically (default true). */
  openBrowser?: boolean;
  /** Called with the consent URL (e.g. to print it for manual opening). */
  onUrl?: (url: string) => void;
  /** Abort the flow after this many ms (default 5 minutes). */
  timeoutMs?: number;
}

export interface LoginResult {
  email?: string;
  scopes: string[];
}

const SUCCESS_HTML = (email?: string) =>
  `<!doctype html><html><body style="font-family:system-ui;text-align:center;padding:3rem">
   <h2>✅ Signed in${email ? ` as ${email}` : ""}</h2>
   <p>You can close this tab and return to your terminal / MCP client.</p>
   </body></html>`;

// ── Token & secret persistence ────────────────────────────────────────────────

/** Read and normalize the OAuth client secret (Desktop "installed" or "web" type). */
export async function readClientSecret(): Promise<ClientSecret> {
  let raw: string;
  try {
    raw = await readFile(CLIENT_SECRET_PATH, "utf8");
  } catch {
    throw new NotAuthenticatedError(
      `No OAuth client secret found at ${CLIENT_SECRET_PATH}. ` +
        `Create one in Google Cloud Console (see SETUP.md) and place it there, ` +
        `or set GOOGLE_OAUTH_CREDENTIALS to its path.`,
    );
  }
  const parsed = JSON.parse(raw) as Record<string, { client_id?: string; client_secret?: string }>;
  const node = parsed.installed ?? parsed.web;
  if (!node?.client_id || !node?.client_secret) {
    throw new NotAuthenticatedError(
      `Client secret at ${CLIENT_SECRET_PATH} is missing client_id/client_secret. ` +
        `Download a fresh "Desktop app" OAuth client from Google Cloud Console.`,
    );
  }
  return { client_id: node.client_id, client_secret: node.client_secret };
}

/** Load cached token credentials, or null if none saved. */
export async function loadToken(): Promise<Credentials | null> {
  try {
    return JSON.parse(await readFile(TOKEN_PATH, "utf8")) as Credentials;
  } catch {
    return null;
  }
}

/** Persist token credentials to disk (creates the config dir if needed). */
export async function saveToken(credentials: Credentials): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(TOKEN_PATH, JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

/** Delete the cached token. Returns true if a token existed. */
export async function clearToken(): Promise<boolean> {
  try {
    await rm(TOKEN_PATH);
    return true;
  } catch {
    return false;
  }
}

// ── Authorized clients & status ───────────────────────────────────────────────

function createBaseClient(secret: ClientSecret, redirectUri?: string): OAuth2Client {
  return new google.auth.OAuth2(secret.client_id, secret.client_secret, redirectUri);
}

/** Fetch the signed-in user's email, best-effort. */
async function fetchEmail(client: OAuth2Client): Promise<string | undefined> {
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data } = await oauth2.userinfo.get();
    return data.email ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build an authorized OAuth2 client from the cached token. Refreshes the access
 * token automatically and persists any refreshed credentials.
 * @throws NotAuthenticatedError if no token is cached.
 */
export async function getAuthenticatedClient(): Promise<OAuth2Client> {
  const secret = await readClientSecret();
  const token = await loadToken();
  if (!token) {
    throw new NotAuthenticatedError("No saved Google credentials.");
  }
  const client = createBaseClient(secret);
  client.setCredentials(token);
  // google-auth-library emits "tokens" when it refreshes; persist merged result.
  client.on("tokens", (fresh) => {
    void saveToken({ ...token, ...fresh });
  });
  return client;
}

/** Report whether we have working credentials and for which account. */
export async function getAuthStatus(): Promise<AuthStatus> {
  const token = await loadToken();
  if (!token) return { authenticated: false };
  let email: string | undefined;
  try {
    email = await fetchEmail(await getAuthenticatedClient());
  } catch {
    // token present but unreadable secret; still report as cached
  }
  return {
    authenticated: true,
    email,
    scopes: token.scope?.split(" "),
    expiryDate: token.expiry_date ?? undefined,
  };
}

// ── Interactive login ─────────────────────────────────────────────────────────

/**
 * Run the interactive OAuth loopback flow: start a localhost listener, open the
 * consent page, capture the redirect, exchange the code, and cache the token.
 */
export async function runLoginFlow(options: LoginOptions = {}): Promise<LoginResult> {
  const { openBrowser = true, onUrl, timeoutMs = 300_000 } = options;
  const secret = await readClientSecret();

  return await new Promise<LoginResult>((resolve, reject) => {
    let client: OAuth2Client | undefined;
    let redirectUri = "";

    const server = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (!url.pathname.startsWith("/oauth2callback")) {
          res.writeHead(404).end("Not found");
          return;
        }
        const authError = url.searchParams.get("error");
        const code = url.searchParams.get("code");
        try {
          if (authError) throw new Error(`Authorization denied: ${authError}`);
          if (!code || !client) throw new Error("Missing authorization code in callback.");
          const { tokens } = await client.getToken({ code, redirect_uri: redirectUri });
          client.setCredentials(tokens);
          await saveToken(tokens);
          const email = await fetchEmail(client);
          res.writeHead(200, { "Content-Type": "text/html" }).end(SUCCESS_HTML(email));
          finish();
          resolve({ email, scopes: tokens.scope?.split(" ") ?? SCOPES });
        } catch (err) {
          res.writeHead(500, { "Content-Type": "text/plain" }).end("Login failed. Check the terminal.");
          finish();
          reject(err);
        }
      })();
    });

    const timer = setTimeout(() => {
      finish();
      reject(new Error("Login timed out — no response within the allotted time."));
    }, timeoutMs);

    function finish() {
      clearTimeout(timer);
      server.close();
    }

    server.on("error", (err) => {
      finish();
      reject(err);
    });

    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
      client = createBaseClient(secret, redirectUri);
      const authUrl = client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: SCOPES,
      });
      onUrl?.(authUrl);
      if (openBrowser) {
        void open(authUrl).catch(() => {
          /* user can open the URL manually via onUrl */
        });
      }
    });
  });
}
