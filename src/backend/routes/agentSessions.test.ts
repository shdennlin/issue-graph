// vi.mock is hoisted above the imports to sever the edge to db.js, which
// imports `bun:sqlite` — a specifier Node cannot resolve. Same pattern and same
// reason as routes/savedViews.test.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest'

interface Row {
  session_id: string
  identifier: string | null
  branch: string | null
  status: string
  phase: string | null
  last_seen: number
}

const rows: Row[] = []
let token: string | undefined

// The briefing's three lookups. `null` for the workstream means "this issue is
// in none", which is the ordinary case, not an error.
let workstream: { name: string; note: string | null; stage_key: string | null } | null = null
let stages: { key: string; name: string; next_command: string | null; fields: string }[] = []
let fieldDefs: { name: string; description: string }[] = []
/** Every SQL statement prepared, so a test can assert what was NOT run. */
const prepared: string[] = []

vi.mock('../db.js', () => ({
  getDb: () => ({
    prepare: (sql: string) => {
      prepared.push(sql)
      if (sql.includes('FROM batch b JOIN batch_member')) {
        return { get: () => workstream ?? undefined, all: () => [], run: () => ({ changes: 0 }) }
      }
      if (sql.includes('FROM lifecycle_stage')) {
        return { all: () => [...stages], get: () => undefined, run: () => ({ changes: 0 }) }
      }
      if (sql.includes('FROM field')) {
        return { all: () => [...fieldDefs], get: () => undefined, run: () => ({ changes: 0 }) }
      }
      return sessionStatement(sql)
    },
  }),
}))

function sessionStatement(sql: string) {
  return {
      all: () => [...rows],
      get: () => undefined,
      run: (...args: unknown[]) => {
        const s = sql.trimStart()
        if (s.startsWith('DELETE')) {
          const [id] = args as [string]
          const i = rows.findIndex((r) => r.session_id === id)
          if (i === -1) return { changes: 0 }
          rows.splice(i, 1)
          return { changes: 1 }
        }
        if (s.startsWith('INSERT')) {
          const [session_id, identifier, branch, , , phase, status, last_seen] = args as [
            string,
            string | null,
            string | null,
            unknown,
            unknown,
            string | null,
            string,
            number,
          ]
          const existing = rows.find((r) => r.session_id === session_id)
          if (existing) {
            // Mirrors the route's COALESCE: a heartbeat with no phase keeps the
            // last one seen.
            Object.assign(existing, {
              identifier,
              branch,
              status,
              last_seen,
              phase: phase ?? existing.phase,
            })
          } else {
            rows.push({ session_id, identifier, branch, status, phase, last_seen })
          }
          return { changes: 1 }
        }
        return { changes: 0 }
      },
  }
}

vi.mock('../lib/env.js', () => ({ loadConfig: () => ({ AGENT_SESSION_TOKEN: token }) }))

// No cached issues at all — the team key comes from the workflow states, which
// is the case that matters: a team with nothing inside the current scope window
// must still resolve, or a session on one of its branches silently attributes
// to nothing.
vi.mock('../cache.js', () => ({
  readCachedIssues: () => [],
  readWorkflowStatesCached: () => [{ teamKey: 'ONE' }],
}))

const { agentSessionRoutes } = await import('./agentSessions.js')

const post = (body: unknown, auth: string | null = 'Bearer secret') =>
  agentSessionRoutes.request('/api/agent-sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: auth } : {}),
    },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  rows.length = 0
  prepared.length = 0
  token = 'secret'
  workstream = null
  stages = []
  fieldDefs = []
})

