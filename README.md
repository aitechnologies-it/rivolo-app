<p align="center">
  <img src="public/logo.png" alt="Rivolo" width="180" />
</p>

<p align="center"><em>The no-notes notes app 💧</em></p>

Rivolo (REE-voh-loh) is the Italian word for "small stream". Every day, you write your thoughts, ideas, notes and todos without organizing anything. Whenever you need to find something complex, just ask the LLM to surface what you need.

Try it here: [rivolo.app](https://rivolo.app)

Rivolo is a local-first PWA deployed on Cloudflare Pages. Notes, settings, AI requests, and cloud file transfers run in the browser. A small same-origin Pages Function is used only to exchange and refresh Google Drive and Dropbox OAuth credentials; it never receives note contents. AI prompts and relevant notes are sent only when you ask, directly to the provider you select: Gemini, Anthropic, OpenAI, or your own OpenAI-compatible endpoint. Dropbox or Google Drive receives notes only if you enable that sync provider. Custom endpoints must be reachable from the device and allow Rivolo's browser origin, headers, and HTTPS connection; on a phone, `localhost` refers to the phone itself.

> [!NOTE]
> The app was completely developed with coding agents. I use it daily. I wrote about this [here](https://diegobit.com/post/rivolo).

## MCP

Rivolo includes a local read-only MCP server for querying your exported notes from other AI tools. Build it with `npm run mcp:build`, then point your MCP client at `dist-mcp/mcp/index.js` with `RIVOLO_NOTES_FILE` set to your local Rivolo markdown file.

## Run

```bash
npm install
npm run dev
```

The Vite server is sufficient unless you are testing Google Drive or Dropbox authentication. To run the built app and its Pages Functions together:

```bash
npm run build
npx wrangler pages dev dist
```

## Build

```bash
npm run build
npm run preview
```

## Rivolo and AIT identities

Settings → Appearance → App identity switches between Rivolo and Rivolo x AIT. The choice stays on the current device and web address; it does not change notes or sync settings. The company domain, `rivolo.aitlab.it`, defaults to AIT, while `rivolo.app` defaults to Rivolo.

For the company deployment, set `VITE_APP_IDENTITY=ait` in the build environment so the initial HTML also contains the company title and installation icons. To preview that build locally:

```bash
VITE_APP_IDENTITY=ait npm run build
npm run preview
```

Choose the identity before adding the app to the home screen. Browsers may keep an already installed icon or name until the app is added again. Each identity has its own manifest and icons, with a shared app ID on the same web address. The personal and company domains have separate browser storage.

The company brain in `public/ait-brain.svg` comes from the supplied AI Technologies SVG, with the lettering removed. The white-and-blue stream icons in `public/icons/ait-*.png` were created with the builtin imagegen tool from Rivolo's existing icon using this prompt:

> Edit target: the provided existing Rivolo app icon. Create its inverse colourway for the company's companion version. Change only colours: replace the blue square background with a pure white background, and recolour the existing white winding stream shape into Rivolo's cyan blue (#22b3ff, gently deepening to #169fe6). Preserve the EXACT stream silhouette, curves, location, proportions, thin upper-left swoosh and the softly fading trailing stream layers from the original. Full-bleed square app icon, sharp clean edges, no rounded frame baked into the image, no shadows around the square, no text, no letters, no AIT badge, no brain, no additional symbols. It must be recognizably the SAME Rivolo stream icon with white and blue exchanged. Output a square high-resolution PNG suitable for 512px, 192px and 180px exports.

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

## Debugging

Set `VITE_DEBUG_LOGS=true` to enable verbose logging.

## Credits

UI icons are from Phosphor Icons: https://phosphoricons.com/
