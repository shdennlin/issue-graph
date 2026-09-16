// Saved views CRUD. Deliberately thin: every rule — name/query validation,
// param stripping, row projection, ordering — lives in the pure
// savedViewStore.ts so it can be tested. vitest runs on Node and cannot
// resolve `bun:sqlite`, so anything that stays in this file is untestable by
// construction. routes/notes.ts is the cautionary example.
//
// No auth, by design: this is a localhost / Tailscale tool (see the warning in
// README). Anyone reaching the server can create, rename or delete any view,
// exactly as they already can for notes and annotations.

import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db.js'
import { originAllowed } from '../lib/http.js'
import {
  nextSortOrder,
  normalizeSavedViewName,
  normalizeSavedViewQuery,
  savedViewRowToDTO,
  type SavedViewRow,
} from '../savedViewStore.js'

const CreateSchema = z.object({ name: z.string(), query: z.string() })
const PatchSchema = z
  .object({
    name: z.string().optional(),
    query: z.string().optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((v) => v.name !== undefined || v.query !== undefined || v.sortOrder !== undefined, {
    message: 'nothing to update',
  })

const SELECT = `SELECT id, name, query, sort_order, created_at, updated_at FROM saved_view`

const denyOrigin = () =>
  ({ error: { code: 'origin', message: 'cross-origin denied' } }) as const
const invalid = (message: string) => ({ error: { code: 'invalid', message } }) as const

export const savedViewRoutes = new Hono()

savedViewRoutes.get('/api/saved-views', (c) => {
  const rows = getDb()
    .prepare(`${SELECT} ORDER BY sort_order ASC, id ASC`)
    .all() as SavedViewRow[]
  return c.json({ entries: rows.map(savedViewRowToDTO) })
})

savedViewRoutes.post('/api/saved-views', async (c) => {
  if (!originAllowed(c)) return c.json(denyOrigin(), 403)
  const body = await c.req.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) return c.json(invalid(parsed.error.message), 400)

  const name = normalizeSavedViewName(parsed.data.name)
  if (name === null) return c.json(invalid('bad name'), 400)
  const query = normalizeSavedViewQuery(parsed.data.query)
  if (query === null) return c.json(invalid('bad query'), 400)

  const db = getDb()
  const rows = db.prepare(`SELECT sort_order FROM saved_view`).all() as Pick<
    SavedViewRow,
    'sort_order'
  >[]
  const sortOrder = nextSortOrder(rows)
  const now = Date.now()
  const r = db
    .prepare(
      `INSERT INTO saved_view(name, query, sort_order, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?)`,
    )
    .run(name, query, sortOrder, now, now)
  return c.json(
    savedViewRowToDTO({
      id: Number(r.lastInsertRowid),
      name,
      query,
      sort_order: sortOrder,
      created_at: now,
      updated_at: now,
    }),
    201,
  )
})

savedViewRoutes.patch('/api/saved-views/:id', async (c) => {
  if (!originAllowed(c)) return c.json(denyOrigin(), 403)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.json(invalid('bad id'), 400)
  const body = await c.req.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return c.json(invalid(parsed.error.message), 400)

  // Built dynamically so name, query and sortOrder can be patched
  // independently without clobbering each other.
  const sets: string[] = []
  const args: (string | number)[] = []
  if (parsed.data.name !== undefined) {
    const name = normalizeSavedViewName(parsed.data.name)
    if (name === null) return c.json(invalid('bad name'), 400)
    sets.push('name = ?')
    args.push(name)
  }
  if (parsed.data.query !== undefined) {
    const query = normalizeSavedViewQuery(parsed.data.query)
    if (query === null) return c.json(invalid('bad query'), 400)
    sets.push('query = ?')
    args.push(query)
  }
  if (parsed.data.sortOrder !== undefined) {
    sets.push('sort_order = ?')
    args.push(parsed.data.sortOrder)
  }
  sets.push('updated_at = ?')
  args.push(Date.now())

  const db = getDb()
  const r = db.prepare(`UPDATE saved_view SET ${sets.join(', ')} WHERE id = ?`).run(...args, id)
  if (r.changes === 0) return c.json({ error: { code: 'not_found', message: 'no such view' } }, 404)
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as SavedViewRow
  return c.json(savedViewRowToDTO(row))
})

savedViewRoutes.delete('/api/saved-views/:id', (c) => {
  if (!originAllowed(c)) return c.json(denyOrigin(), 403)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.json(invalid('bad id'), 400)
  const r = getDb().prepare(`DELETE FROM saved_view WHERE id = ?`).run(id)
  if (r.changes === 0) return c.json({ error: { code: 'not_found', message: 'no such view' } }, 404)
  return c.body(null, 204)
})
