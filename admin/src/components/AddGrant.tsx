import { useEffect, useId, useRef, useState } from "react";
import { api } from "../lib/api";
import type { DriveItem, Kind, NewGrant } from "../lib/types";
import { useToast } from "./Toasts";
import { KindIcon } from "./icons";
import { middleTruncate } from "../lib/format";

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

export function AddGrant({ onAdded }: { onAdded: () => void }) {
  const { notify } = useToast();

  // Selection / manual entry
  const [selected, setSelected] = useState<DriveItem | null>(null);
  const [manualId, setManualId] = useState("");
  const [manualKind, setManualKind] = useState<Kind>("file");

  // Search
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DriveItem[]>([]);
  const [searching, setSearching] = useState(false);

  // Safe default: read only.
  const [perms, setPerms] = useState<PermState>({
    canRead: true,
    canWrite: false,
    canDelete: false,
  });

  const [submitting, setSubmitting] = useState(false);

  const searchFieldId = useId();
  const idFieldId = useId();
  const kindFieldId = useId();
  const reqRef = useRef(0);

  // Debounced Drive search.
  useEffect(() => {
    if (selected) return;
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = window.setTimeout(async () => {
      const ticket = ++reqRef.current;
      const files = await api.searchDrive(term);
      if (ticket === reqRef.current) {
        setResults(files);
        setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(handle);
  }, [query, selected]);

  function choose(item: DriveItem) {
    setSelected(item);
    setResults([]);
    setQuery("");
    setManualId("");
  }

  function reset() {
    setSelected(null);
    setManualId("");
    setManualKind("file");
    setQuery("");
    setResults([]);
    setPerms({ canRead: true, canWrite: false, canDelete: false });
  }

  const effectiveId = selected?.id ?? manualId.trim();
  const canSubmit = effectiveId.length > 0 && !submitting;

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

    setSubmitting(true);
    try {
      const grant = await api.addGrant(body);
      notify(`Granted access to ${grant.name ?? "resource"}`, "success");
      reset();
      onAdded();
    } catch {
      notify("Could not save the grant. Try again.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="add-head">
      <div className="panel-head">
        <h2 id="add-head">Grant Access</h2>
      </div>

      <form className="add-grid" onSubmit={submit}>
        {/* Left: choose a resource */}
        <div className="card">
          <h4>Choose a resource</h4>
          <p className="sub">Search your Drive by name, or paste a raw Google ID.</p>

          {selected ? (
            <div className="selected">
              <KindIcon kind={selected.kind} className="" />
              <span>
                <span className="sname">{selected.name}</span>
                <br />
                <span className="sid">{middleTruncate(selected.id, 10, 8)}</span>
              </span>
              <button type="button" onClick={reset} aria-label="Clear selection">
                ×
              </button>
            </div>
          ) : (
            <>
              <label className="field" htmlFor={searchFieldId}>
                <span>Search Drive</span>
                <input
                  id={searchFieldId}
                  type="text"
                  value={query}
                  placeholder="e.g. Budget, Roadmap…"
                  autoComplete="off"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>

              <ul className="results" aria-label="Search results">
                {results.map((item) => (
                  <li key={item.id}>
                    <button type="button" className="result" onClick={() => choose(item)}>
                      <span className="rname">{item.name}</span>
                      <span className="badge" data-kind={item.kind}>
                        <KindIcon kind={item.kind} />
                        {item.kind}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="search-hint">
                {searching
                  ? "searching…"
                  : query.trim().length >= 2 && results.length === 0
                    ? "no matches — or paste an ID below"
                    : "type at least 2 characters"}
              </p>

              <label className="field" htmlFor={idFieldId} style={{ marginTop: 16 }}>
                <span>…or paste a raw Google ID</span>
                <input
                  id={idFieldId}
                  type="text"
                  value={manualId}
                  placeholder="1AbCdEf…"
                  autoComplete="off"
                  onChange={(e) => setManualId(e.target.value)}
                />
              </label>
              {manualId.trim().length > 0 && (
                <label className="field" htmlFor={kindFieldId}>
                  <span>Resource kind</span>
                  <select
                    id={kindFieldId}
                    value={manualKind}
                    onChange={(e) => setManualKind(e.target.value as Kind)}
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
        </div>

        {/* Right: set powers */}
        <div className="card">
          <h4>Grant powers</h4>
          <p className="sub">Read-only is the safe starting point. Add more as needed.</p>

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
                  onClick={() => setPerms((p) => ({ ...p, [key]: !p[key] }))}
                >
                  <span className="pc-name">{name}</span>
                  <span className="pc-desc">{desc}</span>
                </button>
              );
            })}
          </div>

          <button type="submit" className="btn" disabled={!canSubmit}>
            {submitting ? "Sealing…" : "Add to allowlist"}
          </button>
        </div>
      </form>
    </section>
  );
}
