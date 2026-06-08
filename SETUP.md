# Setup — Google Sheets + Drive MCP

This is a one-time setup. After it, signing in is a single browser click and the
server remembers you.

---

## Step 1 — Create a Google Cloud project

1. Go to <https://console.cloud.google.com/>.
2. Top bar → project dropdown → **New Project**. Name it (e.g. `kozocom-mcp`) and **Create**.
3. Make sure the new project is selected in the top bar.

## Step 2 — Enable the APIs

1. Go to **APIs & Services → Library** (<https://console.cloud.google.com/apis/library>).
2. Search **"Google Drive API"** → open it → **Enable**.
3. Search **"Google Sheets API"** → open it → **Enable**.

## Step 3 — Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. **User type:**
   - If your account is a Google Workspace org (e.g. `@kozo-japan.com`), choose **Internal**.
     This avoids Google's app-verification review and the 7-day token expiry. **Recommended.**
   - Otherwise choose **External** (you'll add yourself as a test user in a moment).
3. Fill in the required fields (app name, your email for user support + developer contact). Save.
4. **Scopes:** you can skip adding scopes here — the app requests them at login. Save and continue.
5. **Test users** (External only): add your own Google email. Save.

> ⚠️ External + Testing mode expires refresh tokens after 7 days, so you'd have to re-run
> `pnpm login` weekly. Internal (or publishing the app) avoids this. Internal is strongly preferred.

## Step 4 — Create the OAuth client credentials

1. Go to **APIs & Services → Credentials**.
2. **+ Create Credentials → OAuth client ID**.
3. **Application type: Desktop app**. Name it (e.g. `kozocom-mcp-desktop`). **Create**.
4. In the dialog, click **Download JSON**.
5. Save that file as the client secret. Default expected location:

   ```bash
   mkdir -p ~/.kozocom-mcp
   mv ~/Downloads/client_secret_*.json ~/.kozocom-mcp/client_secret.json
   ```

   (Or set the env var `GOOGLE_OAUTH_CREDENTIALS=/path/to/your_secret.json` instead.)

## Step 5 — Build and sign in

From the `kozocom-mcp/` directory:

```bash
pnpm install
pnpm build
pnpm login
```

Your browser opens to Google's consent screen. Click **Allow**. You'll see a "Signed in"
page; close the tab. The token is saved to `~/.kozocom-mcp/token.json` and reused automatically.

Verify:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
# then call the google_auth_status tool — it should show your email
```

---

## Where things are stored

| Item            | Default path                       | Override env var            |
| --------------- | ---------------------------------- | --------------------------- |
| Client secret   | `~/.kozocom-mcp/client_secret.json`| `GOOGLE_OAUTH_CREDENTIALS`  |
| Cached token    | `~/.kozocom-mcp/token.json`        | `GOOGLE_OAUTH_TOKEN`        |
| Config dir      | `~/.kozocom-mcp/`                  | `KOZOCOM_MCP_DIR`           |

To switch Google accounts: run the `google_logout` tool (or delete `token.json`), then
`pnpm login` again. These files are secrets — they're already git-ignored.

## Troubleshooting

- **"No OAuth client secret found"** — finish Step 4 / put the JSON at the expected path.
- **`access_denied` in the browser** — on External apps, add your email under Test users (Step 3).
- **Token stops working after ~7 days** — your consent screen is External + Testing. Switch to
  Internal, or publish the app (APIs & Services → OAuth consent screen → Publish app).
- **403 with "API not enabled"** — re-check Step 2 for the project that owns the credentials.
