import { afterEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { isPathInsideRoot } from "./local-file.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
});

describe("isPathInsideRoot", () => {
  const root = resolve("/tmp/kozocom-local");

  it("accepts root descendants", () => {
    expect(isPathInsideRoot(resolve(root, "nested/file.txt"), root)).toBe(true);
  });

  it("rejects sibling prefix matches and parent traversal", () => {
    expect(isPathInsideRoot(resolve("/tmp/kozocom-local-evil/file.txt"), root)).toBe(false);
    expect(isPathInsideRoot(resolve(root, "../secret.txt"), root)).toBe(false);
  });

  it("rejects existing write targets that resolve outside the root", async () => {
    vi.stubEnv("KOZOCOM_MCP_LOCAL_FILE_ROOT", "/safe/root");
    vi.resetModules();
    vi.doMock("node:fs/promises", () => ({
      realpath: vi.fn(async (path: string) => {
        if (path === "/safe/root") return "/safe/root";
        if (path === "/safe/root/link") return "/secret/token.json";
        throw Object.assign(new Error("not found"), { code: "ENOENT" });
      }),
    }));
    const { safeWritePath } = await import("./local-file.js");
    await expect(safeWritePath("link")).rejects.toThrow("outside KOZOCOM_MCP_LOCAL_FILE_ROOT");
  });
});
