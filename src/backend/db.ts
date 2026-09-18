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
import { getCurrentWorkspaceId, UNCONFIGURED_WORKSPACE_ID } from './lib/workspaceContext.js'
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

  // 5. Saved views — named snapshots of the URL's view + filter state, shared
  // by everyone hitting this server (there is no auth by design).
  //
  // Stores the URL QUERY STRING rather than structured JSON, so urlSync stays
  // the single codec and a saved view can never drift from what the URL can
  // express. `w` and record-pointer params are stripped before insert — see
  // savedViewStore.normalizeSavedViewQuery.
  //
  // No workspace_id column: getDb() already hands out one Database per
  // workspace, so the file itself is the scope.
  `CREATE TABLE IF NOT EXISTS saved_view (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     query TEXT NOT NULL,
     sort_order INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS idx_saved_view_sort ON saved_view(sort_order ASC);`,

  // 6. Lifecycle stages — the workspace's own pipeline, and which stage each
  // issue is on. See docs/adr/0002-lifecycle-stage-is-stored-not-derived.md.
  //
  // A row per stage rather than one JSON document, so `key` uniqueness and the
  // ordering are enforced by the schema instead of by whoever writes the blob.
  // `states` is the one JSON column: a list of compatible Linear state NAMES,
  // used to spot disagreement and nothing else.
  //
  // No workspace_id column, same reason as saved_view: getDb() hands out one
  // Database per workspace, so the file is the scope.
  //
  // NEITHER TABLE MAY EVER BE ADDED TO resetCache(). That function is a
  // deny-list — it deletes issue_cache, label_cache and some meta keys, and
  // everything else survives by omission. These rows are not rebuildable:
  // nobody can recompute what a person typed. cacheReset.test.ts pins this.
  `CREATE TABLE IF NOT EXISTS lifecycle_stage (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     key TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     sort_order INTEGER NOT NULL,
     states TEXT NOT NULL,
     next_command TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS idx_lifecycle_stage_sort ON lifecycle_stage(sort_order ASC);`,
  // stage_key is deliberately NOT a foreign key. Deleting a stage must not
  // silently erase every assignment to it — an unresolvable key reads as
  // 'unknown' (see StageVerdict), which is recoverable by re-creating the
  // stage, whereas a cascading delete is not.
  `CREATE TABLE IF NOT EXISTS issue_stage (
     identifier TEXT PRIMARY KEY,
     stage_key TEXT NOT NULL,
     updated_at INTEGER NOT NULL,
     updated_by TEXT
   );`,

  // 7. Agent sessions — which Claude Code session is alive, where, and whether
  // it is moving or waiting on a human. Written by the hook plugin in
  // integrations/claude-code/.
  //
  // Ephemeral by design, and the ONE table here that a cache reset losing would
  // be fine — clearing it just drops stale rows. It is still not listed in
  // resetCache(), because a reset is not a reason to forget a session that is
  // currently running.
  //
  // `payload_version` is recorded from the first release: once installs exist
  // in the wild the wire format cannot be renegotiated, so the server has to be
  // able to tell an old reporter from a new one.
  //
  // Liveness is a TTL on last_seen, not the SessionEnd hook. A crashed session
  // never sends SessionEnd; without the TTL the graph fills with sessions that
  // died days ago.
  `CREATE TABLE IF NOT EXISTS agent_session (
     session_id TEXT PRIMARY KEY,
     identifier TEXT,
     branch TEXT,
     cwd TEXT,
     host TEXT,
     phase TEXT,
     status TEXT NOT NULL,
     last_seen INTEGER NOT NULL,
     payload_version INTEGER NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS idx_agent_session_issue ON agent_session(identifier);`,

  // 8. Batches — a set of issues handed to agent sessions one at a time, via
  // the MCP server in integrations/claude-code/mcp/.
  //
  // Membership is stored; ORDER IS NOT. The order to work a batch in is a
  // topological sort over the `blocks` edges, which live on the issues and
  // change whenever someone edits a relation in Linear. A stored order would be
  // a second copy of that fact and would silently go stale — the same reason
  // a stage is not derived but an order is.
  //
  // `claimed_by` is what stops two sessions calling next_issue from colliding;
  // the claim is taken with a conditional UPDATE, not a read-then-write.
  // Ephemeral, like agent_session.
  `CREATE TABLE IF NOT EXISTS batch (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS batch_member (
     batch_id INTEGER NOT NULL,
     identifier TEXT NOT NULL,
     claimed_by TEXT,
     claimed_at INTEGER,
     done_at INTEGER,
     PRIMARY KEY (batch_id, identifier)
   );`,
  `CREATE INDEX IF NOT EXISTS idx_batch_member_batch ON batch_member(batch_id);`,

  // 9. Drop the per-issue stage.
  //
  // It was the right idea at the wrong level. A pipeline — discuss, spec review,
  // implementing, CI, merge, archive — describes a FEATURE moving through it, not
  // an individual issue; an issue has only its Linear state, and an agent moves
  // that through the Linear MCP. The stage therefore belongs to the workstream,
  // where migration 10 puts it.
  //
  // ADR-0002's argument survives untouched: stages are finer than states, so a
  // stage cannot be derived and must be stored. Only its subject changed — which
  // is why lifecycle_stage needed no schema change at all.
  `DROP TABLE IF EXISTS issue_stage;`,

  // 10. The workstream's own fields.
  //
  // `stage_key` is where the pipeline actually lives now. It is deliberately NOT
  // a foreign key, for the reason issue_stage.stage_key was not: deleting a
  // stage must degrade a workstream to "unknown", which is recoverable by
  // re-creating the stage, rather than erase the assignment.
  //
  // `stage_entered_at` is rewritten on EVERY stage change, including a move
  // backwards. Staleness has to time the current occupancy — a workstream that
  // failed CI, went back to Implementing for three days and returned should not
  // be told it has been at CI for five.
  //
  // `status` is `active` | `archived`. Two adjectives about the workstream
  // itself, and `archived` is the word `note` already uses. A third value
  // (`paused`) waits until someone actually wants to shelve one without calling
  // it finished — a status nobody sets is a field that lies.
  //
  // `assignees` is durable and separate from agent_session: an agent that is not
  // running right now is still whose job the work is.
  `ALTER TABLE batch ADD COLUMN stage_key TEXT;`,
  `ALTER TABLE batch ADD COLUMN status TEXT NOT NULL DEFAULT 'active';`,
  `ALTER TABLE batch ADD COLUMN stage_entered_at INTEGER;`,
  `ALTER TABLE batch ADD COLUMN assignees TEXT NOT NULL DEFAULT '[]';`,
  `CREATE INDEX IF NOT EXISTS idx_batch_status ON batch(status);`,

  // `shows` is a list of PROJECTIONS, not fields: `pullRequests` means "go and
  // read the members' PRs", never "this stage stores PRs". The vocabulary is
  // closed because the app can only draw what it holds data for; which tokens a
  // stage uses is entirely the workspace's choice.
  //
  // `stale_after_days` is per stage because the honest answer differs wildly —
  // a Discuss stage can sit for a fortnight, a CI stage sitting for a day is
  // wrong. Null means this stage never goes stale.
  `ALTER TABLE lifecycle_stage ADD COLUMN shows TEXT NOT NULL DEFAULT '[]';`,
  `ALTER TABLE lifecycle_stage ADD COLUMN stale_after_days INTEGER;`,

  // One free-markdown note per workstream per stage. Not an append-only log:
  // a log nobody prunes is one more thing that rots, and an agent will fill it.
  `CREATE TABLE IF NOT EXISTS workstream_stage_note (
     batch_id INTEGER NOT NULL,
     stage_key TEXT NOT NULL,
     body TEXT NOT NULL,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (batch_id, stage_key)
   );`,

  // Hand-attached items, for when the upstream link is missing: a spec with no
  // `Linear:` line, a PR whose branch and body name no issue. `kind` is closed —
  // 'spec' (a path the scanner can still read progress from) or 'url' (rendered
  // as a link and nothing more). These render with a visible "manual" mark: if a
  // hand attachment looked as good as a projected one it would become the
  // default, and the convention that makes projection work would stop being
  // followed.
  `CREATE TABLE IF NOT EXISTS workstream_stage_link (
     batch_id INTEGER NOT NULL,
     stage_key TEXT NOT NULL,
     kind TEXT NOT NULL,
     value TEXT NOT NULL,
     label TEXT,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (batch_id, stage_key, kind, value)
   );`,

  // 11. A readable name for a session, and room for a third status.
  //
  // `label` exists because a UUID identifies nothing to a reader. It is derived
  // server-side from the repo directory and branch — which is how a person
  // actually recognises a terminal — and the hook may override it.
  //
  // The third status is `blocked`, from the Notification hook: Claude is
  // stopped on a permission prompt and will not resume until someone acts.
  // Folding that into `waiting` (the turn merely ended) loses the only state
  // that should pull a person over.
  `ALTER TABLE agent_session ADD COLUMN label TEXT;`,

  // 12. Where a workstream has BEEN, not just where it is.
  //
  // `batch.stage_entered_at` is one column, overwritten on every move, so it
  // times the CURRENT occupancy and nothing else. That was enough to say "9
  // days on Spec review" and not enough to draw a pipeline: six of seven
  // stages had no time on them at all, so the picture showed a position
  // without a journey — you could not tell what had already happened.
  //
  // Append-only, one row per ENTRY. A stage's duration is the gap to the next
  // entry, and the current stage's is the gap to now, so nothing needs
  // updating in place and a crash between writes loses at most the last move.
  // Moving backwards is recorded like any other move and simply produces a
  // second row for that stage — the pipeline is a chain, but a workstream
  // walking it is not obliged to go forwards.
  //
  // Not in resetCache's delete list, like every other table here: a
  // re-sync rebuilds issues from Linear and must not erase a history Linear
  // never had. See cacheReset.test.ts, which guards that omission.
  `CREATE TABLE IF NOT EXISTS workstream_stage_event (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     batch_id INTEGER NOT NULL,
     stage_key TEXT NOT NULL,
     at INTEGER NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS idx_stage_event_batch ON workstream_stage_event(batch_id, at);`,

  // 13. When a workstream was last touched, and when it was shelved.
  //
  // `created_at` was the only date it had, which answers the least interesting
  // question: a list sorted by it puts a workstream nobody has looked at in
  // three weeks above one that moved this morning.
  //
  // `updated_at` counts a change to the workstream ITSELF — its name, stage,
  // status, assignees, notes and hand attachments. Deliberately NOT its
  // members' Linear activity: that is Linear's clock, it moves whenever anyone
  // comments, and letting it bump this would make "last touched" mean
  // "somebody typed anywhere near this", which is the same trap `updatedAt`
  // already falls into on an issue (see `lastCommentAt` in shared/types.ts).
  //
  // Backfilled from `created_at` rather than left null, so ordering by it is
  // total from the first read — a null would sort unpredictably and the row
  // would look older or newer than everything depending on the collation.
  `ALTER TABLE batch ADD COLUMN updated_at INTEGER;`,
  `UPDATE batch SET updated_at = created_at WHERE updated_at IS NULL;`,
  // Null while active, stamped on archive, CLEARED on unarchive: it dates the
  // current shelving, not the first one ever, for the same reason
  // `stage_entered_at` times the current occupancy.
  `ALTER TABLE batch ADD COLUMN archived_at INTEGER;`,
  `UPDATE batch SET archived_at = updated_at WHERE status = 'archived' AND archived_at IS NULL;`,

  // 14. A note about the WORKSTREAM, distinct from the notes on its stages.
  //
  // They answer different questions and were being conflated. A stage note is
  // "what is this step waiting on" — "the manifest-hash review has not come
  // back". A workstream note is "what is this feature, and what do I need to
  // know before reading the pipeline at all" — the decision from a call, the
  // reason it exists, who is blocked on legal.
  //
  // The symptom was duplication: the card that collected every stage's note
  // showed each one a second time, beside the stage that already showed it.
  // One fact in two places, which is the same defect as an issue drawn on
  // seven stages.
  //
  // A column on `batch` rather than a row in `workstream_stage_note` with some
  // sentinel key: it is a property of the workstream, and a sentinel would put
  // a thing that is not a stage into a table keyed by stage.
  `ALTER TABLE batch ADD COLUMN note TEXT;`,
]

// One Database instance per workspace id. Each profile has its own SQLITE_PATH
// (default: data/workspaces/<id>/graph.db), so different ids → different files
// → no contention. Same id called from multiple tabs reuses the same instance.
const dbByWorkspaceId: Map<string, Database> = new Map()

function currentWid(): string {
  return getCurrentWorkspaceId() ?? getDefaultWorkspaceId() ?? UNCONFIGURED_WORKSPACE_ID
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
