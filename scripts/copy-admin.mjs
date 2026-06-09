#!/usr/bin/env node
// Copy the built admin SPA into dist/ so `terra-mcp admin` can serve it from the
// published package. Best-effort: if the SPA hasn't been built yet, skip without
// failing the main build (run `pnpm admin:build` first to include the console).
import { cp, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const src = join("admin", "dist");
const dest = join("dist", "admin", "ui");

const built = await stat(src).then((s) => s.isDirectory()).catch(() => false);
if (!built) {
  console.error("[copy-admin] admin/dist not found — skipping admin UI. Run `pnpm admin:build` to bundle it.");
  process.exit(0);
}

await rm(dest, { recursive: true, force: true });
await cp(src, dest, { recursive: true });
console.error(`[copy-admin] copied ${src} → ${dest}`);
