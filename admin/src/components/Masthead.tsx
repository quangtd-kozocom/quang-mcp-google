import type { Health } from "../lib/types";
import { VaultCrest } from "./icons";

export function Masthead({ health }: { health: Health | null }) {
  const signedIn = health?.signedIn ?? false;
  const email = health?.email ?? null;

  return (
    <header className="masthead stagger" style={{ animationDelay: "40ms" }}>
      <div className="brand">
        <div className="crest" aria-hidden="true">
          <VaultCrest />
        </div>
        <div>
          <h1>
            Terra <em>Gate</em>
          </h1>
          <div className="tagline">Permission Vault · Access Console</div>
        </div>
      </div>

      <div className="identity">
        <div className="label">Guarded account</div>
        <div className="email">
          <span className={`dot${signedIn ? "" : " off"}`} aria-hidden="true" />
          {signedIn ? (email ?? "signed in") : "not signed in"}
        </div>
      </div>
    </header>
  );
}
