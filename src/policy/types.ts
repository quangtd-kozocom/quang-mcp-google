/**
 * Shared vocabulary for the permission gate. The gate sits between an AI agent's
 * tool calls and the real Google API: the user keeps an allowlist of resources
 * (with read/write/delete permissions) in a small SQLite database, and every
 * tool call is checked against it before — and, for newly created resources,
 * after — it runs.
 */

/**
 * How strict the gate is overall.
 *
 * - `off` — gate disabled; the agent can do anything the account can.
 * - `read_open` — the friendly default: the agent may **read** anything, and may
 *   **create** brand-new resources, but may only **write/delete existing**
 *   resources that appear in the allowlist with that permission.
 * - `strict` — nothing outside the allowlist exists to the agent: reads, writes,
 *   deletes, and list results are all confined to granted resources (and the
 *   children of granted folders).
 */
export type PolicyMode = "off" | "read_open" | "strict";

/** Kind of Google resource a grant covers. A spreadsheet is also a Drive file. */
export type ResourceKind = "file" | "folder" | "spreadsheet";

/** The operation a tool performs on a resource, from the gate's point of view. */
export type PolicyAction = "read" | "write" | "delete" | "create" | "list";

/** A single allowlist entry: one resource and what the agent may do with it. */
export interface Grant {
  id: number;
  kind: ResourceKind;
  googleId: string;
  name: string | null;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  createdAt: string;
}

/** The writable fields of a grant (everything but the server-assigned id/time). */
export interface GrantInput {
  kind: ResourceKind;
  googleId: string;
  name?: string | null;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
}

/** Partial update to an existing grant. */
export interface GrantPatch {
  name?: string | null;
  canRead?: boolean;
  canWrite?: boolean;
  canDelete?: boolean;
}

/**
 * Declarative description, attached to a tool, of how the guard should map that
 * tool's arguments to a permission check — so enforcement stays generic and
 * lives in one place rather than being copy-pasted into every handler.
 */
export interface ToolPolicy {
  /** What the tool does to its target resource. */
  action: PolicyAction;
  /** Kind of resource involved (used when auto-granting created resources). */
  kind: ResourceKind;
  /** Name of the argument holding the target resource id (read/write/delete). */
  idArg?: string;
  /** Name of the argument holding the destination folder id (create). */
  parentArg?: string;
  /** Name of the argument holding a source id that must be readable (copy). */
  sourceArg?: string;
  /** Extract the new resource's id from a successful result, to auto-grant it. */
  newResourceId?: (structured: Record<string, unknown>) => string | undefined;
  /** Extract a display name for the auto-granted resource, if available. */
  newResourceName?: (structured: Record<string, unknown>) => string | undefined;
}

/** The outcome of a permission check. */
export interface Verdict {
  allowed: boolean;
  /** Actionable, agent-readable explanation when `allowed` is false. */
  message?: string;
}
