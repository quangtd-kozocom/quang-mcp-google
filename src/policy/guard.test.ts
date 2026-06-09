import { beforeEach, describe, expect, it, vi } from "vitest";

// The resolver lazily imports this only when an ancestor walk is needed; the
// fake returns a parentless file so "not granted" stays "not granted" instead
// of reaching the real Google client.
vi.mock("../google/client.js", () => ({
  getGoogleClients: vi.fn(async () => ({
    drive: { files: { get: vi.fn(async () => ({ data: { parents: [] } })) } },
  })),
}));

import { filterVisibleFiles, guardedRun, setPolicyStore } from "./guard.js";
import { PolicyStore } from "./store.js";
import type { ToolPolicy } from "./types.js";
import type { ToolResult } from "../core/result.js";

let store: PolicyStore;
beforeEach(() => {
  store = new PolicyStore(":memory:");
  setPolicyStore(store);
});

const okResult = (structured?: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text: "ok" }],
  ...(structured ? { structuredContent: structured } : {}),
});

describe("guardedRun", () => {
  it("runs straight through when the tool has no policy", async () => {
    const run = vi.fn(async () => okResult());
    await guardedRun(undefined, {}, run);
    expect(run).toHaveBeenCalledOnce();
  });

  it("blocks a write to an ungranted resource without running the tool", async () => {
    const run = vi.fn(async () => okResult());
    const policy: ToolPolicy = { action: "write", kind: "file", idArg: "file_id" };
    const res = await guardedRun(policy, { file_id: "x" }, run);
    expect(res.isError).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it("allows a write once the resource is granted", async () => {
    store.upsertGrant({ kind: "file", googleId: "x", canRead: true, canWrite: true, canDelete: false });
    const run = vi.fn(async () => okResult());
    const policy: ToolPolicy = { action: "write", kind: "file", idArg: "file_id" };
    const res = await guardedRun(policy, { file_id: "x" }, run);
    expect(res.isError).toBeUndefined();
    expect(run).toHaveBeenCalledOnce();
  });

  it("auto-grants a resource created by a create tool", async () => {
    const policy: ToolPolicy = {
      action: "create",
      kind: "spreadsheet",
      newResourceId: (s) => (typeof s.spreadsheet_id === "string" ? s.spreadsheet_id : undefined),
      newResourceName: (s) => (typeof s.title === "string" ? s.title : undefined),
    };
    const run = vi.fn(async () => okResult({ spreadsheet_id: "new-1", title: "Fresh" }));
    await guardedRun(policy, {}, run);
    const grant = store.getGrant("new-1");
    expect(grant).toMatchObject({ name: "Fresh", canRead: true, canWrite: true, canDelete: true });
  });

  it("does not auto-grant when the create tool errored", async () => {
    const policy: ToolPolicy = {
      action: "create",
      kind: "spreadsheet",
      newResourceId: (s) => (typeof s.spreadsheet_id === "string" ? s.spreadsheet_id : undefined),
    };
    const run = vi.fn(async () => ({ ...okResult({ spreadsheet_id: "n" }), isError: true }));
    await guardedRun(policy, {}, run);
    expect(store.getGrant("n")).toBeUndefined();
  });
});

describe("filterVisibleFiles", () => {
  it("returns every file outside strict mode", async () => {
    store.setMode("read_open");
    const files = [{ id: "a" }, { id: "b" }];
    expect(await filterVisibleFiles(files)).toEqual(files);
  });

  it("keeps only granted (or folder-covered) files in strict mode", async () => {
    store.setMode("strict");
    store.upsertGrant({ kind: "file", googleId: "a", canRead: true, canWrite: false, canDelete: false });
    const visible = await filterVisibleFiles([{ id: "a" }, { id: "b" }]);
    expect(visible).toEqual([{ id: "a" }]);
  });
});
