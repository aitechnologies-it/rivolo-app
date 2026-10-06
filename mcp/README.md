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
