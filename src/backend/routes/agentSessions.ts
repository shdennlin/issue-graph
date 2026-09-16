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
import { loadConfig } from '../lib/env.js'
import { readCachedIssues, readWorkflowStatesCached } from '../cache.js'
import { issueFromBranch, teamKeysFrom } from '../branchIssue.js'
import {
  HOOK_PAYLOAD_VERSION,
  SESSION_ID_MAX,
  parseSessionReport,
  type AgentSessionRow,
} from '../agentSessionStore.js'

const unauthorized = () => ({ error: { code: 'unauthorized', message: 'bad or missing token' } }) as const
const invalid = (message: string) => ({ error: { code: 'invalid', message } }) as const

/**
 * Constant-time-ish comparison. Not a defence against a remote timing attack —
 * network jitter swamps the signal at this scale — but it costs nothing and
 * avoids the reflex of writing `a === b` for a secret, which is the habit worth
 * not having.
 */
function tokenMatches(presented: string, expected: string): boolean {
  if (presented.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < presented.length; i++) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

function authorized(header: string | undefined): boolean {
  const expected = loadConfig().AGENT_SESSION_TOKEN
  // Unset = closed. See the header comment.
  if (!expected) return false
  const presented = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  if (presented.length === 0) return false
  return tokenMatches(presented, expected)
}

export const agentSessionRoutes = new Hono()

agentSessionRoutes.post('/api/agent-sessions', async (c) => {
  if (!authorized(c.req.header('Authorization'))) return c.json(unauthorized(), 401)

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
      `INSERT INTO agent_session(session_id, identifier, branch, cwd, host, phase, status, last_seen, payload_version)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
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
         payload_version = excluded.payload_version`,
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
    )

  return c.json({ ok: true, identifier, serverPayloadVersion: HOOK_PAYLOAD_VERSION })
})

agentSessionRoutes.delete('/api/agent-sessions/:sessionId', (c) => {
  if (!authorized(c.req.header('Authorization'))) return c.json(unauthorized(), 401)
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
 *  graph response already carries. */
agentSessionRoutes.get('/api/agent-sessions', (c) => {
  const rows = getDb()
    .prepare(
      `SELECT session_id, identifier, branch, cwd, host, phase, status, last_seen, payload_version FROM agent_session`,
    )
    .all() as AgentSessionRow[]
  return c.json({ entries: rows })
})
