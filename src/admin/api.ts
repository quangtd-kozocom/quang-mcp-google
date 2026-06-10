import { z } from "zod";
import type { drive_v3 } from "googleapis";
import { DriveFileAdapter } from "../services/drive/adapter.js";
import type { PolicyStore } from "../policy/store.js";
import type { ResourceKind } from "../policy/types.js";

/** A Drive resource as surfaced to the admin console's "search & pick" flow. */
export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  kind: ResourceKind;
}

/**
 * Live status of a granted resource in Drive, resolved lazily when grants are
 * listed: `active` (present), `trashed` (in the trash, recoverable), `missing`
 * (permanently gone / no longer accessible), or `unknown` (couldn't check —
 * e.g. signed out or a transient error, so the UI shouldn't flag it as stale).
 */
export type GrantStatus = "active" | "trashed" | "missing" | "unknown";

/** Collaborators the API routes need, injected so the router stays testable. */
export interface ApiDeps {
  store: PolicyStore;
  searchDrive: (query: string) => Promise<DriveItem[]>;
  authInfo: () => Promise<{ signedIn: boolean; email: string | null; name: string | null }>;
  /** Resolve each granted id's live Drive status; must never throw (map to `unknown`). */
  fileStatuses: (ids: string[]) => Promise<Record<string, GrantStatus>>;
}

/** A plain HTTP-ish response the transport layer serializes. */
export interface ApiResponse {
  status: number;
  body: unknown;
}

const kindSchema = z.enum(["file", "folder", "spreadsheet"]);
const modeSchema = z.enum(["off", "read_open", "strict"]);

const createGrantSchema = z.object({
  kind: kindSchema,
  googleId: z.string().min(1),
  name: z.string().nullish(),
  canRead: z.boolean(),
  canWrite: z.boolean(),
  canDelete: z.boolean(),
});

const patchGrantSchema = z.object({
  name: z.string().nullish(),
  canRead: z.boolean().optional(),
  canWrite: z.boolean().optional(),
  canDelete: z.boolean().optional(),
});

/** Classify a Drive mimeType into the grant `kind` the gate understands. */
export function kindOfMime(mimeType: string | null | undefined): ResourceKind {
  if (mimeType === "application/vnd.google-apps.folder") return "folder";
  if (mimeType === "application/vnd.google-apps.spreadsheet") return "spreadsheet";
  return "file";
}

/** Build the `searchDrive` dependency backed by a live Drive client. */
export function driveSearcher(drive: drive_v3.Drive): (query: string) => Promise<DriveItem[]> {
  return async (query: string) => {
    const trimmed = query.trim();
    // Escape single quotes for the Drive `q` string literal.
    const q = trimmed ? `name contains '${trimmed.replace(/'/g, "\\'")}'` : undefined;
    const { files } = await new DriveFileAdapter(drive).listFiles({
      query: q,
      pageSize: 25,
      orderBy: "modifiedTime desc",
      includeTrashed: false,
    });
    return files
      .filter((f): f is drive_v3.Schema$File & { id: string } => typeof f.id === "string")
      .map((f) => ({
        id: f.id,
        name: f.name ?? "(untitled)",
        mimeType: f.mimeType ?? "application/octet-stream",
        kind: kindOfMime(f.mimeType),
      }));
  };
}

/** Build the `fileStatuses` dependency backed by a live Drive client. */
export function driveFileStatuses(
  drive: drive_v3.Drive,
): (ids: string[]) => Promise<Record<string, GrantStatus>> {
  const adapter = new DriveFileAdapter(drive);
  return async (ids: string[]) => {
    const entries = await Promise.all(
      ids.map(async (id): Promise<readonly [string, GrantStatus]> => {
        try {
          const { trashed } = await adapter.getFileTrashed(id);
          return [id, trashed ? "trashed" : "active"];
        } catch (error) {
          // A 404 means the file is permanently gone; anything else (403, network,
          // rate limit) is inconclusive, so leave it `unknown` rather than crying wolf.
          const code = (error as { code?: number; status?: number }).code ?? (error as { status?: number }).status;
          return [id, code === 404 ? "missing" : "unknown"];
        }
      }),
    );
    return Object.fromEntries(entries);
  };
}

