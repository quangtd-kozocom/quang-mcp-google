export type Mode = "off" | "read_open" | "strict";
export type Kind = "file" | "folder" | "spreadsheet";

export interface Grant {
  id: number;
  kind: Kind;
  googleId: string;
  name: string | null;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  createdAt: string;
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
