import { beforeEach, describe, expect, it, vi } from "vitest";
import type { drive_v3 } from "googleapis";

vi.mock("../google.js", () => ({
  getGoogleClients: vi.fn(),
}));

import { getGoogleClients } from "../google.js";
import {
  driveDeleteFile,
  driveDownloadFile,
  driveGetFile,
  driveListFiles,
  driveShareFile,
  registerDriveTools,
} from "./drive.js";

/** Build a fake Drive client whose methods are vi mocks. */
function fakeDrive() {
  return {
    files: {
      list: vi.fn(),
      get: vi.fn(),
      export: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      copy: vi.fn(),
      delete: vi.fn(),
    },
    permissions: { create: vi.fn() },
  };
}

/** Cast a fake to the Drive type for passing into handlers. */
const asDrive = (d: ReturnType<typeof fakeDrive>): drive_v3.Drive => d as unknown as drive_v3.Drive;

beforeEach(() => vi.clearAllMocks());

describe("driveListFiles", () => {
  it("appends trashed filter, passes pagination, and returns next token", async () => {
    const drive = fakeDrive();
    drive.files.list.mockResolvedValue({
      data: { files: [{ id: "1", name: "A", mimeType: "text/plain" }], nextPageToken: "tok" },
    });
    const res = await driveListFiles(asDrive(drive), {
      query: "name contains 'x'",
      page_size: 10,
      include_trashed: false,
      response_format: "json",
    });
    expect(drive.files.list).toHaveBeenCalledWith(
      expect.objectContaining({ q: "name contains 'x' and trashed = false", pageSize: 10 }),
    );
    expect(res.structuredContent).toMatchObject({ count: 1, next_page_token: "tok" });
  });

  it("omits the trashed filter when include_trashed is true", async () => {
    const drive = fakeDrive();
    drive.files.list.mockResolvedValue({ data: { files: [] } });
    await driveListFiles(asDrive(drive), {
      query: "name = 'y'",
      page_size: 5,
      include_trashed: true,
      response_format: "markdown",
    });
    expect(drive.files.list).toHaveBeenCalledWith(expect.objectContaining({ q: "name = 'y'" }));
  });
});

describe("driveGetFile", () => {
  it("returns JSON when requested", async () => {
    const drive = fakeDrive();
    drive.files.get.mockResolvedValue({ data: { id: "1", name: "A" } });
    const res = await driveGetFile(asDrive(drive), { file_id: "1", response_format: "json" });
    expect(res.content[0].text).toContain('"name": "A"');
    expect(res.structuredContent).toEqual({ file: { id: "1", name: "A" } });
  });
});

describe("driveDownloadFile", () => {
  it("exports Google-native files to the default text MIME", async () => {
    const drive = fakeDrive();
    drive.files.get.mockResolvedValue({
      data: { mimeType: "application/vnd.google-apps.spreadsheet", name: "Sheet" },
    });
    drive.files.export.mockResolvedValue({ data: "a,b,c" });
    const res = await driveDownloadFile(asDrive(drive), { file_id: "1" });
    expect(drive.files.export).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "text/csv" }),
      expect.anything(),
    );
    expect(res.content[0].text).toBe("a,b,c");
  });

  it("errors on binary content without a save_path", async () => {
    const drive = fakeDrive();
    drive.files.get
      .mockResolvedValueOnce({ data: { mimeType: "application/pdf", name: "doc.pdf" } })
      .mockResolvedValueOnce({ data: Buffer.from([1, 2, 3]) });
    const res = await driveDownloadFile(asDrive(drive), { file_id: "1" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("save_path");
  });
});

describe("driveDeleteFile", () => {
  it("trashes by default", async () => {
    const drive = fakeDrive();
    drive.files.update.mockResolvedValue({ data: { name: "A", trashed: true } });
    const res = await driveDeleteFile(asDrive(drive), { file_id: "1", permanent: false });
    expect(drive.files.update).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: { trashed: true } }),
    );
    expect(drive.files.delete).not.toHaveBeenCalled();
    expect(res.structuredContent).toMatchObject({ permanent: false });
  });

  it("permanently deletes when requested", async () => {
    const drive = fakeDrive();
    drive.files.delete.mockResolvedValue({});
    const res = await driveDeleteFile(asDrive(drive), { file_id: "1", permanent: true });
    expect(drive.files.delete).toHaveBeenCalledWith(expect.objectContaining({ fileId: "1" }));
    expect(res.structuredContent).toMatchObject({ permanent: true });
  });
});

describe("driveShareFile", () => {
  it("requires an email for user shares", async () => {
    const drive = fakeDrive();
    const res = await driveShareFile(asDrive(drive), {
      file_id: "1",
      role: "reader",
      type: "user",
      send_notification: true,
    });
    expect(res.isError).toBe(true);
    expect(drive.permissions.create).not.toHaveBeenCalled();
  });

  it("creates a permission for a valid user share", async () => {
    const drive = fakeDrive();
    drive.permissions.create.mockResolvedValue({ data: { id: "p1", role: "writer" } });
    const res = await driveShareFile(asDrive(drive), {
      file_id: "1",
      role: "writer",
      type: "user",
      email_address: "a@b.com",
      send_notification: false,
    });
    expect(drive.permissions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({ role: "writer", emailAddress: "a@b.com" }),
      }),
    );
    expect(res.structuredContent).toMatchObject({ permission: { id: "p1" } });
  });
});

describe("auth wrapper", () => {
  it("maps NotAuthenticated into an actionable error result", async () => {
    const { NotAuthenticatedError } = await import("../format.js");
    vi.mocked(getGoogleClients).mockRejectedValue(new NotAuthenticatedError("No saved Google credentials."));
    const handlers: Record<string, (args: unknown) => Promise<{ isError?: boolean; content: { text: string }[] }>> = {};
    const server = {
      registerTool: (name: string, _cfg: unknown, handler: (args: unknown) => Promise<unknown>) => {
        handlers[name] = handler as never;
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerDriveTools(server as any);
    const res = await handlers.drive_get_file({ file_id: "x", response_format: "markdown" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("google_login");
  });
});
