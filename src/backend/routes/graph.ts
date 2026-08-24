import { Hono } from 'hono'
import type { GraphResponse } from '@shared/types.js'
import { loadConfig, isAuthConfigured } from '../lib/env.js'
import {
  isCacheFresh,
  readCachedIssues,
  readCachedLabels,
  readDesigndocsCached,
  readLastSyncMs,
  readAnnotations,
  readMeta,
  readLastSyncOutcome,
} from '../cache.js'
import type { WorkspaceChangeWarning } from '@shared/types.js'
import { kickBackgroundSync, syncOnce, readViewerCached } from '../sync.js'
import { getActiveDesignDocAdapter } from '../designdoc/factory.js'
import { syncFailureKind } from '../lib/syncStatus.js'

export const graphRoutes = new Hono()

graphRoutes.get('/api/graph', async (c) => {
  const cfg = loadConfig()
  const fresh = isCacheFresh()
  const cacheEmpty = readLastSyncMs() === null

  if (cacheEmpty && isAuthConfigured(cfg)) {
    // First-run blocking sync so the user sees data immediately.
    await syncOnce({ force: true })
  } else if (!fresh) {
    kickBackgroundSync()
  }

  const issues = readCachedIssues()
  const labels = readCachedLabels()
  const designdocs = readDesigndocsCached()
  const annotations = readAnnotations()
  const viewer = readViewerCached()
  const fetchedAt = readLastSyncMs() ?? 0
  const adapter = getActiveDesignDocAdapter(cfg.REPO_PATH, cfg.DESIGNDOC_ADAPTER)

  let workspaceWarning: WorkspaceChangeWarning | null = null
  const warnRaw = readMeta('workspace_change_warning')
  if (warnRaw) {
    try {
      workspaceWarning = JSON.parse(warnRaw) as WorkspaceChangeWarning
    } catch {
      // Malformed meta — ignore. The next sync will overwrite it.
    }
  }

  const body: GraphResponse = {
    data: {
      issues,
      labels,
      designdocs,
      annotations,
      viewer,
      fetchedAt,
    },
    stale: !fresh,
    fetchedAt,
    instanceLabel: cfg.INSTANCE_LABEL,
    hasDesigndoc: adapter !== null,
    cacheEmpty: issues.length === 0 && cacheEmpty,
    workspaceWarning,
    authError: !isAuthConfigured(cfg),
    syncFailure: (() => {
      const last = readLastSyncOutcome()
      const kind = syncFailureKind(last?.status)
      return kind ? { kind, message: last?.message ?? null } : null
    })(),
  }
  return c.json(body)
})
