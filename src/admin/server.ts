import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { ADMIN_PORT, ADMIN_STATUS_TTL_MS, getAdminStaticDir } from "../config/constants.js";
import { getGoogleClients } from "../google/client.js";
import { getAuthStatus } from "../google/auth.js";
import { getPolicyStoreOrThrow } from "../policy/guard.js";
import {
  type ApiDeps,
  cachedFileStatuses,
  driveFileStatuses,
  type GrantStatus,
  driveSearcher,
  routeApi,
} from "./api.js";

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
  // Created once per server so the TTL cache survives across the UI's polls.
  const resolveStatuses = async (ids: string[]): Promise<Record<string, GrantStatus>> => {
    if (ids.length === 0) return {};
    try {
      return await driveFileStatuses((await getGoogleClients()).drive)(ids);
    } catch {
      // Couldn't even get a Drive client (e.g. signed out) — don't flag anything stale.
      return Object.fromEntries(ids.map((id) => [id, "unknown" as const]));
    }
  };

  return {
    store: getPolicyStoreOrThrow(),
    searchDrive: async (query) => driveSearcher((await getGoogleClients()).drive)(query),
    fileStatuses: cachedFileStatuses(resolveStatuses, ADMIN_STATUS_TTL_MS),
    authInfo: async () => {
      const status = await getAuthStatus().catch(() => ({ authenticated: false, email: null, name: null }));
      return { signedIn: status.authenticated, email: status.email ?? null, name: status.name ?? null };
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

/** Serve a file from the built SPA, falling back to index.html for client-side routing. */
async function serveStatic(staticDir: string | undefined, urlPath: string): Promise<Response> {
  if (!staticDir) {
    return new Response(
      "Admin UI is not built. Run `pnpm admin:build` (or set TERRA_MCP_ADMIN_STATIC_DIR).",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  // Resolve the request to a file inside staticDir; fall back to index.html so
  // the single-page app can handle its own routing. Reject path traversal.
  const relative = normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = resolve(staticDir, "." + relative);
  if (!filePath.startsWith(resolve(staticDir))) filePath = join(staticDir, "index.html");
  if (!(await fileExists(filePath))) filePath = join(staticDir, "index.html");

  try {
    const data = await readFile(filePath);
    return new Response(data, {
      status: 200,
      headers: { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" },
    });
  } catch {
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
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

/** Build the Hono app: the policy REST API under `/api` + the built SPA for the rest. */
function buildApp(deps: ApiDeps, staticDir: string | undefined): Hono {
  const app = new Hono();

  app.all("/api", (c) => handleApi(c, deps));
  app.all("/api/*", (c) => handleApi(c, deps));
  app.all("*", async (c) => serveStatic(staticDir, new URL(c.req.url).pathname));

  return app;
}

/** Map a Hono request onto the pure `routeApi` router and serialize its result. */
async function handleApi(
  c: { req: { method: string; url: string; json: () => Promise<unknown> } },
  deps: ApiDeps,
): Promise<Response> {
  const url = new URL(c.req.url);
  const method = c.req.method;
  try {
    const body =
      method === "GET" || method === "DELETE" ? undefined : await c.req.json().catch(() => undefined);
    const result = await routeApi(method, url.pathname, url.searchParams, body, deps);
    if (result) {
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }
    return await serveStatic(undefined, url.pathname);
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}

/**
 * Start the admin web console: a small Hono server that exposes the policy REST
 * API under `/api` and serves the built SPA for everything else, running on the
 * Node adapter (`@hono/node-server`).
 */
export async function startAdminServer(
  opts: { port?: number; staticDir?: string } = {},
): Promise<AdminServerHandle> {
  const port = opts.port ?? ADMIN_PORT;
  const deps = buildDeps();
  const staticDir = await resolveStaticDir(opts.staticDir);
  const app = buildApp(deps, staticDir);

  return new Promise((resolvePromise, rejectPromise) => {
    let server: ServerType;
    try {
      server = serve({ fetch: app.fetch, port }, (info) => {
        resolvePromise({
          port: info.port,
          url: `http://localhost:${info.port}`,
          close: () => new Promise<void>((done) => server.close(() => done())),
        });
      });
    } catch (error) {
      rejectPromise(error);
      return;
    }
    server.on("error", rejectPromise);
  });
}
