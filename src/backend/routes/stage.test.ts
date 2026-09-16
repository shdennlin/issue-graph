// vi.mock calls MUST sit above the imports: they are hoisted, and the point is
// to sever the module edge to db.js before it resolves. db.js imports
// `bun:sqlite`, a specifier Node cannot resolve, so without this the suite
// cannot even load. Same pattern and same reason as savedViews.test.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest'

interface StageRow {
  identifier: string
  stage_key: string
  updated_at: number
  updated_by: string | null
}

const stages: StageRow[] = []
/** Stage keys the fake lifecycle table defines. */
const knownKeys: string[] = []

vi.mock('../db.js', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      all: () => [...stages],
      get: (key: string) => (knownKeys.includes(key) ? { key } : undefined),
      run: (...args: unknown[]) => {
        const s = sql.trimStart()
        if (s.startsWith('DELETE')) {
          const [identifier] = args as [string]
          const i = stages.findIndex((r) => r.identifier === identifier)
          if (i === -1) return { changes: 0 }
          stages.splice(i, 1)
          return { changes: 1 }
        }
        if (s.startsWith('INSERT')) {
          const [identifier, stage_key, updated_at, updated_by] = args as [
            string,
            string,
            number,
            string | null,
          ]
          const existing = stages.find((r) => r.identifier === identifier)
          if (existing) Object.assign(existing, { stage_key, updated_at, updated_by })
          else stages.push({ identifier, stage_key, updated_at, updated_by })
          return { changes: 1 }
        }
        return { changes: 0 }
      },
    }),
  }),
}))

const { stageRoutes } = await import('./stage.js')

const errorCode = async (res: Response): Promise<string> =>
  ((await res.json()) as { error: { code: string } }).error.code

const put = (identifier: string, body: unknown, headers: Record<string, string> = {}) =>
  stageRoutes.request(`/api/stage/${identifier}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  stages.length = 0
  knownKeys.length = 0
  knownKeys.push('impl', 'review')
})

describe('PUT /api/stage/:identifier', () => {
  it('assigns a stage and echoes the row', async () => {
    const res = await put('ONE-393', { stageKey: 'impl', updatedBy: 'shawn' })
    expect(res.status).toBe(200)
    const dto = (await res.json()) as { identifier: string; stageKey: string; updatedBy: string }
    expect(dto).toMatchObject({ identifier: 'ONE-393', stageKey: 'impl', updatedBy: 'shawn' })
    expect(stages).toHaveLength(1)
  })

  it('upserts rather than duplicating', async () => {
    await put('ONE-393', { stageKey: 'impl' })
    await put('ONE-393', { stageKey: 'review' })
    expect(stages).toHaveLength(1)
    expect(stages[0]?.stage_key).toBe('review')
  })

  it('uppercases the identifier so a lowercase branch-derived id still matches', async () => {
    // Real branches are lowercase (`fix/one-393-…`), and the planned session
    // hook parses ids out of them. Storing "one-393" alongside "ONE-393" would
    // split one issue into two rows that never join back to the graph.
    const res = await put('one-393', { stageKey: 'impl' })
    expect(res.status).toBe(200)
    expect(stages[0]?.identifier).toBe('ONE-393')
  })

  it('rejects a stage key no lifecycle stage defines', async () => {
    // Unresolvable keys are tolerated on READ so deleting a stage does not
    // erase history, but there is no reason to admit a new one here.
    const res = await put('ONE-393', { stageKey: 'nope' })
    expect(res.status).toBe(400)
    expect(await errorCode(res)).toBe('invalid')
    expect(stages).toHaveLength(0)
  })

  it('clears the assignment on an explicit null', async () => {
    await put('ONE-393', { stageKey: 'impl' })
    const res = await put('ONE-393', { stageKey: null })
    expect(res.status).toBe(204)
    expect(stages).toHaveLength(0)
  })

  it('rejects an omitted stageKey, so clearing is always deliberate', async () => {
    // null means "no stage" and is honoured; absent is a malformed request.
    // Collapsing the two would let a truncated body wipe an assignment.
    const res = await put('ONE-393', { updatedBy: 'shawn' })
    expect(res.status).toBe(400)
  })

  it.each([
    ['a lowercase-only prefix that is not an id', 'notanid'],
    ['a prefix with no number', 'ONE-'],
    ['a number with no prefix', '393'],
  ])('rejects %s', async (_label, identifier) => {
    const res = await put(identifier, { stageKey: 'impl' })
    expect(res.status).toBe(400)
  })

  it('denies a cross-origin write', async () => {
    const res = await put('ONE-393', { stageKey: 'impl' }, { Origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect(await errorCode(res)).toBe('origin')
    expect(stages).toHaveLength(0)
  })
})

describe('GET /api/stage', () => {
  it('returns assignments as DTOs', async () => {
    await put('ONE-1', { stageKey: 'impl' })
    const res = await stageRoutes.request('/api/stage')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { entries: { identifier: string; stageKey: string }[] }
    expect(body.entries).toEqual([
      expect.objectContaining({ identifier: 'ONE-1', stageKey: 'impl' }),
    ])
  })

  it('is readable with no rows', async () => {
    const res = await stageRoutes.request('/api/stage')
    expect(((await res.json()) as { entries: unknown[] }).entries).toEqual([])
  })
})
