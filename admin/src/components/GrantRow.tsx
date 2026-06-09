import { useState } from "react";
import type { Grant } from "../lib/types";
import { formatDate } from "../lib/format";
import { CopyId } from "./CopyId";
import { KindIcon } from "./icons";

type PermKey = "canRead" | "canWrite" | "canDelete";

const PERMS: { key: PermKey; perm: string; label: string }[] = [
  { key: "canRead", perm: "read", label: "Read" },
  { key: "canWrite", perm: "write", label: "Write" },
  { key: "canDelete", perm: "delete", label: "Delete" },
];

export function GrantRow({
  grant,
  onToggle,
  onRevoke,
}: {
  grant: Grant;
  onToggle: (id: number, key: PermKey, next: boolean) => void;
  onRevoke: (id: number) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <tr>
      <td className="cell-name">
        {grant.name ?? "Untitled resource"}
        <span className="created">added {formatDate(grant.createdAt)}</span>
      </td>
      <td>
        <span className="badge" data-kind={grant.kind}>
          <KindIcon kind={grant.kind} />
          {grant.kind}
        </span>
      </td>
      <td>
        <CopyId value={grant.googleId} />
      </td>
      <td>
        <div className="perms">
          {PERMS.map(({ key, perm, label }) => {
            const on = grant[key];
            return (
              <button
                key={key}
                type="button"
                className="toggle"
                data-perm={perm}
                data-on={on}
                aria-pressed={on}
                aria-label={`${label} permission for ${grant.name ?? grant.googleId}`}
                title={`${on ? "Disable" : "Enable"} ${label.toLowerCase()}`}
                onClick={() => onToggle(grant.id, key, !on)}
              >
                {label[0]}
              </button>
            );
          })}
        </div>
      </td>
      <td>
        <button
          type="button"
          className="revoke"
          data-confirm={confirming}
          onClick={() => {
            if (confirming) {
              onRevoke(grant.id);
            } else {
              setConfirming(true);
              window.setTimeout(() => setConfirming(false), 3000);
            }
          }}
        >
          {confirming ? "Confirm?" : "Revoke"}
        </button>
      </td>
    </tr>
  );
}
