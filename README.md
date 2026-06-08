# kozocom-mcp — Google Drive + Sheets MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets an MCP client
(Claude Code, Codex, GitHub Copilot, …) read and write your **Google Drive** files and
**Google Sheets** on your behalf. Built with `@modelcontextprotocol/sdk`, `googleapis`, Zod,
and TypeScript.

Authentication is **OAuth user login**: a browser opens, you click **Allow** once, and the
token is cached and auto-refreshed — no repeated logins, no service accounts.

## Quick start

```bash
pnpm install
pnpm build
pnpm login      # one-time: opens the browser to sign in
```

First, follow **[SETUP.md](./SETUP.md)** to create the Google Cloud OAuth credentials
(a one-time, ~5 minute click-through). Then `pnpm login`.

## Scripts

| Command          | Description                                  |
| ---------------- | -------------------------------------------- |
| `pnpm login`     | Sign in to Google (run once after `build`)   |
| `pnpm dev`       | Run the server with hot reload (`tsx watch`) |
| `pnpm build`     | Compile TypeScript to `dist/`                |
| `pnpm start`     | Run the compiled server (`dist/index.js`)    |
| `pnpm test`      | Run unit tests (vitest, fully mocked)        |
| `pnpm lint`      | Lint with oxlint                             |
| `pnpm typecheck` | Type-check without emitting                  |

## Tools

**Auth**
- `google_login` — open the browser and sign in
- `google_auth_status` — show the signed-in account, scopes, token expiry
- `google_logout` — delete the cached token

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

All clients launch the built server over stdio. Build first (`pnpm build`), then sign in
(`pnpm login`). The absolute path below assumes this repo location — adjust if you move it.

### Claude Code

```bash
claude mcp add kozocom-google \
  --env GOOGLE_OAUTH_CREDENTIALS=$HOME/.kozocom-mcp/client_secret.json \
  -- node /home/quang/Projects/kozocom/kozocom-mcp/dist/index.js
```

Or add to `.mcp.json` / your Claude config:

```json
{
  "mcpServers": {
    "kozocom-google": {
      "command": "node",
      "args": ["/home/quang/Projects/kozocom/kozocom-mcp/dist/index.js"],
      "env": { "GOOGLE_OAUTH_CREDENTIALS": "/home/quang/.kozocom-mcp/client_secret.json" }
    }
  }
}
```

### Codex

In `~/.codex/config.toml`:

```toml
[mcp_servers.kozocom-google]
command = "node"
args = ["/home/quang/Projects/kozocom/kozocom-mcp/dist/index.js"]
env = { GOOGLE_OAUTH_CREDENTIALS = "/home/quang/.kozocom-mcp/client_secret.json" }
```

### GitHub Copilot (VS Code)

In `.vscode/mcp.json` (or the global `mcp.json`):

```json
{
  "servers": {
    "kozocom-google": {
      "type": "stdio",
      "command": "node",
      "args": ["/home/quang/Projects/kozocom/kozocom-mcp/dist/index.js"],
      "env": { "GOOGLE_OAUTH_CREDENTIALS": "/home/quang/.kozocom-mcp/client_secret.json" }
    }
  }
}
```

> The `GOOGLE_OAUTH_CREDENTIALS` env is only needed if your client secret isn't at the default
> `~/.kozocom-mcp/client_secret.json`. The cached token lives at `~/.kozocom-mcp/token.json`.

## Security

`client_secret.json` and `token.json` are secrets and are git-ignored. The token grants full
read/write to your Drive and Sheets — keep it private. Run `google_logout` to revoke locally.
