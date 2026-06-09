import { useCallback, useEffect, useState } from "react";
import { middleTruncate } from "../lib/format";

export function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(t);
  }, [copied]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [value]);

  return (
    <button
      type="button"
      className="gid"
      onClick={copy}
      title={`${value}\nClick to copy`}
      aria-label={`Copy Google ID ${value}`}
    >
      <span aria-hidden={copied}>{middleTruncate(value)}</span>
      {copied && <span className="copied">copied</span>}
    </button>
  );
}
