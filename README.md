<p align="center">
  <img src="public/logo.png" alt="Rivolo" width="180" />
</p>

<p align="center"><em>The no-notes notes app 💧</em></p>

Rivolo (REE-voh-loh) is the Italian word for "small stream". Every day, you write your thoughts, ideas, notes and todos without organizing anything. Whenever you need to find something complex, just ask the LLM to surface what you need.

Try it here: [rivolo.app](https://rivolo.app)

Rivolo is a local-first PWA deployed on Cloudflare Pages. Notes, settings, AI requests, and cloud file transfers run in the browser. Same-origin Pages Functions exchange and refresh Google Drive, Dropbox, and OneDrive OAuth credentials. For OneDrive, an authenticated Cloudflare WebSocket relay distributes day-change events and a migration registry stores source/destination identifiers; these services never receive note contents. AI prompts and relevant notes are sent only when you ask, directly to the provider you select: Gemini, Anthropic, OpenAI, or your own OpenAI-compatible endpoint. Dropbox, Google Drive, or OneDrive receives notes only if you enable that sync provider. Custom endpoints must be reachable from the device and allow Rivolo's browser origin, headers, and HTTPS connection; on a phone, `localhost` refers to the phone itself.

> [!NOTE]
> The app was completely developed with coding agents. I use it daily. I wrote about this [here](https://diegobit.com/post/rivolo).

## MCP

Rivolo includes a local read-only MCP server for querying your exported notes from other AI tools. Build it with `npm run mcp:build`, then point your MCP client at `dist-mcp/mcp/index.js` with `RIVOLO_NOTES_FILE` set to your local Rivolo markdown file.

## Run

```bash
npm install
npm run dev
```

The Vite server is sufficient unless you are testing cloud sync. To run the built app, Pages Functions and the OneDrive relay Worker together:

```bash
npm run dev:cloud
```

## Build

```bash
npm run build
npm run preview
```

## Cloud sync setup

> Only needed if you run your own copy of Rivolo and want cloud sync. The hosted app at [rivolo.app](https://rivolo.app) already has this configured — nothing to do.

The providers use two kinds of values:

- **Public** (client ids, allowed origins) — kept in `wrangler.toml`, already committed for `localhost` and `rivolo.app`. Swap in your own ids there.
- **Secret** (client secrets, encryption keys) — never in the repo. Put them in a local `.dev.vars` file for development, and add them as encrypted secrets in the Cloudflare Pages dashboard for production. Start from `.dev.vars.example`. Any long random string works for the encryption keys.

### Google Drive

Create a Google Cloud OAuth web client, enable the Google Drive API, and list your app's origins (`localhost` and your domain) as authorized JavaScript origins. Rivolo asks only for the `drive.file` scope and manages a single `/rivolo/inbox.md` file.

Secrets you'll need:

```bash
GOOGLE_CLIENT_SECRET=...
GOOGLE_TOKEN_ENCRYPTION_KEY=...
```

One gotcha: if the Google consent screen stays in Testing mode, sign-ins expire after seven days. Publish it before relying on sync.

### Dropbox

Create a Dropbox app with `files.content.read` and `files.content.write` access, and add your callback URLs (`https://rivolo.app/auth/dropbox/callback` and the `localhost` equivalent). Dropbox needs no client secret — just one encryption key:

```bash
DROPBOX_TOKEN_ENCRYPTION_KEY=...
```

### OneDrive — shared notes across Microsoft accounts

OneDrive requires your own Microsoft app registration and deployment configuration; it is not enabled by adding the UI alone.

1. In Microsoft Entra **App registrations**, register an app supporting **accounts in any organizational directory and personal Microsoft accounts**.
2. Add a **Web** platform (not SPA: Rivolo exchanges codes in a Pages Function), with redirect URIs `http://localhost:8788/auth/onedrive/callback` and `https://YOUR-DOMAIN/auth/onedrive/callback`.
3. Add Microsoft Graph **delegated** permissions `User.Read` and `Files.ReadWrite.All`. Rivolo also requests `offline_access`. Shared files across accounts require access to files the signed-in user can edit; organization policies may require administrator consent.
4. Create a client secret. Set `ONEDRIVE_CLIENT_ID` and `ONEDRIVE_ALLOWED_ORIGINS` in the relevant `wrangler.toml` environment (use your actual origin). Set `ONEDRIVE_CLIENT_SECRET` and a separate random `ONEDRIVE_TOKEN_ENCRYPTION_KEY` in `.dev.vars` locally and Cloudflare Pages secrets in production. Never put secrets in frontend/Vite variables.
5. Deploy the event Worker first with `npm run deploy:events`, then deploy the app and Pages Functions through your usual Pages deployment. `wrangler.toml` binds `ONEDRIVE_EVENTS` to the external `rivolo-onedrive-events` Worker (including production). Keep both in the same Cloudflare account. The relay reuses `ONEDRIVE_TOKEN_ENCRYPTION_KEY` with a separate ticket key derivation; no additional secret is needed.
6. Locally, run `npm run dev:cloud`. It builds the app and starts Pages and the relay Worker in one Wrangler process using both configuration files. Restart an already-running Pages server after updating this command. Starting Pages alone leaves the external Durable Object unavailable: ticket connections and migration requests return 503. Plain Vite does not serve OAuth or WebSocket endpoints. `npm run dev:events` remains available for isolated Worker development.

OneDrive stores a notebook in a folder, with one Markdown file per day: `/Rivolo/2026/10/2026-10-01.md`. Google Drive and Dropbox keep their existing single-file format. Manual export still produces one portable Markdown notebook.

To share the notes:

1. On the device containing your notes, open **Settings → Cloud sync → OneDrive**, connect, use `/Rivolo` (or another folder path), and activate OneDrive.
2. In OneDrive, share that notebook **folder** with the other Microsoft accounts, granting edit access, and copy its sharing link.
3. On every device, connect the appropriate account, paste the folder link into **Shared folder link or OneDrive path**, save, and activate OneDrive. Opening the invitation in OneDrive first may be necessary for organization or guest accounts.
4. Pull the notebook and keep Rivolo open until the offline loading indicator finishes. Local edits and downloaded days remain available offline. **Force pull** replaces this device's notebook after a local rollback backup; **Force push** replaces matching days with this device's version while preserving unrelated remote days.

Only the active provider syncs. Changes upload after about seven seconds, and only dirty days are transferred. Each day has its own revision, merge baseline and author metadata. Independent edits to different Markdown lines are combined; concurrent additions are retained remote first, then local. Conflicting edits to the same existing line use the last push. Personal OneDrive upload sessions defer completion and the final commit carries a condition on the file revision. Business/SharePoint drives use conditional content uploads; Rivolo first verifies stale-update and duplicate-creation rejection using a temporary file containing no notes, then removes it. If the drive does not enforce these conditions, uploads stop. Conflicts trigger a fresh read and merge, with up to three attempts. Personal and business shared-folder behavior must also be verified on the accounts used for deployment.

The relay uses one Durable Object room per canonical drive/folder identity. Before issuing a short-lived encrypted ticket or publishing an event, Pages verifies folder access with Microsoft Graph and checks that changed files belong to its year/month/day hierarchy. Events contain day/file identifiers and revisions, never note contents or author names. The Worker stores the last revision per file to deduplicate retries. One socket serves the entire notebook; events pull only the affected day. Deletions invalidate the folder inventory. Startup, channel reconnection and returning to the foreground recover missed or external edits through a paginated inventory. There is no continuous OneDrive polling. Google Drive and Dropbox retain their three-minute checks. Closed or backgrounded PWAs do not continuously sync.

Successful uploads, baselines and pending notification metadata are checkpointed in the local database. Failed days can retry independently, and notification retries do not repeat completed uploads. Pending editor drafts and edits made during an upload remain protected. Confirmed remote deletions remove clean local days after a backup; a new local edit can recreate its own deleted day. Moved, renamed or malformed daily files block that day's synchronization instead of being interpreted as deleted notes. Revoked folder access stops sync while keeping local notes.

With OneDrive active, each day has an author icon that toggles a fixed-width gutter of initials beside the editable note, without moving or rewrapping its text. Adjacent lines by the same author are grouped without line numbers. Hover or tap an initial to see the author's Microsoft display name; tapping opens details with edit dates only when they differ from the note’s day. Older metadata without dates remains undated. The icon appears with the hover controls on desktop, and **Authors** appears in the note actions menu on narrow or touch screens. Attribution is stored in a versioned HTML comment in that day's file, with a name dictionary, compact runs and a SHA-256 fingerprint. It is current line attribution, not a signed audit history. Existing or unverifiable attribution appears as **Unknown author**. Names are visible to everyone with access to the folder. Removing the footer loses attribution, not note text. All collaborating clients should be updated.

Existing Markdown file targets migrate automatically before synchronization. The original file and local rollback snapshots are retained. A durable registry maps the canonical source identity to one immutable, dedicated sibling folder, using leases to coordinate devices and per-day checkpoints to resume interruptions. Rivolo automatically creates this folder beside the original Markdown file; manually splitting the file or entering a new folder path is unnecessary. A verified drive owner or an account with an explicit owner permission on the source can establish the destination. In a SharePoint document library, an explicitly identified writer can also create the dedicated sibling folder when Microsoft permits creation and the verified sharing matches the source exactly; site-group ownership is not treated as individual ownership. Rivolo verifies recipient identities, roles and restrictions. Where Graph permits it, existing individual recipients are copied with their existing roles and notifications disabled; no additional recipients are granted access. Existing SharePoint site groups are preserved through inheritance. An existing organization link can be reproduced with its original role; organization links are never a fallback for a source shared only with specific people. Unsupported or unverifiable sharing requires the owner to configure the dedicated folder's sharing and retry. A manually selected folder must be dedicated to the notebook and beside its source; selecting the source's parent still creates a dedicated child folder. Local notes remain usable while migration is blocked. Different local/cloud copies without a baseline require an explicit choice, with both copies backed up. Once verified, target settings and daily baselines change atomically; later devices use the registry and transport their local edits without resurrecting unchanged legacy days deleted from the new folder.

The migration registry stores source/destination identifiers, status, generation and lease metadata; Cloudflare never receives note contents. The retained monolithic file is a recovery copy and stops receiving updates after migration. Update or restart old clients during the transition: an already-open old client can still write to that old file. Disconnecting clears Rivolo's credential cookie; revoke the Microsoft app grant in account settings to remove consent.

Deploy the Worker before the updated Pages app. Run `npm run test:events-runtime` to verify room isolation, per-file deduplication and migration leases in the local Cloudflare runtime. See [Pages Durable Object bindings](https://developers.cloudflare.com/pages/functions/bindings/#durable-objects), [multi-worker local development](https://developers.cloudflare.com/workers/local-development/multi-workers/) and [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

Implementation references: [Microsoft authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [shared files](https://learn.microsoft.com/en-us/graph/api/shares-get?view=graph-rest-1.0), [conditional upload sessions](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0), and [browser downloads](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0).

## Debugging

Set `VITE_DEBUG_LOGS=true` to enable verbose logging.

## Credits

UI icons are from Phosphor Icons: https://phosphoricons.com/
