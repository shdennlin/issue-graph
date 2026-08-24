// The control plane: one SQLite file holding the workspace roster.
//
// Separate from the per-workspace `graph.db` files on purpose. Those are a
// rebuildable cache — deleting one and re-syncing is a normal troubleshooting
// step — so credentials cannot live there. This file is small, sensitive and
// not rebuildable; it is the one under `data/` worth backing up.
//
// Deliberately thin. It imports `bun:sqlite`, which vitest (Node) cannot
// resolve, so nothing here can be unit-tested; all the logic worth testing
// lives in the pure controlStore.ts next door. Keep it that way.
//
// Dependency direction is one-way: this module imports lib/env.js for the base
// path, and lib/env.js must never import this one — it reaches the roster
// through the injected source registered in index.ts.

import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getBaseSqlitePath } from './lib/env.js'
import { getLogger } from './lib/log.js'
import { isValidWorkspaceId, type WorkspaceRow } from './controlStore.js'

/** Append-only, same convention as the MIGRATIONS array in db.ts. Never edit a
 *  past entry — add a new ALTER. */
const CONTROL_MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS workspace (
     id             TEXT PRIMARY KEY,
     name           TEXT NOT NULL,
     backend        TEXT NOT NULL DEFAULT 'linear',
     api_key        TEXT,
     webhook_secret TEXT,
     team_id        TEXT,
     sort_order     INTEGER NOT NULL DEFAULT 0,
     created_at     INTEGER NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS control_meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
]

export const ACTIVE_WORKSPACE_KEY = 'active_workspace'

let db: Database | null = null

/** `data/workspaces.db`, beside the base SQLITE_PATH — the same rule the old
 *  active-workspace.json used, so no new env var is needed. */
export function controlDbPath(): string {
  return join(dirname(getBaseSqlitePath()), 'workspaces.db')
}

export function getControlDb(): Database {
  if (db) return db
  const path = controlDbPath()
  try {
    mkdirSync(dirname(path), { recursive: true })
  } catch {
    /* ignore — the open below will report anything that actually matters */
  }
  const next = new Database(path)
  next.run('PRAGMA journal_mode = WAL')

  const versionRow = next.prepare('PRAGMA user_version').get() as { user_version: number }
  let version = versionRow.user_version
  const applied: number[] = []
  for (let i = version; i < CONTROL_MIGRATIONS.length; i++) {
    const sql = CONTROL_MIGRATIONS[i]
    if (!sql) continue
    next.run(sql)
    version = i + 1
    // PRAGMA takes no bound parameters; `version` is a bounded integer derived
    // from the array length, so interpolation is safe here.
    next.run('PRAGMA user_version = ' + String(version))
    applied.push(i)
  }

  // Cache the handle BEFORE logging, and log only after the loop.
  //
  // getLogger() -> loadConfig() -> resolveDefaultWid() -> roster.rows() ->
  // readWorkspaceRows() -> getControlDb(). Logging from inside the loop
  // re-entered this function while `db` was still null, so a second Database
  // was opened on the same file and leaked, and the migration loop ran twice.
  // That was survivable only because every statement here is CREATE TABLE IF
  // NOT EXISTS; the first ALTER TABLE added to CONTROL_MIGRATIONS would have
  // thrown "duplicate column" on the second pass and taken boot down with it.
  db = next
  if (applied.length > 0) {
    getLogger().info({ migrations: applied }, 'applied control-plane migrations')
  }
  return db
}

interface DbWorkspaceRow {
  id: string
  name: string
  backend: string
  api_key: string | null
  webhook_secret: string | null
  team_id: string | null
  sort_order: number
  created_at: number
}

function toRow(r: DbWorkspaceRow): WorkspaceRow {
  return {
    id: r.id,
    name: r.name,
    backend: r.backend,
    apiKey: r.api_key,
    webhookSecret: r.webhook_secret,
    teamId: r.team_id,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  }
}

export function readWorkspaceRows(): WorkspaceRow[] {
  const rows = getControlDb()
    .prepare(
      `SELECT id, name, backend, api_key, webhook_secret, team_id, sort_order, created_at
       FROM workspace`,
    )
    .all() as DbWorkspaceRow[]
  return rows.map(toRow)
}

export interface WorkspaceUpsert {
  id: string
  name: string
  backend?: string
  /** undefined leaves the stored value alone; '' clears it. */
  apiKey?: string
  webhookSecret?: string
  teamId?: string | null
  sortOrder?: number
}

/**
 * Insert or update one workspace. Credential fields are patch-style: omitting
 * one keeps whatever is stored, which is what lets the UI show an empty
 * password box without wiping the secret on every save.
 */
export function upsertWorkspace(input: WorkspaceUpsert): void {
  if (!isValidWorkspaceId(input.id)) {
    throw new Error(`Invalid workspace id: ${JSON.stringify(input.id)}`)
  }
  const conn = getControlDb()
  const existing = conn.prepare('SELECT id FROM workspace WHERE id = ?').get(input.id) as
    | { id: string }
    | undefined

  if (!existing) {
    conn
      .prepare(
        `INSERT INTO workspace (id, name, backend, api_key, webhook_secret, team_id, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.name || input.id,
        input.backend ?? 'linear',
        input.apiKey ? input.apiKey : null,
        input.webhookSecret ? input.webhookSecret : null,
        input.teamId ?? null,
        input.sortOrder ?? 0,
        Date.now(),
      )
    return
  }

  const sets: string[] = ['name = ?']
  const args: Array<string | number | null> = [input.name || input.id]
  if (input.backend !== undefined) { sets.push('backend = ?'); args.push(input.backend) }
  if (input.apiKey !== undefined) { sets.push('api_key = ?'); args.push(input.apiKey || null) }
  if (input.webhookSecret !== undefined) {
    sets.push('webhook_secret = ?')
    args.push(input.webhookSecret || null)
  }
  if (input.teamId !== undefined) { sets.push('team_id = ?'); args.push(input.teamId || null) }
  if (input.sortOrder !== undefined) { sets.push('sort_order = ?'); args.push(input.sortOrder) }
  args.push(input.id)
  conn.prepare(`UPDATE workspace SET ${sets.join(', ')} WHERE id = ?`).run(...args)
}

/**
 * Remove a workspace from the roster. The data directory is deliberately left
 * on disk: re-adding the same slug re-adopts the cache, and destroying issue
 * history behind a DELETE would need a confirmation flow this app does not have.
 */
export function deleteWorkspace(id: string): boolean {
  const res = getControlDb().prepare('DELETE FROM workspace WHERE id = ?').run(id)
  return res.changes > 0
}

export function readControlMeta(key: string): string | null {
  const row = getControlDb().prepare('SELECT value FROM control_meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function writeControlMeta(key: string, value: string): void {
  getControlDb()
    .prepare(
      `INSERT INTO control_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value)
}

export function clearControlMeta(key: string): void {
  getControlDb().prepare('DELETE FROM control_meta WHERE key = ?').run(key)
}

/** Test / shutdown seam. */
export function closeControlDb(): void {
  if (!db) return
  try {
    db.close()
  } catch {
    /* already closed */
  }
  db = null
}
