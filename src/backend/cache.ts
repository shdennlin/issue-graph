import type {
  GraphData,
  NormalizedIssue,
  NormalizedLabel,
  AnnotationDTO,
  AgentSessionDTO,
  WorkstreamSummaryDTO,
  LifecycleStageDTO,
  WorkflowState,
} from '@shared/types.js'
import { getDb } from './db.js'
import { liveSessions, type AgentSessionRow } from './agentSessionStore.js'
import { LIFECYCLE_COLUMNS, lifecycleRowToDTO, type LifecycleStageRow } from './lifecycleStore.js'
import { parseStringArray } from './batchStore.js'
import { loadConfig } from './lib/env.js'
import { settingInt } from './lib/settings.js'

const META_LAST_SYNC = 'last_sync_ms'
const META_HAS_DESIGNDOC = 'has_designdoc'
const META_DESIGNDOC_PAYLOAD = 'designdoc_payload'
const META_WORKFLOW_STATES = 'workflow_states'
const META_EXTENDED_SCOPE = 'extended_scope_days'
const META_LAST_ISSUE_UPDATED_AT = 'last_issue_updated_at'
const META_LAST_SYNC_SCOPE_KEY = 'last_sync_scope_key'
const META_LAST_RECONCILE_MS = 'last_reconcile_ms'

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

/**
 * Incremental-sync high-water-mark — the max `updatedAt` (ISO 8601) observed
 * across all issues in the most recent successful sync. The next sync uses
 * this as the `updatedAfter` cursor so Linear only returns issues changed
 * since. Null means a full sync is required (first run, or after reset).
 */
export function readLastIssueUpdatedAt(): string | null {
  return readMeta(META_LAST_ISSUE_UPDATED_AT)
}

export function writeLastIssueUpdatedAt(iso: string): void {
  writeMeta(META_LAST_ISSUE_UPDATED_AT, iso)
}

/**
 * Fingerprint of the scope/team/extended-days settings under which the
 * cursor was captured. If the user changes scope, the cursor is invalidated
 * (next sync goes full) so newly-in-scope issues come in.
 */
export function readLastSyncScopeKey(): string | null {
  return readMeta(META_LAST_SYNC_SCOPE_KEY)
}

export function writeLastSyncScopeKey(key: string): void {
  writeMeta(META_LAST_SYNC_SCOPE_KEY, key)
}

/**
 * Epoch ms of the last successful reconcile pass (identifier-only scan that
 * deletes cached issues no longer present in Linear). Used by sync.ts to
 * gate the once-per-day reconcile cadence.
 */
export function readLastReconcileMs(): number {
  const v = readMeta(META_LAST_RECONCILE_MS)
  return v ? Number(v) : 0
}

export function writeLastReconcileMs(ms: number): void {
  writeMeta(META_LAST_RECONCILE_MS, String(ms))
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
  // User-overridable via Settings → Backend. Precedence and bounds live in
  // lib/settingSpecs.ts, which every setting now shares.
  const ttlSeconds = settingInt('cache_ttl_seconds', cfg.CACHE_TTL_SECONDS)
  return Date.now() - last < ttlSeconds * 1000
}

/** The most recent sync's status + message, for explaining an empty graph. */
export function readLastSyncOutcome(): { status: string; message: string | null } | null {
  const row = getDb()
    .prepare('SELECT status, error_message FROM sync_log ORDER BY started_at DESC LIMIT 1')
    .get() as { status: string; error_message: string | null } | undefined
  return row ? { status: row.status, message: row.error_message } : null
}

