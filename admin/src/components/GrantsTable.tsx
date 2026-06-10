import { useEffect, useMemo, useReducer, useRef } from "react";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ExternalLink, MoreVertical, Search, X } from "lucide-react";
import type { Grant, GrantStatus, Kind } from "../lib/types";
import { driveUrl, formatDate } from "../lib/format";
import { CopyId } from "./CopyId";
import { GrantPermissions } from "./GrantPermissions";
import { KindIcon } from "./icons";
import { RevokeButton } from "./RevokeButton";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";

type PermKey = "canRead" | "canWrite" | "canDelete";
type KindFilter = Kind | "all";
type TableState = {
  query: string;
  kind: KindFilter;
  riskOnly: boolean;
  sorting: SortingState;
  scrollTop: number;
  selectedId: number | null;
};
type TableAction =
  | { type: "query"; query: string }
  | { type: "kind"; kind: KindFilter }
  | { type: "risk" }
  | { type: "sorting"; sorting: SortingState | ((current: SortingState) => SortingState) }
  | { type: "scroll"; scrollTop: number }
  | { type: "select"; selectedId: number | null };

const ROW_HEIGHT = 36;
const VIEWPORT_HEIGHT = 680;
const OVERSCAN = 8;
const initialTableState: TableState = {
  query: "",
  kind: "all",
  riskOnly: false,
  sorting: [],
  scrollTop: 0,
  selectedId: null,
};

const KINDS: KindFilter[] = ["all", "file", "folder", "spreadsheet"];
const PERMS: { key: PermKey; label: string; perm: string }[] = [
  { key: "canRead", label: "R", perm: "read" },
  { key: "canWrite", label: "W", perm: "write" },
  { key: "canDelete", label: "D", perm: "delete" },
];

const STALE_TAG: Partial<Record<GrantStatus, { label: string; title: string }>> = {
  trashed: { label: "trashed", title: "This file is in Google Drive's trash — restore it or revoke the grant." },
  missing: { label: "deleted", title: "This file no longer exists in Google Drive — revoke the grant." },
};

/** A small badge flagging a grant whose Drive target is trashed or gone. */
function StaleTag({ status }: { status?: GrantStatus }) {
  const tag = status ? STALE_TAG[status] : undefined;
  if (!tag) return null;
  return (
    <span className="stale-tag" data-status={status} title={tag.title}>
      {tag.label}
    </span>
  );
}

function makeColumns(): ColumnDef<Grant>[] {
  return [
    {
      id: "resource",
      accessorFn: (grant) => grant.name ?? grant.googleId,
      header: "Resource",
      cell: ({ row }) => (
        <span className="resource-button">
          <KindIcon kind={row.original.kind} />
          <span>{row.original.name ?? "Untitled resource"}</span>
          <StaleTag status={row.original.status} />
        </span>
      ),
    },
    {
      accessorKey: "kind",
      header: "Kind",
      cell: ({ row }) => (
        <Badge className="badge" data-kind={row.original.kind} variant="outline">
          <KindIcon kind={row.original.kind} />
          {row.original.kind}
        </Badge>
      ),
    },
    {
      id: "risk",
      accessorFn: (grant) => Number(grant.canWrite) + Number(grant.canDelete) * 2,
      header: "R/W/D",
      cell: ({ row }) => (
        <div className="status-lights" aria-label="Read write delete status">
          {PERMS.map(({ key, label, perm }) => {
            const granted = row.original[key];
            const risk = key === "canDelete" && granted;
            return (
              <span
                key={key}
                className="status-badge"
                data-perm={perm}
                data-on={granted}
                data-risk={risk}
                title={`${label}: ${granted ? "granted" : "denied"}`}
              >
                <span aria-hidden="true">{granted ? (risk ? "△" : "●") : "○"}</span>
                {label}
              </span>
            );
          })}
        </div>
      ),
    },
    {
      id: "action",
      header: "",
      enableSorting: false,
      cell: () => (
        <span className="kebab" aria-label="Open grant detail">
          <MoreVertical size={15} aria-hidden="true" />
        </span>
      ),
    },
  ];
}

function tableReducer(state: TableState, action: TableAction): TableState {
  if (action.type === "query") return { ...state, query: action.query, scrollTop: 0 };
  if (action.type === "kind") return { ...state, kind: action.kind, scrollTop: 0 };
  if (action.type === "risk") return { ...state, riskOnly: !state.riskOnly, scrollTop: 0 };
  if (action.type === "sorting") {
    const sorting =
      typeof action.sorting === "function" ? action.sorting(state.sorting) : action.sorting;
    return { ...state, sorting };
  }
  if (action.type === "scroll") return { ...state, scrollTop: action.scrollTop };
  return { ...state, selectedId: action.selectedId };
}