describe('auth', () => {
  it('rejects a write when no token is configured', async () => {
    // Unset must mean CLOSED, not open. This route is meant to be reachable
    // from outside an app that has no auth by design, so a server deployed
    // without the variable must not quietly accept writes from anywhere.
    token = undefined
    const res = await post({ sessionId: 'a' })
    expect(res.status).toBe(401)
    expect(rows).toHaveLength(0)
  })

  it.each([
    ['a wrong token', 'Bearer nope'],
    ['a token of the right length but wrong bytes', 'Bearer secres'],
    ['no Authorization header', null],
    ['a non-bearer scheme', 'Basic secret'],
    ['an empty bearer', 'Bearer '],
  ])('rejects %s', async (_label, auth) => {
    const res = await post({ sessionId: 'a' }, auth)
    expect(res.status).toBe(401)
    expect(rows).toHaveLength(0)
  })

  it('accepts the configured token', async () => {
    expect((await post({ sessionId: 'a' })).status).toBe(200)
  })

  it('guards DELETE as well as POST', async () => {
    token = undefined
    const res = await agentSessionRoutes.request('/api/agent-sessions/a', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/agent-sessions', () => {
  it('resolves the issue from the branch', async () => {
    const res = await post({ sessionId: 'a', branch: 'fix/one-393-task-failed-status' })
    expect(((await res.json()) as { identifier: string }).identifier).toBe('ONE-393')
    expect(rows[0]?.identifier).toBe('ONE-393')
  })

  it('stores a session whose branch carries no issue', async () => {
    // A branch with no ticket is ordinary work, not an error — the session is
    // recorded, it simply appears on no card.
    const res = await post({ sessionId: 'a', branch: 'feat/skill-system' })
    expect(res.status).toBe(200)
    expect(rows[0]?.identifier).toBeNull()
  })

  it('does not attribute a session to a model name that looks like an id', async () => {
    await post({ sessionId: 'a', branch: 'feat/gemma-4-mtp' })
    expect(rows[0]?.identifier).toBeNull()
  })

  it('upserts on heartbeat instead of duplicating', async () => {
    await post({ sessionId: 'a', branch: 'fix/one-1-x' })
    // 'idle' is what an already-installed plugin reports; it is read as
    // 'waiting', because the wire format cannot be renegotiated once installs
    // exist in the wild.
    await post({ sessionId: 'a', branch: 'fix/one-1-x', status: 'idle' })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('waiting')
  })

  it('records a Notification as blocked, distinct from waiting', async () => {
    // The only state worth walking over for: stopped on a permission prompt
    // with nothing running behind it.
    await post({ sessionId: 'a', status: 'blocked', phase: 'needs permission' })
    expect(rows[0]?.status).toBe('blocked')
  })

  it('keeps the last phase when a heartbeat carries none', async () => {
    // Only SessionStart and a slash command carry a phase; a file-edit
    // heartbeat would otherwise blank it on every save.
    await post({ sessionId: 'a', phase: '/spectra-apply' })
    await post({ sessionId: 'a' })
    expect(rows[0]?.phase).toBe('/spectra-apply')
  })

  it('rejects a report with no session id', async () => {
    expect((await post({ branch: 'fix/one-1-x' })).status).toBe(400)
  })
})

describe('DELETE /api/agent-sessions/:sessionId', () => {
  it('removes the row', async () => {
    await post({ sessionId: 'a' })
    const res = await agentSessionRoutes.request('/api/agent-sessions/a', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer secret' },
    })
    expect(res.status).toBe(204)
    expect(rows).toHaveLength(0)
  })

  it('is 204 for an unknown session, not 404', async () => {
    // SessionEnd is an early-removal optimisation; the TTL is what actually
    // decides liveness. A missing row is not an error a hook script should
    // have to handle.
    const res = await agentSessionRoutes.request('/api/agent-sessions/ghost', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer secret' },
    })
    expect(res.status).toBe(204)
  })
})

describe('the SessionStart briefing', () => {
  const withContext = (body: unknown) =>
    agentSessionRoutes.request('/api/agent-sessions?context=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret' },
      body: JSON.stringify(body),
    })

  const onOne245 = { sessionId: 's1', branch: 'fix/one-245-token-flow', status: 'active' }

  beforeEach(() => {
    workstream = { name: 'OAuth migration', note: 'Replace the token flow.', stage_key: 'ci' }
    stages = [
      { key: 'impl', name: 'Implementing', next_command: null, fields: '["issue"]' },
      { key: 'ci', name: 'Waiting CI', next_command: 'gh run watch', fields: '["issue","runbook"]' },
      { key: 'done', name: 'Done', next_command: null, fields: '["issue"]' },
    ]
    fieldDefs = [{ name: 'runbook', description: 'The on-call doc.' }]
  })

  it('answers with the workstream, the stage and what the stage wants attached', async () => {
    const dto = (await (await withContext(onOne245)).json()) as { briefing?: string }
    expect(dto.briefing).toContain('ONE-245')
    expect(dto.briefing).toContain('"OAuth migration"')
    expect(dto.briefing).toContain('"Waiting CI"')
    expect(dto.briefing).toContain('- runbook: The on-call doc.')
  })

  it('costs a heartbeat NOTHING', async () => {
    // UserPromptSubmit and PostToolUse fire many times a session and have no
    // use for the answer. Without the `?context=1` gate they would each run
    // three extra queries to build a string nobody reads.
    const dto = (await (await post(onOne245)).json()) as { briefing?: string }
    expect(dto.briefing).toBeUndefined()
    expect(prepared.filter((s) => s.includes('FROM batch b JOIN batch_member'))).toHaveLength(0)
    expect(prepared.filter((s) => s.includes('FROM lifecycle_stage'))).toHaveLength(0)
  })

  it('omits the key entirely when the branch names no issue', async () => {
    const dto = (await (
      await withContext({ sessionId: 's1', branch: 'chore/tidy', status: 'active' })
    ).json()) as { briefing?: string }
    expect(dto.briefing).toBeUndefined()
  })

  it('reports an issue that is in no workstream rather than saying nothing', async () => {
    workstream = null
    const dto = (await (await withContext(onOne245)).json()) as { briefing?: string }
    expect(dto.briefing).toBe('This branch names ONE-245, which is not in any workstream.')
  })

  it('survives a stage whose field list is not JSON', async () => {
    // A briefing is a convenience. A malformed column costs the field section,
    // never the session start.
    stages = [{ key: 'ci', name: 'Waiting CI', next_command: null, fields: '{oops' }]
    const dto = (await (await withContext(onOne245)).json()) as { briefing?: string }
    expect(dto.briefing).toContain('"Waiting CI"')
    expect(dto.briefing).not.toContain('attached by hand')
  })

  it('still records the session when the briefing is asked for', async () => {
    await withContext(onOne245)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.identifier).toBe('ONE-245')
  })
})
