import type { GraphData, NormalizedIssue, NormalizedLabel, AnnotationDTO, WorkflowState } from '@shared/types.js'
import { getDb } from './db.js'
import { loadConfig } from './lib/env.js'

const META_LAST_SYNC = 'last_sync_ms'
const META_HAS_DESIGNDOC = 'has_designdoc'
const META_DESIGNDOC_PAYLOAD = 'designdoc_payload'
const META_WORKFLOW_STATES = 'workflow_states'
const META_EXTENDED_SCOPE = 'extended_scope_days'

interface IssueRow { identifier: string; payload: string; fetched_at: number }
interface LabelRow { id: string; payload: string }
interface MetaRow { key: string; value: string }

export function readCachedIssues(): NormalizedIssue[] {
  const rows = getDb().prepare('SELECT identifier, payload, fetched_at FROM issue_cache').all() as IssueRow[]
  return rows.map((r) => JSON.parse(r.payload) as NormalizedIssue)
}

export function readCachedLabels(): NormalizedLabel[] {
  const rows = getDb().prepare('SELECT id, payload FROM label_cache').all() as LabelRow[]
  return rows.map((r) => JSON.parse(r.payload) as NormalizedLabel)
}

export function readMeta(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM cache_meta WHERE key = ?').get(key) as MetaRow | undefined
  return row?.value ?? null
}

export function writeMeta(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO cache_meta(key, value) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value)
}

export function readLastSyncMs(): number | null {
  const v = readMeta(META_LAST_SYNC)
  return v ? Number(v) : null
}

export function writeLastSyncMs(ms: number): void {
  writeMeta(META_LAST_SYNC, String(ms))
}

export function readDesigndocsCached(): GraphData['designdocs'] | undefined {
  const has = readMeta(META_HAS_DESIGNDOC)
  if (has !== '1') return undefined
  const raw = readMeta(META_DESIGNDOC_PAYLOAD)
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

export function readWorkflowStatesCached(): WorkflowState[] {
  const raw = readMeta(META_WORKFLOW_STATES)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as WorkflowState[]) : []
  } catch {
    return []
  }
}

export function writeWorkflowStatesCached(states: WorkflowState[]): void {
  writeMeta(META_WORKFLOW_STATES, JSON.stringify(states))
}

/**
 * Lazy-fetch extension: when the user explicitly checks Canceled or Completed
 * in the filter, we extend the Linear query to include those state types
 * within `extendedScopeDays` (max 365). Persisted in cache_meta so subsequent
 * full syncs keep including them.
 *
 * 0 / unset = no extension (default `active+recent` only).
 */
export function readExtendedScopeDays(): number {
  const raw = readMeta(META_EXTENDED_SCOPE)
  if (!raw) return 0
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.min(365, Math.floor(n)) : 0
}

export function writeExtendedScopeDays(days: number): void {
  const clamped = Math.max(0, Math.min(365, Math.floor(days)))
  writeMeta(META_EXTENDED_SCOPE, String(clamped))
}

export function writeDesigndocsCached(payload: GraphData['designdocs'] | undefined): void {
  if (!payload || payload.length === 0) {
    writeMeta(META_HAS_DESIGNDOC, '0')
    writeMeta(META_DESIGNDOC_PAYLOAD, '')
    return
  }
  writeMeta(META_HAS_DESIGNDOC, '1')
  writeMeta(META_DESIGNDOC_PAYLOAD, JSON.stringify(payload))
}

export function isCacheFresh(): boolean {
  const cfg = loadConfig()
  const last = readLastSyncMs()
  if (!last) return false
  // User-overridable via Settings → Backend; falls back to env, then default.
  // Setting precedence: setting table > env > schema default. Bounds [10, 86400]
  // mirror the API's PatchSchema validation in routes/settings.ts.
  const ttlSeconds = readCacheTtlSeconds(cfg.CACHE_TTL_SECONDS)
  return Date.now() - last < ttlSeconds * 1000
}

function readCacheTtlSeconds(envFallback: number): number {
  const row = getDb()
    .prepare('SELECT value FROM setting WHERE key = ?')
    .get('cache_ttl_seconds') as { value: string } | undefined
  if (!row) return envFallback
  const n = Number(row.value)
  return Number.isFinite(n) && n >= 10 && n <= 86400 ? n : envFallback
}

export function writeIssueCache(issues: NormalizedIssue[]): void {
  const db = getDb()
  const now = Date.now()
  const insert = db.prepare(
    `INSERT INTO issue_cache(identifier, payload, fetched_at) VALUES(?, ?, ?)
     ON CONFLICT(identifier) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
  )
  const txn = db.transaction((items: NormalizedIssue[]) => {
    db.prepare('DELETE FROM issue_cache').run()
    for (const it of items) insert.run(it.identifier, JSON.stringify(it), now)
  })
  txn(issues)
}

export function writeLabelCache(labels: NormalizedLabel[]): void {
  const db = getDb()
  const insert = db.prepare(
    `INSERT INTO label_cache(id, payload) VALUES(?, ?)
     ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`,
  )
  const txn = db.transaction((items: NormalizedLabel[]) => {
    db.prepare('DELETE FROM label_cache').run()
    for (const it of items) insert.run(it.id, JSON.stringify(it))
  })
  txn(labels)
}

/**
 * Returns the number of issues currently in the cache. Used for the
 * sync-time stale-cache warning (see sync.ts) — if the cache holds many
 * more issues than the latest sync returned, the user likely switched
 * LINEAR_API_KEY to a different workspace.
 */
export function countCachedIssues(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM issue_cache').get() as { n: number }
  return row.n
}

/**
 * Wipe everything tied to the configured backend/workspace so the next
 * sync rebuilds from scratch. Intentionally preserves user-created data:
 * annotations, notes (+ notes-assets on disk), snapshots, sync_log,
 * settings. Use after switching LINEAR_API_KEY to a different workspace,
 * or to recover from a corrupted cache.
 */
export function resetCache(): { issues: number; labels: number } {
  const db = getDb()
  const issues = countCachedIssues()
  const labelRow = db.prepare('SELECT COUNT(*) AS n FROM label_cache').get() as { n: number }
  const labels = labelRow.n
  db.transaction(() => {
    db.prepare('DELETE FROM issue_cache').run()
    db.prepare('DELETE FROM label_cache').run()
    // Also clear workspace-tied meta entries so the design-doc filter and
    // workflow-state info don't show stale data from the previous workspace.
    writeMeta(META_HAS_DESIGNDOC, '0')
    writeMeta(META_DESIGNDOC_PAYLOAD, '')
    writeMeta(META_WORKFLOW_STATES, '[]')
    writeMeta(META_LAST_SYNC, '0')
    // Clear the workspace-change banner so it doesn't reappear after reset.
    writeMeta('workspace_change_warning', '')
  })()
  return { issues, labels }
}

export function readAnnotations(): AnnotationDTO[] {
  const rows = getDb()
    .prepare(
      'SELECT id, target_type as targetType, target_id as targetId, body, created_at as createdAt, updated_at as updatedAt FROM annotation',
    )
    .all() as AnnotationDTO[]
  return rows
}
