// Pure workspace-roster logic: rows in, resolved config out.
//
// Replaces the WORKSPACE_* env parsing that used to live in workspaces.ts. The
// shape of the answer is deliberately unchanged — profiles, an active profile,
// and the four values that get layered onto the per-workspace Config — so the
// callers in lib/env.ts and routes/workspaces.ts keep working. What changed is
// where the rows come from.
//
// No `bun:sqlite` import, and none allowed: vitest runs on Node and cannot
// resolve that specifier, so any module reaching it becomes untestable. The
// SQLite half lives in controlDb.ts and stays thin enough not to need tests.

import { dirname, join } from 'node:path'

export interface WorkspaceRow {
  id: string
  name: string
  backend: string
  apiKey: string | null
  webhookSecret: string | null
  teamId: string | null
  sortOrder: number
  createdAt: number
}

/** What GET /api/workspaces ships. Secrets appear only as booleans. */
export interface WorkspaceProfile {
  id: string
  name: string
  linearApiKeySet: boolean
  webhookSecretSet: boolean
  linearTeamId: string | null
  dbPath: string
}

export interface WorkspaceConfigResult {
  profiles: WorkspaceProfile[]
  activeProfile: WorkspaceProfile | null
  values: { LINEAR_API_KEY?: string; LINEAR_TEAM_ID?: string; SQLITE_PATH: string }
  /** Set when the stored active id names a workspace that no longer exists. */
  staleOverride: string | null
}

/** `active` was the WORKSPACE_ACTIVE selector under the env scheme; keeping it
 *  reserved avoids resurrecting that collision if the env path ever returns. */
export const RESERVED_WORKSPACE_IDS = new Set(['active'])

const ID_RE = /^[a-z0-9][a-z0-9-]*$/
const MAX_ID_LENGTH = 64

export function normalizeWorkspaceId(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * Ids come from a web form and become filesystem path segments, so this is a
 * security boundary rather than a tidiness check. The character class alone
 * rules out `.`, `..`, `/` and `\`, which is the whole traversal surface.
 */
export function isValidWorkspaceId(id: string): boolean {
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return false
  if (RESERVED_WORKSPACE_IDS.has(id)) return false
  return ID_RE.test(id)
}

/**
 * `data/workspaces/<id>/graph.db`, derived rather than stored. A stored path
 * would be an arbitrary-file-write primitive the moment the roster became
 * editable from the browser.
 */
export function workspaceDbPath(baseSqlitePath: string, id: string): string {
  if (!isValidWorkspaceId(id)) {
    throw new Error(`Refusing to build a path for invalid workspace id: ${JSON.stringify(id)}`)
  }
  return join(dirname(baseSqlitePath), 'workspaces', id, 'graph.db')
}

export function toProfile(row: WorkspaceRow, baseSqlitePath: string): WorkspaceProfile {
  return {
    id: row.id,
    name: row.name || row.id,
    linearApiKeySet: Boolean(row.apiKey),
    webhookSecretSet: Boolean(row.webhookSecret),
    linearTeamId: row.teamId,
    dbPath: workspaceDbPath(baseSqlitePath, row.id),
  }
}

/** Roster order: explicit sortOrder first, id as the tiebreak so the list is
 *  stable when every row still has the default 0. */
function byOrder(a: WorkspaceRow, b: WorkspaceRow): number {
  return a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
}

/** A row whose stored id is not a valid slug cannot be given a path, so it is
 *  dropped rather than allowed to throw during resolution. */
function usableRows(rows: WorkspaceRow[]): WorkspaceRow[] {
  return rows.filter((r) => isValidWorkspaceId(r.id)).sort(byOrder)
}

function valuesFor(row: WorkspaceRow, baseSqlitePath: string): WorkspaceConfigResult['values'] {
  return {
    LINEAR_API_KEY: row.apiKey ?? undefined,
    LINEAR_TEAM_ID: row.teamId ?? undefined,
    SQLITE_PATH: workspaceDbPath(baseSqlitePath, row.id),
  }
}

export function buildWorkspaceConfig(input: {
  rows: WorkspaceRow[]
  activeOverride: string | null
  defaultSqlitePath: string
}): WorkspaceConfigResult {
  const rows = usableRows(input.rows)
  const profiles = rows.map((r) => toProfile(r, input.defaultSqlitePath))
  const overrideId = input.activeOverride ? normalizeWorkspaceId(input.activeOverride) : null

  // A stored active id that no longer resolves does NOT silently become
  // rows[0]: that would point the instance at a different tenant's data. The
  // caller clears the stale value and resolution falls through as if unset.
  const staleOverride = overrideId && !rows.some((r) => r.id === overrideId) ? overrideId : null
  const effective = staleOverride ? null : overrideId

  const activeRow = (effective ? rows.find((r) => r.id === effective) : rows[0]) ?? null

  // Empty roster: nothing is configured yet, and there is no env key left to
  // fall back to. This is the state the onboarding screen keys off.
  if (!activeRow) {
    return {
      profiles,
      activeProfile: null,
      values: { SQLITE_PATH: input.defaultSqlitePath },
      staleOverride,
    }
  }

  return {
    profiles,
    activeProfile: toProfile(activeRow, input.defaultSqlitePath),
    values: valuesFor(activeRow, input.defaultSqlitePath),
    staleOverride,
  }
}

/**
 * Resolve one workspace by id, bypassing the active-selection logic. Used by
 * the per-workspace Config cache, which holds one entry per id.
 *
 * Returns null for an unknown id rather than falling back — serving another
 * workspace's credentials under the requested id would silently show the wrong
 * tenant's data.
 */
export function resolveProfileValuesById(
  rows: WorkspaceRow[],
  defaultSqlitePath: string,
  id: string,
): WorkspaceConfigResult['values'] | null {
  const wanted = normalizeWorkspaceId(id)
  const match = usableRows(rows).find((r) => r.id === wanted)
  return match ? valuesFor(match, defaultSqlitePath) : null
}

/** The secret for one workspace, for the webhook route. Kept here so the route
 *  reads it off the roster it already resolved instead of doing a second
 *  lookup through a module that would drag `bun:sqlite` into its tests. */
export function webhookSecretFor(rows: WorkspaceRow[], id: string): string | null {
  const wanted = normalizeWorkspaceId(id)
  return usableRows(rows).find((r) => r.id === wanted)?.webhookSecret ?? null
}
