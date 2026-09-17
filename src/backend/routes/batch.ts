// Batches: a set of issues handed to agent sessions one at a time.
//
// Thin by the same rule as routes/lifecycle.ts — ordering, claim eligibility
// and validation live in the pure batchStore.ts. vitest cannot load anything
// reaching `bun:sqlite`.
//
// Two callers with different shapes, which is why the guard here is an OR: the
// browser creates and deletes batches (same-origin, no token), while the MCP
// server claims and reports (a bearer token, no Origin at all — it is not a
// browser). Requiring both would lock one of them out; requiring neither would
// leave a write endpoint open on an app with no auth.
//
// Nothing here writes to Linear. Claiming an issue records that a session is
// working on it; it does not move the issue.

import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db.js'
import { agentTokenValid, originAllowed } from '../lib/http.js'
import { readCachedIssues } from '../cache.js'
import {
  batchProgress,
  nextCandidate,
  normalizeBatchName,
  normalizeMembers,
  orderMembers,
  unfinishedBlockers,
  type BatchMemberRow,
  type BatchRow,
} from '../batchStore.js'

const CreateSchema = z.object({ name: z.string(), members: z.unknown() })
const ClaimSchema = z.object({ claimant: z.string().min(1).max(200) })
const DoneSchema = z.object({ identifier: z.string(), claimant: z.string().min(1).max(200) })
const RenameSchema = z.object({ name: z.string() })
const MembersSchema = z.object({ members: z.unknown() })

const denied = () => ({ error: { code: 'denied', message: 'same-origin or agent token required' } }) as const
const invalid = (message: string) => ({ error: { code: 'invalid', message } }) as const
const notFound = () => ({ error: { code: 'not_found' } }) as const

/** Either a browser on this origin, or the agent plugin with its secret. */
const mayWrite = (c: Parameters<typeof originAllowed>[0]): boolean =>
  originAllowed(c) || agentTokenValid(c.req.header('Authorization'))

const membersOf = (batchId: number): BatchMemberRow[] =>
  getDb()
    .prepare(
      `SELECT batch_id, identifier, claimed_by, claimed_at, done_at FROM batch_member WHERE batch_id = ?`,
    )
    .all(batchId) as BatchMemberRow[]

export const batchRoutes = new Hono()

batchRoutes.get('/api/batches', (c) => {
  const db = getDb()
  const batches = db
    .prepare(`SELECT id, name, created_at FROM batch ORDER BY created_at DESC, id DESC`)
    .all() as BatchRow[]
  return c.json({
    entries: batches.map((b) => ({
      id: b.id,
      name: b.name,
      createdAt: b.created_at,
      progress: batchProgress(membersOf(b.id)),
    })),
  })
})

batchRoutes.get('/api/batches/:id', (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json(invalid('bad id'), 400)
  const row = getDb().prepare(`SELECT id, name, created_at FROM batch WHERE id = ?`).get(id) as
    | BatchRow
    | undefined
  if (!row) return c.json(notFound(), 404)

  const members = membersOf(id)
  const issues = readCachedIssues()
  // Order is computed on read, never stored — the `blocks` edges it derives
  // from live on the issues and change whenever a relation is edited in Linear.
  const order = orderMembers(
    members.map((m) => m.identifier),
    issues,
  )
  const byId = new Map(members.map((m) => [m.identifier, m]))
  return c.json({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    progress: batchProgress(members),
    members: order.map((identifier) => {
      const m = byId.get(identifier)
      return {
        identifier,
        claimedBy: m?.claimed_by ?? null,
        doneAt: m?.done_at ?? null,
        blockedBy: unfinishedBlockers(identifier, members, issues),
      }
    }),
  })
})

batchRoutes.post('/api/batches', async (c) => {
  if (!mayWrite(c)) return c.json(denied(), 403)
  const body = await c.req.json().catch(() => null)
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) return c.json(invalid(parsed.error.message), 400)

  const name = normalizeBatchName(parsed.data.name)
  if (name === null) return c.json(invalid('bad name'), 400)
  const members = normalizeMembers(parsed.data.members)
  if (members === null) return c.json(invalid('bad members'), 400)

  const db = getDb()
  const now = Date.now()
  const r = db.prepare(`INSERT INTO batch(name, created_at) VALUES(?, ?)`).run(name, now)
  const batchId = Number(r.lastInsertRowid)
  const insert = db.prepare(`INSERT INTO batch_member(batch_id, identifier) VALUES(?, ?)`)
  db.transaction((ids: string[]) => {
    for (const id of ids) insert.run(batchId, id)
  })(members)

  return c.json({ id: batchId, name, createdAt: now, members }, 201)
})

batchRoutes.patch('/api/batches/:id', async (c) => {
  if (!mayWrite(c)) return c.json(denied(), 403)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json(invalid('bad id'), 400)
  const body = await c.req.json().catch(() => null)
  const parsed = RenameSchema.safeParse(body)
  if (!parsed.success) return c.json(invalid(parsed.error.message), 400)
  const name = normalizeBatchName(parsed.data.name)
  if (name === null) return c.json(invalid('bad name'), 400)
  const r = getDb().prepare(`UPDATE batch SET name = ? WHERE id = ?`).run(name, id)
  if (r.changes === 0) return c.json(notFound(), 404)
  return c.json({ id, name })
})

