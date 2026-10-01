import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { version } from './package.json'
import { appIdentities, createAppIdentityBootstrap, isAppIdentity } from './src/lib/appIdentity'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const configuredIdentity = loadEnv(mode, process.cwd(), 'VITE_').VITE_APP_IDENTITY
  const defaultIdentity = isAppIdentity(configuredIdentity) ? configuredIdentity : 'rivolo'
  const brand = appIdentities[defaultIdentity]

  return {
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
    server: {
      port: 5174,
    },
    optimizeDeps: {
      exclude: ['@sqlite.org/sqlite-wasm'],
    },
    plugins: [
      {
        name: 'rivolo-app-identity',
        transformIndexHtml(html) {
          return html
            .replace('<title>Rivolo</title>', `<title>${brand.name}</title>`)
            .replace('type="image/x-icon" href="/favicon.ico"', `type="${brand.faviconType}" href="${brand.favicon}"`)
            .replace('href="/apple-touch-icon.png"', `href="${brand.icon}"`)
            .replace('href="/manifest.webmanifest"', `href="${brand.manifest}"`)
            .replace('name="apple-mobile-web-app-title" content="Rivolo"', `name="apple-mobile-web-app-title" content="${brand.shortName}"`)
            .replace('<!-- app-identity-bootstrap -->', `<script>${createAppIdentityBootstrap(defaultIdentity)}</script>`)
        },
      },
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        // Public files referenced by absolute URLs bypass Vite's module graph, so
        // list them for Workbox to keep the installed app's shell usable offline.
        includeAssets: ['favicon.ico', '*.webmanifest', '**/*.{svg,png,jpg,ttf}'],
        // Both identities use the same app id; choosing a look does not create a
        // second notebook. The launch URL carries that look into fresh PWA storage.
        manifest: false,
      }),
    ],
  }
})
