---
name: terra-mcp
description: >-
  Drive + Sheets over the terra-mcp-google MCP server. Use this skill WHENEVER the
  user wants to work with Google Drive or Google Sheets through this MCP — listing,
  searching, downloading, uploading, copying, moving, renaming, or trashing Drive
  files/folders; or creating, reading, writing, appending, clearing, formatting, or
  validating Google Sheets data. Trigger it even when the user doesn't name a tool or
  say "Drive"/"Sheets" explicitly — e.g. "put this report in a spreadsheet", "grab
  that file from my drive", "make a tracker", "export these rows", "share folder X".
  Also use it when a Drive/Sheets call fails (auth errors, permission/policy denials,
  not-found) so you pick the right tool, arguments, and recovery path the first time.
---

# terra-mcp — Google Drive + Sheets

This MCP server (`terra-mcp-google`) exposes Google **Drive** and **Sheets** to you over
OAuth user login. Your job: turn a user's plain-language request into the *right* tool call
with correct arguments, respect the permission gate, and recover cleanly from errors.

The tools all share the `mcp__terra-mcp-google__` prefix. Below they're written without it
for brevity (`drive_list_files` = `mcp__terra-mcp-google__drive_list_files`).

## First move: know the lay of the land

Two cheap habits prevent most failures:

1. **You need an ID, not a name.** Drive/Sheets tools act on **file IDs** and **spreadsheet
   IDs**, never on human names. If the user gives you a name ("the Q4 budget sheet"), first
   `drive_list_files` with a search query to resolve the ID, then act. Don't guess IDs.
2. **Auth first when in doubt.** If anything returns a not-authenticated error, run
   `google_auth_status`. Sign-in is **CLI-only** by design — you cannot log the user in from a
   tool. If they're signed out, tell them to run `terra-mcp auth login` (or `pnpm login` in
   this repo) in their terminal, then retry.

## The toolbox (pick by intent)

### Drive
| Tool | Use it when… | Key args |
|---|---|---|
| `drive_list_files` | Find / browse / search files & folders, resolve a name → ID | `q` (Drive query), `page_size`, `order_by` |
| `drive_get_file` | Inspect one item's metadata by ID | `file_id` |
| `drive_download_file` | Read a file's content (Google Docs/Sheets/Slides are exported) | `file_id`, `export_mime_type` (for Google-native files) |
| `drive_create_folder` | Make a new folder | `name`, `parent_id?` |
| `drive_upload_file` | Create a file from inline text | `name`, `content`, `mime_type?`, `parent_id?` |
| `drive_update_file` | Rename, move, and/or replace content | `file_id`, `new_name?`, `add_parents?`, `content?` |
| `drive_copy_file` | Duplicate a file | `file_id`, `name?`, `parent_id?` |
| `drive_delete_file` | Trash (default, recoverable) or permanently delete | `file_id`, `permanent?` |

### Sheets
| Tool | Use it when… | Key args |
|---|---|---|
| `sheets_create_spreadsheet` | Start a brand-new spreadsheet | `title`, `sheet_titles?` (initial tab names) |
| `sheets_get_spreadsheet` | List tabs + dimensions (no cell values) — get `sheetId`s here | `spreadsheet_id` |
| `sheets_read_range` | Read cells from one A1 range or several (`range` accepts a string or array) | `spreadsheet_id`, `range` |
| `sheets_write_range` | Overwrite cells in one range (`range`+`values`) or many (`data`) | `spreadsheet_id`, `range`, `values`, `data?` |
| `sheets_append_rows` | Add rows after the existing table | `spreadsheet_id`, `range`, `values` |
| `sheets_clear_range` | Wipe values (keeps formatting) | `spreadsheet_id`, `range` |
| `sheets_add_sheet` | Add a tab | `spreadsheet_id`, `title` |
| `sheets_delete_sheet` | Remove a tab by numeric `sheet_id` | `spreadsheet_id`, `sheet_id` |
| `sheets_format_cells` | Bold, colors, number formats on a grid range | `spreadsheet_id`, grid range, format opts |
| `sheets_set_data_validation` | Add a dropdown / list validation | `spreadsheet_id`, grid range, values |
| `sheets_batch_update` | Escape hatch: raw `spreadsheets.batchUpdate` requests | `spreadsheet_id`, `requests` |