batchRoutes.post('/api/batches/:id/members', async (c) => {
  if (!mayWrite(c)) return c.json(denied(), 403)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json(invalid('bad id'), 400)
  const body = await c.req.json().catch(() => null)
  const parsed = MembersSchema.safeParse(body)
  if (!parsed.success) return c.json(invalid(parsed.error.message), 400)
  const members = normalizeMembers(parsed.data.members)
  if (members === null) return c.json(invalid('bad members'), 400)

  const db = getDb()
  if (!db.prepare(`SELECT id FROM batch WHERE id = ?`).get(id)) return c.json(notFound(), 404)
  // OR IGNORE on the (batch_id, identifier) primary key: adding an issue that
  // is already a member is a no-op, not an error. The caller — a person or an
  // agent — is expressing "this belongs here", and it already does.
  const insert = db.prepare(
    `INSERT OR IGNORE INTO batch_member(batch_id, identifier) VALUES(?, ?)`,
  )
  db.transaction((ids: string[]) => {
    for (const m of ids) insert.run(id, m)
  })(members)
  return c.json({ ok: true, members: membersOf(id).map((m) => m.identifier) })
})

batchRoutes.delete('/api/batches/:id/members/:identifier', (c) => {
  if (!mayWrite(c)) return c.json(denied(), 403)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json(invalid('bad id'), 400)
  const identifier = c.req.param('identifier').toUpperCase()
  // Removing a member drops its claim and its done mark with it. That is the
  // point: the issue is no longer part of this workstream, so its progress
  // here is meaningless — and re-adding it should start clean rather than
  // resurrect a claim held by a session that has long since exited.
  const r = getDb()
    .prepare(`DELETE FROM batch_member WHERE batch_id = ? AND identifier = ?`)
    .run(id, identifier)
  if (r.changes === 0) return c.json(notFound(), 404)
  return c.body(null, 204)
})

batchRoutes.post('/api/batches/:id/next', async (c) => {
  if (!mayWrite(c)) return c.json(denied(), 403)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json(invalid('bad id'), 400)
  const body = await c.req.json().catch(() => null)
  const parsed = ClaimSchema.safeParse(body)
  if (!parsed.success) return c.json(invalid(parsed.error.message), 400)
  const claimant = parsed.data.claimant

  const db = getDb()
  const issues = readCachedIssues()

  // Choose, then claim with a CONDITIONAL update, then re-check. Deciding and
  // claiming cannot be one statement here (the choice needs the issue graph, a
  // conditional update needs SQL), so the race is closed on the write instead:
  // `claimed_by IS NULL` means only one caller can win a given row. A loser
  // re-chooses rather than failing, which is what makes two sessions calling
  // this at once come away with different issues.
  for (let attempt = 0; attempt < 5; attempt++) {
    const members = membersOf(id)
    if (members.length === 0) {
      const exists = db.prepare(`SELECT id FROM batch WHERE id = ?`).get(id)
      if (!exists) return c.json(notFound(), 404)
      return c.json({ identifier: null, reason: 'empty' })
    }

    const candidate = nextCandidate(members, issues, claimant)
    if (candidate === null) {
      const progress = batchProgress(members)
      return c.json({
        identifier: null,
        // "done" and "blocked" are different answers: one means the batch is
        // finished, the other means come back later.
        reason: progress.done === progress.total ? 'done' : 'blocked',
        progress,
      })
    }

    const claimed = db
      .prepare(
        `UPDATE batch_member SET claimed_by = ?, claimed_at = ?
         WHERE batch_id = ? AND identifier = ? AND (claimed_by IS NULL OR claimed_by = ?)`,
      )
      .run(claimant, Date.now(), id, candidate, claimant)
    if (claimed.changes === 0) continue // Someone else took it; choose again.

    const fresh = membersOf(id)
    return c.json({
      identifier: candidate,
      blockedBy: unfinishedBlockers(candidate, fresh, issues),
      progress: batchProgress(fresh),
    })
  }
  // Five losses in a row means heavy contention, not a stuck batch.
  return c.json({ identifier: null, reason: 'contended' })
})

batchRoutes.post('/api/batches/:id/done', async (c) => {
  if (!mayWrite(c)) return c.json(denied(), 403)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json(invalid('bad id'), 400)
  const body = await c.req.json().catch(() => null)
  const parsed = DoneSchema.safeParse(body)
  if (!parsed.success) return c.json(invalid(parsed.error.message), 400)
  const identifier = parsed.data.identifier.toUpperCase()

  // Only the holder may finish it. Otherwise a stale session could mark work
  // done that another one is mid-way through.
  const r = getDb()
    .prepare(
      `UPDATE batch_member SET done_at = ? WHERE batch_id = ? AND identifier = ? AND claimed_by = ?`,
    )
    .run(Date.now(), id, identifier, parsed.data.claimant)
  if (r.changes === 0) return c.json(invalid('not claimed by you'), 409)
  return c.json({ ok: true, progress: batchProgress(membersOf(id)) })
})

batchRoutes.delete('/api/batches/:id', (c) => {
  if (!mayWrite(c)) return c.json(denied(), 403)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json(invalid('bad id'), 400)
  const db = getDb()
  const r = db.prepare(`DELETE FROM batch WHERE id = ?`).run(id)
  if (r.changes === 0) return c.json(notFound(), 404)
  // No ON DELETE CASCADE: this schema declares no foreign keys, and bun:sqlite
  // does not enable enforcement by default, so the members go explicitly.
  db.prepare(`DELETE FROM batch_member WHERE batch_id = ?`).run(id)
  return c.body(null, 204)
})
