import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { loadConfig } from './lib/env.js'
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
]

let dbInstance: Database.Database | null = null

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance
  const cfg = loadConfig()
  const log = getLogger()

  // Ensure data dir exists.
  try {
    mkdirSync(dirname(cfg.SQLITE_PATH), { recursive: true })
  } catch {
    /* ignore */
  }

  const db = new Database(cfg.SQLITE_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // user_version tracks which migrations are applied. Use it as an integer.
  const versionRow = db.prepare('PRAGMA user_version').get() as { user_version: number }
  let version = versionRow.user_version
  for (let i = version; i < MIGRATIONS.length; i++) {
    const sql = MIGRATIONS[i]
    if (!sql) continue
    db.exec(sql)
    version = i + 1
    db.pragma(`user_version = ${version}`)
    log.info({ migration: i }, 'applied migration')
  }

  dbInstance = db
  return db
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
}
