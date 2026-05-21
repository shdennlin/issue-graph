import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getDefaultWorkspaceId, getWorkspaceInfo, loadConfig } from './lib/env.js'
import { getLogger } from './lib/log.js'
import { getDb } from './db.js'
import { LEGACY_WORKSPACE_ID, runWithWorkspace } from './lib/workspaceContext.js'
import { graphRoutes } from './routes/graph.js'
import { syncRoutes } from './routes/sync.js'
import { issueRoutes } from './routes/issue.js'
import { projectRoutes } from './routes/project.js'
import { labelsRoutes } from './routes/labels.js'
import { healthRoutes } from './routes/health.js'
import { annotationRoutes } from './routes/annotations.js'
import { notesRoutes } from './routes/notes.js'
import { settingsRoutes } from './routes/settings.js'
import { snapshotRoutes } from './routes/snapshots.js'
import { exportRoutes } from './routes/exportRoutes.js'
import { coverageRoutes } from './routes/coverage.js'
import { eventsRoutes } from './routes/events.js'
import { workspaceRoutes } from './routes/workspaces.js'
import { startDesignDocWatcher } from './designdoc/watcher.js'

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

  // Eagerly init the default workspace's DB so schema migrations run at startup.
  getDb()

  // Per-request workspace middleware: resolve `?w=<id>` (or fall back to the
  // current default) and run the rest of the handler chain under that
  // workspace's AsyncLocalStorage context. Downstream call sites (loadConfig,
  // getDb, getBackend, sync, cache) read it via `getCurrentWorkspaceId()`
  // without any per-route plumbing.
  app.use('/api/*', async (c, next) => {
    const info = getWorkspaceInfo()
    const requested = c.req.query('w')?.toLowerCase() ?? null
    let wid: string
    if (info.profiles.length === 0) {
      // Legacy mode: no profiles defined. Always use the sentinel; ignore ?w.
      wid = LEGACY_WORKSPACE_ID
    } else if (requested && info.profiles.some((p) => p.id === requested)) {
      wid = requested
    } else {
      // Either no ?w, or it pointed at an unknown id (the frontend bootstrap
      // should have caught this). Fall through to the server's default — the
      // request still gets serviced from a real workspace rather than 4xx-ing
      // on a transient mismatch (e.g. just-deleted profile while a stale tab
      // refetches).
      wid = getDefaultWorkspaceId()
    }
    return runWithWorkspace(wid, () => next())
  })

  app.route('/', healthRoutes)
  app.route('/', graphRoutes)
  app.route('/', syncRoutes)
  app.route('/', issueRoutes)
  app.route('/', projectRoutes)
  app.route('/', labelsRoutes)
  app.route('/', annotationRoutes)
  app.route('/', notesRoutes)
  app.route('/', settingsRoutes)
  app.route('/', snapshotRoutes)
  app.route('/', exportRoutes)
  app.route('/', coverageRoutes)
  app.route('/', eventsRoutes)
  app.route('/', workspaceRoutes)

  // File watcher for design-doc files. Pushes 'designdoc-changed' events to
  // SSE clients on tasks.md / proposal.md edits. Watches the *default*
  // workspace only — non-default tabs fall back to the existing 30s
  // frontend poll. Idempotent — calling multiple times during dev's
  // hot-reload cycles is harmless. Falls back to sync-time scans if the
  // watcher can't start (missing openspec/, etc.).
  startDesignDocWatcher(cfg.REPO_PATH, cfg.DESIGNDOC_ADAPTER, getDefaultWorkspaceId())

  app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /\n'))

  // Static frontend (only if dist/ has been built AND SERVE_STATIC is on).
  // Dev sets SERVE_STATIC=false so a stale dist/ doesn't shadow Vite — the
  // backend then returns a clear "use Vite at <port>" message at root instead
  // of silently serving an old build that looks like missing changes.
  const staticRoot = cfg.SERVE_STATIC ? findStaticRoot() : null
  if (!cfg.SERVE_STATIC) {
    // Dev mode: the user shouldn't have to think about which port is the
    // backend vs. the Vite UI. If they land on the backend root by mistake,
    // 302 them to Vite so the dev experience is "open one URL and go."
    // Compute Vite's actual port (mirroring the collision-shift in
    // vite.config.ts) so the redirect lands somewhere real.
    let vitePort = cfg.VITE_PORT
    if (vitePort === cfg.PORT) {
      vitePort = cfg.PORT === 31415 ? 31414 : cfg.PORT + 1
    }
    const viteUrl = `http://localhost:${vitePort}`
    app.get('/', (c) => c.redirect(viteUrl, 302))
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
