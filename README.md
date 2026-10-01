<p align="center">
  <img src="public/logo.png" alt="Rivolo" width="180" />
</p>

<p align="center"><em>The no-notes notes app 💧</em></p>

Rivolo (REE-voh-loh) is the Italian word for "small stream". Every day, you write your thoughts, ideas, notes and todos without organizing anything. Whenever you need to find something complex, just ask the LLM to surface what you need.

Try it here: [rivolo.app](https://rivolo.app)

Rivolo is a local-first PWA deployed on Cloudflare Pages. Notes, settings, AI requests, and cloud file transfers run in the browser. A small same-origin Pages Function is used only to exchange and refresh Google Drive, Dropbox, and OneDrive OAuth credentials; it never receives note contents. AI prompts and relevant notes are sent only when you ask, directly to the provider you select: Gemini, Anthropic, OpenAI, or your own OpenAI-compatible endpoint. Dropbox, Google Drive, or OneDrive receives notes only if you enable that sync provider. Custom endpoints must be reachable from the device and allow Rivolo's browser origin, headers, and HTTPS connection; on a phone, `localhost` refers to the phone itself.

> [!NOTE]
> The app was completely developed with coding agents. I use it daily. I wrote about this [here](https://diegobit.com/post/rivolo).

## MCP

Rivolo includes a local read-only MCP server for querying your exported notes from other AI tools. Build it with `npm run mcp:build`, then point your MCP client at `dist-mcp/mcp/index.js` with `RIVOLO_NOTES_FILE` set to your local Rivolo markdown file.

## Run

```bash
npm install
npm run dev
```

The Vite server is sufficient unless you are testing Google Drive, Dropbox, or OneDrive authentication. To run the built app and its Pages Functions together:

```bash
npm run build
npx wrangler pages dev dist
```

## Build

```bash
npm run build
npm run preview
```

## Cloud sync setup

> Only needed if you run your own copy of Rivolo and want Google Drive or Dropbox sync. The hosted app at [rivolo.app](https://rivolo.app) already has this configured — nothing to do.

Both providers work the same way. Two kinds of values:

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
5. Run `npm run dev:cloud` locally, or deploy the app and Pages Functions. Plain Vite does not serve OAuth endpoints.

To share the notes:

1. On the device containing your notes, open **Settings → Cloud sync → OneDrive**, connect, and push to `/rivolo-notes.md`. Custom folder paths require an existing parent folder.
2. In OneDrive, share that Markdown file with the other Microsoft accounts, granting **edit** access, and copy its sharing link. Share the **file**, not a folder or browser address.
3. On every device, connect the appropriate Microsoft account, paste the same sharing link into **Shared file link or OneDrive path**, save, and activate OneDrive. Opening the invitation in OneDrive first may be necessary for organization or guest accounts.
4. On devices that should receive the existing notes, choose **Pull from OneDrive**. If local notes or a newly selected target block the pull, the explicit **Force pull** action replaces this device's notes and saves a local rollback backup first. Export any independent notes you want to combine before replacing them.

Only the active provider syncs. Changes upload after about seven seconds; remote updates are checked at startup, reconnect, return to the foreground, and every five seconds for OneDrive (three minutes for other providers) while visible. OneDrive slows down retries after errors and respects server throttling delays. Closed/backgrounded PWAs do not continuously sync. Offline notes stay local until reconnection.

OneDrive shares the entire notebook and merges it against the last synchronized local copy before uploading. The conflict unit is always a **line** (a newline in the Markdown, not a visually wrapped screen line): independent edits to different lines, including inside a paragraph or code fence, are combined. Concurrent additions are kept in groups, remote first and then local. For conflicting changes to the same existing line, the last push wins. New days are combined by day marker. Line identity is inferred from text and position; moves and extensive rewrites can be ambiguous. Comparisons skip unchanged prefixes/suffixes and use a linear-memory line alignment algorithm. There is no paragraph fallback, size-based merge block, or size warning. Upload conflicts trigger a fresh read and merge, with up to three attempts. An explicit force push still replaces the file without merging.

With OneDrive active, each day has an **Authors** button. It shows a read-only view with the last editor’s Microsoft display name beside each line; **Edit** returns to the editor. This is current line attribution, not a full audit history. Existing text before tracking remains **Unknown author**. New or changed local lines are attributed at upload (and previewed locally before sync); unchanged lines retain their authors. Edits from external editors with missing or stale attribution are not attributed to a guessed person.

Attribution is saved in a versioned HTML comment at the end of the same `.md` file, with a name dictionary, compact runs of line authors, and a SHA-256 fingerprint per day. Names are therefore shared with everyone who can read the file. Rivolo strips the metadata from note text and verifies its fingerprint before displaying names. Metadata is not a signed identity record. Removing the comment loses shared attribution, not the notes. All collaborating Rivolo clients should be updated: old clients do not understand this footer. Author views load only when opened and render 200 lines at a time; line attribution uses the same line alignment as merging.

Local pending edits are saved and merged before remote updates are applied. Once a file has been synchronized, remote deletions of individual days are also applied automatically. Empty or malformed notebooks remain blocked. An existing file selected for the first time still requires an explicit pull or force push. For connections created before merge support, a successful clean pull or upload establishes the merge baseline; if both copies already differ without a baseline, Rivolo asks which copy to keep. Dropbox and Google Drive retain their existing conflict handling. OneDrive's file version history and Rivolo's local rollback backups provide recovery. A revoked/read-only sharing link stops sync without deleting local notes. Disconnecting clears Rivolo's credential cookie; revoke the Microsoft app grant in your account settings to remove consent as well.

Implementation references: [Microsoft authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [shared files](https://learn.microsoft.com/en-us/graph/api/shares-get?view=graph-rest-1.0), [conditional upload sessions](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0), and [browser downloads](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0).

## Debugging

Set `VITE_DEBUG_LOGS=true` to enable verbose logging.

## Credits

UI icons are from Phosphor Icons: https://phosphoricons.com/
