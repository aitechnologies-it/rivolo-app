# Rivolo Notes MCP

Local read-only MCP server for Rivolo notes. It reads a single Markdown notebook, with entries separated by `<!-- day:YYYY-MM-DD -->` markers. Use a manual export from **Settings → Data**, or a local copy of the file synced by Dropbox or Google Drive.

OneDrive sync uses a folder with one file per day. This server does not read that folder directly: export the notebook from Rivolo and point `RIVOLO_NOTES_FILE` at the exported file. Export again to make later changes available to the server.

## Build

```sh
npm run mcp:build
```

## Run

Set `RIVOLO_NOTES_FILE` to your local Rivolo Markdown notebook:

```sh
RIVOLO_NOTES_FILE="/absolute/path/to/inbox.md" npm run mcp:start
```

## MCP Client Config

```json
{
  "mcpServers": {
    "rivolo-notes": {
      "command": "node",
      "args": ["/path/to/rivolo-app/dist-mcp/mcp/index.js"],
      "env": {
        "RIVOLO_NOTES_FILE": "/path/to/inbox.md"
      }
    }
  }
}
```

opencode in ~/.config/opencode/opencode.jsonc

```
{
  "rivolo-notes": {
    "type": "local",
    "command": [
      "env",
      "RIVOLO_NOTES_FILE=/path/to/inbox.md",
      "node",
      "/absolute/path/to/rivolo-app/dist-mcp/mcp/index.js"
    ],
    "enabled": true
  }
}
```

## Tools

- `get_system_prompt`
- `list_days`
- `get_day`
- `search_notes`
- `get_recent_days`
- `list_open_todos`
- `list_tags`
- `list_mentions`

The server has no network listener and no write tools. Access is controlled by the local user account and the configured file path.

## Hosted Worker

Hosted Agent access supports Dropbox and Google Drive. OneDrive daily folders are not supported by the hosted Worker; use the local server with a manual notebook export.

The hosted endpoint is a separate Cloudflare Worker at `/mcp`. It uses
Streamable HTTP and reads or additively writes the provider target saved by
Rivolo Settings. Clients can authenticate through Rivolo OAuth (`rva_...`
access tokens) or a personal token (`rvl_...`) created in Settings.

Before deploying:

1. Create one D1 database and replace the placeholder database id in both
   `wrangler.toml` (Rivolo Pages Settings APIs) and `wrangler.mcp.toml` (hosted
   MCP Worker). Both services must bind the same database as `MCP_DB`.
2. Apply `migrations/0001` through `0004` to that database.
3. Set Worker secrets:
   - `MCP_PROVIDER_TOKEN_ENCRYPTION_KEY` — exactly the same value used by Pages.
   - `GOOGLE_CLIENT_SECRET`.
4. Set the Pages secrets already required by Agent access:
   - `MCP_PROVIDER_TOKEN_ENCRYPTION_KEY`.
   - `MCP_PROFILE_SESSION_ENCRYPTION_KEY`.
   - Provider OAuth/cookie secrets used by the existing sync endpoints.
5. Route `mcp.aitlab.it` to the Worker and keep
   `MCP_ALLOWED_ORIGINS` restricted to trusted browser origins. Native MCP
   clients normally omit `Origin`.
6. Configure Cloudflare rate-limit or WAF rules for the OAuth registration,
   token, and authorization endpoints before enabling public OAuth. See
   [`docs/mcp-oauth.md`](../docs/mcp-oauth.md).

`MCP_PROFILE_SESSION_ENCRYPTION_KEY` is a Pages-only browser-session secret.
The Worker must share `MCP_PROVIDER_TOKEN_ENCRYPTION_KEY` with Pages, but does
not need the profile-session secret.

Build the Worker without deploying:

```sh
npm run mcp:worker:build
```
