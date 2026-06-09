import { describe, expect, it } from "vitest";
import { PolicyEngine } from "./engine.js";
import { PolicyStore } from "./store.js";
import type { AncestorResolver } from "./resolver.js";
import type { PolicyMode } from "./types.js";

/** Resolver driven by a fixed child→parents map (no Drive calls). */
class FakeResolver implements AncestorResolver {
  constructor(private readonly parents: Record<string, string[]>) {}
  async hasGrantedAncestor(id: string, granted: (folderId: string) => boolean): Promise<boolean> {
    const seen = new Set<string>();
    const queue = [...(this.parents[id] ?? [])];
    while (queue.length) {
      const folder = queue.shift() as string;
      if (seen.has(folder)) continue;
      seen.add(folder);
      if (granted(folder)) return true;
      queue.push(...(this.parents[folder] ?? []));
    }
    return false;
  }
}

function engineWith(mode: PolicyMode): { engine: PolicyEngine; store: PolicyStore } {
  const store = new PolicyStore(":memory:");
  store.setMode(mode);
  return { engine: new PolicyEngine(store), store };
}

describe("PolicyEngine — off mode", () => {
  it("allows everything", async () => {
    const { engine } = engineWith("off");
    const actions = ["read", "write", "delete", "create"] as const;
    const verdicts = await Promise.all(
      actions.map((action) => engine.check({ action, kind: "file", resourceId: "x" })),
    );
    expect(verdicts.every((v) => v.allowed)).toBe(true);
  });
});

describe("PolicyEngine — read_open mode", () => {
  it("allows reads without any grant", async () => {
    const { engine } = engineWith("read_open");
    expect((await engine.check({ action: "read", kind: "file", resourceId: "x" })).allowed).toBe(true);
  });

  it("denies writes to ungranted resources but allows granted ones", async () => {
    const { engine, store } = engineWith("read_open");
    expect((await engine.check({ action: "write", kind: "file", resourceId: "x" })).allowed).toBe(false);
    store.upsertGrant({ kind: "file", googleId: "x", canRead: true, canWrite: true, canDelete: false });
    expect((await engine.check({ action: "write", kind: "file", resourceId: "x" })).allowed).toBe(true);
  });

  it("requires the delete permission specifically", async () => {
    const { engine, store } = engineWith("read_open");
    store.upsertGrant({ kind: "file", googleId: "x", canRead: true, canWrite: true, canDelete: false });
    expect((await engine.check({ action: "delete", kind: "file", resourceId: "x" })).allowed).toBe(false);
    store.upsertGrant({ kind: "file", googleId: "x", canRead: true, canWrite: true, canDelete: true });
    expect((await engine.check({ action: "delete", kind: "file", resourceId: "x" })).allowed).toBe(true);
  });

  it("cascades a folder grant to files inside it", async () => {
    const { engine, store } = engineWith("read_open");
    store.upsertGrant({ kind: "folder", googleId: "F", canRead: true, canWrite: true, canDelete: false });
    const resolver = new FakeResolver({ child: ["F"] });
    expect((await engine.check({ action: "write", kind: "file", resourceId: "child" }, resolver)).allowed).toBe(true);
  });

  it("allows creating new resources freely", async () => {
    const { engine } = engineWith("read_open");
    expect((await engine.check({ action: "create", kind: "spreadsheet" })).allowed).toBe(true);
  });
});

describe("PolicyEngine — strict mode", () => {
  it("denies reads without a grant, allows with one", async () => {
    const { engine, store } = engineWith("strict");
    expect((await engine.check({ action: "read", kind: "file", resourceId: "x" })).allowed).toBe(false);
    store.upsertGrant({ kind: "file", googleId: "x", canRead: true, canWrite: false, canDelete: false });
    expect((await engine.check({ action: "read", kind: "file", resourceId: "x" })).allowed).toBe(true);
  });

  it("canRead reflects strict-mode visibility for list filtering", async () => {
    const { engine, store } = engineWith("strict");
    expect(await engine.canRead("x")).toBe(false);
    store.upsertGrant({ kind: "file", googleId: "x", canRead: true, canWrite: false, canDelete: false });
    expect(await engine.canRead("x")).toBe(true);
  });

  it("denies create at the root (no parent) and allows it inside a write-granted folder", async () => {
    const { engine, store } = engineWith("strict");
    expect((await engine.check({ action: "create", kind: "spreadsheet" })).allowed).toBe(false);
    expect((await engine.check({ action: "create", kind: "file", parentId: "F" })).allowed).toBe(false);
    store.upsertGrant({ kind: "folder", googleId: "F", canRead: true, canWrite: true, canDelete: false });
    expect((await engine.check({ action: "create", kind: "file", parentId: "F" })).allowed).toBe(true);
  });

  it("requires the copy source to be readable", async () => {
    const { engine, store } = engineWith("strict");
    store.upsertGrant({ kind: "folder", googleId: "F", canRead: true, canWrite: true, canDelete: false });
    // Destination granted, source not → denied on the source read check.
    expect(
      (await engine.check({ action: "create", kind: "file", parentId: "F", sourceId: "src" })).allowed,
    ).toBe(false);
    store.upsertGrant({ kind: "file", googleId: "src", canRead: true, canWrite: false, canDelete: false });
    expect(
      (await engine.check({ action: "create", kind: "file", parentId: "F", sourceId: "src" })).allowed,
    ).toBe(true);
  });

  it("returns an actionable message on denial", async () => {
    const { engine } = engineWith("strict");
    const verdict = await engine.check({ action: "write", kind: "file", resourceId: "abc" });
    expect(verdict.allowed).toBe(false);
    expect(verdict.message).toContain("abc");
    expect(verdict.message).toContain("admin console");
  });
});
