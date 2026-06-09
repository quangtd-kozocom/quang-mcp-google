import { useCallback, useEffect, useRef, useState } from "react";
import { api, isUsingFallback } from "./lib/api";
import type { Grant, Health, Mode } from "./lib/types";
import { Masthead } from "./components/Masthead";
import { ModeSwitcher } from "./components/ModeSwitcher";
import { GrantsTable } from "./components/GrantsTable";
import { AddGrant } from "./components/AddGrant";
import { useToast } from "./components/Toasts";

type PermKey = "canRead" | "canWrite" | "canDelete";
const POLL_MS = 4000;

export function App() {
  const { notify } = useToast();
  const [health, setHealth] = useState<Health | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [demo, setDemo] = useState(false);

  const loadGrants = useCallback(async () => {
    const next = await api.getGrants();
    setGrants(next);
    setDemo(isUsingFallback());
  }, []);

  const loadHealth = useCallback(async () => {
    const h = await api.getHealth();
    setHealth(h);
    setDemo(isUsingFallback());
  }, []);

  // Initial load.
  useEffect(() => {
    void loadHealth();
    void loadGrants();
  }, [loadHealth, loadGrants]);

  // Poll grants so the allowlist stays fresh.
  const loadRef = useRef(loadGrants);
  loadRef.current = loadGrants;
  useEffect(() => {
    const t = window.setInterval(() => void loadRef.current(), POLL_MS);
    return () => window.clearInterval(t);
  }, []);

  const changeMode = useCallback(
    async (mode: Mode) => {
      const prev = health;
      // Optimistic.
      setHealth((h) => (h ? { ...h, mode } : h));
      try {
        const confirmed = await api.setMode(mode);
        setHealth((h) => (h ? { ...h, mode: confirmed } : h));
        notify(`Gate posture set to ${labelForMode(confirmed)}`, "success");
      } catch {
        setHealth(prev);
        notify("Could not change the gate posture.", "error");
      }
    },
    [health, notify],
  );

  const togglePerm = useCallback(
    async (id: number, key: PermKey, next: boolean) => {
      const snapshot = grants;
      // Optimistic.
      setGrants((gs) => gs.map((g) => (g.id === id ? { ...g, [key]: next } : g)));
      try {
        await api.patchGrant(id, { [key]: next });
      } catch {
        setGrants(snapshot);
        notify("Could not update permission.", "error");
      }
    },
    [grants, notify],
  );

  const revoke = useCallback(
    async (id: number) => {
      const snapshot = grants;
      const target = grants.find((g) => g.id === id);
      setGrants((gs) => gs.filter((g) => g.id !== id));
      try {
        await api.deleteGrant(id);
        notify(`Revoked ${target?.name ?? "resource"}`, "info");
      } catch {
        setGrants(snapshot);
        notify("Could not revoke access.", "error");
      }
    },
    [grants, notify],
  );

  const signedIn = health?.signedIn ?? false;

  return (
    <div className="shell">
      <Masthead health={health} />

      {!signedIn && health && (
        <div className="notice stagger" style={{ animationDelay: "120ms" }}>
          <div>
            <h3>No account is signed in</h3>
            <p>
              Terra Gate can't guard a Drive it can't reach. Open a terminal and run{" "}
              <code>terra-mcp auth login</code> to grant Terra Gate access to your Google
              account, then refresh this page.
            </p>
          </div>
        </div>
      )}

      {demo && (
        <div className="demo-banner stagger" style={{ animationDelay: "160ms" }}>
          <span className="ddot" aria-hidden="true" />
          backend unreachable — showing live demo data
        </div>
      )}

      <div className="stagger" style={{ animationDelay: "200ms" }}>
        <ModeSwitcher mode={health?.mode ?? "read_open"} onChange={changeMode} />
      </div>

      <div className="stagger" style={{ animationDelay: "300ms" }}>
        <GrantsTable grants={grants} onToggle={togglePerm} onRevoke={revoke} />
      </div>

      <div className="stagger" style={{ animationDelay: "400ms" }}>
        <AddGrant onAdded={loadGrants} />
      </div>

      <footer className="footer">
        <span>Terra Gate · guarding Google Drive &amp; Sheets</span>
        <span>read · write · delete — you hold the keys</span>
      </footer>
    </div>
  );
}

function labelForMode(mode: Mode): string {
  if (mode === "read_open") return "read-open";
  if (mode === "strict") return "strict";
  return "off";
}
