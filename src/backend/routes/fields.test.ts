// vi.mock is hoisted above the imports on purpose — it severs the edge to
// db.js, which imports `bun:sqlite`, a specifier Node cannot resolve. Without
// it the suite cannot load at all. Same note as savedViews.test.ts.
//
// The description's own rules live in batchStore's `normalizeFieldDescription`
// and are tested there. What is tested here is the route layer: that a name is
// normalised the same way a kind is, and that an empty description deletes
// rather than storing a row defining the field as nothing.
import { describe, it, expect, beforeEach, vi } from 'vitest'

interface Row {
  name: string
  description: string
  updated_at: number
}

const rows: Row[] = []
const sqls: string[] = []

vi.mock('../db.js', () => ({
  getDb: () => ({
    prepare: (sql: string) => {
      sqls.push(sql)
      return {
        all: () => [...rows],
        get: () => undefined,
        run: (...args: unknown[]) => {
          const s = sql.trimStart()
          if (s.startsWith('DELETE')) {
            const [name] = args as [string]
            const i = rows.findIndex((r) => r.name === name)
            if (i === -1) return { changes: 0 }
            rows.splice(i, 1)
            return { changes: 1 }
          }
          if (s.startsWith('INSERT')) {
            const [name, description, updated_at] = args as [string, string, number]
            const existing = rows.find((r) => r.name === name)
            if (existing) {
              existing.description = description
              existing.updated_at = updated_at
            } else {
              rows.push({ name, description, updated_at })
            }
            return { changes: 1 }
          }
          return { changes: 0 }
        },
      }
    },
  }),
}))

const { fieldRoutes } = await import('./fields.js')

const put = (name: string, body: unknown) =>
  fieldRoutes.request(`/api/fields/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  rows.length = 0
  sqls.length = 0
})

describe('PUT /api/fields/:name', () => {
  it('normalises the name the way a kind is normalised', async () => {
    // A definition written against "Pull Request" has to be found by an agent
    // asking about `pull-request`, or it is a definition nobody can look up.
    const res = await put('Pull Request', { description: 'the PR that closes this' })
    expect(res.status).toBe(200)
    expect(rows).toEqual([
      { name: 'pull-request', description: 'the PR that closes this', updated_at: expect.any(Number) },
    ])
  })

  it('overwrites rather than adding a second row for one name', async () => {
    await put('runbook', { description: 'first' })
    await put('runbook', { description: 'second' })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.description).toBe('second')
  })

  it('deletes on an empty description instead of storing an empty one', async () => {
    await put('runbook', { description: 'the on-call doc' })
    const res = await put('runbook', { description: '   ' })
    expect(res.status).toBe(204)
    expect(rows).toHaveLength(0)
  })

  it('refuses a name that is not a slug', async () => {
    const res = await put('has/slash', { description: 'x' })
    expect(res.status).toBe(400)
    expect(rows).toHaveLength(0)
  })

  it('refuses a description over the cap without writing anything', async () => {
    const res = await put('runbook', { description: 'x'.repeat(281) })
    expect(res.status).toBe(400)
    expect(rows).toHaveLength(0)
  })
})

describe('GET /api/fields', () => {
  it('returns entries in name order as DTOs', async () => {
    rows.push({ name: 'runbook', description: 'the on-call doc', updated_at: 5 })
    const res = await fieldRoutes.request('/api/fields')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      entries: [{ name: 'runbook', description: 'the on-call doc', updatedAt: 5 }],
    })
    expect(sqls.some((s) => /ORDER BY name ASC/.test(s))).toBe(true)
  })
})
