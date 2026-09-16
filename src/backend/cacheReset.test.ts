// What this suite protects is an OMISSION, which is why it needs a test at all.
//
// resetCache() is a deny-list: it deletes issue_cache, label_cache and a fixed
// set of cache_meta keys. Every other table — annotation, note, saved_view,
// setting, and now lifecycle_stage and issue_stage — survives because it is not
// mentioned. There is no preserve-list to add a table to, so nothing in the
// source says "keep these", and adding one line to the wrong place would
// permanently destroy data nobody can recompute: a lifecycle and its stage
// assignments were typed by a person, and re-syncing cannot bring them back.
//
// The failure mode has no symptom until someone hits "Reset cache & re-sync"
// weeks later, which is exactly the kind of bug a test has to catch instead of
// a reviewer.
//
// vi.mock is hoisted above the imports to sever the edge to db.js, which
// imports `bun:sqlite` — a specifier Node cannot resolve. Same pattern as
// routes/savedViews.test.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest'

/** Every SQL string resetCache() prepares, in order. */
const prepared: string[] = []

vi.mock('./db.js', () => ({
  getDb: () => ({
    transaction:
      (fn: (...a: unknown[]) => unknown) =>
      (...a: unknown[]) =>
        fn(...a),
    prepare: (sql: string) => {
      prepared.push(sql)
      return {
        run: () => ({ changes: 0 }),
        get: () => ({ n: 0 }),
        all: () => [],
      }
    },
  }),
}))

vi.mock('./lib/env.js', () => ({ loadConfig: () => ({ ISSUE_SCOPE: 'active+recent' }) }))
vi.mock('./lib/settings.js', () => ({ settingInt: (_k: string, d: number) => d }))

const { resetCache } = await import('./cache.js')

/** Tables a cache reset is allowed to touch. Anything else appearing in a
 *  DELETE is a data-loss bug, not a new feature. */
const DELETABLE = ['issue_cache', 'label_cache']

/** User-authored tables that must survive. Add a row here whenever a new
 *  not-rebuildable table is introduced. */
const MUST_SURVIVE = [
  'lifecycle_stage',
  'issue_stage',
  'annotation',
  'note',
  'saved_view',
  'setting',
]

beforeEach(() => {
  prepared.length = 0
})

describe('resetCache', () => {
  it('deletes only the rebuildable caches', () => {
    resetCache()
    const deletes = prepared.filter((s) => /\bDELETE\b/i.test(s))
    expect(deletes.length).toBeGreaterThan(0)
    for (const sql of deletes) {
      const touched = DELETABLE.some((t) => sql.includes(t))
      expect(touched, `unexpected DELETE: ${sql}`).toBe(true)
    }
  })

  it.each(MUST_SURVIVE)('never mentions %s in any statement', (table) => {
    resetCache()
    // Deliberately checks every statement, not just DELETEs: an UPDATE or a
    // DROP against one of these would be just as destructive.
    const hit = prepared.find((s) => new RegExp(`\\b${table}\\b`).test(s))
    expect(hit, `resetCache touched ${table}: ${hit}`).toBeUndefined()
  })
})
