import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Settings } from "lucide-react";
import { api, isUsingFallback } from "./lib/api";
import type { Grant, Health, Mode } from "./lib/types";
import { Masthead } from "./components/Masthead";
import { ModeSwitcher } from "./components/ModeSwitcher";
import { GrantsTable } from "./components/GrantsTable";
import { AddGrant } from "./components/AddGrant";
import { useToast } from "./components/Toasts";

type PermKey = "canRead" | "canWrite" | "canDelete";
type Theme = "dark" | "light";
const THEME_KEY = "terra-theme";
const POLL_MS = 4000;

function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}
const queryKeys = {
  health: ["health"] as const,
  grants: ["grants"] as const,
};

export function App() {
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    document.documentElement.dataset.mode = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // storage unavailable (private mode); the in-memory theme still applies
    }
  }, [theme]);

  const { data: healthData } = useQuery({
    queryKey: queryKeys.health,
    queryFn: api.getHealth,
  });
  const { data: grantsData, isLoading: grantsLoading } = useQuery({
    queryKey: queryKeys.grants,
    queryFn: api.getGrants,
    refetchInterval: POLL_MS,
  });

  const health = healthData ?? null;
  const grants = grantsData ?? [];
  const demo = isUsingFallback();

  const setModeMutation = useMutation({
    mutationFn: api.setMode,
    onMutate: async (mode: Mode) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.health });
      const previous = queryClient.getQueryData<Health>(queryKeys.health);
      queryClient.setQueryData<Health>(queryKeys.health, (current) =>
        current ? { ...current, mode } : current,
      );
      return { previous };
    },
    onError: (_error, _mode, context) => {
      queryClient.setQueryData(queryKeys.health, context?.previous);
      notify("Could not change the gate posture.", "error");
    },
    onSuccess: (confirmed) => {
      queryClient.setQueryData<Health>(queryKeys.health, (current) =>
        current ? { ...current, mode: confirmed } : current,
      );
      notify(`Gate posture set to ${labelForMode(confirmed)}`, "success");
    },
  });

  const patchGrantMutation = useMutation({
    mutationFn: ({ id, key, next }: { id: number; key: PermKey; next: boolean }) =>
      api.patchGrant(id, { [key]: next }),
    onMutate: async ({ id, key, next }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.grants });
      const previous = queryClient.getQueryData<Grant[]>(queryKeys.grants);
      queryClient.setQueryData<Grant[]>(queryKeys.grants, (current = []) =>
        current.map((g) => (g.id === id ? { ...g, [key]: next } : g)),
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      queryClient.setQueryData(queryKeys.grants, context?.previous);
      notify("Could not update permission.", "error");
    },
  });

  const deleteGrantMutation = useMutation({
    mutationFn: api.deleteGrant,
    onMutate: async (id: number) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.grants });
      const previous = queryClient.getQueryData<Grant[]>(queryKeys.grants);
      const target = previous?.find((g) => g.id === id);
      queryClient.setQueryData<Grant[]>(queryKeys.grants, (current = []) =>
        current.filter((g) => g.id !== id),
      );
      return { previous, target };
    },
    onError: (_error, _id, context) => {
      queryClient.setQueryData(queryKeys.grants, context?.previous);
      notify("Could not revoke access.", "error");
    },
    onSuccess: (_result, _id, context) => {
      notify(`Revoked ${context?.target?.name ?? "resource"}`, "info");
    },
  });

  const changeMode = useCallback(
    async (mode: Mode) => {
      setModeMutation.mutate(mode);
    },
    [setModeMutation],
  );

  const togglePerm = useCallback(
    async (id: number, key: PermKey, next: boolean) => {
      patchGrantMutation.mutate({ id, key, next });
    },
    [patchGrantMutation],
  );

  const revoke = useCallback(
    async (id: number) => {
      deleteGrantMutation.mutate(id);
    },
    [deleteGrantMutation],
  );

  const refreshGrants = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.grants });
  }, [queryClient]);

  const signedIn = health?.signedIn ?? false;

  return (
    <div className="shell">
      <header className="topbar">
        <Masthead health={health} demo={demo} />
        <nav className="top-actions" aria-label="Console controls">
          <ModeSwitcher mode={health?.mode ?? "read_open"} onChange={changeMode} />
          <button type="button" className="action-btn primary" onClick={() => setAddOpen(true)}>
            <Plus size={15} aria-hidden="true" />
            Add grant
          </button>
          <div className="settings-wrap">
            <button
              type="button"
              className="icon-btn"
              aria-label="Settings"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <Settings size={16} aria-hidden="true" />
            </button>
            {settingsOpen && (
              <div className="settings-popover" role="menu">
                <div className="menu-kicker">Display</div>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme === "dark"}
                  className="menu-row"
                  data-active={theme === "dark"}
                  onClick={() => {
                    setTheme("dark");
                    setSettingsOpen(false);
                  }}
                >
                  Dark
                  <span>{theme === "dark" ? "active" : ""}</span>
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme === "light"}
                  className="menu-row"
                  data-active={theme === "light"}
                  onClick={() => {
                    setTheme("light");
                    setSettingsOpen(false);
                  }}
                >
                  Light
                  <span>{theme === "light" ? "active" : ""}</span>
                </button>
              </div>
            )}
          </div>
        </nav>
      </header>

      {!signedIn && health && (
        <div className="notice">
          <strong>No Google account connected.</strong>
          <span>
            Run <code>terra-mcp auth login</code>, then refresh. Docs are in README.md.
          </span>
        </div>
      )}
      <AddGrant open={addOpen} onOpenChange={setAddOpen} onAdded={refreshGrants} />
      <GrantsTable grants={grants} loading={grantsLoading} onToggle={togglePerm} onRevoke={revoke} />
    </div>
  );
}

function labelForMode(mode: Mode): string {
  if (mode === "read_open") return "read-open";
  if (mode === "strict") return "strict";
  return "off";
}
