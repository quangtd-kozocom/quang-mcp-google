import { describe, expect, it, vi } from "vitest";
import { type ApiDeps, cachedFileStatuses, kindOfMime, routeApi } from "./api.js";
import { PolicyStore } from "../policy/store.js";

function deps(over: Partial<ApiDeps> = {}): ApiDeps {
  return {
    store: new PolicyStore(":memory:"),
    searchDrive: vi.fn(async () => [{ id: "f1", name: "Folder", mimeType: "x", kind: "folder" as const }]),
    fileStatuses: vi.fn(async () => ({})),
    authInfo: vi.fn(async () => ({ signedIn: true, email: "me@example.com", name: "Me Example" })),
    ...over,
  };
}

const q = (s = "") => new URLSearchParams(s);
const grantBody = { kind: "file", googleId: "g1", canRead: true, canWrite: false, canDelete: false };

describe("kindOfMime", () => {
  it("maps Google mime types to grant kinds", () => {
    expect(kindOfMime("application/vnd.google-apps.folder")).toBe("folder");
    expect(kindOfMime("application/vnd.google-apps.spreadsheet")).toBe("spreadsheet");
    expect(kindOfMime("application/pdf")).toBe("file");
    expect(kindOfMime(null)).toBe("file");
  });
});

describe("routeApi", () => {
  it("returns null for non-/api paths so the SPA can be served", async () => {
    expect(await routeApi("GET", "/index.html", q(), undefined, deps())).toBeNull();
  });

  it("reports health with mode and auth info", async () => {
    const res = await routeApi("GET", "/api/health", q(), undefined, deps());
    expect(res).toMatchObject({ status: 200, body: { ok: true, mode: "read_open", signedIn: true, email: "me@example.com", name: "Me Example" } });
  });

  it("lists, creates, patches and deletes grants", async () => {
    const d = deps();
    const created = (await routeApi("POST", "/api/grants", q(), grantBody, d))!;
    expect(created.status).toBe(201);
    const id = (created.body as { grant: { id: number } }).grant.id;

    const listed = (await routeApi("GET", "/api/grants", q(), undefined, d))!;
    expect((listed.body as { grants: unknown[] }).grants).toHaveLength(1);

    const patched = (await routeApi("PATCH", `/api/grants/${id}`, q(), { canWrite: true }, d))!;
    expect((patched.body as { grant: { canWrite: boolean } }).grant.canWrite).toBe(true);

    const deleted = await routeApi("DELETE", `/api/grants/${id}`, q(), undefined, d);
    expect(deleted).toMatchObject({ status: 200, body: { ok: true } });
  });

  it("annotates each listed grant with its live Drive status", async () => {
    const fileStatuses = vi.fn(async (ids: string[]) =>
      Object.fromEntries(ids.map((id) => [id, "trashed" as const])),
    );
    const d = deps({ fileStatuses });
    await routeApi("POST", "/api/grants", q(), grantBody, d);

    const listed = (await routeApi("GET", "/api/grants", q(), undefined, d))!;
    expect(fileStatuses).toHaveBeenCalledWith(["g1"]);
    expect((listed.body as { grants: { status: string }[] }).grants[0]?.status).toBe("trashed");
  });

  it("falls back to 'unknown' status when the checker omits an id", async () => {
    const d = deps({ fileStatuses: vi.fn(async () => ({})) });
    await routeApi("POST", "/api/grants", q(), grantBody, d);
    const listed = (await routeApi("GET", "/api/grants", q(), undefined, d))!;
    expect((listed.body as { grants: { status: string }[] }).grants[0]?.status).toBe("unknown");
  });

  it("400s on an invalid grant body", async () => {
    const res = await routeApi("POST", "/api/grants", q(), { googleId: "" }, deps());
    expect(res?.status).toBe(400);
  });

  it("404s when patching or deleting a missing grant", async () => {
    expect((await routeApi("PATCH", "/api/grants/999", q(), { canRead: false }, deps()))?.status).toBe(404);
    expect((await routeApi("DELETE", "/api/grants/999", q(), undefined, deps()))?.status).toBe(404);
  });

  it("sets the policy mode and rejects an invalid one", async () => {
    const d = deps();
    const res = await routeApi("PUT", "/api/mode", q(), { mode: "strict" }, d);
    expect(res).toMatchObject({ status: 200, body: { mode: "strict" } });
    expect(d.store.getMode()).toBe("strict");
    expect((await routeApi("PUT", "/api/mode", q(), { mode: "nonsense" }, d))?.status).toBe(400);
  });

  it("proxies drive search", async () => {
    const search = vi.fn(async () => [{ id: "f1", name: "F", mimeType: "x", kind: "file" as const }]);
    const res = (await routeApi("GET", "/api/drive/search", q("q=budget"), undefined, deps({ searchDrive: search })))!;
    expect(search).toHaveBeenCalledWith("budget");
    expect((res.body as { files: unknown[] }).files).toHaveLength(1);
  });

  it("404s on an unknown /api route", async () => {
    expect((await routeApi("GET", "/api/nope", q(), undefined, deps()))?.status).toBe(404);
  });
});

describe("cachedFileStatuses", () => {
  const ttl = 1000;

  it("serves repeat calls from cache within the TTL", async () => {
    const resolve = vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, "active" as const])));
    let t = 0;
    const cached = cachedFileStatuses(resolve, ttl, () => t);

    expect(await cached(["a", "b"])).toEqual({ a: "active", b: "active" });
    t = 500;
    expect(await cached(["a", "b"])).toEqual({ a: "active", b: "active" });
    expect(resolve).toHaveBeenCalledTimes(1); // second poll hit the cache
  });

  it("re-fetches once the TTL has elapsed", async () => {
    const resolve = vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, "active" as const])));
    let t = 0;
    const cached = cachedFileStatuses(resolve, ttl, () => t);

    await cached(["a"]);
    t = ttl; // exactly at the boundary → stale
    await cached(["a"]);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("only forwards stale/new ids to the resolver", async () => {
    const resolve = vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, "active" as const])));
    let t = 0;
    const cached = cachedFileStatuses(resolve, ttl, () => t);

    await cached(["a"]);
    t = 100;
    await cached(["a", "b"]); // "a" still fresh, only "b" is fetched
    expect(resolve).toHaveBeenNthCalledWith(2, ["b"]);
  });

  it("prunes ids no longer requested so the cache stays bounded", async () => {
    const resolve = vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, "active" as const])));
    let t = 0;
    const cached = cachedFileStatuses(resolve, ttl, () => t);

    await cached(["a", "b"]);
    t = 100;
    await cached(["a"]); // "b" dropped from the grant set → evicted
    t = 200;
    await cached(["b"]); // must be re-fetched, proving it was evicted (not served stale)
    expect(resolve).toHaveBeenLastCalledWith(["b"]);
  });
});
