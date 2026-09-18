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

interface Batch {
  id: number
  name: string
  updated_at?: number | null
  archived_at?: number | null
  created_at: number
  stage_key: string | null
  status: string
  stage_entered_at: number | null
  assignees: string
}

const batches: Batch[] = []
const members: Member[] = []
const notes: { batch_id: number; stage_key: string; body: string }[] = []
const links: { batch_id: number; stage_key: string; kind: string; value: string }[] = []
/** Stage keys the fake lifecycle table defines. */
const stageKeys: string[] = []
let nextId = 1
let token: string | undefined

vi.mock('../db.js', () => ({
  getDb: () => ({
    transaction:
      (fn: (items: unknown) => void) =>
      (items: unknown) =>
        fn(items),
    prepare: (sql: string) => ({
      all: (batchId?: number) => {
        if (sql.includes('FROM batch_member')) return members.filter((m) => m.batch_id === batchId)
        if (sql.includes('FROM workstream_stage_note')) {
          return notes.filter((n) => n.batch_id === batchId).map((n) => ({ ...n, updated_at: 0 }))
        }
        if (sql.includes('FROM workstream_stage_link')) {
          return links
            .filter((l) => l.batch_id === batchId)
            .map((l) => ({ ...l, label: null, created_at: 0 }))
        }
        return [...batches]
      },
      // bun:sqlite answers a miss with NULL, not undefined. The mock does the
      // same on purpose: a `!== undefined` check passed here and failed against
      // a real server, letting every unknown stage key through.
      get: (a: number | string, b?: string) => {
        if (sql.includes('FROM lifecycle_stage')) {
          return stageKeys.includes(String(a)) ? { key: a } : null
        }
        if (sql.includes('FROM workstream_stage_note')) {
          return notes.find((n) => n.batch_id === a && n.stage_key === b) ?? null
        }
        return batches.find((x) => x.id === a) ?? null
      },
      run: (...args: unknown[]) => {
        const s = sql.trimStart()
        if (s.startsWith('INSERT INTO batch_member')) {
          const [batch_id, identifier] = args as [number, string]
          members.push({ batch_id, identifier, claimed_by: null, claimed_at: null, done_at: null })
          return { changes: 1 }
        }
        if (s.startsWith('INSERT INTO batch')) {
          // POSITIONAL, so it has to track the route's column list. Adding
          // `updated_at` to the INSERT once shifted `stage_key` one place along
          // and a rejected PATCH appeared to have set a stage to a timestamp —
          // a failure that pointed at the route and was entirely the mock's.
          const [name, created_at, updated_at, stage_key, stage_entered_at] = args as [
            string,
            number,
            number,
            string | null,
            number | null,
          ]
          batches.push({
            id: nextId,
            name,
            created_at,
            updated_at,
            archived_at: null,
            stage_key: stage_key ?? null,
            status: 'active',
            stage_entered_at: stage_entered_at ?? null,
            assignees: '[]',
          })
          return { lastInsertRowid: nextId++, changes: 1 }
        }
        if (s.startsWith('INSERT INTO workstream_stage_note')) {
          const [batch_id, stage_key, body] = args as [number, string, string]
          const found = notes.find((n) => n.batch_id === batch_id && n.stage_key === stage_key)
          if (found) found.body = body
          else notes.push({ batch_id, stage_key, body })
          return { changes: 1 }
        }
        if (s.startsWith('INSERT OR IGNORE INTO workstream_stage_link')) {
          const [batch_id, stage_key, kind, value] = args as [number, string, string, string]
          if (!links.some((l) => l.batch_id === batch_id && l.stage_key === stage_key && l.value === value)) {
            links.push({ batch_id, stage_key, kind, value })
          }
          return { changes: 1 }
        }
        if (s.startsWith('UPDATE batch SET')) {
          // The route builds the SET clause dynamically, so replay it by
          // pairing each assignment with its argument, id last.
          const cols = [...sql.matchAll(/(\w+) = \?/g)].map((m) => m[1])
          const id = args[args.length - 1] as number
          const row = batches.find((x) => x.id === id)
          if (!row) return { changes: 0 }
          cols.forEach((col, i) => {
            ;(row as unknown as Record<string, unknown>)[col as string] = args[i]
          })
          return { changes: 1 }
        }
        if (s.startsWith('DELETE FROM workstream_stage_note')) return { changes: 1 }
        if (s.startsWith('DELETE FROM workstream_stage_link')) return { changes: 1 }
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
  notes.length = 0
  links.length = 0
  stageKeys.length = 0
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

describe('PATCH /api/batches/:id — the workstream’s own fields', () => {
  beforeEach(async () => {
    await seed()
    stageKeys.push('spec', 'impl')
  })

  it('sets a stage and stamps when it was entered', async () => {
    const res = await req('/api/batches/1', 'PATCH', { stage: 'impl' })
    expect(res.status).toBe(200)
    expect(batches[0]?.stage_key).toBe('impl')
    expect(batches[0]?.stage_entered_at).not.toBeNull()
  })

  it('does NOT restamp when the same stage is set again', async () => {
    // A tool writing the current value on every heartbeat must not keep a
    // stalled workstream looking fresh.
    await req('/api/batches/1', 'PATCH', { stage: 'impl' })
    const first = batches[0]?.stage_entered_at
    await req('/api/batches/1', 'PATCH', { stage: 'impl' })
    expect(batches[0]?.stage_entered_at).toBe(first)
  })

  it('restamps on a move BACKWARDS', async () => {
    // CI going red and returning to Implementing is ordinary; staleness must
    // time the current occupancy, not the first one.
    await req('/api/batches/1', 'PATCH', { stage: 'impl' })
    const first = batches[0]?.stage_entered_at ?? 0
    batches[0]!.stage_entered_at = first - 1_000
    await req('/api/batches/1', 'PATCH', { stage: 'spec' })
    expect(batches[0]?.stage_key).toBe('spec')
    expect(batches[0]?.stage_entered_at).toBeGreaterThan(first - 1_000)
  })

  it('refuses a stage no lifecycle defines', async () => {
    // A typo must not park a workstream somewhere nothing will ever render.
    const res = await req('/api/batches/1', 'PATCH', { stage: 'nope' })
    expect(res.status).toBe(400)
    expect(batches[0]?.stage_key).toBeNull()
  })

  it('clears the stage on an explicit null', async () => {
    await req('/api/batches/1', 'PATCH', { stage: 'impl' })
    await req('/api/batches/1', 'PATCH', { stage: null })
    expect(batches[0]?.stage_key).toBeNull()
  })

  it('accepts the two statuses and refuses a third', async () => {
    expect((await req('/api/batches/1', 'PATCH', { status: 'archived' })).status).toBe(200)
    expect(batches[0]?.status).toBe('archived')
    expect((await req('/api/batches/1', 'PATCH', { status: 'paused' })).status).toBe(400)
  })

  it('stores assignees', async () => {
    await req('/api/batches/1', 'PATCH', { assignees: ['claude-1', 'claude-1', 'claude-2'] })
    expect(JSON.parse(batches[0]?.assignees ?? '[]')).toEqual(['claude-1', 'claude-2'])
  })

  it('rejects an empty patch and 404s an unknown workstream', async () => {
    expect((await req('/api/batches/1', 'PATCH', {})).status).toBe(400)
    expect((await req('/api/batches/99', 'PATCH', { name: 'X' })).status).toBe(404)
  })
})

describe('GET /api/batches — archived is off the board', () => {
  it('hides archived by default and returns it under status=all', async () => {
    await seed()
    await req('/api/batches/1', 'PATCH', { status: 'archived' })
    const hidden = (await (await req('/api/batches', 'GET')).json()) as { entries: unknown[] }
    expect(hidden.entries).toHaveLength(0)
    const all = (await (await req('/api/batches?status=all', 'GET')).json()) as { entries: unknown[] }
    expect(all.entries).toHaveLength(1)
  })
})

describe('stage notes', () => {
  beforeEach(async () => {
    await seed()
  })

  it('writes a note to a stage the workstream is not on', async () => {
    // The spec folder is known before Spec review is reached. Unlike `stage`, a
    // note has no second writer to coordinate with, so nothing is protected by
    // restricting which stage may be written.
    const res = await req('/api/batches/1/notes/spec', 'PUT', { body: 'openspec/changes/x' })
    expect(res.status).toBe(200)
    expect(notes[0]?.body).toBe('openspec/changes/x')
  })

  it('appends without clobbering what is already there', async () => {
    await req('/api/batches/1/notes/ci', 'PUT', { body: 'waiting on core-api' })
    await req('/api/batches/1/notes/ci', 'PUT', { append: 'frontend green' })
    expect(notes[0]?.body).toBe('waiting on core-api\nfrontend green')
  })

  it('appends into an empty stage without a leading newline', async () => {
    await req('/api/batches/1/notes/ci', 'PUT', { append: 'first line' })
    expect(notes[0]?.body).toBe('first line')
  })

  it('rejects a write with neither body nor append', async () => {
    expect((await req('/api/batches/1/notes/ci', 'PUT', {})).status).toBe(400)
  })
})

describe('hand-attached links', () => {
  beforeEach(async () => {
    await seed()
  })

  it('attaches a spec path and a url', async () => {
    expect(
      (await req('/api/batches/1/links/spec', 'POST', { kind: 'spec', value: 'openspec/changes/x' }))
        .status,
    ).toBe(200)
    expect(
      (await req('/api/batches/1/links/ci', 'POST', { kind: 'url', value: 'https://gh/pr/9' }))
        .status,
    ).toBe(200)
    expect(links).toHaveLength(2)
  })

  it('is a no-op when the same thing is attached twice', async () => {
    const body = { kind: 'spec', value: 'openspec/changes/x' }
    await req('/api/batches/1/links/spec', 'POST', body)
    await req('/api/batches/1/links/spec', 'POST', body)
    expect(links).toHaveLength(1)
  })

  it('refuses a kind outside the closed vocabulary', async () => {
    const res = await req('/api/batches/1/links/ci', 'POST', { kind: 'branch', value: 'x' })
    expect(res.status).toBe(400)
    expect(links).toHaveLength(0)
  })

  it('accepts a PR attached by hand', async () => {
    // The case the whole feature exists for: a PR whose body names no issue, so
    // Linear never linked it and nothing can project it onto the stage.
    const res = await req('/api/batches/1/links/ci', 'POST', {
      kind: 'pr',
      value: 'https://github.com/o/r/pull/3',
    })
    expect(res.status).toBe(200)
    expect(links).toHaveLength(1)
  })
})
