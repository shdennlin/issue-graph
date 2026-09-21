// Agent-session reporting. Written by the Claude Code hook plugin in
// integrations/claude-code/; read back through the graph response.
//
// Thin by the same rule as routes/lifecycle.ts: validation, liveness and the
// branch → issue rules live in agentSessionStore.ts and branchIssue.ts so they
// can be tested. vitest cannot load anything that reaches `bun:sqlite`.
//
// THIS IS THE SECOND ROUTE MEANT TO BE REACHABLE FROM OUTSIDE (the first is the
// Linear webhook), and the app has no auth by design. So unlike every other
// mutating route here, an Origin check is not enough — the hook is not a
// browser and sends no Origin. It carries a bearer token instead, and an unset
// AGENT_SESSION_TOKEN CLOSES the endpoint rather than opening it: a server
// deployed without the variable must not quietly accept writes from anywhere.
//
// Nothing here touches Linear, and a session report never changes an issue.

import { Hono } from 'hono'
import { getDb } from '../db.js'
import { agentTokenValid } from '../lib/http.js'
import { readCachedIssues, readWorkflowStatesCached } from '../cache.js'
import { issueFromBranch, teamKeysFrom } from '../branchIssue.js'
import {
  HOOK_PAYLOAD_VERSION,
  SESSION_ID_MAX,
  parseSessionReport,
  sessionRowToDTO,
  type AgentSessionRow,
} from '../agentSessionStore.js'
import { sessionBriefing, type BriefingStage } from '../../shared/sessionBriefing.js'

const unauthorized = () => ({ error: { code: 'unauthorized', message: 'bad or missing token' } }) as const
const invalid = (message: string) => ({ error: { code: 'invalid', message } }) as const

export const agentSessionRoutes = new Hono()

agentSessionRoutes.post('/api/agent-sessions', async (c) => {
  if (!agentTokenValid(c.req.header('Authorization'))) return c.json(unauthorized(), 401)

  const body = await c.req.json().catch(() => null)
  const report = parseSessionReport(body)
  if (!report) return c.json(invalid('bad report'), 400)

  // Resolve the branch here rather than in the hook: the rules need fixing over
  // time (see branchIssue.ts), and a rule in the server can be fixed by
  // restarting it, while one baked into an installed plugin cannot.
  //
  // Team keys come from the cache, so a server that has never synced resolves
  // nothing. That is the safe direction — an unattributed session is better
  // than one parked on the wrong issue. Workflow states are preferred over
  // issues because they cover every team, not just the ones with something in
  // the current scope window.
  const identifier = issueFromBranch(report.branch, {
    teamKeys: teamKeysFrom(readCachedIssues(), readWorkflowStatesCached()),
  })

  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO agent_session(session_id, identifier, branch, cwd, host, phase, status, last_seen, payload_version, label)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         identifier = excluded.identifier,
         branch = excluded.branch,
         cwd = excluded.cwd,
         host = excluded.host,
         -- A heartbeat with no phase must not erase the last one we saw: only
         -- SessionStart and a slash command carry it.
         phase = COALESCE(excluded.phase, agent_session.phase),
         status = excluded.status,
         last_seen = excluded.last_seen,
         payload_version = excluded.payload_version,
         label = COALESCE(excluded.label, agent_session.label)`,
    )
    .run(
      report.sessionId,
      identifier,
      report.branch,
      report.cwd,
      report.host,
      report.phase,
      report.status,
      now,
      report.payloadVersion,
      report.label,
    )

  // Only when asked. `start` asks; the heartbeats from UserPromptSubmit and
  // PostToolUse fire many times a session and have nothing to do with the
  // answer, so they must not pay three queries for it.
  const briefing = c.req.query('context') === '1' ? buildBriefing(identifier) : null

  return c.json({
    ok: true,
    identifier,
    serverPayloadVersion: HOOK_PAYLOAD_VERSION,
    ...(briefing === null ? {} : { briefing }),
  })
})

interface StageRow {
  key: string
  name: string
  next_command: string | null
  fields: string
}

/** The rows behind sessionBriefing(). Everything it decides lives in shared/. */
function buildBriefing(identifier: string | null): string | null {
  const db = getDb()

  // An issue may sit in more than one workstream. The most recently created
  // ACTIVE one is the answer: an archived workstream is off the board, which
  // is what archiving it meant, and of two live ones the newer is the work in
  // hand. Picking wrong here costs a wrong sentence, not a wrong write.
  const ws =
    identifier === null
      ? undefined
      : (db
          .prepare(
            `SELECT b.name AS name, b.note AS note, b.stage_key AS stage_key
               FROM batch b JOIN batch_member m ON m.batch_id = b.id
              WHERE m.identifier = ? AND b.status <> 'archived'
              ORDER BY b.created_at DESC, b.id DESC LIMIT 1`,
          )
          .get(identifier) as { name: string; note: string | null; stage_key: string | null } | undefined)

  if (ws === undefined) {
    return sessionBriefing({ identifier, workstream: null, stage: null, pipeline: [], meanings: {} })
  }

  const stageRows = db
    .prepare(`SELECT key, name, next_command, fields FROM lifecycle_stage ORDER BY sort_order ASC`)
    .all() as StageRow[]

  let stage: BriefingStage | null = null
  const row = stageRows.find((r) => r.key === ws.stage_key)
  if (row !== undefined) {
    let fields: string[] = []
    try {
      const parsed: unknown = JSON.parse(row.fields)
      if (Array.isArray(parsed)) fields = parsed.filter((v): v is string => typeof v === 'string')
    } catch {
      // A malformed list costs the field section, not the briefing.
    }
    stage = { key: row.key, name: row.name, nextCommand: row.next_command, fields }
  }

  const meanings: Record<string, string> = {}
  for (const f of db.prepare(`SELECT name, description FROM field`).all() as {
    name: string
    description: string
  }[]) {
    meanings[f.name] = f.description
  }

  return sessionBriefing({
    identifier,
    workstream: { name: ws.name, note: ws.note },
    stage,
    pipeline: stageRows.map((r) => ({ key: r.key, name: r.name })),
    meanings,
  })
}

agentSessionRoutes.delete('/api/agent-sessions/:sessionId', (c) => {
  if (!agentTokenValid(c.req.header('Authorization'))) return c.json(unauthorized(), 401)
  const sessionId = c.req.param('sessionId')
  if (sessionId.length === 0 || sessionId.length > SESSION_ID_MAX) {
    return c.json(invalid('bad sessionId'), 400)
  }
  // 204 whether or not a row went: SessionEnd is an early-removal optimisation,
  // and the TTL is what actually decides liveness. A missing row is not an
  // error worth making a hook script handle.
  getDb().prepare(`DELETE FROM agent_session WHERE session_id = ?`).run(sessionId)
  return c.body(null, 204)
})

/** Read side is unguarded, like every other GET here — it is the same data the
 *  graph response already carries, and returned in the same DTO shape so the
 *  derived label is present on both paths rather than only one. */
agentSessionRoutes.get('/api/agent-sessions', (c) => {
  const rows = getDb()
    .prepare(
      `SELECT session_id, identifier, branch, cwd, host, phase, status, last_seen, payload_version, label FROM agent_session`,
    )
    .all() as AgentSessionRow[]
  return c.json({ entries: rows.map(sessionRowToDTO) })
})
