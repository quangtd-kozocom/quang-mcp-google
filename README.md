# kozocom-mcp — Google Drive + Sheets MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets an MCP client
(Claude Code, Codex, GitHub Copilot, …) read and write your **Google Drive** files and
**Google Sheets** on your behalf. Built with `@modelcontextprotocol/sdk`, `googleapis`, Zod,
and TypeScript.

Authentication is **OAuth user login**: a browser opens, you click **Allow** once, and the
token is cached and auto-refreshed — no repeated logins, no service accounts.

## Quick start

### Install from npm

Install and sign in:

```bash
npm install -g kozocom-mcp-google
kozocom-mcp auth login
kozocom-mcp client codex
```

The CLI (built on `commander`) has these commands:

- `kozocom-mcp auth login` — sign in to Google and cache the OAuth token.
- `kozocom-mcp auth logout` — delete the cached token (sign out / switch accounts).
- `kozocom-mcp auth status` — show the signed-in account, granted scopes, and token expiry.
- `kozocom-mcp setup` — check the config directory, report auth
  status, and print MCP config for Codex, Claude Code, and VS Code Copilot.
- `kozocom-mcp client [codex|claude|copilot|all]` — print MCP config with the **dangerous
  (mutating) tools disabled**, leaving only the read-only tools enabled (the agent name is a
  positional argument, default `all`). Each client uses its own mechanism: Codex
  `enabled_tools`/`disabled_tools`, a Claude Code `permissions.deny` list, and a named read-only
  `tools` set for VS Code Copilot. Pass `--include-dangerous` to keep every tool.

Run `kozocom-mcp` (or `start`) with no command to launch the server over stdio.

### From source

```bash
pnpm install
pnpm build
pnpm setup      # checks setup and prints MCP config
```

The published package embeds the internal Desktop OAuth client at build time. From source,
use `GOOGLE_OAUTH_CREDENTIALS=/path/to/client_secret.json` or put a Desktop OAuth JSON at
`~/.kozocom-mcp/client_secret.json`.

## Scripts

| Command          | Description                                  |
| ---------------- | -------------------------------------------- |
| `pnpm setup`     | Check setup and print MCP config             |
| `pnpm login`     | Sign in to Google (run once after `build`)   |
| `pnpm logout`    | Sign out (delete the cached token)           |
| `pnpm run client`| Print MCP config with dangerous tools disabled |
| `pnpm dev`       | Run the server with hot reload (`tsx watch`) |
| `pnpm build`     | Compile TypeScript to `dist/`                |
| `pnpm start`     | Run the compiled server over stdio           |
| `pnpm test`      | Run unit tests (vitest, fully mocked)        |
| `pnpm lint`      | Lint with oxlint                             |
| `pnpm typecheck` | Type-check without emitting                  |

## Tools

**Auth**
- `google_auth_status` — show the signed-in account, scopes, token expiry

> Sign-in and sign-out are **terminal commands**, not tools: `kozocom-mcp auth login` /
> `kozocom-mcp auth logout` (or `kozocom-mcp auth status`). See **CLI** below.

**Drive**
- `drive_list_files` — list / search files (Drive `q` query, pagination)
- `drive_get_file` — file metadata by ID
- `drive_download_file` — download / export content (Google-native files exported to csv/txt/pdf/…)
- `drive_create_folder` — create a folder
- `drive_upload_file` — upload inline text or a local file
- `drive_update_file` — rename / move / replace content
- `drive_copy_file` — duplicate a file
- `drive_delete_file` — trash (default) or permanently delete
- `drive_share_file` — grant a permission (user/group/domain/anyone)

**Sheets**
- `sheets_create_spreadsheet` — create a spreadsheet
- `sheets_get_spreadsheet` — tabs + dimensions
- `sheets_read_range` / `sheets_read_ranges` — read one / many A1 ranges
- `sheets_write_range` — overwrite a range
- `sheets_append_rows` — append rows after a table
- `sheets_clear_range` — clear values
- `sheets_add_sheet` / `sheets_delete_sheet` — add / remove a tab

## Using with an MCP client

All clients launch the server over stdio. If installed from npm, use the `npx` config below.
If running from source, build first (`pnpm build`), then sign in (`pnpm login`) or run
`pnpm setup`. The absolute source path below assumes this repo location — adjust if you move it.

### npm / npx config

```json
{
  "command": "npx",
  "args": ["-y", "-p", "kozocom-mcp-google", "kozocom-mcp"]
}
```

For terminal use, install globally and run:

```bash
kozocom-mcp setup
kozocom-mcp auth login
kozocom-mcp
```

### Claude Code

```bash
claude mcp add kozocom-google \
  -- npx -y -p kozocom-mcp-google kozocom-mcp
```

Or add to `.mcp.json` / your Claude config:

```json
{
  "mcpServers": {
    "kozocom-google": {
      "command": "npx",
      "args": ["-y", "-p", "kozocom-mcp-google", "kozocom-mcp"]
    }
  }
}
```

### Codex

In `~/.codex/config.toml`:

```toml
[mcp_servers.kozocom-google]
command = "npx"
args = ["-y", "-p", "kozocom-mcp-google", "kozocom-mcp"]
```

### GitHub Copilot (VS Code)

In `.vscode/mcp.json` (or the global `mcp.json`):

```json
{
  "servers": {
    "kozocom-google": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "-p", "kozocom-mcp-google", "kozocom-mcp"]
    }
  }
}
```

> The `GOOGLE_OAUTH_CREDENTIALS` env is only needed for local development or custom OAuth clients.
> The published package uses its embedded internal OAuth client. The cached token lives at
> `~/.kozocom-mcp/token.json`.

## Security

`token.json` grants full read/write to your Drive and Sheets — keep it private. Run
`kozocom-mcp auth logout` to revoke locally. Do not commit downloaded OAuth JSON files or user tokens.
The embedded Desktop OAuth client identifies the internal Google app; access still requires an
allowed Workspace account and user consent.
