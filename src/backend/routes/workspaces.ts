// Workspace roster: list, select the server default, and CRUD.
//
// Credentials are write-only across this boundary. GET ships WorkspaceProfile,
// which reports `linearApiKeySet` / `webhookSecretSet` as booleans and carries
// no secret values — same contract as `linear_api_key_set` in settings.ts.
//
// These routes accept credentials, so they must never be published. The
// Tailscale funnel mount is path-scoped to /api/webhooks/linear precisely so
// that the rest of the API, this file included, stays unreachable from outside.

import { Hono } from 'hono'
import { z } from 'zod'
import {
  bustDefaultWorkspaceCache,
  getBaseSqlitePath,
  getDefaultWorkspaceId,
  getWorkspaceInfo,
  invalidateWorkspaceConfig,
  loadConfig,
} from '../lib/env.js'
import { BUS_EVENT, publish } from '../lib/eventBus.js'
import { getLogger } from '../lib/log.js'
import { runWithWorkspace } from '../lib/workspaceContext.js'
import { startDesignDocWatcher, stopDesignDocWatcher } from '../designdoc/watcher.js'
import { isValidWorkspaceId, normalizeWorkspaceId, workspaceDbPath } from '../controlStore.js'
import {
  ACTIVE_WORKSPACE_KEY,
  deleteWorkspace,
  readWorkspaceRows,
  upsertWorkspace,
  writeControlMeta,
} from '../controlDb.js'
import { resetBackendCache } from '../sources/factory.js'

const SwitchSchema = z.object({ id: z.string().min(1) })

/** `id` is validated by isValidWorkspaceId rather than a zod regex so the rule
 *  lives in exactly one place — it is a path-traversal guard, not a format
 *  preference, because the id becomes a directory name. */
const CreateSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200).optional(),
  backend: z.enum(['linear']).optional(),
  apiKey: z.string().max(500).optional(),
  webhookSecret: z.string().max(200).optional(),
  teamId: z.string().max(200).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
})

const UpdateSchema = CreateSchema.omit({ id: true })

export const workspaceRoutes = new Hono()

// Serializes concurrent default-workspace changes: writing the stored id and
// restarting the file watcher must be atomic across simultaneous requests.
let switching = false

/** Re-read a workspace's config and rebuild its backend adapter on the next
 *  use. Without this an edited API key sits in the roster while the process
 *  keeps using the old one until restart. */
function applyWorkspaceEdit(id: string): void {
  invalidateWorkspaceConfig(id)
  resetBackendCache(id)
}

workspaceRoutes.get('/api/workspaces', (c) => {
  // Reflects the **server-default** workspace (what new tabs land on, what the
  // file watcher follows) regardless of the requesting tab's `?w=`.
  const info = getWorkspaceInfo()
  return c.json({
    active: info.active,
    profiles: info.profiles,
    /** Empty roster: the frontend shows onboarding instead of the graph. */
    unconfigured: info.profiles.length === 0,
  })
})

workspaceRoutes.post('/api/workspaces', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'invalid', message: parsed.error.message } }, 400)
  }
  const id = normalizeWorkspaceId(parsed.data.id)
  if (!isValidWorkspaceId(id)) {
    return c.json(
      {
        error: {
          code: 'invalid_id',
          message: 'Use lowercase letters, digits and dashes; must start with a letter or digit.',
        },
      },
      400,
    )
  }
  if (readWorkspaceRows().some((r) => r.id === id)) {
    return c.json({ error: { code: 'exists', message: `Workspace "${id}" already exists.` } }, 409)
  }

  upsertWorkspace({ ...parsed.data, id, name: parsed.data.name ?? id })
  bustDefaultWorkspaceCache()
  applyWorkspaceEdit(id)
  getLogger().info({ workspaceId: id }, 'workspace created')
  // The slug decides the data path, so re-adding a previously-removed id
  // re-adopts whatever cache is already on disk.
  const dbPath = workspaceDbPath(getBaseSqlitePath(), id)
  return c.json({ ok: true, id, dbPath, adoptedExistingData: true }, 201)
})

