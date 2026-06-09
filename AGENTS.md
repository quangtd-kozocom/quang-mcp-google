# AGENTS.md

Guidance for AI agents working in this repository.

## What this is

`kozocom-mcp` is an **MCP server** exposing **Google Drive** and **Google Sheets** as tools over
**stdio**. Auth is **OAuth user login** (browser consent, cached + auto-refreshed token), not a
service account.

Stack: TypeScript (NodeNext, strict), `@modelcontextprotocol/sdk`, `googleapis`, Zod v4, vitest,
oxlint. Package manager: **pnpm**.

## Design principles (apply to every change)

1. **Pick the simplest option.** Before implementing, ask: is this the simplest, easiest-to-read,
   easiest-to-maintain way to do it? If not, reconsider before writing code.
2. **Use the `caveman` skill** for communication — it cuts token usage ~75% while keeping full
   technical accuracy.

## Commands

| Command          | Use                                                    |
| ---------------- | ------------------------------------------------------ |
| `pnpm install`   | Install dependencies                                   |
| `pnpm build`     | Compile to `dist/` (`tsconfig.build.json`)             |
| `pnpm typecheck` | `tsc --noEmit` over all of `src/` including tests      |
| `pnpm lint`      | oxlint                                                 |
| `pnpm test`      | vitest once (fully mocked, no network/credentials)     |
| `pnpm dev`       | Run server with hot reload                             |
| `pnpm login` / `logout` | Sign in / out (needs built `dist/`)             |
| `pnpm run setup` | Check setup and print MCP config                       |
| `pnpm run client`| Print MCP config with dangerous tools disabled         |

`:dev` variants (`login:dev`, `setup:dev`, …) run from source via tsx. `setup`/`client` are pnpm
built-ins — use `pnpm run setup` / `pnpm run client`, and pass flags **without** `--`
(`pnpm run client codex` ✅). Or call the binary directly: `node dist/cli.js client codex`.

**Before any change is done:** `pnpm typecheck && pnpm lint && pnpm test` pass and `pnpm build`
succeeds.

## Layout

```
src/
  cli.ts            # commander CLI: auth login|logout|status / setup / client; default = start server
  index.ts          # startServer(): McpServer + registerGoogleTools() + stdio transport
  setup.ts          # runSetup(), mcpConfigSnippet(), configReport() — per-client MCP config text
  constants.ts      # SCOPES, file paths, CHARACTER_LIMIT, server name/version, SAFE_MODE(_ENV)
  format.ts         # ToolResult helpers, truncation, handleGoogleError, NotAuthenticatedError
  auth.ts           # OAuth2 token load/save/clear, status, loopback login flow
  google.ts         # getGoogleClients() -> authorized { drive, sheets }
  drive-adapter.ts  # DriveFileAdapter: anti-corruption layer over Drive v3
  sheets-adapter.ts # SheetsAdapter: anti-corruption layer over Sheets v4
  tools/
    define.ts       # tool/driveTool/sheetsTool factories + registerAll; isReadOnlyTool
    auth.ts         # google_auth_status (login/logout are CLI-only)
    drive.ts        # drive_* tools
    sheets.ts       # sheets_* tools
    google.ts       # selectGoogleTools(safeMode), READ_ONLY/DANGEROUS_TOOL_NAMES, registerGoogleTools()
  **/*.test.ts      # colocated vitest unit tests
```

## CLI & safe mode

`kozocom-mcp` (`src/cli.ts`) commands: `auth login|logout|status`, `setup` (`-c/--client`,
`-y/--yes`), `client [codex|claude|copilot|all]` (dangerous tools disabled; `--include-dangerous`
keeps them), and no command = start the stdio server. Sign-in/out are **CLI-only** — there are no
`google_login`/`google_logout` tools, so an untrusted client can't trigger consent or wipe the token.

**"Dangerous" = any non-read-only tool** (`readOnlyHint !== true`). Classification flows from the
`readOnlyHint` annotation via `isReadOnlyTool`, so the name lists in `tools/google.ts` derive
automatically — adding a tool needs no extra wiring. Two disabling paths:

- **Client-side** (what `client` emits): Codex `enabled_tools`/`disabled_tools`, Claude Code
  `permissions.deny`, VS Code Copilot `tools` set. Server still registers everything.
- **Server-side** (`KOZOCOM_MCP_SAFE_MODE=1`): `selectGoogleTools(true)` registers only read-only
  tools — the dangerous ones never exist on the wire.

Adding/re-annotating a tool updates the safe set automatically, but keep `setup.test.ts`'s
enabled/disabled assertions in sync.

## Conventions

- **Tool registration:** define via the `tool`/`driveTool`/`sheetsTool` factory in `define.ts`
  (`{ name, title, description, inputSchema, annotations, run }`), collect into `ToolRegistration[]`,
  register via `registerAll`. `inputSchema` is a **Zod raw shape**, not a wrapped `z.object()`.
- **Naming:** snake_case, service-prefixed (`drive_*`, `sheets_*`, `google_*`).
- **Descriptions:** include `Args:` and `Returns:` blocks; set annotations honestly
  (`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`).
- **Handlers:** each is an **exported pure function** `(client, args) => Promise<ToolResult>`, passed
  as the factory's `run`. Derive the arg type via `ArgsOf<typeof inputSchema>` — never hand-write a
  duplicate. The factory injects the client and maps errors, so handlers are testable with a fake client.
- **API access:** Google calls live in `DriveFileAdapter`/`SheetsAdapter`, not handlers. Add a new
  call as an adapter method; handlers translate snake_case args → adapter calls and shape the response.
- **Errors:** never throw out of a tool — the factory returns `errorResult(handleGoogleError(e))`. Add
  new status cases to `handleGoogleError`, not inline strings.
- **Output:** return human text + `structuredContent`; respect `response_format` (`markdown` default |
  `json`) and truncate via `toolResult`/`CHARACTER_LIMIT`.
- **Types:** strict, no `any` in `src/` (tests may use one annotated `as any` for the fake server).

## Testing

- Colocated `*.test.ts`, fully mocked — **never** hit the real Google API or filesystem.
- Mock `googleapis` clients with `vi.fn()`; call the handler directly via `asDrive(...)`/`asSheets(...)`.
- Mock `node:fs/promises` for `auth.ts` token tests; mock `../google.js` only for the auth-failure path.
- Every handler needs at least a happy-path and an error/validation-path test.

## Auth & secrets

- Secrets live in `~/.kozocom-mcp/` (override: `KOZOCOM_MCP_DIR`, `GOOGLE_OAUTH_CREDENTIALS`,
  `GOOGLE_OAUTH_TOKEN`). `client_secret.json` / `token.json` are **git-ignored — never commit them**.
- OAuth client must be **Desktop app** type. Scopes are in `constants.ts`; changing them needs a
  re-login (delete the old token first).
- Consent in **External + Testing** expires refresh tokens after 7 days — prefer **Internal** for
  Workspace orgs.
- Don't log tokens/secrets to stdout (it's the JSON-RPC channel) — log to **stderr**.
- Full setup: `SETUP.md`. Client config snippets: `README.md`.

## Scope notes

- This server holds **full read/write** Drive + Sheets scopes — treat write/delete tools as real side
  effects. `drive_delete_file` trashes by default; `permanent: true` is irreversible.
- For untrusted/agentic clients, hand out a `kozocom-mcp client` snippet and/or run with
  `KOZOCOM_MCP_SAFE_MODE=1`.
