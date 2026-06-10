import { z } from "zod";
import type { drive_v3 } from "googleapis";
import { DriveFileAdapter } from "./adapter.js";
import {
  errorResult,
  formatResponse,
  responseFormatSchema,
  type ResponseFormatValue,
  type ToolResult,
  toolResult,
} from "../../core/result.js";
import { type ArgsOf, driveTool, type ToolRegistration } from "../../core/tool.js";
import { filterVisibleFiles } from "../../policy/guard.js";

// ── Markdown rendering ────────────────────────────────────────────────────────

function formatFileMarkdown(f: drive_v3.Schema$File): string {
  const lines = [`## ${f.name ?? "(untitled)"} (${f.id})`];
  lines.push(`- **Type**: ${f.mimeType ?? "unknown"}`);
  if (f.size) lines.push(`- **Size**: ${f.size} bytes`);
  if (f.modifiedTime) lines.push(`- **Modified**: ${f.modifiedTime}`);
  if (f.owners?.length) {
    lines.push(`- **Owner**: ${f.owners.map((o) => o.displayName ?? o.emailAddress).join(", ")}`);
  }
  if (f.trashed) lines.push(`- **Trashed**: yes`);
  if (f.webViewLink) lines.push(`- **Link**: ${f.webViewLink}`);
  return lines.join("\n");
}

function renderFiles(
  files: drive_v3.Schema$File[],
  format: ResponseFormatValue,
  header: string,
  extra: Record<string, unknown> = {},
): string {
  return formatResponse(format, { ...extra, count: files.length, files }, () => {
    if (!files.length) return `${header}\n\n(no files)`;
    return [`# ${header}`, "", ...files.map(formatFileMarkdown)].join("\n\n");
  });
}

// ── Policy helpers ────────────────────────────────────────────────────────────
// A created Drive file is returned under `structuredContent.file`; these pull
// its id/name so the guard can auto-grant it after a successful create.

function createdFileId(structured: Record<string, unknown>): string | undefined {
  const file = structured.file as { id?: unknown } | undefined;
  return typeof file?.id === "string" ? file.id : undefined;
}

function createdFileName(structured: Record<string, unknown>): string | undefined {
  const file = structured.file as { name?: unknown } | undefined;
  return typeof file?.name === "string" ? file.name : undefined;
}

// ── Tools ─────────────────────────────────────────────────────────────────────
// Each tool: input schema → exported pure handler (unit-tested directly) →
// registration. The handler's arg type derives from the schema, so the schema
// is the single source of truth.

const listFilesInput = {
  query: z.string().optional().describe("Drive 'q' search expression"),
  page_size: z.number().int().min(1).max(100).default(25),
  page_token: z.string().optional(),
  order_by: z.string().optional().describe("e.g. 'modifiedTime desc'"),
  include_trashed: z.boolean().default(false),
  response_format: responseFormatSchema,
};

export async function driveListFiles(
  drive: drive_v3.Drive,
  args: ArgsOf<typeof listFilesInput>,
): Promise<ToolResult> {
  const result = await new DriveFileAdapter(drive).listFiles({
    query: args.query,
    pageSize: args.page_size,
    pageToken: args.page_token,
    orderBy: args.order_by,
    includeTrashed: args.include_trashed,
  });
  // In strict mode this drops files outside the allowlist so search can't leak
  // resources the agent isn't permitted to see; otherwise it returns them all.
  const files = await filterVisibleFiles(result.files);
  const output = {
    count: files.length,
    files,
    next_page_token: result.nextPageToken,
  };
  const text = renderFiles(files, args.response_format, `Drive files (${files.length})`, {
    next_page_token: result.nextPageToken,
  });
  return toolResult(text, output);
}

const listFilesTool = driveTool({
  name: "drive_list_files",
  title: "List / search Drive files",
  description: `List or search files and folders in Google Drive.

Args:
  - query (string, optional): Drive search query (the 'q' parameter). Examples:
      name contains 'budget'
      mimeType = 'application/vnd.google-apps.spreadsheet'
      '<folderId>' in parents
      fullText contains 'quarterly report'
      modifiedTime > '2024-01-01T00:00:00'
    Combine with 'and'/'or'. Omit to list recent files.
  - page_size (number 1-100, default 25)
  - page_token (string, optional): from a previous response's next_page_token
  - order_by (string, optional): e.g. 'modifiedTime desc', 'name'
  - include_trashed (boolean, default false)
  - response_format ('markdown'|'json', default markdown)

Returns: { count, files:[{id,name,mimeType,modifiedTime,size,parents,webViewLink,owners}], next_page_token }`,
  inputSchema: listFilesInput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  policy: { action: "list", kind: "file" },
  run: driveListFiles,
});

