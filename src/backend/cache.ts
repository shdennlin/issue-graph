import type { GraphData, NormalizedIssue, NormalizedLabel, AnnotationDTO } from '@shared/types.js'
import { getDb } from './db.js'
import { loadConfig } from './lib/env.js'

const META_LAST_SYNC = 'last_sync_ms'
const META_HAS_DESIGNDOC = 'has_designdoc'
const META_DESIGNDOC_PAYLOAD = 'designdoc_payload'

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
  return Date.now() - last < cfg.CACHE_TTL_SECONDS * 1000
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

export function readAnnotations(): AnnotationDTO[] {
  const rows = getDb()
    .prepare(
      'SELECT id, target_type as targetType, target_id as targetId, body, created_at as createdAt, updated_at as updatedAt FROM annotation',
    )
    .all() as AnnotationDTO[]
  return rows
}