Rules of thumb:
- A **spreadsheet is a Drive file too.** To find one by name, search with `drive_list_files`
  (`q: "name contains 'Q4 budget' and mimeType='application/vnd.google-apps.spreadsheet'"`),
  then use that ID with the `sheets_*` tools.
- `sheets_get_spreadsheet` is your map: it gives tab titles **and** the numeric `sheetId`s that
  `sheets_delete_sheet` and the grid-range tools (`format_cells`, `set_data_validation`,
  `batch_update`) require. Call it before any tab- or grid-level edit.
- Prefer **`append_rows`** for "add this data" and **`write_range`** for "set these exact cells".
  Reach for `batch_update` only when no dedicated tool covers the operation (merges, conditional
  formatting, freezing rows, etc.).

## Common workflows

**Export data into a new spreadsheet**
1. `sheets_create_spreadsheet` (`title`) → capture the returned `spreadsheetId`.
2. `sheets_write_range` a header row, then `sheets_append_rows` for the data (or write it all at
   once with `write_range` if you already have the full 2-D array).
3. Optional polish: `sheets_format_cells` to bold the header / set number formats.

**Update an existing sheet the user names**
1. `drive_list_files` to resolve name → `spreadsheetId`.
2. `sheets_get_spreadsheet` to confirm the tab and its dimensions.
3. `sheets_read_range` if you need current values, then `write_range` / `append_rows`.

**Organize Drive**
- New folder: `drive_create_folder`. Move things in: `drive_update_file` with `add_parents`.
- Duplicate a template: `drive_copy_file` (set `name` and `parent_id` for the copy).

**Read a document's contents**
- `drive_download_file`. For Google-native files set an `export_mime_type` (e.g.
  `text/csv` for a Sheet, `text/plain`/`text/markdown` for a Doc).

**Clean up**
- Default to **trashing** (`drive_delete_file` without `permanent`) — it's recoverable. Only pass
  `permanent: true` if the user clearly asks for irreversible deletion, and confirm first.

## Permission gate (safe mode)

Under safe mode this server runs a per-resource **allowlist** on top of OAuth. You will hit it,
so understand the three modes (set by the operator, not by you):

- **`off`** — gate disabled; every tool works normally.
- **`read_open`** (default) — you may **read and create** freely, but **writing or deleting an
  existing resource** is denied unless that resource (or an ancestor folder) is granted. Newly
  created resources are auto-granted, so a create-then-edit flow in the same session works.
- **`strict`** — everything is confined to the allowlist, *including* list/search results, which
  are filtered to granted files only. If `drive_list_files` returns less than expected, strict
  mode is likely hiding ungranted files — that's expected, not a bug.

When a call is blocked by policy (not by Google), don't retry blindly. Explain what was denied
and that grants are managed in the **`terra-mcp admin`** web console — the user (or their admin)
must grant the file/folder there, then you can retry. A folder grant cascades to its children, so
granting a parent folder is the efficient fix.

> The gate needs Node 23.4+ (`node:sqlite`). On older Node it self-disables and the server still
> runs ungated — so absence of denials doesn't always mean "allowed everywhere".

## Error recovery cheatsheet

| Symptom | Likely cause | Do this |
|---|---|---|
| "not authenticated" | No/expired token | `google_auth_status`; tell user to `terra-mcp auth login` in terminal, retry |
| Policy/permission denied (no Google call made) | Safe-mode gate | Ask user to grant the resource in `terra-mcp admin`, then retry |
| 403 from Google | Real Drive/Sheets permission | The signed-in user lacks access to that file — they must get shared access |
| 404 / not found | Wrong or stale ID | Re-resolve via `drive_list_files`; don't reuse a guessed ID |
| Range error | Bad A1 / tab name with space | Quote tab names: `'My Tab'!A1:C10`; verify tabs via `sheets_get_spreadsheet` |

## Output discipline

- Resolve names to IDs **before** acting, and surface the ID you used so the user can verify.
- Don't fabricate IDs, ranges, or sheet names — read them from a prior call.
- For destructive actions (`drive_delete_file permanent`, `sheets_delete_sheet`, overwriting a
  populated range), state what will change and confirm unless the user already authorized it.
- Keep responses focused on the result (link/ID + what changed), not a play-by-play of every call.
