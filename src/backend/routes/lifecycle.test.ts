// vi.mock is hoisted above the imports on purpose — it severs the edge to
// db.js, which imports `bun:sqlite`, a specifier Node cannot resolve. Without
// it the suite cannot load at all. See savedViews.test.ts for the same note.
//
// The pure rules (key/name/state validation, reorder legality) are covered in
// lifecycleStore.test.ts. What is tested here is only what exists at the route
// layer: uniqueness against the live table, key derivation, and the transaction.
import { describe, it, expect, beforeEach, vi } from 'vitest'

interface Row {
  id: number
  key: string
  name: string
  sort_order: number
  states: string
  next_command: string | null
  created_at: number
  updated_at: number
}

const rows: Row[] = []
let nextId = 1

vi.mock('../db.js', () => ({
  getDb: () => ({
    transaction:
      (fn: (items: unknown) => void) =>
      (items: unknown) =>
        fn(items),
    prepare: (sql: string) => ({
      all: () => [...rows],
      get: () => undefined,
      run: (...args: unknown[]) => {
        const s = sql.trimStart()
        if (s.startsWith('INSERT')) {
          const [key, name, sort_order, states, next_command, created_at, updated_at] = args as [
            string,
            string,
            number,
            string,
            string | null,
            number,
            number,
          ]
          rows.push({ id: nextId, key, name, sort_order, states, next_command, created_at, updated_at })
          return { lastInsertRowid: nextId++, changes: 1 }
        }
        if (s.startsWith('UPDATE')) {
          // Reorder updates by key; PATCH updates by id. Both end with their
          // selector as the last argument.
          if (sql.includes('WHERE key = ?')) {
            const [sort_order, , key] = args as [number, number, string]
            const r = rows.find((x) => x.key === key)
            if (!r) return { changes: 0 }
            r.sort_order = sort_order
            return { changes: 1 }
          }
          const id = args[args.length - 1] as number
          const r = rows.find((x) => x.id === id)
          if (!r) return { changes: 0 }
          return { changes: 1 }
        }
        if (s.startsWith('DELETE')) {
          const [id] = args as [number]
          const i = rows.findIndex((x) => x.id === id)
          if (i === -1) return { changes: 0 }
          rows.splice(i, 1)
          return { changes: 1 }
        }
        return { changes: 0 }
      },
    }),
  }),
}))

const { lifecycleRoutes } = await import('./lifecycle.js')

const json = (path: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
  lifecycleRoutes.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

const post = (body: unknown, headers?: Record<string, string>) =>
  json('/api/lifecycle', 'POST', body, headers)

beforeEach(() => {
  rows.length = 0
  nextId = 1
})

describe('POST /api/lifecycle', () => {
  it('derives the key from the name when none is given', async () => {
    const res = await post({ name: 'Review Spec', states: ['Review Spec'] })
    expect(res.status).toBe(201)
    const dto = (await res.json()) as { key: string; states: string[]; nextCommand: string | null }
    expect(dto.key).toBe('review-spec')
    expect(dto.states).toEqual(['Review Spec'])
    expect(dto.nextCommand).toBeNull()
  })

  it('appends each new stage after the last', async () => {
    await post({ name: 'One' })
    await post({ name: 'Two' })
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1])
  })

  it('refuses a duplicate NAME, so seeding twice does not double the pipeline', async () => {
    // Key uniqueness alone misses this when the name yields no slug: the second
    // attempt just takes the next free fallback key.
    await post({ name: 'Implementing' })
    const res = await post({ name: 'implementing' })
    expect(res.status).toBe(409)
    expect(rows).toHaveLength(1)
  })

  it('refuses a duplicate key with 409 rather than silently renaming', async () => {
    await post({ name: 'Implementing', key: 'impl' })
    const res = await post({ name: 'Also implementing', key: 'impl' })
    expect(res.status).toBe(409)
    expect(rows).toHaveLength(1)
  })

  it('accepts a stage that constrains no state', async () => {
    // An empty list is how a stage opts out of conflict detection, so it must
    // be a valid stage rather than a rejected one.
    const res = await post({ name: 'Parked', states: [] })
    expect(res.status).toBe(201)
    expect(((await res.json()) as { states: string[] }).states).toEqual([])
  })

  it.each([
    ['a blank name', { name: '   ' }],
    ['a non-slug key', { name: 'X', key: 'not a slug' }],
    ['states that are not an array', { name: 'X', states: 'In Review' }],
    ['a non-string nextCommand', { name: 'X', nextCommand: 42 }],
  ])('rejects %s', async (_label, body) => {
    expect((await post(body)).status).toBe(400)
  })

  it('denies a cross-origin write', async () => {
    const res = await post({ name: 'X' }, { Origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect(rows).toHaveLength(0)
  })
})

describe('PATCH /api/lifecycle/:id', () => {
  it('lets a stage keep its own key', async () => {
    await post({ name: 'Implementing', key: 'impl' })
    const res = await json('/api/lifecycle/1', 'PATCH', { key: 'impl', name: 'Impl' })
    expect(res.status).toBe(200)
  })

  it('refuses to take another stage’s key', async () => {
    await post({ name: 'Implementing', key: 'impl' })
    await post({ name: 'Review', key: 'review' })
    const res = await json('/api/lifecycle/2', 'PATCH', { key: 'impl' })
    expect(res.status).toBe(409)
  })

  it('404s on an unknown id', async () => {
    expect((await json('/api/lifecycle/99', 'PATCH', { name: 'X' })).status).toBe(404)
  })

  it('rejects an empty patch', async () => {
    await post({ name: 'Implementing', key: 'impl' })
    expect((await json('/api/lifecycle/1', 'PATCH', {})).status).toBe(400)
  })
})

describe('POST /api/lifecycle/reorder', () => {
  beforeEach(async () => {
    await post({ name: 'A', key: 'a' })
    await post({ name: 'B', key: 'b' })
    await post({ name: 'C', key: 'c' })
  })

  it('rewrites sort_order to the given order', async () => {
    const res = await json('/api/lifecycle/reorder', 'POST', { keys: ['c', 'a', 'b'] })
    expect(res.status).toBe(200)
    expect(rows.find((r) => r.key === 'c')?.sort_order).toBe(0)
    expect(rows.find((r) => r.key === 'b')?.sort_order).toBe(2)
  })

  it('refuses a stale list instead of applying it partially', async () => {
    // A short list means the client has not seen a stage someone else added.
    // Interleaving the two orders would produce a pipeline nobody chose.
    const before = rows.map((r) => r.sort_order)
    const res = await json('/api/lifecycle/reorder', 'POST', { keys: ['a', 'b'] })
    expect(res.status).toBe(400)
    expect(rows.map((r) => r.sort_order)).toEqual(before)
  })
})

describe('DELETE /api/lifecycle/:id', () => {
  it('removes the stage', async () => {
    await post({ name: 'A', key: 'a' })
    const res = await lifecycleRoutes.request('/api/lifecycle/1', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(rows).toHaveLength(0)
  })

  it('404s on an unknown id', async () => {
    const res = await lifecycleRoutes.request('/api/lifecycle/99', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})
