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

  app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /\n'))

  // Static frontend (only if dist/ has been built).
  const staticRoot = findStaticRoot()
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
