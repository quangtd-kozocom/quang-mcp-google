import type { Mode } from "../lib/types";

interface ModeMeta {
  value: Mode;
  name: string;
  tone: "off" | "read" | "strict";
  help: string;
}

const MODES: ModeMeta[] = [
  {
    value: "read_open",
    name: "Read-open",
    tone: "read",
    help: "Recommended. The agent can READ anything, but can only WRITE, DELETE or CREATE on resources you've granted below.",
  },
  {
    value: "strict",
    name: "Strict",
    tone: "strict",
    help: "The agent can only SEE and USE resources you've granted below. Everything else is invisible.",
  },
  {
    value: "off",
    name: "Gate off",
    tone: "off",
    help: "Gate disabled. The agent can do anything your Google account can. Use with caution.",
  },
];

export function ModeSwitcher({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  return (
    <section className="mode" aria-labelledby="mode-eyebrow">
      <div className="section-eyebrow" id="mode-eyebrow">
        Gate posture
      </div>
      <div className="mode-track" role="radiogroup" aria-label="Permission gate mode">
        {MODES.map((m) => {
          const active = m.value === mode;
          return (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={active}
              className="mode-opt"
              data-active={active}
              data-tone={m.tone}
              onClick={() => onChange(m.value)}
            >
              <span className="name">
                <span className="pip" aria-hidden="true" />
                {m.name}
              </span>
              <span className="help">{m.help}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
