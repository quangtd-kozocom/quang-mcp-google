import { useEffect, useId, useReducer, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { api } from "../lib/api";
import type { DriveItem, Kind, NewGrant } from "../lib/types";
import { useToast } from "./Toasts";
import { KindIcon } from "./icons";
import { middleTruncate } from "../lib/format";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

type PermState = { canRead: boolean; canWrite: boolean; canDelete: boolean };

const PERM_CHOICES: {
  key: keyof PermState;
  perm: string;
  name: string;
  desc: string;
}[] = [
  { key: "canRead", perm: "read", name: "Read", desc: "View contents" },
  { key: "canWrite", perm: "write", name: "Write", desc: "Edit & create" },
  { key: "canDelete", perm: "delete", name: "Delete", desc: "Trash & remove" },
];

const KINDS: Kind[] = ["file", "folder", "spreadsheet"];
const initialPerms: PermState = { canRead: true, canWrite: false, canDelete: false };
const initialState = {
  selected: null as DriveItem | null,
  manualId: "",
  manualKind: "file" as Kind,
  query: "",
  debouncedQuery: "",
  perms: initialPerms,
};

type AddGrantState = typeof initialState;
type AddGrantAction =
  | { type: "query"; query: string }
  | { type: "debounced_query"; query: string }
  | { type: "select"; item: DriveItem }
  | { type: "manual_id"; id: string }
  | { type: "manual_kind"; kind: Kind }
  | { type: "toggle_perm"; key: keyof PermState }
  | { type: "reset" };

function reducer(state: AddGrantState, action: AddGrantAction): AddGrantState {
  if (action.type === "query") return { ...state, query: action.query };
  if (action.type === "debounced_query") return { ...state, debouncedQuery: action.query };
  if (action.type === "select") {
    return { ...state, selected: action.item, query: "", debouncedQuery: "", manualId: "" };
  }
  if (action.type === "manual_id") return { ...state, manualId: action.id };
  if (action.type === "manual_kind") return { ...state, manualKind: action.kind };
  if (action.type === "toggle_perm") {
    return { ...state, perms: { ...state.perms, [action.key]: !state.perms[action.key] } };
  }
  return initialState;
}

export function AddGrant({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(reducer, initialState);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const searchFieldId = useId();
  const idFieldId = useId();
  const kindFieldId = useId();
  const { selected, manualId, manualKind, query, debouncedQuery, perms } = state;

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, [open]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      dispatch({ type: "debounced_query", query: query.trim() });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [query]);

  const {
    data: searchResults,
    isFetching: searchFetching,
  } = useQuery({
    queryKey: ["drive-search", debouncedQuery],
    queryFn: () => api.searchDrive(debouncedQuery),
    enabled: !selected && debouncedQuery.length >= 2,
    staleTime: 20_000,
  });

  const addGrantMutation = useMutation({
    mutationFn: api.addGrant,
    onSuccess: (grant) => {
      notify(`Granted access to ${grant.name ?? "resource"}`, "success");
      dispatch({ type: "reset" });
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ["grants"] });
      onAdded();
    },
    onError: () => {
      notify("Could not save the grant. Try again.", "error");
    },
  });

  const effectiveId = selected?.id ?? manualId.trim();
  const canSubmit = effectiveId.length > 0 && !addGrantMutation.isPending;
  const results = searchResults ?? [];
  const searching = query.trim().length >= 2 && (debouncedQuery !== query.trim() || searchFetching);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const body: NewGrant = {
      kind: selected?.kind ?? manualKind,
      googleId: effectiveId,
      ...(selected?.name ? { name: selected.name } : {}),
      canRead: perms.canRead,
      canWrite: perms.canWrite,
      canDelete: perms.canDelete,
    };

    addGrantMutation.mutate(body);
  }

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className="drawer-dialog"
      onClose={() => onOpenChange(false)}
      onClick={(e) => {
        // The drawer occupies only the right side; a click that lands on the
        // dialog element itself (the dimmed area to its left) dismisses it.
        if (e.target === dialogRef.current) onOpenChange(false);
      }}
    >
      <div className="drawer add-drawer" aria-labelledby="add-head">
        <div className="drawer-head">
          <div>
            <p className="kicker">Allowlist</p>
            <h2 id="add-head">Add grant</h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close add grant"
            onClick={() => onOpenChange(false)}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <form className="drawer-body" onSubmit={submit}>
          <section className="drawer-section">
            <h3>Resource</h3>
            {selected ? (
              <div className="selected">
                <KindIcon kind={selected.kind} className="" />
                <span>
                  <span className="sname">{selected.name}</span>
                  <br />
                  <span className="sid">{middleTruncate(selected.id, 10, 8)}</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => dispatch({ type: "reset" })}
                  aria-label="Clear selection"
                >
                  <X size={14} aria-hidden="true" />
                </Button>
              </div>
            ) : (
              <>
                <Label className="field" htmlFor={searchFieldId}>
                  <span>Search Drive</span>
                  <span className="search-box">
                    <Search size={15} aria-hidden="true" />
                    <Input
                      id={searchFieldId}
                      type="text"
                      value={query}
                      placeholder="Budget, Roadmap"
                      autoComplete="off"
                      onChange={(e) => dispatch({ type: "query", query: e.target.value })}
                    />
                  </span>
                </Label>

                <ul className="results" aria-label="Search results">
                  {results.map((item) => (
                    <li key={item.id}>
                      <button
                      type="button"
                      className="result"
                      onClick={() => dispatch({ type: "select", item })}
                      >
                        <span className="rname">{item.name}</span>
                        <Badge className="badge" data-kind={item.kind} variant="outline">
                          <KindIcon kind={item.kind} />
                          {item.kind}
                        </Badge>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="search-hint">
                  {searching
                    ? "searching"
                    : query.trim().length >= 2 && results.length === 0
                      ? "no matches; paste an ID below"
                      : "type at least 2 characters"}
                </p>

                <Label className="field" htmlFor={idFieldId} style={{ marginTop: 16 }}>
                  <span>Paste Google ID</span>
                  <Input
                    id={idFieldId}
                    type="text"
                    value={manualId}
                    placeholder="1AbCdEf"
                    autoComplete="off"
                    onChange={(e) => dispatch({ type: "manual_id", id: e.target.value })}
                  />
                </Label>
                {manualId.trim().length > 0 && (
                  <Label className="field" htmlFor={kindFieldId}>
                    <span>Resource kind</span>
                    <Select
                      value={manualKind}
                      onValueChange={(kind) =>
                        dispatch({ type: "manual_kind", kind: kind as Kind })
                      }
                    >
                      <SelectTrigger id={kindFieldId} className="kind-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {KINDS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {k}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Label>
                )}
              </>
            )}
          </section>

          <section className="drawer-section">
            <h3>Permissions</h3>
            <div className="perm-row">
              {PERM_CHOICES.map(({ key, perm, name, desc }) => {
                const on = perms[key];
                return (
                  <button
                    key={key}
                    type="button"
                    className="perm-choice"
                    data-perm={perm}
                    data-on={on}
                    aria-pressed={on}
                    onClick={() => dispatch({ type: "toggle_perm", key })}
                  >
                    <span className="signal" aria-hidden="true">
                      {on ? "●" : "○"}
                    </span>
                    <span className="pc-name">{name}</span>
                    <span className="pc-desc">{desc}</span>
                  </button>
                );
              })}
            </div>

            <Button type="submit" className="btn" disabled={!canSubmit}>
              {addGrantMutation.isPending ? "Adding..." : "Add to allowlist"}
            </Button>
          </section>
        </form>
      </div>
    </dialog>
  );
}
