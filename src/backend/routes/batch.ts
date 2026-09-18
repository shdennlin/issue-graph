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
  normalizeAssignees,
  normalizeLinkKind,
  normalizeLinkValue,
  normalizeNote,
  normalizeStatus,
  parseStringArray,
  STAGE_LINK_KINDS,
  type StageLinkRow,
  type StageNoteRow,
  nextCandidate,
  normalizeBatchName,
  normalizeMembers,
  orderMembers,
  unfinishedBlockers,
  type BatchMemberRow,
  type BatchRow,
} from '../batchStore.js'

const CreateSchema = z.object({
  name: z.string(),
  members: z.unknown(),
  // Work is often already underway when someone decides to track it. Forcing
  // every workstream to start at stage 1 would mean advancing it four times
  // straight away.
  stage: z.string().optional(),
})
const ClaimSchema = z.object({ claimant: z.string().min(1).max(200) })
const DoneSchema = z.object({ identifier: z.string(), claimant: z.string().min(1).max(200) })
const PatchSchema = z
  .object({
    name: z.string().optional(),
    // null clears the stage. A stage may also move BACKWARDS — CI going red and
    // returning to Implementing is ordinary, and a one-way pipeline would make
    // people delete and recreate to go back.
    stage: z.string().nullable().optional(),
    status: z.unknown().optional(),
    assignees: z.unknown().optional(),
    // null clears it, absent leaves it alone.
    note: z.string().nullable().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.stage !== undefined ||
      v.status !== undefined ||
      v.note !== undefined ||
      v.assignees !== undefined,
    { message: 'nothing to update' },
  )

const NoteSchema = z
  .object({ body: z.string().optional(), append: z.string().optional() })
  .refine((v) => v.body !== undefined || v.append !== undefined, {
    message: 'body or append required',
  })

const LinkSchema = z.object({
  kind: z.unknown(),
  value: z.unknown(),
  label: z.string().max(200).optional(),
})
const MembersSchema = z.object({ members: z.unknown() })

const denied = () => ({ error: { code: 'denied', message: 'same-origin or agent token required' } }) as const
const invalid = (message: string) => ({ error: { code: 'invalid', message } }) as const
const notFound = () => ({ error: { code: 'not_found' } }) as const

/** Either a browser on this origin, or the agent plugin with its secret. */
const mayWrite = (c: Parameters<typeof originAllowed>[0]): boolean =>
  originAllowed(c) || agentTokenValid(c.req.header('Authorization'))

const BATCH_SELECT = `SELECT id, name, created_at, updated_at, archived_at, note, stage_key, status, stage_entered_at, assignees FROM batch`

const notesOf = (batchId: number): StageNoteRow[] =>
  getDb()
    .prepare(
      `SELECT batch_id, stage_key, body, updated_at FROM workstream_stage_note WHERE batch_id = ?`,
    )
    .all(batchId) as StageNoteRow[]

const linksOf = (batchId: number): StageLinkRow[] =>
  getDb()
    .prepare(
      `SELECT batch_id, stage_key, kind, value, label, created_at FROM workstream_stage_link WHERE batch_id = ?`,
    )
    .all(batchId) as StageLinkRow[]

const membersOf = (batchId: number): BatchMemberRow[] =>
  getDb()
    .prepare(
      `SELECT batch_id, identifier, claimed_by, claimed_at, done_at FROM batch_member WHERE batch_id = ?`,
    )
    .all(batchId) as BatchMemberRow[]

export const batchRoutes = new Hono()

batchRoutes.get('/api/batches', (c) => {
  const db = getDb()
  // `?status=all` opts back in; by default an archived workstream is off the
  // board, which is what archiving it meant.
  const wantAll = c.req.query('status') === 'all'
  const batches = db
    .prepare(`${BATCH_SELECT} ORDER BY created_at DESC, id DESC`)
    .all() as BatchRow[]
  return c.json({
    entries: batches
      .filter((b) => wantAll || b.status !== 'archived')
      .map((b) => ({
        id: b.id,
        name: b.name,
        createdAt: b.created_at,
        updatedAt: b.updated_at ?? b.created_at,
        archivedAt: b.archived_at,
        note: b.note,
        stage: b.stage_key,
        stageEnteredAt: b.stage_entered_at,
        status: b.status,
        assignees: parseStringArray(b.assignees),
        progress: batchProgress(membersOf(b.id)),
      })),
  })
})

batchRoutes.get('/api/batches/:id', (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json(invalid('bad id'), 400)
  const row = getDb().prepare(`${BATCH_SELECT} WHERE id = ?`).get(id) as BatchRow | undefined
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
    stage: row.stage_key,
    stageEnteredAt: row.stage_entered_at,
    status: row.status,
    assignees: parseStringArray(row.assignees),
    notes: Object.fromEntries(notesOf(id).map((n) => [n.stage_key, n.body])),
    // Hand-attached items are returned separately from anything projected, so
    // the UI can mark them — see the migration comment on why that matters.
    links: linksOf(id).map((l) => ({
      stageKey: l.stage_key,
      kind: l.kind,
      value: l.value,
      label: l.label,
    })),
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
  const stage = parsed.data.stage ?? null
  if (stage !== null && !stageExists(db, stage)) return c.json(invalid('unknown stage'), 400)
  const r = db
    .prepare(
      `INSERT INTO batch(name, created_at, updated_at, stage_key, stage_entered_at) VALUES(?, ?, ?, ?, ?)`,
    )
    .run(name, now, now, stage, stage === null ? null : now)
  const batchId = Number(r.lastInsertRowid)
  // Work is often already underway when someone starts tracking it, so a
  // workstream can be born on stage 4. That arrival is history like any other.
  if (stage !== null) recordStageEntry(db, batchId, stage, now)
  const insert = db.prepare(`INSERT INTO batch_member(batch_id, identifier) VALUES(?, ?)`)
  db.transaction((ids: string[]) => {
    for (const id of ids) insert.run(batchId, id)
  })(members)

  return c.json({ id: batchId, name, createdAt: now, stage, members }, 201)
})

/**
 * A stage key must name a stage that exists — a typo should not park a
 * workstream somewhere nothing will ever render.
 *
 * Truthiness, not `!== undefined`: bun:sqlite returns NULL for a miss, and the
 * strict comparison let every unknown key through. A hand-rolled test mock
 * returning `undefined` hid it; a real server did not.
 */
/** Append one arrival. Only ever called after the stage actually changed —
 *  see the guards at both call sites. */
function recordStageEntry(
  db: ReturnType<typeof getDb>,
  batchId: number,
  stageKey: string,
  at: number,
): void {
  db.prepare(`INSERT INTO workstream_stage_event(batch_id, stage_key, at) VALUES(?, ?, ?)`).run(
    batchId,
    stageKey,
    at,
  )
}

/** A note, a hand attachment or a membership change is a change to the
 *  workstream, so it moves the same clock the PATCH route moves. Without this,
 *  "last touched" would only ever mean "renamed or re-staged". */
function touchBatch(db: ReturnType<typeof getDb>, batchId: number): void {
  db.prepare(`UPDATE batch SET updated_at = ? WHERE id = ?`).run(Date.now(), batchId)
}

function stageExists(db: ReturnType<typeof getDb>, key: string): boolean {
  return Boolean(db.prepare(`SELECT key FROM lifecycle_stage WHERE key = ?`).get(key))
}

batchRoutes.patch('/api/batches/:id', async (c) => {
  if (!mayWrite(c)) return c.json(denied(), 403)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json(invalid('bad id'), 400)
  const body = await c.req.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return c.json(invalid(parsed.error.message), 400)

  const db = getDb()
  const row = db.prepare(`${BATCH_SELECT} WHERE id = ?`).get(id) as BatchRow | undefined
  if (!row) return c.json(notFound(), 404)

  const sets: string[] = []
  const args: (string | number | null)[] = []
  // Held until the UPDATE succeeds: a history row for a move that was then
  // rejected would be a lie, and this handler can still bail out below.
  let stageEntryPending: { stage: string; at: number } | null = null

  if (parsed.data.name !== undefined) {
    const name = normalizeBatchName(parsed.data.name)
    if (name === null) return c.json(invalid('bad name'), 400)
    sets.push('name = ?')
    args.push(name)
  }
  if (parsed.data.stage !== undefined) {
    const stage = parsed.data.stage
    if (stage !== null && !stageExists(db, stage)) return c.json(invalid('unknown stage'), 400)
    sets.push('stage_key = ?')
    args.push(stage)
    // Only a real move restamps the clock. Re-setting the same stage is a
    // no-op, so a tool that writes the current value on every heartbeat cannot
    // keep a stalled workstream looking fresh.
    if (stage !== row.stage_key) {
      const at = Date.now()
      sets.push('stage_entered_at = ?')
      args.push(stage === null ? null : at)
      // Append-only, and only on a REAL move — the same guard as the clock
      // above, or a tool writing the current stage on every heartbeat would
      // fill the history with arrivals that never happened.
      if (stage !== null) stageEntryPending = { stage, at }
    }
  }
  if (parsed.data.note !== undefined) {
    // An explicit null clears it. Absent means "leave alone" — the same
    // convention the issue write-back patches use, and for the same reason:
    // a truthiness check makes clearing impossible.
    if (parsed.data.note === null) {
      sets.push('note = ?')
      args.push(null)
    } else {
      const note = normalizeNote(parsed.data.note)
      if (note === null) return c.json(invalid('bad note'), 400)
      sets.push('note = ?')
      args.push(note)
    }
  }
  if (parsed.data.status !== undefined) {
    const status = normalizeStatus(parsed.data.status)
    if (status === null) return c.json(invalid('bad status'), 400)
    // Stamped on the way in, CLEARED on the way out: it dates the current
    // shelving, not the first one ever.
    if (status !== row.status) {
      sets.push('archived_at = ?')
      args.push(status === 'archived' ? Date.now() : null)
    }
    sets.push('status = ?')
    args.push(status)
  }
  if (parsed.data.assignees !== undefined) {
    const assignees = normalizeAssignees(parsed.data.assignees)
    if (assignees === null) return c.json(invalid('bad assignees'), 400)
    sets.push('assignees = ?')
    args.push(JSON.stringify(assignees))
  }

  // Appended last so it covers every branch above without each remembering.
  sets.push('updated_at = ?')
  args.push(Date.now())
  db.prepare(`UPDATE batch SET ${sets.join(', ')} WHERE id = ?`).run(...args, id)
  if (stageEntryPending) recordStageEntry(db, id, stageEntryPending.stage, stageEntryPending.at)
  return c.json({ ok: true })
})

batchRoutes.put('/api/batches/:id/notes/:stageKey', async (c) => {
  if (!mayWrite(c)) return c.json(denied(), 403)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json(invalid('bad id'), 400)
  const stageKey = c.req.param('stageKey')
  const body = await c.req.json().catch(() => null)
  const parsed = NoteSchema.safeParse(body)
  if (!parsed.success) return c.json(invalid(parsed.error.message), 400)

  const db = getDb()
  // A note may be written to ANY stage, not only the current one: the spec
  // folder is known before Spec review is reached, a decision is recorded after
  // Result review has passed, an agent at CI leaves "needs a squash" on Merge.
  // Unlike `stage`, a note has no second writer to coordinate with.
  const existing = db
    .prepare(`SELECT body FROM workstream_stage_note WHERE batch_id = ? AND stage_key = ?`)
    .get(id, stageKey) as { body: string } | undefined

  // Two write modes on one field: a person edits and prunes, an agent appends
  // without clobbering what the person wrote. Not an append-only log — a log
  // nobody prunes is one more thing that rots, and an agent will fill it.
  let next: string | null
  if (parsed.data.append !== undefined) {
    const line = normalizeNote(parsed.data.append)
    if (line === null) return c.json(invalid('bad append'), 400)
    next = existing?.body ? `${existing.body.replace(/\s+$/, '')}\n${line}` : line
  } else {
    next = normalizeNote(parsed.data.body)
  }
  if (next === null) return c.json(invalid('bad body'), 400)

  db.prepare(
    `INSERT INTO workstream_stage_note(batch_id, stage_key, body, updated_at) VALUES(?, ?, ?, ?)
     ON CONFLICT(batch_id, stage_key) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
  ).run(id, stageKey, next, Date.now())
  touchBatch(db, id)
  return c.json({ ok: true, body: next })
})

batchRoutes.delete('/api/batches/:id/notes/:stageKey', (c) => {
  if (!mayWrite(c)) return c.json(denied(), 403)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json(invalid('bad id'), 400)
  const db = getDb()
  db.prepare(`DELETE FROM workstream_stage_note WHERE batch_id = ? AND stage_key = ?`).run(
    id,
    c.req.param('stageKey'),
  )
  touchBatch(db, id)
  return c.body(null, 204)
})

batchRoutes.post('/api/batches/:id/links/:stageKey', async (c) => {
  if (!mayWrite(c)) return c.json(denied(), 403)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json(invalid('bad id'), 400)
  const body = await c.req.json().catch(() => null)
  const parsed = LinkSchema.safeParse(body)
  if (!parsed.success) return c.json(invalid(parsed.error.message), 400)
  const kind = normalizeLinkKind(parsed.data.kind)
  if (kind === null) return c.json(invalid(`kind must be one of ${STAGE_LINK_KINDS.join(', ')}`), 400)
  const value = normalizeLinkValue(parsed.data.value)
  if (value === null) return c.json(invalid('bad value'), 400)

  // OR IGNORE: attaching the same thing twice is a no-op, not an error.
  const db = getDb()
  db.prepare(
    `INSERT OR IGNORE INTO workstream_stage_link(batch_id, stage_key, kind, value, label, created_at)
     VALUES(?, ?, ?, ?, ?, ?)`,
  ).run(id, c.req.param('stageKey'), kind, value, parsed.data.label ?? null, Date.now())
  touchBatch(db, id)
  return c.json({ ok: true })
})

batchRoutes.delete('/api/batches/:id/links/:stageKey', async (c) => {
  if (!mayWrite(c)) return c.json(denied(), 403)
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) return c.json(invalid('bad id'), 400)
  const body = await c.req.json().catch(() => null)
  const value = normalizeLinkValue((body as { value?: unknown } | null)?.value)
  if (value === null) return c.json(invalid('bad value'), 400)
  const db = getDb()
  db.prepare(`DELETE FROM workstream_stage_link WHERE batch_id = ? AND stage_key = ? AND value = ?`).run(
    id,
    c.req.param('stageKey'),
    value,
  )
  touchBatch(db, id)
  return c.body(null, 204)
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
  // Truthiness again — bun:sqlite answers a miss with NULL.
  if (!db.prepare(`SELECT id FROM batch WHERE id = ?`).get(id)) return c.json(notFound(), 404)
  // OR IGNORE on the (batch_id, identifier) primary key: adding an issue that
  // is already a member is a no-op, not an error. The caller — a person or an
  // agent — is expressing "this belongs here", and it already does.
  const insert = db.prepare(
    `INSERT OR IGNORE INTO batch_member(batch_id, identifier) VALUES(?, ?)`,
  )
  db.transaction((ids: string[]) => {
    for (const m of ids) insert.run(id, m)
    touchBatch(db, id)
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
  const db = getDb()
  const r = db.prepare(`DELETE FROM batch_member WHERE batch_id = ? AND identifier = ?`).run(id, identifier)
  if (r.changes === 0) return c.json(notFound(), 404)
  touchBatch(db, id)
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
  db.prepare(`DELETE FROM workstream_stage_note WHERE batch_id = ?`).run(id)
  db.prepare(`DELETE FROM workstream_stage_link WHERE batch_id = ?`).run(id)
  return c.body(null, 204)
})
