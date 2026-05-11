// Bun's built-in SQLite. We migrated from `better-sqlite3` because Bun
// explicitly refuses to load it (oven-sh/bun#4290) — better-sqlite3's N-API
// surface is incompatible with Bun's runtime. `bun:sqlite` has a near-identical
// API and ships with the runtime, so no native compile / no prebuild headaches.
// Trade-off: this module now only runs on Bun. The previous Node-target
// Dockerfile (`Dockerfile.node`) no longer works against this code path.
import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { loadConfig } from './lib/env.js'
import { getCurrentWorkspaceId, LEGACY_WORKSPACE_ID } from './lib/workspaceContext.js'
import { getDefaultWorkspaceId } from './lib/env.js'
import { getLogger } from './lib/log.js'

const MIGRATIONS: string[] = [
  // 1. Phase 1a base
  `CREATE TABLE IF NOT EXISTS issue_cache (
     identifier TEXT PRIMARY KEY,
     payload TEXT NOT NULL,
     fetched_at INTEGER NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS label_cache (
     id TEXT PRIMARY KEY,
     payload TEXT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS sync_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     started_at INTEGER NOT NULL,
     finished_at INTEGER,
     status TEXT NOT NULL,
     backend TEXT NOT NULL,
     issues_count INTEGER,
     error_message TEXT
   );`,
  `CREATE INDEX IF NOT EXISTS idx_sync_started ON sync_log(started_at DESC);`,
  `CREATE TABLE IF NOT EXISTS cache_meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,

  // 2. Phase 2 — annotations, settings, snapshots.
  `CREATE TABLE IF NOT EXISTS snapshot (
     ts INTEGER PRIMARY KEY,
     issues_json TEXT NOT NULL,
     designdoc_json TEXT,
     schema_json TEXT
   );`,
  `CREATE INDEX IF NOT EXISTS idx_snapshot_ts ON snapshot(ts DESC);`,
  `CREATE TABLE IF NOT EXISTS annotation (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     target_type TEXT NOT NULL,
     target_id TEXT NOT NULL,
     body TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS idx_annotation_target ON annotation(target_type, target_id);`,
  `CREATE TABLE IF NOT EXISTS setting (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,

  // 3. Workspace notes — markdown notes scoped to a workspace profile.
  // Title is derived from body's first line at read time (not stored).
  // Lower sort_order sorts first (allows newest-on-top via negative values).
  `CREATE TABLE IF NOT EXISTS note (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     body TEXT NOT NULL DEFAULT '',
     sort_order INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS idx_note_sort ON note(sort_order ASC);`,

  // 4. Notes: archived flag. Soft-archive support so users can hide notes
  // without deleting them. Existing rows default to 0 (active).
  `ALTER TABLE note ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;`,
  `CREATE INDEX IF NOT EXISTS idx_note_archived ON note(archived ASC, sort_order ASC);`,
]

// One Database instance per workspace id. Each profile has its own SQLITE_PATH
// (default: data/workspaces/<id>/graph.db), so different ids → different files
// → no contention. Same id called from multiple tabs reuses the same instance.
const dbByWorkspaceId: Map<string, Database> = new Map()

function currentWid(): string {
  return getCurrentWorkspaceId() ?? getDefaultWorkspaceId() ?? LEGACY_WORKSPACE_ID
}

export function getDb(): Database {
  const wid = currentWid()
  const cached = dbByWorkspaceId.get(wid)
  if (cached) return cached

  const cfg = loadConfig()
  const log = getLogger()

  // Ensure data dir exists.
  try {
    mkdirSync(dirname(cfg.SQLITE_PATH), { recursive: true })
  } catch {
    /* ignore */
  }

  const db = new Database(cfg.SQLITE_PATH)
  // bun:sqlite has no `.pragma()` helper — use the run/exec pair instead.
  db.run('PRAGMA journal_mode = WAL')
  db.run('PRAGMA foreign_keys = ON')

  // user_version tracks which migrations are applied. Use it as an integer.
  const versionRow = db.prepare('PRAGMA user_version').get() as { user_version: number }
  let version = versionRow.user_version
  for (let i = version; i < MIGRATIONS.length; i++) {
    const sql = MIGRATIONS[i]
    if (!sql) continue
    db.run(sql)
    version = i + 1
    // PRAGMA doesn't support `?` binding, so we string-concat. `version` is a
    // bounded integer derived from MIGRATIONS.length so injection is N/A.
    db.run('PRAGMA user_version = ' + String(version))
    log.info({ migration: i, workspace: wid }, 'applied migration')
  }

  dbByWorkspaceId.set(wid, db)
  return db
}

/**
 * Close one workspace's DB (no-op if not open) or all of them (for shutdown
 * / tests). Per-tab workspace switching does NOT call this — each id keeps
 * its handle so other tabs viewing the same workspace continue working.
 */
export function closeDb(workspaceId?: string): void {
  if (workspaceId) {
    const db = dbByWorkspaceId.get(workspaceId)
    if (db) {
      db.close()
      dbByWorkspaceId.delete(workspaceId)
    }
    return
  }
  for (const db of dbByWorkspaceId.values()) {
    try {
      db.close()
    } catch {
      // Already closed — fine.
    }
  }
  dbByWorkspaceId.clear()
}