const getFileInput = {
  file_id: z.string().min(1).describe("Drive file ID"),
  response_format: responseFormatSchema,
};

export async function driveGetFile(
  drive: drive_v3.Drive,
  args: ArgsOf<typeof getFileInput>,
): Promise<ToolResult> {
  const file = await new DriveFileAdapter(drive).getFile(args.file_id);
  const text = formatResponse(args.response_format, file, () => formatFileMarkdown(file));
  return toolResult(text, { file });
}

const getFileTool = driveTool({
  name: "drive_get_file",
  title: "Get Drive file metadata",
  description: `Get metadata for a single Drive file or folder by ID.

Args:
  - file_id (string): the Drive file ID
  - response_format ('markdown'|'json', default markdown)

Returns: { file: {id,name,mimeType,size,modifiedTime,parents,owners,webViewLink,...} }`,
  inputSchema: getFileInput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  policy: { action: "read", kind: "file", idArg: "file_id" },
  run: driveGetFile,
});

const downloadFileInput = {
  file_id: z.string().min(1),
  export_mime_type: z.string().optional(),
};

export async function driveDownloadFile(
  drive: drive_v3.Drive,
  args: ArgsOf<typeof downloadFileInput>,
): Promise<ToolResult> {
  const download = await new DriveFileAdapter(drive).downloadFile({
    fileId: args.file_id,
    exportMimeType: args.export_mime_type,
  });
  if (download.binaryUnsupported) {
    return errorResult(
      `Error: "${download.name}" is binary (${download.mimeType}) and can't be returned inline. ` +
        `Set export_mime_type to a text format (e.g. text/csv, text/plain) for Google-native files.`,
    );
  }
  return toolResult(download.content ?? "", {
    file_id: args.file_id,
    name: download.name,
    mime_type: download.mimeType,
    content: download.content,
  });
}

const downloadFileTool = driveTool({
  name: "drive_download_file",
  title: "Download / export Drive file",
  description: `Download a file's content. Google-native files (Docs/Sheets/Slides) are exported.

Args:
  - file_id (string)
  - export_mime_type (string, optional): for Google-native files, e.g. 'text/csv', 'text/plain'.
    Defaults: Sheets→text/csv, Docs→text/plain, Slides→application/pdf.

Returns text content inline. Binary content can't be returned — export Google-native files to a text format.`,
  inputSchema: downloadFileInput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  policy: { action: "read", kind: "file", idArg: "file_id" },
  run: driveDownloadFile,
});

const createFolderInput = {
  name: z.string().min(1),
  parent_id: z.string().optional(),
};

export async function driveCreateFolder(
  drive: drive_v3.Drive,
  args: ArgsOf<typeof createFolderInput>,
): Promise<ToolResult> {
  const file = await new DriveFileAdapter(drive).createFolder({
    name: args.name,
    parentId: args.parent_id,
  });
  return toolResult(`Created folder "${file.name}" (${file.id})`, { file });
}

const createFolderTool = driveTool({
  name: "drive_create_folder",
  title: "Create Drive folder",
  description: `Create a new folder in Drive.

Args:
  - name (string)
  - parent_id (string, optional): parent folder ID; omit for My Drive root

Returns: { file: {id, name, ...} }`,
  inputSchema: createFolderInput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  policy: {
    action: "create",
    kind: "folder",
    parentArg: "parent_id",
    newResourceId: createdFileId,
    newResourceName: createdFileName,
  },
  run: driveCreateFolder,
});

const uploadFileInput = {
  name: z.string().min(1),
  content: z.string().describe("Inline text content of the new file"),
  mime_type: z.string().optional(),
  parent_id: z.string().optional(),
};

export async function driveUploadFile(
  drive: drive_v3.Drive,
  args: ArgsOf<typeof uploadFileInput>,
): Promise<ToolResult> {
  const file = await new DriveFileAdapter(drive).uploadFile({
    name: args.name,
    content: args.content,
    mimeType: args.mime_type,
    parentId: args.parent_id,
  });
  return toolResult(`Uploaded "${file.name}" (${file.id})`, { file });
}

