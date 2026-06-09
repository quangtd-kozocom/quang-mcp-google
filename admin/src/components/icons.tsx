import type { Kind } from "../lib/types";

type IconProps = { className?: string };

export function VaultCrest({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="2.5"
        y="3.5"
        width="19"
        height="17"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="12" cy="12" r="4.4" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
      <path
        d="M12 7.6V5.4M12 18.6v-2.2M7.6 12H5.4M18.6 12h-2.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function FolderIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.2H19.5A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V6.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function SheetIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 9h16M4 14h16M10 3v18" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function FileIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M14 3v4h4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function KindIcon({ kind, className }: { kind: Kind; className?: string }) {
  if (kind === "folder") return <FolderIcon className={className} />;
  if (kind === "spreadsheet") return <SheetIcon className={className} />;
  return <FileIcon className={className} />;
}

export function EmptyVault({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 96 96" fill="none" aria-hidden="true">
      <rect x="10" y="14" width="76" height="68" rx="6" stroke="currentColor" strokeWidth="2" />
      <rect x="10" y="14" width="76" height="14" rx="6" stroke="currentColor" strokeWidth="2" />
      <circle cx="48" cy="54" r="17" stroke="currentColor" strokeWidth="2" />
      <circle cx="48" cy="54" r="4" stroke="currentColor" strokeWidth="2" />
      <path
        d="M48 41v-5M48 72v-5M61 54h5M30 54h5M57.2 44.8l3.5-3.5M35.3 66.7l3.5-3.5M57.2 63.2l3.5 3.5M35.3 41.3l3.5 3.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
