// Per-issue stage assignment. Thin by the same rule as routes/lifecycle.ts:
// validation lives in the pure lifecycleStore.ts.
//
// A stage is SET, never derived. The Linear state cannot tell you which stage
// an issue is on, because a workspace's stages are finer than its states — one
// state routinely spans several steps. See ADR-0002.
//
// Nothing here touches Linear. Writing a stage records what a person or an
// agent asserts; when that disagrees with the Linear state the app shows both
// and resolves neither.

import { Hono } from 'hono'
import { z } from 'zod'
import { getDb } from '../db.js'
import { originAllowed } from '../lib/http.js'
import {
  issueStageRowToDTO,
  normalizeStageKey,
  type IssueStageRow,
  type LifecycleStageRow,
} from '../lifecycleStore.js'

// Matches ISSUE_ID_PATTERN in frontend/lib/issueLinks.ts and scanner.ts. Anchored
// here because this is an identity, not a search over prose.
const IDENTIFIER_RE = /^[A-Z][A-Z0-9]+-\d+$/

const PutSchema = z.object({
  stageKey: z.string().nullable(),
  updatedBy: z.string().max(200).optional(),
})

const SELECT = `SELECT identifier, stage_key, updated_at, updated_by FROM issue_stage`

const denyOrigin = () => ({ error: { code: 'origin', message: 'cross-origin denied' } }) as const
const invalid = (message: string) => ({ error: { code: 'invalid', message } }) as const

export const stageRoutes = new Hono()

stageRoutes.get('/api/stage', (c) => {
  const rows = getDb().prepare(SELECT).all() as IssueStageRow[]
  return c.json({ entries: rows.map(issueStageRowToDTO) })
})

stageRoutes.put('/api/stage/:identifier', async (c) => {
  if (!originAllowed(c)) return c.json(denyOrigin(), 403)
  const identifier = c.req.param('identifier').toUpperCase()
  if (!IDENTIFIER_RE.test(identifier)) return c.json(invalid('bad identifier'), 400)

  const body = await c.req.json().catch(() => null)
  const parsed = PutSchema.safeParse(body)
  if (!parsed.success) return c.json(invalid(parsed.error.message), 400)

  const db = getDb()

  // An explicit null clears the assignment. This is a PUT of the whole value,
  // so null is "no stage", distinct from omitting the field, which the schema
  // rejects — clearing must be deliberate.
  if (parsed.data.stageKey === null) {
    db.prepare(`DELETE FROM issue_stage WHERE identifier = ?`).run(identifier)
    return c.body(null, 204)
  }

  const stageKey = normalizeStageKey(parsed.data.stageKey)
  if (stageKey === null) return c.json(invalid('bad stageKey'), 400)

  // Reject a key no stage defines. Unresolvable keys are tolerated on READ
  // (they degrade to 'unknown' so a deleted stage does not erase history), but
  // there is no reason to let a new one in through the front door.
  const known = db
    .prepare(`SELECT key FROM lifecycle_stage WHERE key = ?`)
    .get(stageKey) as Pick<LifecycleStageRow, 'key'> | undefined
  if (!known) return c.json(invalid('unknown stageKey'), 400)

  const now = Date.now()
  const updatedBy = parsed.data.updatedBy?.trim() || null
  db.prepare(
    `INSERT INTO issue_stage(identifier, stage_key, updated_at, updated_by) VALUES(?, ?, ?, ?)
     ON CONFLICT(identifier) DO UPDATE SET
       stage_key = excluded.stage_key,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
  ).run(identifier, stageKey, now, updatedBy)

  return c.json(
    issueStageRowToDTO({
      identifier,
      stage_key: stageKey,
      updated_at: now,
      updated_by: updatedBy,
    }),
  )
})
