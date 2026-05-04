import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadConfig } from './lib/env.js'
import { getLogger } from './lib/log.js'
import { getDb } from './db.js'
import { graphRoutes } from './routes/graph.js'
import { syncRoutes } from './routes/sync.js'
import { issueRoutes } from './routes/issue.js'
import { labelsRoutes } from './routes/labels.js'
import { healthRoutes } from './routes/health.js'
import { annotationRoutes } from './routes/annotations.js'
import { settingsRoutes } from './routes/settings.js'
import { snapshotRoutes } from './routes/snapshots.js'
import { exportRoutes } from './routes/exportRoutes.js'
import { coverageRoutes } from './routes/coverage.js'

function findStaticRoot(): string | null {
  const candidates = [
    resolve(process.cwd(), 'dist'),
    resolve(process.cwd(), '..', 'dist'),
    '/app/dist',
  ]
  for (const c of candidates) if (existsSync(join(c, 'index.html'))) return c
  return null
}

export function createApp(): Hono {
  const app = new Hono()
  const cfg = loadConfig()
  const log = getLogger()

  // Eagerly init DB so schema migrations run at startup.
  getDb()

  app.route('/', healthRoutes)
  app.route('/', graphRoutes)
  app.route('/', syncRoutes)
  app.route('/', issueRoutes)
  app.route('/', labelsRoutes)
  app.route('/', annotationRoutes)
  app.route('/', settingsRoutes)
  app.route('/', snapshotRoutes)
  app.route('/', exportRoutes)
  app.route('/', coverageRoutes)

  app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /\n'))

  // Static frontend (only if dist/ has been built AND SERVE_STATIC is on).
  // Dev sets SERVE_STATIC=false so a stale dist/ doesn't shadow Vite — the
  // backend then returns a clear "use Vite at <port>" message at root instead
  // of silently serving an old build that looks like missing changes.
  const staticRoot = cfg.SERVE_STATIC ? findStaticRoot() : null
  if (!cfg.SERVE_STATIC) {
    // Compute Vite's actual dev port. If VITE_PORT collides with backend PORT,
    // vite.config.ts auto-shifts (31415→31414 special case, otherwise +1).
    // Mirror that here so the message points the user to the right URL.
    let vitePort = cfg.VITE_PORT
    if (vitePort === cfg.PORT) {
      vitePort = cfg.PORT === 31415 ? 31414 : cfg.PORT + 1
    }
    app.get('/', (c) =>
      c.text(
        `API only (SERVE_STATIC=false). Open the Vite dev server at http://localhost:${vitePort} for the UI.`,
      ),
    )
  }
  if (staticRoot) {
    app.use(
      '/*',
      serveStatic({
        root: staticRoot.replace(`${process.cwd()}/`, '') || './',
      }),
    )
    // SPA fallback: any non-API GET serves index.html.
    app.get('*', async (c) => {
      const indexPath = join(staticRoot, 'index.html')
      if (!existsSync(indexPath)) return c.text('Frontend not built', 404)
      const { readFileSync } = await import('node:fs')
      return c.html(readFileSync(indexPath, 'utf-8'))
    })
  } else {
    log.warn('No dist/ found — frontend not served. Run `npm run build:web` or use `npm run dev:web`.')
  }

  log.info({ port: cfg.PORT, instance: cfg.INSTANCE_LABEL }, 'issue-graph server starting')
  return app
}

const app = createApp()
const cfg = loadConfig()
serve({ fetch: app.fetch, port: cfg.PORT, hostname: '0.0.0.0' })
getLogger().info({ url: `http://0.0.0.0:${cfg.PORT}` }, 'listening')
