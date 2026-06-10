import type { Health } from "../lib/types";

export function Masthead({ health, demo }: { health: Health | null; demo: boolean }) {
  const signedIn = health?.signedIn ?? false;
  const email = health?.email ?? null;
  const name = health?.name ?? null;
  // Prefer "Name · email" when both are known; degrade gracefully to whichever
  // we have, then to a plain status when signed in without a profile.
  const identity = name && email ? `${name} · ${email}` : (name ?? email ?? "signed in");

  return (
    <div className="masthead">
      <div className="brand">
        <div className="mark" aria-hidden="true" />
        <div>
          <h1>Terra Gate</h1>
        </div>
      </div>

      <div className="account-chip" data-state={signedIn ? "in" : "out"}>
        <span className="status-dot" aria-hidden="true" />
        <span>{signedIn ? identity : "not signed in"}</span>
        {demo && <em>demo</em>}
      </div>
    </div>
  );
}
