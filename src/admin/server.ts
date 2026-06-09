import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { ADMIN_PORT, getAdminStaticDir } from "../config/constants.js";
import { getGoogleClients } from "../google/client.js";
import { getAuthStatus } from "../google/auth.js";
import { getPolicyStoreOrThrow } from "../policy/guard.js";
import { type ApiDeps, driveSearcher, routeApi } from "./api.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

/** Build the API dependencies from the live policy store + Google clients. */
function buildDeps(): ApiDeps {
  return {
    store: getPolicyStoreOrThrow(),
    searchDrive: async (query) => driveSearcher((await getGoogleClients()).drive)(query),
    authInfo: async () => {
      const status = await getAuthStatus().catch(() => ({ authenticated: false, email: null }));
      return { signedIn: status.authenticated, email: status.email ?? null };
    },
  };
}

/** First existing candidate directory holding the built SPA, or undefined. */
async function resolveStaticDir(override?: string): Promise<string | undefined> {
  const candidates = [
    override,
    getAdminStaticDir(),
    join(HERE, "ui"), // production: copied beside the compiled server (dist/admin/ui)
    join(HERE, "../../admin/dist"), // dev via tsx: the repo's built SPA
  ].filter((c): c is string => typeof c === "string");
  const exists = await Promise.all(candidates.map(isDir));
  return candidates.find((_, index) => exists[index]);
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

async function serveStatic(res: ServerResponse, staticDir: string | undefined, urlPath: string): Promise<void> {
  if (!staticDir) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end("Admin UI is not built. Run `pnpm admin:build` (or set TERRA_MCP_ADMIN_STATIC_DIR).");
    return;
  }
  // Resolve the request to a file inside staticDir; fall back to index.html so
  // the single-page app can handle its own routing. Reject path traversal.
  const relative = normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = resolve(staticDir, "." + relative);
  if (!filePath.startsWith(resolve(staticDir))) filePath = join(staticDir, "index.html");
  if (!(await fileExists(filePath))) filePath = join(staticDir, "index.html");

  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export interface AdminServerHandle {
  port: number;
  url: string;
  close: () => Promise<void>;
}

/**
 * Start the admin web console: a tiny `node:http` server that exposes the policy
 * REST API under `/api` and serves the built SPA for everything else. No
 * framework, no extra runtime dependency.
 */
export async function startAdminServer(
  opts: { port?: number; staticDir?: string } = {},
): Promise<AdminServerHandle> {
  const port = opts.port ?? ADMIN_PORT;
  const deps = buildDeps();
  const staticDir = await resolveStaticDir(opts.staticDir);

  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer((req, res) => {
      void handle(req, res, deps, staticDir);
    });
    server.on("error", rejectPromise);
    server.listen(port, () => {
      resolvePromise({
        port,
        url: `http://localhost:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ApiDeps,
  staticDir: string | undefined,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  try {
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const body = method === "GET" || method === "DELETE" ? undefined : await readBody(req);
      const result = await routeApi(method, url.pathname, url.searchParams, body, deps);
      if (result) return sendJson(res, result.status, result.body);
    }
    await serveStatic(res, staticDir, url.pathname);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}
