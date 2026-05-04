import { Hono } from 'hono'
import { z } from 'zod'
import { closeDb } from '../db.js'
import { loadConfig, getWorkspaceInfo, resetConfigCache } from '../lib/env.js'
import { resetBackendCache } from '../sources/factory.js'
import { isSyncInFlight, kickBackgroundSync } from '../sync.js'
import { startDesignDocWatcher, stopDesignDocWatcher } from '../designdoc/watcher.js'
import { writeActiveWorkspaceOverride } from '../workspaces.js'

const SwitchSchema = z.object({
  id: z.string().min(1),
})

export const workspaceRoutes = new Hono()

// Module-level guard: serializes concurrent POST /api/workspaces/active calls.
// The teardown sequence (closeDb / resetBackendCache / resetConfigCache) mutates
// shared singletons; allowing two switches to interleave can leave the server
// with a null DB while the config cache has already been re-primed.
let switching = false

workspaceRoutes.get('/api/workspaces', (c) => {
  loadConfig()
  const info = getWorkspaceInfo()
  return c.json({
    active: info.active,
    profiles: info.profiles,
    legacyMode: info.profiles.length === 0,
  })
})

workspaceRoutes.post('/api/workspaces/active', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = SwitchSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: { code: 'invalid', message: parsed.error.message } }, 400)

  const cfg = loadConfig()
  const info = getWorkspaceInfo()
  if (info.profiles.length === 0) {
    return c.json({ error: { code: 'legacy_mode', message: 'No WORKSPACE_* profiles are configured.' } }, 400)
  }
  const next = info.profiles.find((p) => p.id === parsed.data.id)
  if (!next) return c.json({ error: { code: 'not_found', message: `Unknown workspace: ${parsed.data.id}` } }, 404)
  if (info.active?.id === next.id) return c.json({ ok: true, active: next, changed: false })
  if (isSyncInFlight()) {
    return c.json({ error: { code: 'sync_in_progress', message: 'Wait for the current sync to finish.' } }, 409)
  }
  if (switching) {
    return c.json(
      { error: { code: 'switch_in_progress', message: 'Another workspace switch is in progress.' } },
      409,
    )
  }

  switching = true
  const previousActiveId = info.active?.id ?? null
  // Use the loaded Config (profile-aware) rather than process.env so a profile
  // override of SQLITE_PATH still resolves the correct active-workspace.json path.
  const sqlitePath = cfg.SQLITE_PATH
  try {
    writeActiveWorkspaceOverride(sqlitePath, next.id)
    closeDb()
    resetBackendCache()
    resetConfigCache()
    stopDesignDocWatcher()
    const newCfg = loadConfig()
    startDesignDocWatcher(newCfg.REPO_PATH, newCfg.DESIGNDOC_ADAPTER)
    const updated = getWorkspaceInfo()
    // Fire-and-forget: prime the new workspace's DB so the frontend's reload
    // doesn't have to wait for an organic sync trigger via /api/graph.
    kickBackgroundSync()
    return c.json({ ok: true, active: updated.active, changed: true })
  } catch (err) {
    // Best-effort recovery: try to point the override file back at the previous
    // active id and re-prime the config so we don't leave the server stuck
    // pointing at a half-initialised workspace.
    try {
      if (previousActiveId) writeActiveWorkspaceOverride(sqlitePath, previousActiveId)
      resetConfigCache()
      const restoreCfg = loadConfig()
      startDesignDocWatcher(restoreCfg.REPO_PATH, restoreCfg.DESIGNDOC_ADAPTER)
    } catch (recoveryErr) {
      console.error('[issue-graph] Failed to restore workspace after switch error:', recoveryErr)
    }
    console.error('[issue-graph] Workspace switch failed:', err)
    return c.json(
      { error: { code: 'switch_failed', message: 'Failed to switch workspace. See server logs.' } },
      500,
    )
  } finally {
    switching = false
  }
})