const uploadFileTool = driveTool({
  name: "drive_upload_file",
  title: "Upload file to Drive",
  description: `Create a new Drive file from inline text content.

Args:
  - name (string): file name to create
  - content (string): inline text content
  - mime_type (string, optional): e.g. 'text/plain', 'text/csv' (default octet-stream)
  - parent_id (string, optional): destination folder ID

Returns: { file: {id, name, ...} }`,
  inputSchema: uploadFileInput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  policy: {
    action: "create",
    kind: "file",
    parentArg: "parent_id",
    newResourceId: createdFileId,
    newResourceName: createdFileName,
  },
  run: driveUploadFile,
});

const updateFileInput = {
  file_id: z.string().min(1),
  new_name: z.string().optional(),
  add_parents: z.string().optional(),
  remove_parents: z.string().optional(),
  content: z.string().optional(),
  mime_type: z.string().optional(),
};

export async function driveUpdateFile(
  drive: drive_v3.Drive,
  args: ArgsOf<typeof updateFileInput>,
): Promise<ToolResult> {
  const file = await new DriveFileAdapter(drive).updateFile({
    fileId: args.file_id,
    newName: args.new_name,
    addParents: args.add_parents,
    removeParents: args.remove_parents,
    content: args.content,
    mimeType: args.mime_type,
  });
  return toolResult(`Updated "${file.name}" (${file.id})`, { file });
}

const updateFileTool = driveTool({
  name: "drive_update_file",
  title: "Update / rename / move Drive file",
  description: `Rename, move, and/or replace the content of an existing Drive file.

Args:
  - file_id (string)
  - new_name (string, optional): rename
  - add_parents (string, optional): comma-separated folder IDs to add (move into)
  - remove_parents (string, optional): comma-separated folder IDs to remove
  - content (string, optional): replace file content with this text
  - mime_type (string, optional): MIME for replaced content (default text/plain)

Returns: { file: {id, name, ...} }`,
  inputSchema: updateFileInput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  policy: { action: "write", kind: "file", idArg: "file_id" },
  run: driveUpdateFile,
});

const copyFileInput = {
  file_id: z.string().min(1),
  name: z.string().optional(),
  parent_id: z.string().optional(),
};

export async function driveCopyFile(
  drive: drive_v3.Drive,
  args: ArgsOf<typeof copyFileInput>,
): Promise<ToolResult> {
  const file = await new DriveFileAdapter(drive).copyFile({
    fileId: args.file_id,
    name: args.name,
    parentId: args.parent_id,
  });
  return toolResult(`Copied to "${file.name}" (${file.id})`, { file });
}

const copyFileTool = driveTool({
  name: "drive_copy_file",
  title: "Copy Drive file",
  description: `Duplicate a Drive file.

Args:
  - file_id (string): source file
  - name (string, optional): name for the copy
  - parent_id (string, optional): destination folder

Returns: { file: {id, name, ...} } of the new copy`,
  inputSchema: copyFileInput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  policy: {
    action: "create",
    kind: "file",
    parentArg: "parent_id",
    sourceArg: "file_id",
    newResourceId: createdFileId,
    newResourceName: createdFileName,
  },
  run: driveCopyFile,
});

const deleteFileInput = {
  file_id: z.string().min(1),
  permanent: z.boolean().default(false).describe("Irreversibly delete instead of trashing"),
};

export async function driveDeleteFile(
  drive: drive_v3.Drive,
  args: ArgsOf<typeof deleteFileInput>,
): Promise<ToolResult> {
  const files = new DriveFileAdapter(drive);
  if (args.permanent) {
    await files.deleteFile(args.file_id);
    return toolResult(`Permanently deleted file ${args.file_id}.`, {
      file_id: args.file_id,
      permanent: true,
    });
  }
  const file = await files.trashFile(args.file_id);
  return toolResult(`Moved "${file.name}" (${file.id}) to trash (recoverable).`, {
    file_id: args.file_id,
    permanent: false,
    trashed: file.trashed,
  });
}

const deleteFileTool = driveTool({
  name: "drive_delete_file",
  title: "Delete / trash Drive file",
  description: `Move a Drive file to trash (default, recoverable) or delete it permanently.

Args:
  - file_id (string)
  - permanent (boolean, default false): true = permanent, irreversible delete

Returns: { file_id, permanent, trashed? }`,
  inputSchema: deleteFileInput,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  policy: { action: "delete", kind: "file", idArg: "file_id" },
  run: driveDeleteFile,
});

// ── Registration ────────────────────────────────────────────────────────────

export const driveTools: readonly ToolRegistration[] = [
  listFilesTool,
  getFileTool,
  downloadFileTool,
  createFolderTool,
  uploadFileTool,
  updateFileTool,
  copyFileTool,
  deleteFileTool,
];