export function writeIssueCache(issues: NormalizedIssue[]): void {
  const db = getDb()
  const now = Date.now()
  const insert = db.prepare(
    `INSERT INTO issue_cache(identifier, payload, fetched_at) VALUES(?, ?, ?)
     ON CONFLICT(identifier) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
  )
  // UPSERT-only — incremental sync only fetches changed issues, so unchanged
  // rows must persist across calls. Deletes are handled by the periodic
  // reconcile pass (see deleteIssuesNotIn / sync.ts) and by resetCache.
  const txn = db.transaction((items: NormalizedIssue[]) => {
    for (const it of items) insert.run(it.identifier, JSON.stringify(it), now)
  })
  txn(issues)
}

/**
 * Reconcile-pass delete: remove cached issues whose identifier is NOT in the
 * provided keep-set. Uses `json_each` so a single statement handles any
 * collection size without bumping into SQLite's parameter limit.
 *
 * Returns the number of deleted rows.
 */
export function deleteIssuesNotIn(keep: string[]): number {
  const db = getDb()
  // Defensive: never wipe the cache when the backend returned zero — that
  // usually means a transient API hiccup, not "the workspace is empty now".
  if (keep.length === 0) return 0
  const before = countCachedIssues()
  db.prepare(
    `DELETE FROM issue_cache
     WHERE identifier NOT IN (SELECT value FROM json_each(?))`,
  ).run(JSON.stringify(keep))
  const after = countCachedIssues()
  return before - after
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
 * annotations, notes (+ notes-assets on disk), saved views, snapshots,
 * sync_log, settings. Use after switching LINEAR_API_KEY to a different workspace,
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
    // Drop incremental-sync cursor so the next sync goes full. Empty-string
    // sentinel matches the convention used for other reset-tied keys; both
    // readers fall back to the full-sync path on falsy values.
    writeMeta(META_LAST_ISSUE_UPDATED_AT, '')
    writeMeta(META_LAST_SYNC_SCOPE_KEY, '')
    writeMeta(META_LAST_RECONCILE_MS, '0')
  })()
  return { issues, labels }
}

/**
 * The workspace's lifecycle, ordered as the pipeline runs.
 *
 * Read through lifecycleRowToDTO so a malformed `states` column degrades to
 * "constrains nothing" instead of throwing inside the graph response — one bad
 * row must not be able to blank the whole graph.
 */
export function readLifecycleStages(): LifecycleStageDTO[] {
  const rows = getDb()
    .prepare(
      `SELECT ${LIFECYCLE_COLUMNS} FROM lifecycle_stage ORDER BY sort_order ASC, id ASC`,
    )
    .all() as LifecycleStageRow[]
  return rows.map(lifecycleRowToDTO)
}

/**
 * Workstreams with everything the stage view draws from.
 *
 * Archived ones are left out: archiving a workstream means taking it off the
 * board, and a container for it would contradict that. `?status=all` on the
 * batches route is where they come back.
 */
export function readWorkstreamSummaries(): WorkstreamSummaryDTO[] {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT id, name, created_at, updated_at, archived_at, stage_key, status, stage_entered_at, assignees, note FROM batch ORDER BY created_at DESC, id DESC',
    )
    .all() as {
    id: number
    name: string
    stage_key: string | null
    status: string
    stage_entered_at: number | null
    assignees: string
    note: string | null
    created_at: number
    updated_at: number | null
    archived_at: number | null
  }[]
  const members = db
    .prepare('SELECT batch_id, identifier FROM batch_member')
    .all() as { batch_id: number; identifier: string }[]
  const noteRows = db
    .prepare('SELECT batch_id, stage_key, body FROM workstream_stage_note')
    .all() as { batch_id: number; stage_key: string; body: string }[]
  // Ordered by `at` then `id`: two moves inside the same millisecond tie on
  // `at`, and the autoincrement id is the only thing that can break that tie
  // in the order they actually happened.
  const eventRows = db
    .prepare('SELECT batch_id, stage_key, at FROM workstream_stage_event ORDER BY at ASC, id ASC')
    .all() as { batch_id: number; stage_key: string; at: number }[]
  const linkRows = db
    .prepare('SELECT batch_id, stage_key, kind, value, label FROM workstream_stage_link')
    .all() as { batch_id: number; stage_key: string; kind: string; value: string; label: string | null }[]
  const byBatch = new Map<number, string[]>()
  for (const m of members) {
    const list = byBatch.get(m.batch_id)
    if (list) list.push(m.identifier)
    else byBatch.set(m.batch_id, [m.identifier])
  }
  // Archived rows are INCLUDED. Hiding them is a display decision and it is
  // already made in the two places that display: views/workstream.ts and the
  // jump list. Making it here as well put it somewhere the frontend could not
  // overrule, so "show me this one archived workstream" was unanswerable — the
  // view's own rule let it through and the data never arrived. stageNudges
  // skips them on its own, and there are a handful of rows either way.
  return rows
    .map((r) => ({
    id: r.id,
    name: r.name,
    members: byBatch.get(r.id) ?? [],
    stage: r.stage_key,
    note: r.note,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at,
    archivedAt: r.archived_at,
    stageEnteredAt: r.stage_entered_at,
    stageEvents: eventRows
      .filter((e) => e.batch_id === r.id)
      .map((e) => ({ stageKey: e.stage_key, at: e.at })),
    status: r.status === 'archived' ? ('archived' as const) : ('active' as const),
    assignees: parseStringArray(r.assignees),
    notes: Object.fromEntries(
      noteRows.filter((n) => n.batch_id === r.id).map((n) => [n.stage_key, n.body]),
    ),
    links: linkRows
      .filter((l) => l.batch_id === r.id)
      .map((l) => ({ stageKey: l.stage_key, kind: l.kind, value: l.value, label: l.label })),
  }))
}

/**
 * Live agent sessions, TTL already applied.
 *
 * The filter lives here rather than in each consumer so that no caller can
 * forget it: a row that has gone quiet is not "a session with an old
 * timestamp", it is a session that has probably died, and showing it would
 * have the card claim work is in progress when nothing is running.
 */
export function readLiveAgentSessions(now = Date.now()): AgentSessionDTO[] {
  const rows = getDb()
    .prepare(
      'SELECT session_id, identifier, branch, cwd, host, phase, status, last_seen, payload_version, label FROM agent_session',
    )
    .all() as AgentSessionRow[]
  return liveSessions(rows, now)
}

export function readAnnotations(): AnnotationDTO[] {
  const rows = getDb()
    .prepare(
      'SELECT id, target_type as targetType, target_id as targetId, body, created_at as createdAt, updated_at as updatedAt FROM annotation',
    )
    .all() as AnnotationDTO[]
  return rows
}
