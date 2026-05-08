import { Hono } from 'hono'
import { z } from 'zod'
import {
  bustDefaultWorkspaceCache,
  getBaseSqlitePath,
  getDefaultWorkspaceId,
  getWorkspaceInfo,
  loadConfig,
} from '../lib/env.js'
import { BUS_EVENT, publish } from '../lib/eventBus.js'
import { runWithWorkspace } from '../lib/workspaceContext.js'
import { startDesignDocWatcher, stopDesignDocWatcher } from '../designdoc/watcher.js'
import { writeActiveWorkspaceOverride } from '../workspaces.js'

const SwitchSchema = z.object({
  id: z.string().min(1),
})

export const workspaceRoutes = new Hono()

// Module-level guard: serializes concurrent POST /api/workspaces/active calls.
// Per-tab workspaces removed the heavy DB / cache teardown the old code did,
// but writing active-workspace.json + restarting the file watcher still must
// be atomic across simultaneous requests.
let switching = false

workspaceRoutes.get('/api/workspaces', (c) => {
  // GET reflects the **server-default** workspace (what new tabs land on,
  // what the file watcher follows) regardless of the requesting tab's `?w=`.
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

  const info = getWorkspaceInfo()
  if (info.profiles.length === 0) {
    return c.json({ error: { code: 'legacy_mode', message: 'No WORKSPACE_* profiles are configured.' } }, 400)
  }
  const next = info.profiles.find((p) => p.id === parsed.data.id)
  if (!next) return c.json({ error: { code: 'not_found', message: `Unknown workspace: ${parsed.data.id}` } }, 404)
  if (info.active?.id === next.id) return c.json({ ok: true, active: next, changed: false })
  if (switching) {
    return c.json(
      { error: { code: 'switch_in_progress', message: 'Another default-workspace change is in progress.' } },
      409,
    )
  }

  switching = true
  // Override file MUST live next to the base SQLITE_PATH, NOT next to the
  // profile-resolved cfg.SQLITE_PATH (which already includes a workspaces/<id>/
  // component and would route the override into a per-workspace subdir that
  // the loader never reads from).
  const sqlitePath = getBaseSqlitePath()
  try {
    writeActiveWorkspaceOverride(sqlitePath, next.id)
    bustDefaultWorkspaceCache()
    stopDesignDocWatcher()
    const newDefaultWid = getDefaultWorkspaceId()
    const newCfg = await runWithWorkspace(newDefaultWid, () => loadConfig())
    startDesignDocWatcher(newCfg.REPO_PATH, newCfg.DESIGNDOC_ADAPTER, newDefaultWid)
    publish({
      type: BUS_EVENT.DEFAULT_WORKSPACE_CHANGED,
      data: { activeId: next.id },
    })
    const updated = getWorkspaceInfo()
    return c.json({ ok: true, active: updated.active, changed: true })
  } catch (err) {
    // Best-effort recovery: try to point the override file back at the
    // previous active id and re-prime the watcher so we don't leave the
    // server with no watcher running.
    try {
      if (info.active?.id) {
        writeActiveWorkspaceOverride(sqlitePath, info.active.id)
        bustDefaultWorkspaceCache()
        const restoreWid = getDefaultWorkspaceId()
        const restoreCfg = await runWithWorkspace(restoreWid, () => loadConfig())
        startDesignDocWatcher(restoreCfg.REPO_PATH, restoreCfg.DESIGNDOC_ADAPTER, restoreWid)
      }
    } catch (recoveryErr) {
      console.error('[issue-graph] Failed to restore default workspace after change error:', recoveryErr)
    }
    console.error('[issue-graph] Default workspace change failed:', err)
    return c.json(
      { error: { code: 'switch_failed', message: 'Failed to change default workspace. See server logs.' } },
      500,
    )
  } finally {
    switching = false
  }
})
