import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import open from "open";
import { Auth, google } from "googleapis";
import {
  CLIENT_SECRET_PATH,
  CONFIG_DIR,
  hasExplicitCredentialsPath,
  PROXY_SHARED_KEY,
  SCOPES,
  TOKEN_PATH,
  TOKEN_PROXY_URL,
} from "../config/constants.js";
import { NotAuthenticatedError } from "../core/result.js";
import { EMBEDDED_OAUTH_CLIENT } from "./generated/oauth-client.js";

export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
type Credentials = Parameters<OAuth2Client["setCredentials"]>[0];

interface ClientSecret {
  client_id: string;
  client_secret?: string;
}

export interface AuthStatus {
  authenticated: boolean;
  email?: string;
  name?: string;
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
  `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:system-ui;text-align:center;padding:3rem">
   <h2>✅ Signed in${email ? ` as ${email}` : ""}</h2>
   <p>You can close this tab and return to your terminal / MCP client.</p>
   </body></html>`;

// ── Token & OAuth client persistence ─────────────────────────────────────────

/** Read and normalize the OAuth client config (embedded client or local JSON). */
export async function readClientSecret(): Promise<ClientSecret> {
  const explicitCredentialsPath = hasExplicitCredentialsPath();
  if (!explicitCredentialsPath && EMBEDDED_OAUTH_CLIENT) {
    return EMBEDDED_OAUTH_CLIENT;
  }

  let raw: string;
  try {
    raw = await readFile(CLIENT_SECRET_PATH, "utf8");
  } catch {
    throw new NotAuthenticatedError(
      `No OAuth client config found at ${CLIENT_SECRET_PATH}. ` +
        `Use a package built with the embedded OAuth client, place one there, ` +
        `or set GOOGLE_OAUTH_CREDENTIALS to its path.`,
    );
  }
  const parsed = JSON.parse(raw) as Record<string, { client_id?: string; client_secret?: string }>;
  const node = parsed.installed ?? parsed.web;
  if (!node?.client_id) {
    throw new NotAuthenticatedError(
      `OAuth client config at ${CLIENT_SECRET_PATH} is missing client_id. ` +
        `Download a fresh OAuth client from Google Cloud Console.`,
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
  if (secret.client_secret) {
    return new google.auth.OAuth2(secret.client_id, secret.client_secret, redirectUri);
  }
  return new google.auth.OAuth2({
    clientId: secret.client_id,
    redirectUri,
    clientAuthentication: Auth.ClientAuthentication.None,
  });
}

/** Raw token response from Google, relayed verbatim by the proxy. */
interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

/**
 * Exchange an auth code or refresh token for credentials via the token proxy.
 * The proxy holds the Google client_secret (Desktop clients require it even with
 * PKCE); we send only the grant + PKCE params, never a secret.
 */
async function proxyTokenExchange(body: Record<string, string>): Promise<Credentials> {
  let res: Response;
  try {
    res = await fetch(TOKEN_PROXY_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-proxy-key": PROXY_SHARED_KEY },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new Error(`Could not reach the OAuth token proxy at ${TOKEN_PROXY_URL}.`, { cause });
  }
  const data = (await res.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!res.ok || data.error || !data.access_token) {
    const detail = data.error_description ?? data.error ?? `HTTP ${res.status}`;
    throw new Error(`Token exchange failed: ${detail}`);
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    scope: data.scope,
    token_type: data.token_type,
    id_token: data.id_token,
    expiry_date: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

/** Fetch the signed-in user's profile (email + display name), best-effort. */
async function fetchUserInfo(client: OAuth2Client): Promise<{ email?: string; name?: string }> {
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data } = await oauth2.userinfo.get();
    return { email: data.email ?? undefined, name: data.name ?? undefined };
  } catch {
    return {};
  }
}

/** Fetch the signed-in user's email, best-effort. */
async function fetchEmail(client: OAuth2Client): Promise<string | undefined> {
  return (await fetchUserInfo(client)).email;
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
  // Refresh through the proxy: Google needs the client_secret to refresh a
  // confidential (Desktop) client, and we don't hold it. Setting refreshHandler
  // makes google-auth-library call us instead of doing its own secret-based
  // refresh. Persist the refreshed access token so it survives restarts.
  client.refreshHandler = async () => {
    if (!token.refresh_token) {
      throw new NotAuthenticatedError("No refresh token cached — run `terra-mcp auth login` again.");
    }
    const fresh = await proxyTokenExchange({
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    });
    await saveToken({ ...token, ...fresh });
    if (!fresh.access_token || fresh.expiry_date == null) {
      throw new Error("Token proxy returned no access token on refresh.");
    }
    return { access_token: fresh.access_token, expiry_date: fresh.expiry_date };
  };
  return client;
}

/** Report whether we have working credentials and for which account. */
export async function getAuthStatus(): Promise<AuthStatus> {
  const token = await loadToken();
  if (!token) return { authenticated: false };
  let email: string | undefined;
  let name: string | undefined;
  try {
    ({ email, name } = await fetchUserInfo(await getAuthenticatedClient()));
  } catch {
    // token present but OAuth client config unreadable; still report as cached
  }
  return {
    authenticated: true,
    email,
    name,
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
    let codeVerifier = "";

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
          const tokens = await proxyTokenExchange({
            grant_type: "authorization_code",
            code,
            code_verifier: codeVerifier,
            redirect_uri: redirectUri,
          });
          client.setCredentials(tokens);
          await saveToken(tokens);
          const email = await fetchEmail(client);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(SUCCESS_HTML(email));
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
      const oauthClient = createBaseClient(secret, redirectUri);
      client = oauthClient;
      void oauthClient.generateCodeVerifierAsync().then(({ codeVerifier: verifier, codeChallenge }) => {
        if (!codeChallenge) throw new Error("Failed to generate OAuth PKCE challenge.");
        codeVerifier = verifier;
        const authUrl = oauthClient.generateAuthUrl({
          access_type: "offline",
          prompt: "consent",
          scope: SCOPES,
          code_challenge: codeChallenge,
          code_challenge_method: Auth.CodeChallengeMethod.S256,
          // Force per-scope checkboxes so the user can grant Drive and Sheets
          // independently. Desktop/pre-2019 clients don't get them by default;
          // a no-op once Google has auto-enabled granular consent for the client.
          enable_granular_consent: true,
        });
        onUrl?.(authUrl);
        if (openBrowser) {
          void open(authUrl).catch(() => {
            /* user can open the URL manually via onUrl */
          });
        }
      }).catch((err: unknown) => {
        finish();
        reject(err);
      });
    });
  });
}
