import type { Grant } from "../lib/types";
import { GrantRow } from "./GrantRow";
import { EmptyVault } from "./icons";

type PermKey = "canRead" | "canWrite" | "canDelete";

export function GrantsTable({
  grants,
  onToggle,
  onRevoke,
}: {
  grants: Grant[];
  onToggle: (id: number, key: PermKey, next: boolean) => void;
  onRevoke: (id: number) => void;
}) {
  return (
    <section className="panel" aria-labelledby="allowlist-head">
      <div className="panel-head">
        <h2 id="allowlist-head">The Allowlist</h2>
        <span className="count">
          {grants.length} {grants.length === 1 ? "grant" : "grants"}
        </span>
      </div>

      <div className="table-wrap">
        {grants.length === 0 ? (
          <div className="empty">
            <div className="vault-ill">
              <EmptyVault />
            </div>
            <h3>The vault is sealed</h3>
            <p>
              No resources are granted yet. In <strong>read-open</strong> and{" "}
              <strong>strict</strong> mode the agent cannot write to — or even see — anything
              in your Drive until you add it here. Grant your first file, folder or
              spreadsheet below.
            </p>
            <div className="arrow">↓ add your first grant</div>
          </div>
        ) : (
          <table className="grants">
            <thead>
              <tr>
                <th scope="col">Resource</th>
                <th scope="col">Kind</th>
                <th scope="col">Google ID</th>
                <th scope="col">Permissions</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <GrantRow key={g.id} grant={g} onToggle={onToggle} onRevoke={onRevoke} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
