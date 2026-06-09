import type { drive_v3 } from "googleapis";

/**
 * Resolves a resource's folder ancestry so a grant on a folder can cascade to
 * everything inside it. The Drive client is fetched lazily (only when a check
 * actually misses the direct allowlist) and parent lookups are memoized for the
 * lifetime of the instance, so a list of files sharing folders costs one lookup
 * per distinct folder, not per file.
 */
export interface AncestorResolver {
  /** True if any ancestor folder of `id` satisfies the `granted` predicate. */
  hasGrantedAncestor(id: string, granted: (folderId: string) => boolean): Promise<boolean>;
}

export class DriveAncestorResolver implements AncestorResolver {
  private drive?: drive_v3.Drive;
  private readonly parentCache = new Map<string, string[]>();

  /**
   * @param getDrive  builds (or returns a cached) authorized Drive client; only
   *                  invoked the first time an ancestor walk is needed.
   * @param maxLookups hard ceiling on Drive metadata calls per instance — a
   *                  backstop against pathological trees / cycles.
   */
  constructor(
    private readonly getDrive: () => Promise<drive_v3.Drive>,
    private readonly maxLookups = 200,
  ) {}

  private async parentsOf(id: string): Promise<string[]> {
    const cached = this.parentCache.get(id);
    if (cached) return cached;
    const drive = (this.drive ??= await this.getDrive());
    const { data } = await drive.files.get({ fileId: id, fields: "parents", supportsAllDrives: true });
    const parents = data.parents ?? [];
    this.parentCache.set(id, parents);
    return parents;
  }

  async hasGrantedAncestor(id: string, granted: (folderId: string) => boolean): Promise<boolean> {
    const visited = new Set<string>([id]);
    let level = await this.parentsOf(id);
    let lookups = 0;
    while (level.length > 0 && lookups < this.maxLookups) {
      const fresh = level.filter((folderId) => !visited.has(folderId));
      for (const folderId of fresh) visited.add(folderId);
      if (fresh.some(granted)) return true;
      lookups += fresh.length;
      // BFS advances one folder-level per iteration; parents within a level are
      // fetched together, so the only await here is a single parallel batch.
      // eslint-disable-next-line no-await-in-loop
      const parents = await Promise.all(fresh.map((folderId) => this.parentsOf(folderId)));
      level = parents.flat();
    }
    return false;
  }
}
