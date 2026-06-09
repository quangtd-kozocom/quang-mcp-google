# AGENTS.md

Guidance for AI agents in this repo.

## What this is

`quang-mcp`: MCP server exposing **Google Drive + Sheets** over stdio. Auth = **OAuth user login**
(browser consent, cached + auto-refreshed token), not a service account.

Stack: TypeScript (NodeNext, strict), `@modelcontextprotocol/sdk`, `googleapis`, Zod v4, vitest,
oxlint. PM: **pnpm**. Use the `caveman` skill to communicate.

## Commands

`pnpm install` · `build` (→ `dist/`) · `typecheck` · `lint` (oxlint) · `test` (vitest, mocked) ·
`dev` (hot reload) · `login`/`logout` (needs built `dist/`) · `run setup` · `run client`.

`:dev` variants run from source via tsx. Pass flags to `run setup`/`run client` **without** `--`
(`pnpm run client codex`), or call `node dist/cli.js client codex`.

**Before any change:** `pnpm typecheck && pnpm lint && pnpm test` pass and `pnpm build` succeeds.

## Layout (`src/`)

Organized as **feature modules**: shared kernel (`config`, `core`), Google integration
(`google`), and one self-contained folder per service under `services/`. Adding a Google service
= one new `services/<name>/` folder (`adapter.ts` + `tools.ts`) wired into `services/registry.ts`.

- `cli.ts` — CLI entry (bin): `auth login|logout|status` / `setup` / `client`; no command = start server
- `index.ts` — server entry (bin): `startServer()` = McpServer + `registerGoogleTools()` + stdio
- `config/constants.ts` — SCOPES, paths, `CHARACTER_LIMIT`, `SAFE_MODE`
- `core/` — MCP framework, service-agnostic:
  - `result.ts` — `ToolResult` helpers, truncation, `handleGoogleError`, `NotAuthenticatedError`, `responseFormatSchema`
  - `tool.ts` — `tool`/`driveTool`/`sheetsTool` factories, `registerAll`, `isReadOnlyTool`, `ArgsOf`
- `google/` — Google integration:
  - `auth.ts` — OAuth token load/save/clear, loopback login
  - `client.ts` — `getGoogleClients()` → `{ drive, sheets }`
  - `generated/oauth-client.ts` — embedded OAuth client stub (overwritten in `dist/` at build time)
- `services/` — one folder per service + the aggregating registry:
  - `registry.ts` — `googleTools`, `selectGoogleTools`, tool-name lists, `registerGoogleTools`
  - `auth/tools.ts` — `google_auth_status`
  - `drive/` — `adapter.ts` (anti-corruption layer) + `tools.ts` (handlers + registrations)
  - `sheets/` — `adapter.ts` + `tools.ts`
- `setup/setup.ts` — `runSetup()`, MCP config snippets per client
- `**/*.test.ts` — colocated vitest tests

## CLI & safe mode

Sign-in/out are **CLI-only** (no `google_login`/`google_logout` tools) so untrusted clients can't
trigger consent or wipe the token. **"Dangerous" = any non-read-only tool** (`readOnlyHint !== true`);
classification derives automatically from annotations via `isReadOnlyTool`. Two disabling paths:

- **Client-side** (`pnpm run client`): emits Codex/Claude/Copilot config that disables dangerous
  tools; server still registers everything.
- **Server-side** (`QUANG_MCP_SAFE_MODE=1`): `selectGoogleTools(true)` registers only read-only tools.

Adding/re-annotating a tool updates the safe set automatically — but keep `setup/setup.test.ts`
and `services/registry.test.ts` assertions in sync.

## Conventions

- **Simplest, compact:** write code the most compact way that stays readable — caveman spirit applied
  to code; no boilerplate, no ceremony.
- **Register** tools via `tool`/`driveTool`/`sheetsTool` factory in `core/tool.ts`
  (`{ name, title, description, inputSchema, annotations, run }`) → `ToolRegistration[]` → `registerAll`.
  `inputSchema` is a **Zod raw shape**, not `z.object()`.
- **Naming:** snake_case, service-prefixed (`drive_*`, `sheets_*`, `google_*`).
- **Descriptions** include `Args:`/`Returns:`; set annotations honestly
  (`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`).
- **Handlers** are exported pure fns `(client, args) => Promise<ToolResult>` passed as `run`. Derive
  arg type via `ArgsOf<typeof inputSchema>` — never hand-write it.
- **API access** lives in the adapters, not handlers. New call = new adapter method; handlers map
  snake_case args → adapter calls and shape the response.
- **Errors:** never throw from a tool (factory returns `errorResult(handleGoogleError(e))`); add status
  cases to `handleGoogleError`.
- **Output:** human text + `structuredContent`; respect `response_format` (`markdown` default | `json`),
  truncate via `toolResult`/`CHARACTER_LIMIT`.
- **Types:** strict, no `any` in `src/` (tests may use one annotated `as any`).

## Testing

Colocated, fully mocked — **never** hit real Google API or filesystem. Mock `googleapis` with
`vi.fn()`, call handlers via `asDrive(...)`/`asSheets(...)`. Mock `node:fs/promises` for `auth.ts`;
mock `../google.js` only for the auth-failure path. Each handler needs happy-path + error/validation tests.

## Auth & secrets

- Token in `~/.quang-mcp/` (override: `QUANG_MCP_DIR`, `GOOGLE_OAUTH_CREDENTIALS`,
  `GOOGLE_OAUTH_TOKEN`). `client_secret.json` / `token.json` are **git-ignored — never commit**.
- Published package embeds only public OAuth `client_id`; login uses PKCE. Scopes in `config/constants.ts`; changing them needs re-login
  (delete old token first). External+Testing consent expires refresh tokens after 7 days — prefer
  **Internal** for Workspace orgs.
- Never log tokens/secrets to **stdout** (JSON-RPC channel) — use **stderr**.
- Client snippets: `README.md`.

## Scope notes

Server holds **full read/write** Drive + Sheets scopes — write/delete tools are real side effects.
`drive_delete_file` trashes by default; `permanent: true` is irreversible. For untrusted clients use a
`quang-mcp client` snippet and/or `QUANG_MCP_SAFE_MODE=1`.
