import { describe, expect, it } from "vitest";
import { PolicyStore } from "./store.js";

const fresh = () => new PolicyStore(":memory:");

const baseGrant = {
  kind: "spreadsheet" as const,
  googleId: "sheet-1",
  name: "Budget",
  canRead: true,
  canWrite: false,
  canDelete: false,
};

describe("PolicyStore mode", () => {
  it("defaults to read_open when nothing is stored", () => {
    expect(fresh().getMode()).toBe("read_open");
  });

  it("persists a set mode", () => {
    const store = fresh();
    store.setMode("strict");
    expect(store.getMode()).toBe("strict");
    store.setMode("off");
    expect(store.getMode()).toBe("off");
  });
});

describe("PolicyStore grants", () => {
  it("inserts and reads back a grant with booleans intact", () => {
    const store = fresh();
    const grant = store.upsertGrant(baseGrant);
    expect(grant).toMatchObject({ googleId: "sheet-1", canRead: true, canWrite: false, canDelete: false });
    expect(grant.id).toBeGreaterThan(0);
    expect(store.getGrant("sheet-1")).toEqual(grant);
  });

  it("upsert updates permissions and preserves id + created_at", () => {
    const store = fresh();
    const first = store.upsertGrant(baseGrant);
    const second = store.upsertGrant({ ...baseGrant, canWrite: true });
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.canWrite).toBe(true);
    expect(store.listGrants()).toHaveLength(1);
  });

  it("updates a subset of fields by id", () => {
    const store = fresh();
    const grant = store.upsertGrant(baseGrant);
    const updated = store.updateGrant(grant.id, { canDelete: true });
    expect(updated).toMatchObject({ canRead: true, canWrite: false, canDelete: true, name: "Budget" });
  });

  it("returns undefined when updating a missing grant", () => {
    expect(fresh().updateGrant(999, { canRead: false })).toBeUndefined();
  });

  it("deletes a grant and reports whether a row was removed", () => {
    const store = fresh();
    const grant = store.upsertGrant(baseGrant);
    expect(store.deleteGrant(grant.id)).toBe(true);
    expect(store.deleteGrant(grant.id)).toBe(false);
    expect(store.getGrant("sheet-1")).toBeUndefined();
  });

  it("lists grants newest-first", () => {
    const store = fresh();
    store.upsertGrant({ ...baseGrant, googleId: "a" });
    store.upsertGrant({ ...baseGrant, googleId: "b" });
    const ids = store.listGrants().map((g) => g.googleId);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(store.listGrants()).toHaveLength(2);
  });
});
