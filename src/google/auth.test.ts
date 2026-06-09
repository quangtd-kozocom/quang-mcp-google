import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  rm: vi.fn(),
}));

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { clearToken, loadToken, readClientSecret, saveToken } from "./auth.js";
import { TOKEN_PATH } from "../config/constants.js";
import { NotAuthenticatedError } from "../core/result.js";

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);
const mockRm = vi.mocked(rm);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadToken", () => {
  it("returns parsed credentials", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ access_token: "a", refresh_token: "r" }));
    expect(await loadToken()).toEqual({ access_token: "a", refresh_token: "r" });
  });

  it("returns null when no token file exists", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    expect(await loadToken()).toBeNull();
  });
});

describe("saveToken", () => {
  it("creates the config dir and writes JSON with 0600 perms", async () => {
    mockMkdir.mockResolvedValue(undefined as never);
    mockWriteFile.mockResolvedValue();
    await saveToken({ access_token: "a", refresh_token: "r" });
    expect(mockMkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith(
      TOKEN_PATH,
      expect.stringContaining("access_token"),
      { mode: 0o600 },
    );
  });
});

describe("clearToken", () => {
  it("returns true when a token was removed", async () => {
    mockRm.mockResolvedValue();
    expect(await clearToken()).toBe(true);
  });

  it("returns false when nothing to remove", async () => {
    mockRm.mockRejectedValue(new Error("ENOENT"));
    expect(await clearToken()).toBe(false);
  });
});

describe("readClientSecret", () => {
  it("parses a Desktop ('installed') client secret", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({ installed: { client_id: "cid", client_secret: "secret" } }),
    );
    expect(await readClientSecret()).toEqual({ client_id: "cid", client_secret: "secret" });
  });

  it("parses a Web client secret", async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({ web: { client_id: "wid", client_secret: "wsec" } }),
    );
    expect(await readClientSecret()).toEqual({ client_id: "wid", client_secret: "wsec" });
  });

  it("throws NotAuthenticatedError when the file is missing", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    await expect(readClientSecret()).rejects.toBeInstanceOf(NotAuthenticatedError);
  });

  it("throws when client_id/secret are absent", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ installed: {} }));
    await expect(readClientSecret()).rejects.toBeInstanceOf(NotAuthenticatedError);
  });
});
