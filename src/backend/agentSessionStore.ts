// Pure agent-session logic: report validation, liveness, row projection.
//
// No `bun:sqlite` import, and none allowed — same rule and same reason as
// savedViewStore.ts and lifecycleStore.ts.
//
// Liveness is a TTL over `last_seen`, NOT the SessionEnd hook. A session killed
// with SIGKILL, a crashed terminal, or a laptop that slept never sends
// SessionEnd, so treating its absence as "still running" would fill the graph
// with sessions that died days ago. SessionEnd is an optimisation that removes
// a row early; the TTL is what actually decides.
//
// The wire format carries a version from the first release. Once the plugin is
// installed on machines, the format cannot be renegotiated — the server has to
// be able to recognise an old reporter rather than reject it as malformed.

import type { AgentSessionDTO } from '../shared/types.js'

/** Bumped only on a breaking change to what the hook sends. */
export const HOOK_PAYLOAD_VERSION = 1

/**
 * How long a session may go unheard before it is presumed dead.
 *
 * Fifteen minutes, chosen against what the hooks actually fire on: a heartbeat
 * lands on every user prompt and every file edit, so a session doing work is
 * heard from constantly. The gap this has to tolerate is a long single tool
 * call or a model thinking — minutes, not hours. Much shorter and a slow build
 * would make a live session flicker out; much longer and a dead one lingers
 * past the point where its card is still telling the truth.
 */
export const SESSION_TTL_MS = 15 * 60 * 1000

export interface AgentSessionRow {
  session_id: string
  identifier: string | null
  branch: string | null
  cwd: string | null
  host: string | null
  phase: string | null
  status: string
  last_seen: number
  payload_version: number
}

export const SESSION_ID_MAX = 200
const FIELD_MAX = 500

export type SessionStatus = 'active' | 'idle'

export interface SessionReport {
  sessionId: string
  branch: string | null
  cwd: string | null
  host: string | null
  phase: string | null
  status: SessionStatus
  payloadVersion: number
}

function str(raw: unknown, max = FIELD_MAX): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (v.length === 0 || v.length > max) return null
  return v
}

/**
 * Validate one hook report. Returns null when the report is unusable.
 *
 * Only `sessionId` is required. Everything else is best-effort: a hook running
 * outside a git repo has no branch, and a branch with no issue id is a normal
 * outcome rather than an error. Rejecting those would silently drop exactly the
 * sessions most worth seeing — the ones somewhere unexpected.
 */
export function parseSessionReport(raw: unknown): SessionReport | null {
  if (raw === null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const sessionId = str(o.sessionId, SESSION_ID_MAX)
  if (sessionId === null) return null

  const status: SessionStatus = o.status === 'idle' ? 'idle' : 'active'
  const version =
    typeof o.payloadVersion === 'number' && Number.isInteger(o.payloadVersion)
      ? o.payloadVersion
      : // An unversioned report can only be from a pre-versioning build, which
        // never shipped. Recording 0 keeps it distinguishable rather than
        // silently claiming it speaks the current format.
        0

  return {
    sessionId,
    branch: str(o.branch),
    cwd: str(o.cwd),
    host: str(o.host),
    phase: str(o.phase, 100),
    status,
    payloadVersion: version,
  }
}

export function sessionRowToDTO(row: AgentSessionRow): AgentSessionDTO {
  return {
    sessionId: row.session_id,
    identifier: row.identifier,
    branch: row.branch,
    cwd: row.cwd,
    host: row.host,
    phase: row.phase,
    status: row.status === 'idle' ? 'idle' : 'active',
    lastSeen: row.last_seen,
  }
}

/** Is this row still within the TTL? */
export function isLive(row: Pick<AgentSessionRow, 'last_seen'>, now: number, ttlMs = SESSION_TTL_MS): boolean {
  return now - row.last_seen < ttlMs
}

/** Rows a card should show: live ones only, newest heartbeat first. */
export function liveSessions(
  rows: AgentSessionRow[],
  now: number,
  ttlMs = SESSION_TTL_MS,
): AgentSessionDTO[] {
  return rows
    .filter((r) => isLive(r, now, ttlMs))
    .sort((a, b) => b.last_seen - a.last_seen)
    .map(sessionRowToDTO)
}

/** Sessions grouped by the issue they are on. Rows with no issue are dropped —
 *  they are real sessions, but no card can display them. */
export function indexSessionsByIssue(
  sessions: AgentSessionDTO[],
): Map<string, AgentSessionDTO[]> {
  const map = new Map<string, AgentSessionDTO[]>()
  for (const s of sessions) {
    if (!s.identifier) continue
    const list = map.get(s.identifier)
    if (list) list.push(s)
    else map.set(s.identifier, [s])
  }
  return map
}
