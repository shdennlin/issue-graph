import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db.js'
import type { AnnotationDTO } from '@shared/types.js'

const TARGETS = ['issue', 'edge', 'bucket'] as const

const CreateSchema = z.object({
  targetType: z.enum(TARGETS),
  targetId: z.string().min(1).max(200),
  body: z.string().min(1).max(64 * 1024),
})

const PatchSchema = z.object({
  body: z.string().min(1).max(64 * 1024),
})

function originAllowed(c: any): boolean {
  const origin = c.req.header('origin')
  const host = c.req.header('host')
  if (!origin) return true // same-origin form posts have no Origin
  try {
    const u = new URL(origin)
    return u.host === host
  } catch {
    return false
  }
}

export const annotationRoutes = new Hono()

annotationRoutes.get('/api/annotations', (c) => {
  const format = c.req.query('format')
  const rows = getDb()
    .prepare(
      `SELECT id, target_type as targetType, target_id as targetId, body,
              created_at as createdAt, updated_at as updatedAt
       FROM annotation ORDER BY id ASC`,
    )
    .all() as AnnotationDTO[]
  if (format === 'json') {
    return c.json({ exportedAt: Date.now(), annotations: rows })
  }
  return c.json({ entries: rows })
})

annotationRoutes.post('/api/annotations', async (c) => {
  if (!originAllowed(c)) return c.json({ error: { code: 'origin', message: 'cross-origin denied' } }, 403)
  const body = await c.req.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: { code: 'invalid', message: parsed.error.message } }, 400)
  const now = Date.now()
  const r = getDb()
    .prepare(
      `INSERT INTO annotation(target_type, target_id, body, created_at, updated_at) VALUES(?, ?, ?, ?, ?)`,
    )
    .run(parsed.data.targetType, parsed.data.targetId, parsed.data.body, now, now)
  return c.json({ id: Number(r.lastInsertRowid) }, 201)
})

annotationRoutes.patch('/api/annotations/:id', async (c) => {
  if (!originAllowed(c)) return c.json({ error: { code: 'origin', message: 'cross-origin denied' } }, 403)
  const id = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: { code: 'invalid', message: parsed.error.message } }, 400)
  const r = getDb()
    .prepare(`UPDATE annotation SET body = ?, updated_at = ? WHERE id = ?`)
    .run(parsed.data.body, Date.now(), id)
  if (r.changes === 0) return c.json({ error: { code: 'not_found' } }, 404)
  return c.json({ ok: true })
})

annotationRoutes.delete('/api/annotations/:id', (c) => {
  if (!originAllowed(c)) return c.json({ error: { code: 'origin', message: 'cross-origin denied' } }, 403)
  const id = Number(c.req.param('id'))
  const r = getDb().prepare(`DELETE FROM annotation WHERE id = ?`).run(id)
  if (r.changes === 0) return c.json({ error: { code: 'not_found' } }, 404)
  return c.json({ ok: true })
})

const ImportSchema = z.object({
  mode: z.enum(['merge', 'replace']),
  annotations: z.array(
    z.object({
      targetType: z.enum(TARGETS),
      targetId: z.string(),
      body: z.string(),
      createdAt: z.number().optional(),
      updatedAt: z.number().optional(),
    }),
  ),
})

annotationRoutes.post('/api/annotations/import', async (c) => {
  if (!originAllowed(c)) return c.json({ error: { code: 'origin', message: 'cross-origin denied' } }, 403)
  const body = await c.req.json().catch(() => null)
  const parsed = ImportSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: { code: 'invalid', message: parsed.error.message } }, 400)
  const db = getDb()
  const txn = db.transaction(() => {
    if (parsed.data.mode === 'replace') db.prepare('DELETE FROM annotation').run()
    const stmt = db.prepare(
      `INSERT INTO annotation(target_type, target_id, body, created_at, updated_at) VALUES(?, ?, ?, ?, ?)`,
    )
    for (const a of parsed.data.annotations) {
      const now = Date.now()
      stmt.run(a.targetType, a.targetId, a.body, a.createdAt ?? now, a.updatedAt ?? now)
    }
  })
  txn()
  return c.json({ ok: true, count: parsed.data.annotations.length })
})
