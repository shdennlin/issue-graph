import { getLogger } from './lib/log.js'
import { loadConfig, isAuthConfigured, getDefaultWorkspaceId } from './lib/env.js'
import { getCurrentWorkspaceId, LEGACY_WORKSPACE_ID } from './lib/workspaceContext.js'
import { getDb } from './db.js'
import {
  writeIssueCache,
  writeLabelCache,
  writeLastSyncMs,
  writeDesigndocsCached,
  writeWorkflowStatesCached,
  writeMeta,
  readMeta,
  readExtendedScopeDays,
  countCachedIssues,
} from './cache.js'
import { getBackend } from './sources/factory.js'
import { AuthError, RateLimitError } from './sources/types.js'
import { runDesignDocScan } from './designdoc/factory.js'

interface SyncResult {
  ok: boolean
  count: number | null
  durationMs: number
  status: 'success' | 'rate_limited' | 'api_error' | 'partial' | 'auth_error'
  errorMessage?: string
}

// Per-workspace sync state: one tab on workspace A and another on workspace B
// can sync simultaneously, but two tabs on the same workspace coalesce to a
// single in-flight sync (the second caller awaits the first and returns the
// shared result). Background-sync debouncing is also per-workspace so trigger
// floods on A don't suppress B.
const inflightByWid: Map<string, Promise<SyncResult>> = new Map()
const backgroundLastByWid: Map<string, number> = new Map()
const VIEWER_KEY = 'viewer_json'
const SNAPSHOT_DATE_KEY = 'last_snapshot_yyyymmdd'