workspaceRoutes.patch('/api/workspaces/:id', async (c) => {
  const id = normalizeWorkspaceId(c.req.param('id'))
  const body = await c.req.json().catch(() => null)
  const parsed = UpdateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'invalid', message: parsed.error.message } }, 400)
  }
  const existing = readWorkspaceRows().find((r) => r.id === id)
  if (!existing) {
    return c.json({ error: { code: 'not_found', message: `Unknown workspace: ${id}` } }, 404)
  }
  // Omitted credential fields keep their stored value; '' clears one. That is
  // what lets the UI render an empty password box without wiping the secret on
  // every unrelated save.
  upsertWorkspace({ ...parsed.data, id, name: parsed.data.name ?? existing.name })
  applyWorkspaceEdit(id)
  getLogger().info({ workspaceId: id }, 'workspace updated')
  return c.json({ ok: true, id })
})

workspaceRoutes.delete('/api/workspaces/:id', (c) => {
  const id = normalizeWorkspaceId(c.req.param('id'))
  const rows = readWorkspaceRows()
  if (!rows.some((r) => r.id === id)) {
    return c.json({ error: { code: 'not_found', message: `Unknown workspace: ${id}` } }, 404)
  }
  // Roster row only. `data/workspaces/<id>/` stays on disk: re-adding the slug
  // brings the cache back, and destroying issue history behind a DELETE would
  // need a confirmation flow this app does not have.
  deleteWorkspace(id)
  bustDefaultWorkspaceCache()
  applyWorkspaceEdit(id)
  getLogger().warn({ workspaceId: id }, 'workspace removed from roster (data left on disk)')
  return c.json({ ok: true, id, dataRetained: true })
})

workspaceRoutes.post('/api/workspaces/active', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = SwitchSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: { code: 'invalid', message: parsed.error.message } }, 400)

  const info = getWorkspaceInfo()
  if (info.profiles.length === 0) {
    return c.json({ error: { code: 'unconfigured', message: 'No workspaces are configured yet.' } }, 400)
  }
  const next = info.profiles.find((p) => p.id === normalizeWorkspaceId(parsed.data.id))
  if (!next) return c.json({ error: { code: 'not_found', message: `Unknown workspace: ${parsed.data.id}` } }, 404)
  if (info.active?.id === next.id) return c.json({ ok: true, active: next, changed: false })
  if (switching) {
    return c.json(
      { error: { code: 'switch_in_progress', message: 'Another default-workspace change is in progress.' } },
      409,
    )
  }

  switching = true
  const previousId = info.active?.id ?? null
  try {
    writeControlMeta(ACTIVE_WORKSPACE_KEY, next.id)
    bustDefaultWorkspaceCache()
    stopDesignDocWatcher()
    const newDefaultWid = getDefaultWorkspaceId()
    const newCfg = await runWithWorkspace(newDefaultWid, () => loadConfig())
    startDesignDocWatcher(newCfg.REPO_PATH, newCfg.DESIGNDOC_ADAPTER, newDefaultWid)
    publish({ type: BUS_EVENT.DEFAULT_WORKSPACE_CHANGED, data: { activeId: next.id } })
    const updated = getWorkspaceInfo()
    return c.json({ ok: true, active: updated.active, changed: true })
  } catch (err) {
    // Best-effort recovery: point the stored id back at the previous default
    // and re-prime the watcher so the server is never left without one.
    try {
      if (previousId) {
        writeControlMeta(ACTIVE_WORKSPACE_KEY, previousId)
        bustDefaultWorkspaceCache()
        const restoreWid = getDefaultWorkspaceId()
        const restoreCfg = await runWithWorkspace(restoreWid, () => loadConfig())
        startDesignDocWatcher(restoreCfg.REPO_PATH, restoreCfg.DESIGNDOC_ADAPTER, restoreWid)
      }
    } catch (recoveryErr) {
      getLogger().error({ err: recoveryErr }, 'failed to restore default workspace after change error')
    }
    getLogger().error({ err }, 'default workspace change failed')
    return c.json(
      { error: { code: 'switch_failed', message: 'Failed to change default workspace. See server logs.' } },
      500,
    )
  } finally {
    switching = false
  }
})
