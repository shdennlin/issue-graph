// vi.mock calls MUST sit above the imports: they are hoisted, and the point is
// to sever the module edge to db.js before it resolves. db.js imports
// `bun:sqlite`, a specifier Node cannot resolve, so without this the suite
// cannot even load. Same pattern and same reason as webhooks.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Row {
  id: number
  name: string
  query: string
  sort_order: number
  created_at: number
  updated_at: number
}

const rows: Row[] = []
let nextId = 1

// A hand-rolled stand-in for the few statements the route issues. Deliberately
// dumb: it matches on the leading verb rather than parsing SQL, which is enough
// to exercise the handlers' validation and status codes — the part worth
// testing — without pretending to be a database.
vi.mock('../db.js', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      all: () => (sql.includes('sort_order FROM saved_view') ? rows.map((r) => ({ sort_order: r.sort_order })) : [...rows]),
      get: (id: number) => rows.find((r) => r.id === id),
      run: (...args: unknown[]) => {
        if (sql.startsWith('\n     INSERT') || sql.trimStart().startsWith('INSERT')) {
          const [name, query, sort_order, created_at, updated_at] = args as [string, string, number, number, number]
          rows.push({ id: nextId, name, query, sort_order, created_at, updated_at })
          return { lastInsertRowid: nextId++, changes: 1 }
        }
        if (sql.trimStart().startsWith('UPDATE')) {
          const id = args[args.length - 1] as number
          const row = rows.find((r) => r.id === id)
          if (!row) return { changes: 0 }
          // Column order in `sets` mirrors the handler's build order.
          if (sql.includes('name = ?')) row.name = args[0] as string
          return { changes: 1 }
        }
        if (sql.trimStart().startsWith('DELETE')) {
          const id = args[0] as number
          const i = rows.findIndex((r) => r.id === id)
          if (i === -1) return { changes: 0 }
          rows.splice(i, 1)
          return { changes: 1 }
        }
        return { changes: 0 }
      },
    }),
  }),
}))

const { savedViewRoutes } = await import('./savedViews.js')

/** Route errors always use the { error: { code, message } } envelope. */
const errorCode = async (res: Response): Promise<string> =>
  ((await res.json()) as { error: { code: string } }).error.code

const post = (body: unknown, headers: Record<string, string> = {}) =>
  savedViewRoutes.request('/api/saved-views', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  rows.length = 0
  nextId = 1
})

describe('POST /api/saved-views', () => {
  it('creates a view and strips the workspace param', async () => {
    const res = await post({ name: 'This week', query: 'w=alpha&view=mix&recent=7d' })
    expect(res.status).toBe(201)
    const dto = (await res.json()) as { name: string; query: string }
    expect(dto.name).toBe('This week')
    // `w` must not survive, or opening this view from another workspace
    // teleports the reader.
    expect(dto.query).toBe('view=mix&recent=7d')
  })

  it.each([
    ['a blank name', { name: '   ', query: 'view=mix' }],
    ['a URL-shaped query', { name: 'x', query: 'http://evil.com' }],
    ['a missing field', { name: 'x' }],
  ])('rejects %s with 400 invalid', async (_name, body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(await errorCode(res)).toBe('invalid')
  })

  it('refuses a cross-origin write', async () => {
    const res = await post(
      { name: 'x', query: 'view=mix' },
      { Origin: 'http://evil.com', Host: 'localhost:31415' },
    )
    expect(res.status).toBe(403)
    expect(await errorCode(res)).toBe('origin')
  })
})

describe('GET / PATCH / DELETE', () => {
  it('lists what was created', async () => {
    await post({ name: 'A', query: 'view=mix' })
    const res = await savedViewRoutes.request('/api/saved-views')
    const body = (await res.json()) as { entries: { name: string; sortOrder: number }[] }
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0]).toMatchObject({ name: 'A', sortOrder: 0 })
  })

  it('renames an existing view', async () => {
    await post({ name: 'A', query: 'view=mix' })
    const res = await savedViewRoutes.request('/api/saved-views/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'B' }),
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { name: string }).name).toBe('B')
  })

  it.each([
    ['PATCH', { name: 'X' }],
    ['DELETE', undefined],
  ])('returns 404 from %s for an unknown id', async (method, body) => {
    const res = await savedViewRoutes.request('/api/saved-views/999', {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('not_found')
  })

  it('deletes and returns 204', async () => {
    await post({ name: 'A', query: 'view=mix' })
    const res = await savedViewRoutes.request('/api/saved-views/1', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(rows).toHaveLength(0)
  })
})