function currentWid(): string {
  return getCurrentWorkspaceId() ?? getDefaultWorkspaceId() ?? LEGACY_WORKSPACE_ID
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function syncOnce({ force = false }: { force?: boolean } = {}): Promise<SyncResult> {
  const wid = currentWid()
  const existing = inflightByWid.get(wid)
  if (existing && !force) return existing
  if (existing && force) {
    // Wait for the in-flight one to settle, then run a fresh one.
    await existing.catch(() => undefined)
  }
  const p = doSync()
  inflightByWid.set(wid, p)
  try {
    return await p
  } finally {
    if (inflightByWid.get(wid) === p) inflightByWid.delete(wid)
  }
}

export function isSyncInFlight(workspaceId?: string): boolean {
  const wid = workspaceId ?? currentWid()
  return inflightByWid.has(wid)
}

async function doSync(): Promise<SyncResult> {
  const log = getLogger()
  const cfg = loadConfig()
  // Eagerly init DB so the migrations run before we touch any caches.
  getDb()
  const backend = getBackend()
  const startedAt = Date.now()

  if (!isAuthConfigured(cfg)) {
    log.warn('sync skipped: backend credentials missing')
    insertSyncLog({
      startedAt,
      finishedAt: Date.now(),
      status: 'auth_error',
      backend: backend.name,
      issuesCount: null,
      errorMessage: 'Backend credentials not configured',
    })
    return { ok: false, count: null, durationMs: 0, status: 'auth_error', errorMessage: 'no creds' }
  }

  const logId = insertSyncLog({
    startedAt,
    finishedAt: null,
    status: 'started',
    backend: backend.name,
    issuesCount: null,
    errorMessage: null,
  })

  try {
    const extendedDays = readExtendedScopeDays()
    const [issues, labels, viewer, workflowStates] = await Promise.all([
      backend.fetchAllIssues({ scope: cfg.ISSUE_SCOPE, teamId: cfg.LINEAR_TEAM_ID, extendedDays }),
      backend.fetchLabels(),
      backend.fetchViewer().catch(() => null),
      // Optional — adapters that don't implement fetchWorkflowStates will skip
      // this and the UI falls back to inferring states from issues.
      backend.fetchWorkflowStates
        ? backend.fetchWorkflowStates(cfg.LINEAR_TEAM_ID).catch((e: unknown) => {
            log.warn({ err: e }, 'workflowStates fetch failed; continuing')
            return [] as Awaited<ReturnType<NonNullable<typeof backend.fetchWorkflowStates>>>
          })
        : Promise.resolve([]),
    ])

    // Optional design-doc scan (silent if disabled).
    const designdocs = await runDesignDocScan(cfg.REPO_PATH, cfg.DESIGNDOC_ADAPTER).catch((e: unknown) => {
      log.warn({ err: e }, 'designdoc scan failed; continuing')
      return undefined
    })

    // Workspace-switch sniff test: if the cache holds many more issues than
    // we just fetched, the user likely changed LINEAR_API_KEY to a different
    // workspace. Issues from the previous workspace stay in cache (the
    // identifiers don't collide), polluting the graph. We can't detect this
    // perfectly without storing the workspace ID, so use a generous heuristic:
    // cached count > 2x fetched count AND fetched > 0 (avoid false positives
    // on initial sync or rate-limited partial responses).
    const cachedBefore = countCachedIssues()
    if (cachedBefore > issues.length * 2 && issues.length > 0) {
      log.warn(
        { cachedBefore, syncedNow: issues.length },
        'Cache holds far more issues than this sync returned. ' +
          'If you switched LINEAR_API_KEY to a different workspace, ' +
          'POST /api/reset-cache to clear stale data.',
      )
    }

    writeIssueCache(issues)
    writeLabelCache(labels)
    writeDesigndocsCached(designdocs)
    if (workflowStates.length > 0) writeWorkflowStatesCached(workflowStates)

    // Workspace-change detection (precise — uses Linear's organization.urlKey).
    // If the freshly-fetched workspace differs from the previously-cached
    // one, stash both into a meta key the /api/graph route exposes so the
    // frontend banner can warn the user before they look at issue URLs and
    // wonder why they don't match.
    if (viewer?.organization?.urlKey) {
      const newKey = viewer.organization.urlKey
      const prevViewer = readViewerCached()
      const prevKey = prevViewer?.organization?.urlKey
      if (prevKey && prevKey !== newKey) {
        writeMeta(
          'workspace_change_warning',
          JSON.stringify({ previous: prevKey, current: newKey, detectedAt: Date.now() }),
        )
        log.warn({ prevKey, newKey }, 'workspace changed — surfacing warning to UI')
      }
      writeMeta(VIEWER_KEY, JSON.stringify(viewer))
    } else if (viewer) {
      writeMeta(VIEWER_KEY, JSON.stringify(viewer))
    }
    writeLastSyncMs(Date.now())

    // Daily snapshot (PRD §5.8 — written on first successful sync of the day after configured hour).
    maybeWriteSnapshot(issues, labels, designdocs)

    const finishedAt = Date.now()
    updateSyncLog(logId, { finishedAt, status: 'success', issuesCount: issues.length, errorMessage: null })

    return {
      ok: true,
      count: issues.length,
      durationMs: finishedAt - startedAt,
      status: 'success',
    }
  } catch (err) {
    const finishedAt = Date.now()
    let status: SyncResult['status'] = 'api_error'
    if (err instanceof AuthError) status = 'auth_error'
    else if (err instanceof RateLimitError) status = 'rate_limited'
    const message = err instanceof Error ? err.message : String(err)
    log.error({ err: message }, 'sync failed')
    updateSyncLog(logId, { finishedAt, status, issuesCount: null, errorMessage: message })
    return {
      ok: false,
      count: null,
      durationMs: finishedAt - startedAt,
      status,
      errorMessage: message,
    }
  }
}

export function kickBackgroundSync(): void {
  // PRD §5.7 — debounce repeated triggers within 2s window. Per-workspace so
  // a flurry of triggers on A doesn't lock out a legitimate trigger on B.
  const wid = currentWid()
  const now = Date.now()
  const last = backgroundLastByWid.get(wid) ?? 0
  if (now - last < 2000) return
  backgroundLastByWid.set(wid, now)
  syncOnce({ force: false }).catch(() => undefined)
}

interface SyncLogInsert {
  startedAt: number
  finishedAt: number | null
  status: string
  backend: string
  issuesCount: number | null
  errorMessage: string | null
}

function insertSyncLog(row: SyncLogInsert): number {
  const stmt = getDb().prepare(
    `INSERT INTO sync_log(started_at, finished_at, status, backend, issues_count, error_message)
     VALUES(?, ?, ?, ?, ?, ?)`,
  )
  const r = stmt.run(
    row.startedAt,
    row.finishedAt,
    row.status,
    row.backend,
    row.issuesCount,
    row.errorMessage,
  )
  return Number(r.lastInsertRowid)
}

function updateSyncLog(
  id: number,
  patch: { finishedAt: number; status: string; issuesCount: number | null; errorMessage: string | null },
): void {
  getDb()
    .prepare(
      `UPDATE sync_log SET finished_at = ?, status = ?, issues_count = ?, error_message = ? WHERE id = ?`,
    )
    .run(patch.finishedAt, patch.status, patch.issuesCount, patch.errorMessage, id)
}

function maybeWriteSnapshot(issues: unknown, labels: unknown, designdocs: unknown): void {
  const cfg = loadConfig()
  const now = new Date()
  if (now.getHours() < cfg.DAILY_SNAPSHOT_HOUR) return
  const today = ymd(now)
  if (readMeta(SNAPSHOT_DATE_KEY) === today) return
  const db = getDb()
  db.prepare(
    `INSERT INTO snapshot(ts, issues_json, designdoc_json, schema_json) VALUES(?, ?, ?, ?)`,
  ).run(
    now.getTime(),
    JSON.stringify(issues),
    designdocs ? JSON.stringify(designdocs) : null,
    JSON.stringify({ labels }),
  )
  writeMeta(SNAPSHOT_DATE_KEY, today)

  // Prune old snapshots.
  const cutoff = Date.now() - cfg.SNAPSHOT_RETENTION_DAYS * 24 * 3600 * 1000
  db.prepare('DELETE FROM snapshot WHERE ts < ?').run(cutoff)
}

export function readViewerCached(): import('@shared/types.js').Viewer | null {
  const v = readMeta(VIEWER_KEY)
  if (!v) return null
  try {
    return JSON.parse(v) as import('@shared/types.js').Viewer
  } catch {
    return null
  }
}