/**
 * Wrap a status resolver with a per-id TTL cache so the admin console's frequent
 * grants poll doesn't hit Drive on every tick. Within `ttlMs` an id is served
 * from memory; only stale or never-seen ids are forwarded to `resolve`. Ids no
 * longer present in a call are pruned, so the cache stays bounded to the current
 * grant set. `now` is injectable for deterministic tests.
 */
export function cachedFileStatuses(
  resolve: (ids: string[]) => Promise<Record<string, GrantStatus>>,
  ttlMs: number,
  now: () => number = Date.now,
): (ids: string[]) => Promise<Record<string, GrantStatus>> {
  const cache = new Map<string, { status: GrantStatus; at: number }>();
  return async (ids: string[]) => {
    const at = now();
    const stale = ids.filter((id) => {
      const hit = cache.get(id);
      return !hit || at - hit.at >= ttlMs;
    });
    if (stale.length > 0) {
      const fresh = await resolve(stale);
      for (const id of stale) cache.set(id, { status: fresh[id] ?? "unknown", at });
    }
    const wanted = new Set(ids);
    for (const id of cache.keys()) if (!wanted.has(id)) cache.delete(id);
    return Object.fromEntries(ids.map((id) => [id, cache.get(id)?.status ?? "unknown"]));
  };
}

/**
 * The admin console's HTTP surface, as a pure function over (method, path, body)
 * — no `node:http` objects — so it unit-tests against an in-memory store and
 * fake deps. Returns `null` for non-`/api` paths so the caller can fall back to
 * serving the SPA's static assets.
 */
export async function routeApi(
  method: string,
  path: string,
  query: URLSearchParams,
  body: unknown,
  deps: ApiDeps,
): Promise<ApiResponse | null> {
  if (path !== "/api" && !path.startsWith("/api/")) return null;

  try {
    if (path === "/api/health" && method === "GET") {
      const auth = await deps.authInfo();
      return ok({ ok: true, mode: deps.store.getMode(), ...auth });
    }

    if (path === "/api/grants") {
      if (method === "GET") {
        const grants = deps.store.listGrants();
        const statuses = await deps.fileStatuses(grants.map((g) => g.googleId));
        return ok({ grants: grants.map((g) => ({ ...g, status: statuses[g.googleId] ?? "unknown" })) });
      }
      if (method === "POST") {
        const input = createGrantSchema.parse(body);
        return ok({ grant: deps.store.upsertGrant(input) }, 201);
      }
    }

    const grantId = path.match(/^\/api\/grants\/(\d+)$/);
    if (grantId) {
      const id = Number(grantId[1]);
      if (method === "PATCH") {
        const patch = patchGrantSchema.parse(body);
        const grant = deps.store.updateGrant(id, patch);
        return grant ? ok({ grant }) : fail(404, "Grant not found");
      }
      if (method === "DELETE") {
        return deps.store.deleteGrant(id) ? ok({ ok: true }) : fail(404, "Grant not found");
      }
    }

    if (path === "/api/mode" && method === "PUT") {
      const { mode } = z.object({ mode: modeSchema }).parse(body);
      deps.store.setMode(mode);
      return ok({ mode });
    }

    if (path === "/api/drive/search" && method === "GET") {
      return ok({ files: await deps.searchDrive(query.get("q") ?? "") });
    }

    return fail(404, "Not found");
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(400, error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "));
    }
    return fail(500, error instanceof Error ? error.message : String(error));
  }
}

function ok(body: unknown, status = 200): ApiResponse {
  return { status, body };
}

function fail(status: number, error: string): ApiResponse {
  return { status, body: { error } };
}
