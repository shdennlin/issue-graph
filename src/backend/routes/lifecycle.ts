// Lifecycle-stage CRUD. Deliberately thin: every rule — key/name/state
// validation, ordering, reorder legality — lives in the pure lifecycleStore.ts
// so it can be tested. vitest runs on Node and cannot resolve `bun:sqlite`, so
// anything that stays in this file is untestable by construction. Same split
// and same reason as routes/savedViews.ts.
//
// No auth, by design: this is a localhost / Tailscale tool (see the warning in
// README), exactly as for notes, annotations and saved views.
//
// This route NEVER writes to Linear, and configuring a lifecycle never moves an
// issue. The config describes and suggests; every state transition stays with
// Linear's own MCP or its GitHub automation. See ADR-0002.

import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db.js'
import { originAllowed } from '../lib/http.js'
import {
  isKeyTaken,
  lifecycleRowToDTO,
  nextSortOrder,
  normalizeNextCommand,
  normalizeStageKey,
  normalizeStageName,
  normalizeStates,
  reorderStages,
  slugifyStageName,
  type LifecycleStageRow,
} from '../lifecycleStore.js'

const CreateSchema = z.object({
  key: z.string().optional(),
  name: z.string(),
  states: z.unknown().optional(),
  nextCommand: z.unknown().optional(),
})

const PatchSchema = z
  .object({
    key: z.string().optional(),
    name: z.string().optional(),
    states: z.unknown().optional(),
    nextCommand: z.unknown().optional(),
  })
  .refine(
    (v) =>
      v.key !== undefined ||
      v.name !== undefined ||
      v.states !== undefined ||
      v.nextCommand !== undefined,
    { message: 'nothing to update' },
  )

const ReorderSchema = z.object({ keys: z.unknown() })

const SELECT = `SELECT id, key, name, sort_order, states, next_command, created_at, updated_at FROM lifecycle_stage`

const denyOrigin = () => ({ error: { code: 'origin', message: 'cross-origin denied' } }) as const
const invalid = (message: string) => ({ error: { code: 'invalid', message } }) as const

export const lifecycleRoutes = new Hono()

lifecycleRoutes.get('/api/lifecycle', (c) => {
  const rows = getDb()
    .prepare(`${SELECT} ORDER BY sort_order ASC, id ASC`)
    .all() as LifecycleStageRow[]
  return c.json({ entries: rows.map(lifecycleRowToDTO) })
})

