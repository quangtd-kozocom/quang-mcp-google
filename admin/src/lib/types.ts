export type Mode = "off" | "read_open" | "strict";
export type Kind = "file" | "folder" | "spreadsheet";

/** Live status of a grant's target in Drive (resolved server-side on list). */
export type GrantStatus = "active" | "trashed" | "missing" | "unknown";

export interface Grant {
  id: number;
  kind: Kind;
  googleId: string;
  name: string | null;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  createdAt: string;
  /** Absent on older payloads / demo data; treated as `active`. */
  status?: GrantStatus;
}

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  kind: Kind;
}

export interface Health {
  ok: true;
  mode: Mode;
  signedIn: boolean;
  email: string | null;
  name: string | null;
}

export interface NewGrant {
  kind: Kind;
  googleId: string;
  name?: string;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
}

export interface GrantPatch {
  name?: string;
  canRead?: boolean;
  canWrite?: boolean;
  canDelete?: boolean;
}
