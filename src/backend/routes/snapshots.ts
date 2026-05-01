import { Hono } from 'hono'
import { getDb } from '../db.js'

export const snapshotRoutes = new Hono()

snapshotRoutes.get('/api/snapshots', (c) => {
  const rows = getDb()
    .prepare(`SELECT ts FROM snapshot ORDER BY ts DESC LIMIT 1000`)
    .all() as Array<{ ts: number }>
  return c.json({ entries: rows.map((r) => r.ts) })
})

snapshotRoutes.get('/api/snapshots/:ts', (c) => {
  const ts = Number(c.req.param('ts'))
  const row = getDb()
    .prepare(`SELECT ts, issues_json as issuesJson, designdoc_json as designdocJson, schema_json as schemaJson FROM snapshot WHERE ts = ?`)
    .get(ts) as
    | { ts: number; issuesJson: string; designdocJson: string | null; schemaJson: string | null }
    | undefined
  if (!row) return c.json({ error: { code: 'not_found' } }, 404)
  return c.json({
    ts: row.ts,
    issues: JSON.parse(row.issuesJson),
    designdocs: row.designdocJson ? JSON.parse(row.designdocJson) : null,
    schema: row.schemaJson ? JSON.parse(row.schemaJson) : null,
  })
})

// Phase 3 — diff between two snapshots.
snapshotRoutes.get('/api/snapshot-diff', (c) => {
  const fromTs = Number(c.req.query('from'))
  const toTs = Number(c.req.query('to'))
  if (!fromTs || !toTs) return c.json({ error: { code: 'invalid' } }, 400)
  const stmt = getDb().prepare(`SELECT issues_json FROM snapshot WHERE ts = ?`)
  const aRow = stmt.get(fromTs) as { issues_json: string } | undefined
  const bRow = stmt.get(toTs) as { issues_json: string } | undefined
  if (!aRow || !bRow) return c.json({ error: { code: 'not_found' } }, 404)
  const a = JSON.parse(aRow.issues_json) as Array<{ identifier: string; state: { type: string } }>
  const b = JSON.parse(bRow.issues_json) as Array<{ identifier: string; state: { type: string } }>
  const aMap = new Map(a.map((x) => [x.identifier, x]))
  const bMap = new Map(b.map((x) => [x.identifier, x]))
  const added: string[] = []
  const removed: string[] = []
  const stateChanged: Array<{ identifier: string; from: string; to: string }> = []
  for (const id of bMap.keys()) if (!aMap.has(id)) added.push(id)
  for (const id of aMap.keys()) if (!bMap.has(id)) removed.push(id)
  for (const [id, x] of aMap) {
    const y = bMap.get(id)
    if (y && y.state?.type !== x.state?.type) {
      stateChanged.push({ identifier: id, from: x.state.type, to: y.state.type })
    }
  }
  return c.json({ from: fromTs, to: toTs, added, removed, stateChanged })
})

// Phase 3 — timeline (returns minimal aggregated series).
snapshotRoutes.get('/api/timeline', (c) => {
  const fromQ = Number(c.req.query('from') ?? 0)
  const toQ = Number(c.req.query('to') ?? Date.now())
  const rows = getDb()
    .prepare(`SELECT ts, issues_json as issuesJson FROM snapshot WHERE ts BETWEEN ? AND ? ORDER BY ts ASC`)
    .all(fromQ, toQ) as Array<{ ts: number; issuesJson: string }>
  const series = rows.map((r) => {
    const issues = JSON.parse(r.issuesJson) as Array<{ state: { type: string } }>
    const counts: Record<string, number> = {}
    for (const i of issues) counts[i.state.type] = (counts[i.state.type] ?? 0) + 1
    return { ts: r.ts, counts }
  })
  return c.json({ series })
})