lifecycleRoutes.post('/api/lifecycle', async (c) => {
  if (!originAllowed(c)) return c.json(denyOrigin(), 403)
  const body = await c.req.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) return c.json(invalid(parsed.error.message), 400)

  const name = normalizeStageName(parsed.data.name)
  if (name === null) return c.json(invalid('bad name'), 400)
  // An explicit key wins; otherwise derive one from the name so the editor's
  // "add stage" path needs one field, not two.
  const key =
    parsed.data.key === undefined ? slugifyStageName(name) : normalizeStageKey(parsed.data.key)
  if (key === null) return c.json(invalid('bad key'), 400)
  const states = normalizeStates(parsed.data.states)
  if (states === null) return c.json(invalid('bad states'), 400)
  const nextCommand = normalizeNextCommand(parsed.data.nextCommand)
  if (nextCommand === undefined) return c.json(invalid('bad nextCommand'), 400)

  const db = getDb()
  const rows = db.prepare(`SELECT id, key, sort_order FROM lifecycle_stage`).all() as Pick<
    LifecycleStageRow,
    'id' | 'key' | 'sort_order'
  >[]
  if (isKeyTaken(rows, key)) return c.json(invalid('key already exists'), 409)

  const now = Date.now()
  const sortOrder = nextSortOrder(rows)
  const r = db
    .prepare(
      `INSERT INTO lifecycle_stage(key, name, sort_order, states, next_command, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(key, name, sortOrder, JSON.stringify(states), nextCommand, now, now)
  return c.json(
    lifecycleRowToDTO({
      id: Number(r.lastInsertRowid),
      key,
      name,
      sort_order: sortOrder,
      states: JSON.stringify(states),
      next_command: nextCommand,
      created_at: now,
      updated_at: now,
    }),
    201,
  )
})

lifecycleRoutes.patch('/api/lifecycle/:id', async (c) => {
  if (!originAllowed(c)) return c.json(denyOrigin(), 403)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json(invalid('bad id'), 400)
  const body = await c.req.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return c.json(invalid(parsed.error.message), 400)

  const db = getDb()
  const sets: string[] = []
  const args: (string | null)[] = []

  if (parsed.data.key !== undefined) {
    const key = normalizeStageKey(parsed.data.key)
    if (key === null) return c.json(invalid('bad key'), 400)
    const rows = db.prepare(`SELECT id, key FROM lifecycle_stage`).all() as Pick<
      LifecycleStageRow,
      'id' | 'key'
    >[]
    if (isKeyTaken(rows, key, id)) return c.json(invalid('key already exists'), 409)
    // Renaming a key orphans existing issue_stage rows rather than cascading —
    // an unresolvable key reads as 'unknown', which is recoverable; a cascade
    // that rewrote assignments would not be.
    sets.push('key = ?')
    args.push(key)
  }
  if (parsed.data.name !== undefined) {
    const name = normalizeStageName(parsed.data.name)
    if (name === null) return c.json(invalid('bad name'), 400)
    sets.push('name = ?')
    args.push(name)
  }
  if (parsed.data.states !== undefined) {
    const states = normalizeStates(parsed.data.states)
    if (states === null) return c.json(invalid('bad states'), 400)
    sets.push('states = ?')
    args.push(JSON.stringify(states))
  }
  if (parsed.data.nextCommand !== undefined) {
    const nextCommand = normalizeNextCommand(parsed.data.nextCommand)
    if (nextCommand === undefined) return c.json(invalid('bad nextCommand'), 400)
    sets.push('next_command = ?')
    args.push(nextCommand)
  }

  sets.push('updated_at = ?')
  const r = db
    .prepare(`UPDATE lifecycle_stage SET ${sets.join(', ')} WHERE id = ?`)
    .run(...args, Date.now(), id)
  if (r.changes === 0) return c.json({ error: { code: 'not_found' } }, 404)
  return c.json({ ok: true })
})

lifecycleRoutes.post('/api/lifecycle/reorder', async (c) => {
  if (!originAllowed(c)) return c.json(denyOrigin(), 403)
  const body = await c.req.json().catch(() => null)
  const parsed = ReorderSchema.safeParse(body)
  if (!parsed.success) return c.json(invalid(parsed.error.message), 400)

  const db = getDb()
  const rows = db.prepare(`SELECT key FROM lifecycle_stage`).all() as Pick<
    LifecycleStageRow,
    'key'
  >[]
  const next = reorderStages(rows, parsed.data.keys)
  // Null means the request did not name exactly the current keys once each,
  // i.e. the client is out of date. Refused rather than partially applied.
  if (next === null) return c.json(invalid('keys must list every existing stage once'), 400)

  const now = Date.now()
  const update = db.prepare(`UPDATE lifecycle_stage SET sort_order = ?, updated_at = ? WHERE key = ?`)
  db.transaction((items: typeof next) => {
    for (const it of items) update.run(it.sort_order, now, it.key)
  })(next)
  return c.json({ ok: true })
})

lifecycleRoutes.delete('/api/lifecycle/:id', (c) => {
  if (!originAllowed(c)) return c.json(denyOrigin(), 403)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json(invalid('bad id'), 400)
  // issue_stage rows pointing at this stage are left alone on purpose: they
  // degrade to 'unknown' and come back if the stage is re-created. See the
  // migration comment on why stage_key is not a foreign key.
  const r = getDb().prepare(`DELETE FROM lifecycle_stage WHERE id = ?`).run(id)
  if (r.changes === 0) return c.json({ error: { code: 'not_found' } }, 404)
  return c.body(null, 204)
})
