# AGENTS.md

Guidance for AI agents working in this repository.

## What this is

`kozocom-mcp` is a **Model Context Protocol (MCP) server** that exposes **Google Drive** and
**Google Sheets** as tools over **stdio**. It authenticates via **OAuth user login** (browser
consent, cached + auto-refreshed token) — not a service account.

Stack: TypeScript (NodeNext, strict), `@modelcontextprotocol/sdk`, `googleapis`, Zod v4, vitest,
oxlint. Package manager: **pnpm**.

## Commands

| Command          | Use                                                   |
| ---------------- | ----------------------------------------------------- |
| `pnpm install`   | Install dependencies                                  |
| `pnpm build`     | Compile to `dist/` (uses `tsconfig.build.json`)       |
| `pnpm typecheck` | `tsc --noEmit` over all of `src/` **including tests**  |
| `pnpm lint`      | oxlint                                                |
| `pnpm test`      | Run vitest once (fully mocked, no network/credentials) |
| `pnpm test:watch`| vitest watch mode                                     |
| `pnpm login`     | Run the OAuth flow once (needs built `dist/`)         |
| `pnpm login:dev` | OAuth flow from source via tsx                        |
| `pnpm dev`       | Run server with hot reload                            |

**Before considering any change done:** `pnpm typecheck && pnpm lint && pnpm test` must all pass,
and `pnpm build` must succeed.

## Layout

```
src/
  index.ts          # entry: McpServer + register*Tools() + stdio transport
  login.ts          # standalone `pnpm login` CLI
  constants.ts      # SCOPES, file paths, CHARACTER_LIMIT, server name/version
  format.ts         # ToolResult helpers, truncation, handleGoogleError, NotAuthenticatedError
  auth.ts           # OAuth2 token load/save/clear, status, loopback login flow (module functions)
  google.ts         # getGoogleClients() -> authorized { drive, sheets }
  drive-adapter.ts  # DriveFileAdapter: anti-corruption layer over the Drive v3 API
  sheets-adapter.ts # SheetsAdapter: anti-corruption layer over the Sheets v4 API
  tools/
    define.ts       # tool / driveTool / sheetsTool factories + registerAll (type-safe registration)
    auth.ts         # google_login, google_auth_status, google_logout
    drive.ts        # drive_* tools
    sheets.ts       # sheets_* tools
    google.ts       # registerGoogleTools(): aggregate + register every tool
  **/*.test.ts      # colocated vitest unit tests
```

## Conventions (match these when editing)

- **Tool registration:** define each tool with the `tool` / `driveTool` / `sheetsTool` factory in
  `tools/define.ts` (`{ name, title, description, inputSchema, annotations, run }`), collect them into a
  `ToolRegistration[]`, and register via `registerAll`. `inputSchema` is a **Zod raw shape**
  (`{ field: z.string()... }`), NOT a wrapped `z.object()`.
- **Tool naming:** snake_case, service-prefixed (`drive_*`, `sheets_*`, `google_*`).
- **Descriptions:** include `Args:` and `Returns:` blocks; set annotations honestly
  (`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`).
- **Handler pattern:** each tool's logic is an **exported pure function** `(client, args) => Promise<ToolResult>`
  (e.g. `driveListFiles(drive, args)`) passed as the factory's `run`. The arg type is **derived from the
  schema** via `ArgsOf<typeof inputSchema>` — declare the Zod shape once; never hand-write a duplicate
  arg interface. The factory injects the authorized client and maps errors, so the `run` function stays
  unit-testable by calling it directly with a fake client (no need to mock `google.js`).
- **API access:** Google API calls live in `DriveFileAdapter` / `SheetsAdapter`, not in handlers.
  Handlers translate snake_case args → adapter calls and shape the response. Add a new API call as an
  adapter method.
- **Errors:** never throw out of a tool; the factory catches and returns `errorResult(handleGoogleError(e))`.
  Add new status cases to `handleGoogleError` rather than inline strings.
- **Output:** return both human text and `structuredContent`; respect `response_format`
  (`markdown` default | `json`) and truncate via `toolResult` / `CHARACTER_LIMIT`.
- **Types:** strict, no `any` in `src/` (tests may use a single annotated `as any` for the fake server).

## Testing

- Tests are colocated `*.test.ts`, fully mocked — **never** hit the real Google API or filesystem.
- Mock `googleapis` clients with plain `vi.fn()` objects; call the exported handler directly,
  passing the fake cast via `asDrive(...)` / `asSheets(...)`.
- Mock `node:fs/promises` for `auth.ts` token tests; mock `../google.js` only to test the
  auth-failure wrapper path.
- Every tool handler should have at least a happy-path and an error/validation-path test.

## Auth & secrets — gotchas

- Secrets live in `~/.kozocom-mcp/` (override via `KOZOCOM_MCP_DIR`, `GOOGLE_OAUTH_CREDENTIALS`,
  `GOOGLE_OAUTH_TOKEN`). `client_secret.json` and `token.json` are **git-ignored — never commit them**.
- OAuth client must be the **Desktop app** type (loopback redirect). Scopes are in `constants.ts`;
  changing them requires re-running `pnpm login` (delete the old token first).
- Consent screen in **External + Testing** expires refresh tokens after 7 days — prefer **Internal**
  for Workspace orgs. See `SETUP.md`.
- Full setup walkthrough: **`SETUP.md`**. Client config snippets: **`README.md`**.

## Scope notes

- This server holds **full read/write** scopes for Drive and Sheets. Treat write/delete tools as
  real side effects. `drive_delete_file` trashes by default; `permanent: true` is irreversible.
- Don't log token contents or secrets to stdout — stdout is the JSON-RPC channel; log to **stderr**.
