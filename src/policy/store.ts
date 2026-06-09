import { createRequire } from "node:module";
import { DEFAULT_POLICY_MODE } from "../config/constants.js";
import type { Grant, GrantInput, GrantPatch, PolicyMode } from "./types.js";

// `node:sqlite` is built in, but only loadable without a flag on Node >= 23.4.
// Load it lazily via require so this module imports cleanly on every Node — the
// guard catches a failure here and disables the gate rather than crashing.
type DatabaseSync = import("node:sqlite").DatabaseSync;
let DatabaseSyncCtor: (new (location: string) => DatabaseSync) | undefined;

function loadDatabaseSync(): new (location: string) => DatabaseSync {
  if (!DatabaseSyncCtor) {
    const require = createRequire(import.meta.url);
    DatabaseSyncCtor = (require("node:sqlite") as typeof import("node:sqlite")).DatabaseSync;
  }
  return DatabaseSyncCtor;
}

const VALID_MODES: ReadonlySet<string> = new Set(["off", "read_open", "strict"]);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS grants (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT    NOT NULL,
  google_id  TEXT    NOT NULL UNIQUE,
  name       TEXT,
  can_read   INTEGER NOT NULL DEFAULT 1,
  can_write  INTEGER NOT NULL DEFAULT 0,
  can_delete INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL
);
`;

/** Raw row shape as returned by node:sqlite (null-prototype, integer booleans). */
interface GrantRow {
  id: number;
  kind: string;
  google_id: string;
  name: string | null;
  can_read: number;
  can_write: number;
  can_delete: number;
  created_at: string;
}

function rowToGrant(row: GrantRow): Grant {
  return {
    id: row.id,
    kind: row.kind as Grant["kind"],
    googleId: row.google_id,
    name: row.name,
    canRead: !!row.can_read,
    canWrite: !!row.can_write,
    canDelete: !!row.can_delete,
    createdAt: row.created_at,
  };
}

/**
 * The single gateway to the policy database — every read/write of grants and the
 * mode goes through here, so SQL lives in exactly one place (repository pattern).
 * Construct against a file path in production, or `:memory:` in tests (no real
 * filesystem touched). WAL mode lets the MCP server and the admin console share
 * the same file concurrently.
 */
export class PolicyStore {
  private readonly db: DatabaseSync;

  constructor(location: string) {
    const DatabaseSync = loadDatabaseSync();
    this.db = new DatabaseSync(location);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SCHEMA);
  }

  /** Open (creating if needed) the policy database at `location`. */
  static open(location: string): PolicyStore {
    return new PolicyStore(location);
  }

  close(): void {
    this.db.close();
  }

  // ── Mode ──────────────────────────────────────────────────────────────────

  /** The current policy mode, falling back to the configured default. */
  getMode(): PolicyMode {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'mode'").get() as
      | { value: string }
      | undefined;
    const value = row?.value ?? DEFAULT_POLICY_MODE;
    return VALID_MODES.has(value) ? (value as PolicyMode) : "read_open";
  }

  setMode(mode: PolicyMode): void {
    this.db
      .prepare(
        "INSERT INTO settings(key, value) VALUES('mode', ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(mode);
  }

  // ── Grants ──────────────────────────────────────────────────────────────────

  listGrants(): Grant[] {
    const rows = this.db
      .prepare("SELECT * FROM grants ORDER BY created_at DESC, id DESC")
      .all() as unknown as GrantRow[];
    return rows.map(rowToGrant);
  }

  /** Look up a grant by its Google resource id (the hot path for the guard). */
  getGrant(googleId: string): Grant | undefined {
    const row = this.db.prepare("SELECT * FROM grants WHERE google_id = ?").get(googleId) as
      | GrantRow
      | undefined;
    return row ? rowToGrant(row) : undefined;
  }

  getGrantById(id: number): Grant | undefined {
    const row = this.db.prepare("SELECT * FROM grants WHERE id = ?").get(id) as GrantRow | undefined;
    return row ? rowToGrant(row) : undefined;
  }

  /**
   * Insert a grant, or update the permissions of an existing one with the same
   * Google id (its original `created_at` and `id` are preserved). Returns the
   * stored grant.
   */
  upsertGrant(input: GrantInput): Grant {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO grants(kind, google_id, name, can_read, can_write, can_delete, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(google_id) DO UPDATE SET
           kind       = excluded.kind,
           name       = COALESCE(excluded.name, grants.name),
           can_read   = excluded.can_read,
           can_write  = excluded.can_write,
           can_delete = excluded.can_delete`,
      )
      .run(
        input.kind,
        input.googleId,
        input.name ?? null,
        input.canRead ? 1 : 0,
        input.canWrite ? 1 : 0,
        input.canDelete ? 1 : 0,
        now,
      );
    // SAFETY: the row exists by google_id immediately after the upsert above.
    return this.getGrant(input.googleId) as Grant;
  }

  /** Apply a partial update; returns the updated grant, or undefined if absent. */
  updateGrant(id: number, patch: GrantPatch): Grant | undefined {
    const current = this.getGrantById(id);
    if (!current) return undefined;
    const next: Grant = {
      ...current,
      name: patch.name !== undefined ? patch.name : current.name,
      canRead: patch.canRead ?? current.canRead,
      canWrite: patch.canWrite ?? current.canWrite,
      canDelete: patch.canDelete ?? current.canDelete,
    };
    this.db
      .prepare("UPDATE grants SET name = ?, can_read = ?, can_write = ?, can_delete = ? WHERE id = ?")
      .run(next.name, next.canRead ? 1 : 0, next.canWrite ? 1 : 0, next.canDelete ? 1 : 0, id);
    return next;
  }

  /** Delete a grant by id; returns whether a row was removed. */
  deleteGrant(id: number): boolean {
    const result = this.db.prepare("DELETE FROM grants WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
