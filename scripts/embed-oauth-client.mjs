#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const clientId = process.env.KOZOCOM_GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.KOZOCOM_GOOGLE_OAUTH_CLIENT_SECRET;
const outputPath = join("dist", "google", "generated", "oauth-client.js");

if (!clientId && !clientSecret) {
  console.error("No embedded OAuth client configured.");
  process.exit(0);
}

if (!clientId || !clientSecret) {
  console.error(
    "Set both KOZOCOM_GOOGLE_OAUTH_CLIENT_ID and KOZOCOM_GOOGLE_OAUTH_CLIENT_SECRET to embed the OAuth client.",
  );
  process.exit(1);
}

const contents = `export const EMBEDDED_OAUTH_CLIENT = ${JSON.stringify(
  { client_id: clientId, client_secret: clientSecret },
  null,
  2,
)};\n`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, contents, { mode: 0o600 });
console.error("Embedded OAuth client into dist.");
