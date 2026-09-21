// What a field name means in this workspace.
//
// Thin, like every route here: the two rules — the name's shape and the
// description's — live in pure modules (`normalizeLinkKind` in shared,
// `normalizeFieldDescription` in batchStore) so they can be tested, since
// vitest runs on Node and anything importing db.js cannot load at all.
//
// The name goes through the SAME normaliser as an attachment's kind and a
// stage's declared field. That is the whole point of the table: a description
// written against "Pull Request" has to be found by an agent asking about
// `pull-request`, or it is a definition nobody can look up.
//
// No auth, by design, as for notes, annotations, saved views and the lifecycle.

import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db.js'
import { originAllowed } from '../lib/http.js'
import { normalizeLinkKind } from '../../shared/showTokens.js'
import { normalizeFieldDescription } from '../batchStore.js'
import type { FieldDTO } from '../../shared/types.js'

interface FieldRow {
  name: string
  description: string
  updated_at: number
}

const rowToDTO = (r: FieldRow): FieldDTO => ({
  name: r.name,
  description: r.description,
  updatedAt: r.updated_at,
})

const PutSchema = z.object({ description: z.unknown() })

const denyOrigin = () => ({ error: { code: 'origin', message: 'cross-origin denied' } }) as const
const invalid = (message: string) => ({ error: { code: 'invalid', message } }) as const

export const fieldRoutes = new Hono()

fieldRoutes.get('/api/fields', (c) => {
  const rows = getDb()
    .prepare(`SELECT name, description, updated_at FROM field ORDER BY name ASC`)
    .all() as FieldRow[]
  return c.json({ entries: rows.map(rowToDTO) })
})

fieldRoutes.put('/api/fields/:name', async (c) => {
  if (!originAllowed(c)) return c.json(denyOrigin(), 403)
  const name = normalizeLinkKind(c.req.param('name'))
  if (name === null) return c.json(invalid('bad field name'), 400)

  const body = await c.req.json().catch(() => null)
  const parsed = PutSchema.safeParse(body)
  if (!parsed.success) return c.json(invalid(parsed.error.message), 400)
  const description = normalizeFieldDescription(parsed.data.description)
  if (description === null) return c.json(invalid('bad description'), 400)

  const db = getDb()
  // Empty means "remove it", so a cleared box leaves no row behind claiming
  // the field is defined as nothing.
  if (description.length === 0) {
    db.prepare(`DELETE FROM field WHERE name = ?`).run(name)
    return c.body(null, 204)
  }
  const now = Date.now()
  db.prepare(
    `INSERT INTO field(name, description, updated_at) VALUES(?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET description = excluded.description, updated_at = excluded.updated_at`,
  ).run(name, description, now)
  return c.json({ name, description, updatedAt: now } satisfies FieldDTO)
})
