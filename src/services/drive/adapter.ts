import { Readable } from "node:stream";
import type { drive_v3 } from "googleapis";

const DRIVE_FILE_FIELDS =
  "id, name, mimeType, modifiedTime, createdTime, size, parents, trashed, webViewLink, iconLink, owners(displayName, emailAddress)";

const DRIVE_LIST_FIELDS = `nextPageToken, files(${DRIVE_FILE_FIELDS})`;

export interface DriveDownloadResult {
  fileId: string;
  name?: string | null;
  mimeType: string;
  bytes: number;
  content?: string;
  binaryUnsupported: boolean;
}

export class DriveFileAdapter {
  constructor(private readonly drive: drive_v3.Drive) {}

  async listFiles(args: {
    query?: string;
    pageSize: number;
    pageToken?: string;
    orderBy?: string;
    includeTrashed: boolean;
  }): Promise<{ files: drive_v3.Schema$File[]; nextPageToken: string | null }> {
    const q = [args.query, args.includeTrashed ? undefined : "trashed = false"]
      .filter(Boolean)
      .join(" and ");
    const { data } = await this.drive.files.list({
      q: q || undefined,
      pageSize: args.pageSize,
      pageToken: args.pageToken,
      orderBy: args.orderBy,
      fields: DRIVE_LIST_FIELDS,
      spaces: "drive",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    return { files: data.files ?? [], nextPageToken: data.nextPageToken ?? null };
  }

  async getFile(fileId: string): Promise<drive_v3.Schema$File> {
    const { data } = await this.drive.files.get({
      fileId,
      fields: DRIVE_FILE_FIELDS,
      supportsAllDrives: true,
    });
    return data;
  }

  /** Cheap liveness probe: is this file currently in the trash? Throws (404) if it's gone. */
  async getFileTrashed(fileId: string): Promise<{ trashed: boolean }> {
    const { data } = await this.drive.files.get({
      fileId,
      fields: "trashed",
      supportsAllDrives: true,
    });
    return { trashed: data.trashed === true };
  }

  async downloadFile(args: {
    fileId: string;
    exportMimeType?: string;
  }): Promise<DriveDownloadResult> {
    const meta = await this.drive.files.get({
      fileId: args.fileId,
      fields: "id, name, mimeType, size",
      supportsAllDrives: true,
    });
    const native = isGoogleNative(meta.data.mimeType);
    const exportMime = native
      ? (args.exportMimeType ?? defaultExportMime(meta.data.mimeType ?? ""))
      : undefined;
    const res = native
      ? await this.drive.files.export(
          { fileId: args.fileId, mimeType: exportMime as string },
          { responseType: "arraybuffer" },
        )
      : await this.drive.files.get(
          { fileId: args.fileId, alt: "media", supportsAllDrives: true },
          { responseType: "arraybuffer" },
        );
    const buffer = Buffer.from(res.data as ArrayBuffer);
    const mimeType = native ? (exportMime as string) : (meta.data.mimeType ?? "application/octet-stream");
    if (!isTextMime(mimeType)) {
      return {
        fileId: args.fileId,
        name: meta.data.name,
        mimeType,
        bytes: buffer.byteLength,
        binaryUnsupported: true,
      };
    }
    return {
      fileId: args.fileId,
      name: meta.data.name,
      mimeType,
      bytes: buffer.byteLength,
      content: buffer.toString("utf8"),
      binaryUnsupported: false,
    };
  }

  async createFolder(args: { name: string; parentId?: string }): Promise<drive_v3.Schema$File> {
    const { data } = await this.drive.files.create({
      requestBody: {
        name: args.name,
        mimeType: "application/vnd.google-apps.folder",
        ...(args.parentId ? { parents: [args.parentId] } : {}),
      },
      fields: DRIVE_FILE_FIELDS,
      supportsAllDrives: true,
    });
    return data;
  }

  async uploadFile(args: {
    name: string;
    content?: string;
    mimeType?: string;
    parentId?: string;
  }): Promise<drive_v3.Schema$File> {
    const body = Readable.from(args.content ?? "");
    const { data } = await this.drive.files.create({
      requestBody: {
        name: args.name,
        ...(args.parentId ? { parents: [args.parentId] } : {}),
      },
      media: {
        mimeType: args.mimeType ?? "application/octet-stream",
        body,
      },
      fields: DRIVE_FILE_FIELDS,
      supportsAllDrives: true,
    });
    return data;
  }

  async updateFile(args: {
    fileId: string;
    newName?: string;
    addParents?: string;
    removeParents?: string;
    content?: string;
    mimeType?: string;
  }): Promise<drive_v3.Schema$File> {
    const { data } = await this.drive.files.update({
      fileId: args.fileId,
      addParents: args.addParents,
      removeParents: args.removeParents,
      requestBody: args.newName ? { name: args.newName } : {},
      ...(args.content !== undefined
        ? { media: { mimeType: args.mimeType ?? "text/plain", body: Readable.from(args.content) } }
        : {}),
      fields: DRIVE_FILE_FIELDS,
      supportsAllDrives: true,
    });
    return data;
  }

  async copyFile(args: { fileId: string; name?: string; parentId?: string }): Promise<drive_v3.Schema$File> {
    const { data } = await this.drive.files.copy({
      fileId: args.fileId,
      requestBody: {
        ...(args.name ? { name: args.name } : {}),
        ...(args.parentId ? { parents: [args.parentId] } : {}),
      },
      fields: DRIVE_FILE_FIELDS,
      supportsAllDrives: true,
    });
    return data;
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.drive.files.delete({ fileId, supportsAllDrives: true });
  }

  async trashFile(fileId: string): Promise<drive_v3.Schema$File> {
    const { data } = await this.drive.files.update({
      fileId,
      requestBody: { trashed: true },
      fields: "id, name, trashed",
      supportsAllDrives: true,
    });
    return data;
  }
}

function defaultExportMime(mimeType: string): string {
  switch (mimeType) {
    case "application/vnd.google-apps.spreadsheet":
      return "text/csv";
    case "application/vnd.google-apps.document":
      return "text/plain";
    case "application/vnd.google-apps.presentation":
      return "application/pdf";
    default:
      return "application/pdf";
  }
}

function isGoogleNative(mimeType?: string | null): boolean {
  return !!mimeType && mimeType.startsWith("application/vnd.google-apps.");
}

function isTextMime(mimeType: string): boolean {
  return /^(text\/|application\/(json|xml|csv))/.test(mimeType);
}
