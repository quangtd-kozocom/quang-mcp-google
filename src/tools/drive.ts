import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { drive_v3 } from "googleapis";
import { DriveFileAdapter } from "../drive-adapter.js";
import {
  errorResult,
  formatResponse,
  responseFormatSchema,
  type ResponseFormatValue,
  type ToolResult,
  toolResult,
} from "../format.js";
import { type ArgsOf, driveTool, registerAll, type ToolRegistration } from "./define.js";

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
  const output = {
    count: result.files.length,
    files: result.files,
    next_page_token: result.nextPageToken,
  };
  const text = renderFiles(result.files, args.response_format, `Drive files (${result.files.length})`, {
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
  run: driveGetFile,
});

const downloadFileInput = {
  file_id: z.string().min(1),
  export_mime_type: z.string().optional(),
  save_path: z.string().optional().describe("Local path to write the downloaded bytes"),
};

export async function driveDownloadFile(
  drive: drive_v3.Drive,
  args: ArgsOf<typeof downloadFileInput>,
): Promise<ToolResult> {
  const download = await new DriveFileAdapter(drive).downloadFile({
    fileId: args.file_id,
    exportMimeType: args.export_mime_type,
    savePath: args.save_path,
  });
  if (download.savedTo) {
    return toolResult(
      `Downloaded "${download.name}" (${download.bytes} bytes, ${download.mimeType}) to ${download.savedTo}`,
      { file_id: args.file_id, saved_to: download.savedTo, bytes: download.bytes, mime_type: download.mimeType },
    );
  }
  if (download.binaryRequiresSavePath) {
    return errorResult(
      `Error: "${download.name}" is binary (${download.mimeType}). Provide save_path to write it to disk, ` +
        `or set export_mime_type to a text format (e.g. text/csv, text/plain) for Google files.`,
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
  - export_mime_type (string, optional): for Google-native files, e.g. 'text/csv', 'text/plain',
    'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'.
    Defaults: Sheets→text/csv, Docs→text/plain, Slides→application/pdf.
  - save_path (string, optional): write bytes to this local path. Required for binary content;
    if omitted, only text content is returned inline.

Returns (text content inline) or { file_id, saved_to, bytes, mime_type } when saved to disk.`,
  inputSchema: downloadFileInput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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
  run: driveCreateFolder,
});

const uploadFileInput = {
  name: z.string().min(1),
  content: z.string().optional(),
  local_path: z.string().optional(),
  mime_type: z.string().optional(),
  parent_id: z.string().optional(),
};

export async function driveUploadFile(
  drive: drive_v3.Drive,
  args: ArgsOf<typeof uploadFileInput>,
): Promise<ToolResult> {
  if (!args.content && !args.local_path) {
    return errorResult("Error: provide either 'content' (inline text) or 'local_path' to upload.");
  }
  const file = await new DriveFileAdapter(drive).uploadFile({
    name: args.name,
    content: args.content,
    localPath: args.local_path,
    mimeType: args.mime_type,
    parentId: args.parent_id,
  });
  return toolResult(`Uploaded "${file.name}" (${file.id})`, { file });
}

const uploadFileTool = driveTool({
  name: "drive_upload_file",
  title: "Upload file to Drive",
  description: `Create a new Drive file from inline text or a local file path.

Args:
  - name (string): file name to create
  - content (string, optional): inline text content
  - local_path (string, optional): path to a local file to upload (takes precedence)
  - mime_type (string, optional): e.g. 'text/plain', 'text/csv', 'application/pdf' (default octet-stream)
  - parent_id (string, optional): destination folder ID

Provide exactly one of content/local_path. Returns: { file: {id, name, ...} }`,
  inputSchema: uploadFileInput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
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
  run: driveDeleteFile,
});

const shareFileInput = {
  file_id: z.string().min(1),
  role: z
    .enum(["reader", "commenter", "writer", "fileOrganizer", "organizer", "owner"])
    .describe("Permission role"),
  type: z.enum(["user", "group", "domain", "anyone"]).default("user"),
  email_address: z.string().optional(),
  domain: z.string().optional(),
  send_notification: z.boolean().default(true),
  message: z.string().optional(),
};

export async function driveShareFile(
  drive: drive_v3.Drive,
  args: ArgsOf<typeof shareFileInput>,
): Promise<ToolResult> {
  if ((args.type === "user" || args.type === "group") && !args.email_address) {
    return errorResult("Error: email_address is required when type is 'user' or 'group'.");
  }
  if (args.type === "domain" && !args.domain) {
    return errorResult("Error: domain is required when type is 'domain'.");
  }
  const permission = await new DriveFileAdapter(drive).shareFile({
    fileId: args.file_id,
    role: args.role,
    type: args.type,
    emailAddress: args.email_address,
    domain: args.domain,
    sendNotification: args.send_notification,
    message: args.message,
  });
  const target = args.email_address ?? args.domain ?? args.type;
  return toolResult(`Shared file ${args.file_id} as ${args.role} with ${target}.`, {
    file_id: args.file_id,
    permission,
  });
}

const shareFileTool = driveTool({
  name: "drive_share_file",
  title: "Share Drive file",
  description: `Grant a permission on a Drive file (share with a person, group, domain, or anyone).

Args:
  - file_id (string)
  - role ('reader'|'commenter'|'writer'|'fileOrganizer'|'organizer'|'owner')
  - type ('user'|'group'|'domain'|'anyone', default 'user')
  - email_address (string): required for type user/group
  - domain (string): required for type domain
  - send_notification (boolean, default true)
  - message (string, optional): notification email message

Returns: { file_id, permission: {id, role, type, ...} }`,
  inputSchema: shareFileInput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  run: driveShareFile,
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
  shareFileTool,
];

export function registerDriveTools(server: McpServer): void {
  registerAll(server, driveTools);
}
