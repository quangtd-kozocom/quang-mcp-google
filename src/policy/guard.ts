import { POLICY_DB_PATH } from "../config/constants.js";
import { errorResult, type ToolResult } from "../core/result.js";
import { PolicyEngine } from "./engine.js";
import { DriveAncestorResolver } from "./resolver.js";
import { PolicyStore } from "./store.js";
import type { ToolPolicy } from "./types.js";

// The gate keeps one process-wide store handle, opened lazily so importing this
// module never touches the filesystem (tests inject an in-memory store instead).
let store: PolicyStore | undefined;
let openFailed = false;

/**
 * The active policy store, opening the on-disk database on first use. Returns
 * `undefined` if SQLite is unavailable (Node older than 23.4 without the
 * `--experimental-sqlite` flag) — the gate then stays out of the way rather than
 * breaking every tool call. The failure is logged once, to stderr.
 */
export function getPolicyStore(): PolicyStore | undefined {
  if (store) return store;
  if (openFailed) return undefined;
  try {
    store = PolicyStore.open(POLICY_DB_PATH);
    return store;
  } catch (error) {
    openFailed = true;
    console.error(
      "[terra-mcp] Permission gate disabled: could not open the policy database " +
        `(${error instanceof Error ? error.message : String(error)}). ` +
        "Use Node 23.4+ to enable per-resource access control.",
    );
    return undefined;
  }
}

/** Like {@link getPolicyStore} but throws when SQLite is unavailable. */
export function getPolicyStoreOrThrow(): PolicyStore {
  const active = getPolicyStore();
  if (!active) {
    throw new Error("The policy database is unavailable. The admin console requires Node 23.4 or newer.");
  }
  return active;
}

/** Swap the store — used by tests (with `:memory:`) and by the admin server. */
export function setPolicyStore(next: PolicyStore): void {
  store = next;
  openFailed = false;
}

/**
 * A resolver whose Drive client is built only if an ancestor walk is actually
 * needed. The client module is imported lazily so this file never pulls in
 * `googleapis` at load time (keeps it cheap, and out of unrelated tests).
 */
function makeResolver(): DriveAncestorResolver {
  return new DriveAncestorResolver(async () => {
    const { getGoogleClients } = await import("../google/client.js");
    return (await getGoogleClients()).drive;
  });
}

function asId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Run a tool through the permission gate. Decorates the tool's real work with a
 * pre-call check (read/write/delete/create) and a post-call effect (auto-grant
 * the resource a create tool just made). Denials become an actionable error
 * result; they never throw. Tools with no `policy` pass straight through, and so
 * does everything when the mode is `off`.
 */
export async function guardedRun(
  policy: ToolPolicy | undefined,
  args: Record<string, unknown>,
  run: () => Promise<ToolResult>,
): Promise<ToolResult> {
  if (!policy) return run();
  const activeStore = getPolicyStore();
  if (!activeStore) return run();

  const engine = new PolicyEngine(activeStore);
  if (policy.action !== "list") {
    const verdict = await engine.check(
      {
        action: policy.action,
        kind: policy.kind,
        resourceId: policy.idArg ? asId(args[policy.idArg]) : undefined,
        parentId: policy.parentArg ? asId(args[policy.parentArg]) : undefined,
        sourceId: policy.sourceArg ? asId(args[policy.sourceArg]) : undefined,
      },
      makeResolver(),
    );
    if (!verdict.allowed) return errorResult(verdict.message ?? "Access denied by policy.");
  }

  const result = await run();

  if (policy.action === "create" && !result.isError && policy.newResourceId && result.structuredContent) {
    const id = policy.newResourceId(result.structuredContent);
    if (id) {
      activeStore.upsertGrant({
        kind: policy.kind,
        googleId: id,
        name: policy.newResourceName?.(result.structuredContent) ?? null,
        canRead: true,
        canWrite: true,
        canDelete: true,
      });
    }
  }
  return result;
}

/**
 * Narrow a list of Drive files to those the agent may see. A no-op unless the
 * mode is `strict`, where it keeps only files that are granted directly or live
 * under a granted folder — so list/search can't leak resources outside the
 * allowlist.
 */
export async function filterVisibleFiles<T extends { id?: string | null }>(files: T[]): Promise<T[]> {
  const activeStore = getPolicyStore();
  if (!activeStore || activeStore.getMode() !== "strict") return files;
  const engine = new PolicyEngine(activeStore);
  const resolver = makeResolver();
  const readable = await Promise.all(
    files.map((file) => (file.id ? engine.canRead(file.id, resolver) : Promise.resolve(false))),
  );
  return files.filter((_, index) => readable[index]);
}
