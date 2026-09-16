// vi.mock is hoisted above the imports to sever the edge to db.js, which
// imports `bun:sqlite` — a specifier Node cannot resolve. Same pattern and same
// reason as routes/savedViews.test.ts.
//
// The ordering and claim-eligibility rules are covered in batchStore.test.ts.
// What is tested here is what only exists at the route layer: the conditional
// UPDATE that makes a claim atomic, and who is allowed to write.
import { describe, it, expect, beforeEach, vi } from 'vitest'

interface Member {
  batch_id: number
  identifier: string
  claimed_by: string | null
  claimed_at: number | null
  done_at: number | null
}

const batches: { id: number; name: string; created_at: number }[] = []
const members: Member[] = []
let nextId = 1
let token: string | undefined

vi.mock('../db.js', () => ({
  getDb: () => ({
    transaction:
      (fn: (items: unknown) => void) =>
      (items: unknown) =>
        fn(items),
    prepare: (sql: string) => ({
      all: (batchId?: number) =>
        sql.includes('FROM batch_member')
          ? members.filter((m) => m.batch_id === batchId)
          : [...batches],
      get: (id: number) => batches.find((b) => b.id === id),
      run: (...args: unknown[]) => {
        const s = sql.trimStart()
        if (s.startsWith('INSERT INTO batch_member')) {
          const [batch_id, identifier] = args as [number, string]
          members.push({ batch_id, identifier, claimed_by: null, claimed_at: null, done_at: null })
          return { changes: 1 }
        }
        if (s.startsWith('INSERT INTO batch')) {
          const [name, created_at] = args as [string, number]
          batches.push({ id: nextId, name, created_at })
          return { lastInsertRowid: nextId++, changes: 1 }
        }
        if (s.startsWith('UPDATE batch_member SET claimed_by')) {
          const [claimant, at, batchId, identifier, self] = args as [
            string,
            number,
            number,
            string,
            string,
          ]
          const m = members.find((x) => x.batch_id === batchId && x.identifier === identifier)
          // Mirrors the route's WHERE: only an unclaimed row, or one already
          // held by the same caller, can be taken. This is the whole race.
          if (!m || (m.claimed_by !== null && m.claimed_by !== self)) return { changes: 0 }
          m.claimed_by = claimant
          m.claimed_at = at
          return { changes: 1 }
        }
        if (s.startsWith('UPDATE batch_member SET done_at')) {
          const [at, batchId, identifier, claimant] = args as [number, number, string, string]
          const m = members.find((x) => x.batch_id === batchId && x.identifier === identifier)
          if (!m || m.claimed_by !== claimant) return { changes: 0 }
          m.done_at = at
          return { changes: 1 }
        }
        if (s.startsWith('DELETE FROM batch_member')) {
          const [batchId] = args as [number]
          for (let i = members.length - 1; i >= 0; i--) {
            if (members[i]?.batch_id === batchId) members.splice(i, 1)
          }
          return { changes: 1 }
        }
        if (s.startsWith('DELETE FROM batch')) {
          const [id] = args as [number]
          const i = batches.findIndex((b) => b.id === id)
          if (i === -1) return { changes: 0 }
          batches.splice(i, 1)
          return { changes: 1 }
        }
        return { changes: 0 }
      },
    }),
  }),
}))

vi.mock('../lib/env.js', () => ({ loadConfig: () => ({ AGENT_SESSION_TOKEN: token }) }))

// ONE-1 blocks ONE-2, so ONE-1 must be handed out first.
vi.mock('../cache.js', () => ({
  readCachedIssues: () => [
    { identifier: 'ONE-1', relations: [{ type: 'blocks', targetIdentifier: 'ONE-2' }] },
    { identifier: 'ONE-2', relations: [] },
  ],
}))

const { batchRoutes } = await import('./batch.js')

const req = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  batchRoutes.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const seed = async () =>
  req('/api/batches', 'POST', { name: 'Stack', members: ['ONE-2', 'ONE-1'] })

beforeEach(() => {
  batches.length = 0
  members.length = 0
  nextId = 1
  token = 'secret'
})

describe('POST /api/batches', () => {
  it('creates a batch and stores every member', async () => {
    const res = await seed()
    expect(res.status).toBe(201)
    expect(members.map((m) => m.identifier).sort()).toEqual(['ONE-1', 'ONE-2'])
  })

  it.each([
    ['a blank name', { name: '  ', members: ['ONE-1'] }],
    ['no members', { name: 'X', members: [] }],
    ['a bad identifier', { name: 'X', members: ['nope'] }],
  ])('rejects %s', async (_l, body) => {
    expect((await req('/api/batches', 'POST', body)).status).toBe(400)
  })
})

