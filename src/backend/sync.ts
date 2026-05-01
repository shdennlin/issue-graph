import { getLogger } from './lib/log.js'
import { loadConfig, isAuthConfigured } from './lib/env.js'
import { getDb } from './db.js'
import {
  writeIssueCache,
  writeLabelCache,
  writeLastSyncMs,
  writeDesigndocsCached,
  writeMeta,
  readMeta,
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

let inflight: Promise<SyncResult> | null = null
const VIEWER_KEY = 'viewer_json'
const SNAPSHOT_DATE_KEY = 'last_snapshot_yyyymmdd'

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function syncOnce({ force = false }: { force?: boolean } = {}): Promise<SyncResult> {
  if (inflight && !force) return inflight
  if (inflight && force) {
    // Wait for the in-flight one to settle, then run a fresh one.
    await inflight.catch(() => undefined)
  }
  inflight = doSync()
  try {
    return await inflight
  } finally {
    inflight = null
  }
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
    const [issues, labels, viewer] = await Promise.all([
      backend.fetchAllIssues({ scope: cfg.ISSUE_SCOPE, teamId: cfg.LINEAR_TEAM_ID }),
      backend.fetchLabels(),
      backend.fetchViewer().catch(() => null),
    ])

    // Optional design-doc scan (silent if disabled).
    const designdocs = await runDesignDocScan(cfg.REPO_PATH, cfg.DESIGNDOC_ADAPTER).catch((e: unknown) => {
      log.warn({ err: e }, 'designdoc scan failed; continuing')
      return undefined
    })

    writeIssueCache(issues)
    writeLabelCache(labels)
    writeDesigndocsCached(designdocs)
    if (viewer) writeMeta(VIEWER_KEY, JSON.stringify(viewer))
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

let backgroundLast = 0
export function kickBackgroundSync(): void {
  // PRD §5.7 — debounce repeated triggers within 2s window.
  const now = Date.now()
  if (now - backgroundLast < 2000) return
  backgroundLast = now
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

export function readViewerCached(): { id: string; displayName: string; email?: string | null } | null {
  const v = readMeta(VIEWER_KEY)
  if (!v) return null
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}
