import type { AncestorResolver } from "./resolver.js";
import type { PolicyStore } from "./store.js";
import type { Grant, PolicyAction, ResourceKind, Verdict } from "./types.js";

const ALLOW: Verdict = { allowed: true };

type Permission = "read" | "write" | "delete";

function permits(grant: Grant, perm: Permission): boolean {
  return perm === "read" ? grant.canRead : perm === "write" ? grant.canWrite : grant.canDelete;
}

const VERB: Record<Permission, string> = { read: "read", write: "write to", delete: "delete" };

/**
 * The decision-maker for the gate. Pure with respect to its inputs: it reads the
 * allowlist and mode from the injected {@link PolicyStore} and only walks folder
 * ancestry (via the optional {@link AncestorResolver}) when a direct lookup
 * misses. No Google API calls happen on the common "directly granted" path.
 */
export class PolicyEngine {
  constructor(private readonly store: PolicyStore) {}

  /**
   * Decide whether a tool call may proceed. `list` always passes here — list
   * results are narrowed separately by {@link filterReadable} so the agent only
   * ever sees granted resources in strict mode.
   */
  async check(
    req: {
      action: PolicyAction;
      kind: ResourceKind;
      resourceId?: string;
      parentId?: string;
      sourceId?: string;
    },
    resolver?: AncestorResolver,
  ): Promise<Verdict> {
    const mode = this.store.getMode();
    if (mode === "off") return ALLOW;

    switch (req.action) {
      case "list":
        return ALLOW;
      case "read":
        // Reading is unrestricted unless the user has opted into strict mode.
        return mode === "strict" ? this.checkResource(req.resourceId, "read", resolver) : ALLOW;
      case "write":
        return this.checkResource(req.resourceId, "write", resolver);
      case "delete":
        return this.checkResource(req.resourceId, "delete", resolver);
      case "create":
        return this.checkCreate(req, resolver, mode === "strict");
    }
  }

  /** Whether a resource is readable — the predicate used to narrow list results. */
  async canRead(resourceId: string, resolver?: AncestorResolver): Promise<boolean> {
    if (this.store.getMode() !== "strict") return true;
    return (await this.checkResource(resourceId, "read", resolver)).allowed;
  }

  private async checkResource(
    resourceId: string | undefined,
    perm: Permission,
    resolver?: AncestorResolver,
  ): Promise<Verdict> {
    if (!resourceId) {
      return deny("Access denied: the policy could not determine which resource this call targets.");
    }
    const direct = this.store.getGrant(resourceId);
    if (direct && permits(direct, perm)) return ALLOW;

    if (resolver) {
      const viaFolder = await resolver.hasGrantedAncestor(resourceId, (folderId) => {
        const folder = this.store.getGrant(folderId);
        return !!folder && permits(folder, perm);
      });
      if (viaFolder) return ALLOW;
    }
    return deny(
      `Access denied: no grant lets the agent ${VERB[perm]} ${resourceId}. ` +
        `Add it (with ${perm} permission) in the terra-mcp admin console, or grant a parent folder.`,
    );
  }

  private async checkCreate(
    req: { parentId?: string; sourceId?: string },
    resolver: AncestorResolver | undefined,
    strict: boolean,
  ): Promise<Verdict> {
    // Off/read_open: creating brand-new resources is always allowed (it can't
    // damage existing data), and the result is auto-granted by the guard.
    if (!strict) return ALLOW;

    if (req.sourceId) {
      const sourceOk = await this.checkResource(req.sourceId, "read", resolver);
      if (!sourceOk.allowed) return sourceOk;
    }
    if (!req.parentId) {
      return deny(
        "Access denied: strict mode does not allow creating resources at the Drive root. " +
          "Grant a folder write permission in the admin console and pass its id as the parent.",
      );
    }
    const parent = this.store.getGrant(req.parentId);
    if (parent && parent.canWrite) return ALLOW;
    if (
      resolver &&
      (await resolver.hasGrantedAncestor(req.parentId, (folderId) => {
        const folder = this.store.getGrant(folderId);
        return !!folder && folder.canWrite;
      }))
    ) {
      return ALLOW;
    }
    return deny(
      `Access denied: the destination folder ${req.parentId} is not granted write access. ` +
        `Grant it (with write) in the terra-mcp admin console.`,
    );
  }
}

function deny(message: string): Verdict {
  return { allowed: false, message };
}