describe('GET /api/batches/:id', () => {
  it('returns members in dependency order, not insertion order', async () => {
    // Stored as ONE-2 then ONE-1; the order is derived from `blocks` at read
    // time, because those edges live on the issues and change in Linear.
    await seed()
    const body = (await (await req('/api/batches/1', 'GET')).json()) as {
      members: { identifier: string; blockedBy: string[] }[]
    }
    expect(body.members.map((m) => m.identifier)).toEqual(['ONE-1', 'ONE-2'])
    expect(body.members[1]?.blockedBy).toEqual(['ONE-1'])
  })

  it('404s on an unknown batch', async () => {
    expect((await req('/api/batches/99', 'GET')).status).toBe(404)
  })
})

describe('POST /api/batches/:id/next', () => {
  it('hands out the blocker first', async () => {
    await seed()
    const body = (await (await req('/api/batches/1/next', 'POST', { claimant: 'a' })).json()) as {
      identifier: string
    }
    expect(body.identifier).toBe('ONE-1')
  })

  it('does not give two sessions the same issue', async () => {
    // The claim is a conditional UPDATE, so only one caller can win a row. The
    // loser re-chooses rather than failing.
    await seed()
    const a = (await (await req('/api/batches/1/next', 'POST', { claimant: 'a' })).json()) as {
      identifier: string | null
    }
    const b = (await (await req('/api/batches/1/next', 'POST', { claimant: 'b' })).json()) as {
      identifier: string | null
      reason?: string
    }
    expect(a.identifier).toBe('ONE-1')
    // ONE-2 is blocked by the unfinished ONE-1, so there is nothing for b yet.
    expect(b.identifier).toBeNull()
    expect(b.reason).toBe('blocked')
  })

  it('gives a session its own claim back instead of a second issue', async () => {
    await seed()
    await req('/api/batches/1/next', 'POST', { claimant: 'a' })
    const again = (await (await req('/api/batches/1/next', 'POST', { claimant: 'a' })).json()) as {
      identifier: string
    }
    expect(again.identifier).toBe('ONE-1')
    expect(members.filter((m) => m.claimed_by === 'a')).toHaveLength(1)
  })

  it('unblocks the dependant once the blocker is reported done', async () => {
    await seed()
    await req('/api/batches/1/next', 'POST', { claimant: 'a' })
    await req('/api/batches/1/done', 'POST', { identifier: 'ONE-1', claimant: 'a' })
    const b = (await (await req('/api/batches/1/next', 'POST', { claimant: 'b' })).json()) as {
      identifier: string
    }
    expect(b.identifier).toBe('ONE-2')
  })

  it('distinguishes a finished batch from a blocked one', async () => {
    // "done" means stop asking; "blocked" means come back later. Collapsing
    // them would make a session either give up early or spin forever.
    await seed()
    await req('/api/batches/1/next', 'POST', { claimant: 'a' })
    await req('/api/batches/1/done', 'POST', { identifier: 'ONE-1', claimant: 'a' })
    await req('/api/batches/1/next', 'POST', { claimant: 'a' })
    await req('/api/batches/1/done', 'POST', { identifier: 'ONE-2', claimant: 'a' })
    const done = (await (await req('/api/batches/1/next', 'POST', { claimant: 'a' })).json()) as {
      reason: string
    }
    expect(done.reason).toBe('done')
  })
})

describe('POST /api/batches/:id/done', () => {
  it('refuses to let a session finish work it does not hold', async () => {
    // Otherwise a stale session could mark done what another is mid-way
    // through, and the batch would hand out its dependants too early.
    await seed()
    await req('/api/batches/1/next', 'POST', { claimant: 'a' })
    const res = await req('/api/batches/1/done', 'POST', { identifier: 'ONE-1', claimant: 'b' })
    expect(res.status).toBe(409)
    expect(members.find((m) => m.identifier === 'ONE-1')?.done_at).toBeNull()
  })

  it('refuses an unclaimed member', async () => {
    await seed()
    expect(
      (await req('/api/batches/1/done', 'POST', { identifier: 'ONE-1', claimant: 'a' })).status,
    ).toBe(409)
  })
})

describe('write guard', () => {
  it('allows a same-origin browser with no token', async () => {
    token = undefined
    expect((await seed()).status).toBe(201)
  })

  it('allows the agent token from a foreign origin', async () => {
    // The MCP server is not a browser and sends no Origin, so originAllowed
    // cannot speak for it.
    const res = await req(
      '/api/batches',
      'POST',
      { name: 'X', members: ['ONE-1'] },
      { Origin: 'https://elsewhere.example', Authorization: 'Bearer secret' },
    )
    expect(res.status).toBe(201)
  })

  it('denies a foreign origin with no token', async () => {
    const res = await req(
      '/api/batches',
      'POST',
      { name: 'X', members: ['ONE-1'] },
      { Origin: 'https://elsewhere.example' },
    )
    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/batches/:id', () => {
  it('removes the batch and its members', async () => {
    await seed()
    const res = await batchRoutes.request('/api/batches/1', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(batches).toHaveLength(0)
    expect(members).toHaveLength(0)
  })
})