export function GrantsTable({
  grants,
  loading,
  onToggle,
  onRevoke,
}: {
  grants: Grant[];
  loading?: boolean;
  onToggle: (id: number, key: PermKey, next: boolean) => void;
  onRevoke: (id: number) => void;
}) {
  const [state, dispatch] = useReducer(tableReducer, initialTableState);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const detailDialogRef = useRef<HTMLDialogElement | null>(null);
  const { query, kind, riskOnly, sorting, scrollTop, selectedId } = state;

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return grants.filter((grant) => {
      const matchesTerm =
        !term ||
        (grant.name ?? "").toLowerCase().includes(term) ||
        grant.googleId.toLowerCase().includes(term);
      const matchesKind = kind === "all" || grant.kind === kind;
      const matchesRisk = !riskOnly || grant.canWrite || grant.canDelete;
      return matchesTerm && matchesKind && matchesRisk;
    });
  }, [grants, kind, query, riskOnly]);

  const table = useReactTable({
    data: filtered,
    columns: useMemo(() => makeColumns(), []),
    state: { sorting },
    onSortingChange: (updater) => dispatch({ type: "sorting", sorting: updater }),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN);
  const visibleRows = rows.slice(start, end);
  const selected = grants.find((grant) => grant.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) return;
    const dialog = detailDialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, [selected]);

  return (
    <main className="allowlist" aria-labelledby="allowlist-head">
      <div className="table-toolbar">
        <div>
          <p className="kicker">Allowlist</p>
          <h2 id="allowlist-head">Resource grants</h2>
        </div>
        <div className="table-count">
          <strong>{filtered.length}</strong>
          <span>/ {grants.length}</span>
        </div>
        <label className="filter-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder="Search name or ID"
            onChange={(event) => {
              dispatch({ type: "query", query: event.target.value });
              scrollRef.current?.scrollTo({ top: 0 });
            }}
          />
        </label>
        <div className="chip-row" aria-label="Kind filter">
          {KINDS.map((value) => (
            <button
              key={value}
              type="button"
              className="filter-chip"
              data-active={kind === value}
              onClick={() => {
                dispatch({ type: "kind", kind: value });
                scrollRef.current?.scrollTo({ top: 0 });
              }}
            >
              {value}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="risk-chip"
          data-active={riskOnly}
          onClick={() => {
            dispatch({ type: "risk" });
            scrollRef.current?.scrollTo({ top: 0 });
          }}
        >
          △ Write/Delete
        </button>
      </div>

      <section className="table-shell">
        {loading ? (
          <div className="grant-skeletons" aria-label="Loading grants">
            <Skeleton />
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <div className="empty-mark" aria-hidden="true" />
            <h3>No matching grants</h3>
            <p>Add a grant or loosen the current filters.</p>
          </div>
        ) : (
          <>
            <div className="grant-head">
              {table.getHeaderGroups()[0]?.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                return (
                  <button
                    key={header.id}
                    type="button"
                    role="columnheader"
                    className="head-cell"
                    data-col={header.id}
                    disabled={!header.column.getCanSort()}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {sorted && <span aria-hidden="true">{sorted === "asc" ? "↑" : "↓"}</span>}
                  </button>
                );
              })}
            </div>
            <div
              ref={scrollRef}
              className="grant-viewport"
              style={{ height: VIEWPORT_HEIGHT }}
              onScroll={(event) =>
                dispatch({ type: "scroll", scrollTop: event.currentTarget.scrollTop })
              }
            >
              <div className="grant-spacer" style={{ height: rows.length * ROW_HEIGHT }}>
                {visibleRows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className="grant-row"
                    style={{ transform: `translateY(${row.index * ROW_HEIGHT}px)` }}
                    onClick={() => dispatch({ type: "select", selectedId: row.original.id })}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <span key={cell.id} className="body-cell" data-col={cell.column.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </span>
                    ))}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      {selected && (
        <dialog
          ref={detailDialogRef}
          className="drawer-dialog"
          onClose={() => dispatch({ type: "select", selectedId: null })}
          onClick={(e) => {
            // Click on the dimmed area beside the drawer closes the detail panel.
            if (e.target === detailDialogRef.current) dispatch({ type: "select", selectedId: null });
          }}
        >
          <div className="drawer detail-drawer" aria-labelledby="grant-detail-head">
            <div className="drawer-head">
              <div>
                <p className="kicker">Grant detail</p>
                <h2 id="grant-detail-head">{selected.name ?? "Untitled resource"}</h2>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="Close grant detail"
                onClick={() => dispatch({ type: "select", selectedId: null })}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="drawer-body">
              <section className="drawer-section">
                <h3>Permissions</h3>
                <GrantPermissions grant={selected} onToggle={onToggle} />
              </section>
              <section className="drawer-section">
                <h3>Resource</h3>
                <div className="detail-grid">
                  <span>Kind</span>
                  <Badge className="badge" data-kind={selected.kind} variant="outline">
                    <KindIcon kind={selected.kind} />
                    {selected.kind}
                  </Badge>
                  <span>Status</span>
                  <span className="detail-status">
                    {STALE_TAG[selected.status ?? "active"] ? (
                      <StaleTag status={selected.status} />
                    ) : (
                      "Active"
                    )}
                  </span>
                  <span>Google ID</span>
                  <CopyId value={selected.googleId} />
                  <span>Link</span>
                  <a
                    className="resource-link"
                    href={driveUrl(selected.kind, selected.googleId)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in Google
                    <ExternalLink size={13} aria-hidden="true" />
                  </a>
                  <span>Added</span>
                  <code>{formatDate(selected.createdAt)}</code>
                </div>
              </section>
              <section className="drawer-section danger-zone">
                <h3>Revoke</h3>
                <RevokeButton grantId={selected.id} onRevoke={onRevoke} />
              </section>
            </div>
          </div>
        </dialog>
      )}
    </main>
  );
}
