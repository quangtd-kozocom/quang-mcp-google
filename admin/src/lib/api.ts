import type {
  DriveItem,
  Grant,
  GrantPatch,
  Health,
  Mode,
  NewGrant,
} from "./types";

/**
 * Single typed API client for the Terra Gate permission gate.
 *
 * Every call hits the same-origin `/api/*` backend. If a request fails for any
 * reason (most commonly: running `vite` with no backend on :4717), the client
 * transparently falls back to an in-memory demo store so the whole UI still
 * renders and is fully demoable. The fallback is isolated below in `demo` and
 * mutations against it update the in-memory state so the UI feels live.
 */

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// In-memory demo fallback (only used when the real backend is unreachable).
// ---------------------------------------------------------------------------
const demo = (() => {
  let mode: Mode = "read_open";
  let nextId = 4;
  let grants: Grant[] = [
    {
      id: 1,
      kind: "folder",
      googleId: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456",
      name: "Q3 Financial Reports",
      canRead: true,
      canWrite: true,
      canDelete: false,
      createdAt: "2026-05-28T09:12:00.000Z",
    },
    {
      id: 2,
      kind: "spreadsheet",
      googleId: "1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210",
      name: "Agent Activity Ledger",
      canRead: true,
      canWrite: true,
      canDelete: true,
      createdAt: "2026-06-01T14:40:00.000Z",
    },
    {
      id: 3,
      kind: "file",
      googleId: "1mNbVcXzAsDfGhJkLqWeRtYuIoP098765432",
      name: "Brand Guidelines.pdf",
      canRead: true,
      canWrite: false,
      canDelete: false,
      createdAt: "2026-06-07T08:05:00.000Z",
    },
  ];

  const driveCorpus: DriveItem[] = [
    { id: "1folderMarketing0000000000000000000", name: "Marketing Assets", mimeType: "application/vnd.google-apps.folder", kind: "folder" },
    { id: "1sheetBudget000000000000000000000000", name: "2026 Budget Master", mimeType: "application/vnd.google-apps.spreadsheet", kind: "spreadsheet" },
    { id: "1sheetRoadmap00000000000000000000000", name: "Product Roadmap", mimeType: "application/vnd.google-apps.spreadsheet", kind: "spreadsheet" },
    { id: "1docOnboarding0000000000000000000000", name: "Onboarding Handbook", mimeType: "application/vnd.google-apps.document", kind: "file" },
    { id: "1folderLegal00000000000000000000000", name: "Legal & Contracts", mimeType: "application/vnd.google-apps.folder", kind: "folder" },
    { id: "1fileDeck000000000000000000000000000", name: "Investor Deck.pptx", mimeType: "application/vnd.ms-powerpoint", kind: "file" },
  ];

  return {
    health(): Health {
      return { ok: true, mode, signedIn: true, email: "demo@kozo-japan.com", name: "Demo User" };
    },
    grants(): Grant[] {
      return grants.slice();
    },
    addGrant(body: NewGrant): Grant {
      const existing = grants.find((g) => g.googleId === body.googleId);
      if (existing) {
        Object.assign(existing, body, { name: body.name ?? existing.name });
        return existing;
      }
      const grant: Grant = {
        id: nextId++,
        kind: body.kind,
        googleId: body.googleId,
        name: body.name ?? null,
        canRead: body.canRead,
        canWrite: body.canWrite,
        canDelete: body.canDelete,
        createdAt: new Date().toISOString(),
      };
      grants = [grant, ...grants];
      return grant;
    },
    patchGrant(id: number, patch: GrantPatch): Grant {
      const g = grants.find((x) => x.id === id);
      if (!g) throw new Error("not found");
      Object.assign(g, patch);
      return g;
    },
    deleteGrant(id: number): void {
      grants = grants.filter((g) => g.id !== id);
    },
    setMode(next: Mode): Mode {
      mode = next;
      return mode;
    },
    search(q: string): DriveItem[] {
      const term = q.trim().toLowerCase();
      if (!term) return driveCorpus.slice(0, 5);
      return driveCorpus.filter((f) => f.name.toLowerCase().includes(term));
    },
  };
})();

let usingFallback = false;
export function isUsingFallback(): boolean {
  return usingFallback;
}

async function withFallback<T>(live: () => Promise<T>, fake: () => T): Promise<T> {
  try {
    const out = await live();
    usingFallback = false;
    return out;
  } catch {
    usingFallback = true;
    return fake();
  }
}

// ---------------------------------------------------------------------------
// Public API surface.
// ---------------------------------------------------------------------------
export const api = {
  getHealth: () =>
    withFallback(
      () => request<Health>("/api/health"),
      () => demo.health(),
    ),

  getGrants: () =>
    withFallback(
      async () => (await request<{ grants: Grant[] }>("/api/grants")).grants,
      () => demo.grants(),
    ),

  addGrant: (body: NewGrant) =>
    withFallback(
      async () =>
        (
          await request<{ grant: Grant }>("/api/grants", {
            method: "POST",
            body: JSON.stringify(body),
          })
        ).grant,
      () => demo.addGrant(body),
    ),

  patchGrant: (id: number, patch: GrantPatch) =>
    withFallback(
      async () =>
        (
          await request<{ grant: Grant }>(`/api/grants/${id}`, {
            method: "PATCH",
            body: JSON.stringify(patch),
          })
        ).grant,
      () => demo.patchGrant(id, patch),
    ),

  deleteGrant: (id: number) =>
    withFallback(
      async () => {
        await request<{ ok: true }>(`/api/grants/${id}`, { method: "DELETE" });
      },
      () => demo.deleteGrant(id),
    ),

  setMode: (mode: Mode) =>
    withFallback(
      async () =>
        (
          await request<{ mode: Mode }>("/api/mode", {
            method: "PUT",
            body: JSON.stringify({ mode }),
          })
        ).mode,
      () => demo.setMode(mode),
    ),

  searchDrive: (q: string) =>
    withFallback(
      async () =>
        (
          await request<{ files: DriveItem[] }>(
            `/api/drive/search?q=${encodeURIComponent(q)}`,
          )
        ).files,
      () => demo.search(q),
    ),
};
