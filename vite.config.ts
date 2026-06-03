import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { visualizer } from 'rollup-plugin-visualizer'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendPort = Number(env.PORT) || 31415
  let vitePort = Number(env.VITE_PORT) || 31414
  // Collision guard: if a user sets PORT=31414 in .env without also setting
  // VITE_PORT, both default-resolve to 31414. The backend grabs the port
  // first; Vite silently fails to bind, and the browser then hits the
  // backend's static-fallback (serving stale dist/) instead of the live Vite
  // dev server — looking like "old data" with no obvious cause. Auto-shift
  // and warn loudly instead of failing silently.
  if (vitePort === backendPort) {
    const next = backendPort === 31415 ? 31414 : backendPort + 1
    // eslint-disable-next-line no-console
    console.warn(
      `[vite.config] VITE_PORT (${vitePort}) collides with backend PORT (${backendPort}). ` +
        `Falling back to ${next}. Set VITE_PORT explicitly in .env to silence this.`,
    )
    vitePort = next
  }
  return {
    root: 'src/frontend',
    plugins: [
      react(),
      // Bundle-composition report. Off by default; flip on with
      // `ANALYZE=1 bun run build:web` to produce `dist/stats.html` —
      // useful for spotting accidentally-included heavy deps or to
      // check the effect of a lazy-load split.
      env.ANALYZE
        ? visualizer({
            filename: 'dist/stats.html',
            template: 'treemap',
            gzipSize: true,
            brotliSize: true,
          })
        : null,
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg', 'icon-maskable.svg'],
        // Don't precache /api responses or the SSE stream — those are live and
        // workspace-specific. App-shell offline so the dock icon launches
        // instantly; data still hits the network when online.
        workbox: {
          navigateFallbackDenylist: [/^\/api\//, /^\/events/],
          globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        },
        manifest: {
          name: 'Issue Graph',
          short_name: 'Issues',
          description: 'Self-hosted, read-only graph viewer for issue dependencies',
          theme_color: '#1c1f26',
          background_color: '#1c1f26',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          // Reuse the existing PWA window instead of spawning a new one on every
          // external launch (e.g. deep links from the Raycast extension). Chrome
          // focuses the open client and navigates it to the launch URL; the
          // SPA's urlSync then reacts to the new ?focus=/?chain= params. Without
          // this, each `open -a "Issue Graph" <url>` opens a fresh window.
          launch_handler: { client_mode: 'navigate-existing' },
          icons: [
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
        '@frontend': fileURLToPath(new URL('./src/frontend', import.meta.url)),
      },
      // Force a single React instance. Without dedupe, Vite's optimizer can
      // pre-bundle a dependency (e.g. @dnd-kit/core) against a different React
      // copy than the app's, producing "Invalid hook call" errors at runtime.
      dedupe: ['react', 'react-dom'],
    },
    // Pre-bundle @dnd-kit so it shares the same React instance as the app.
    optimizeDeps: {
      include: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
    },
    server: {
      port: vitePort,
      proxy: {
        '/api': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: false,
        },
      },
    },
    build: {
      outDir: '../../dist',
      emptyOutDir: true,
      sourcemap: true,
    },
  }
})
