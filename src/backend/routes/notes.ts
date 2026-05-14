import { Hono } from 'hono'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from '../db.js'
import { originAllowed } from '../lib/http.js'
import { getNoteAssetDir } from '../lib/workspacePaths.js'
import type { NoteDTO } from '@shared/types.js'

const MAX_ASSET_BYTES = 5 * 1024 * 1024 // 5 MB

interface SniffedImage {
  ext: 'png' | 'jpg' | 'gif' | 'webp'
  mime: string
}

// Reject anything whose first bytes don't match a known image magic. Trusting
// the client-supplied Content-Type would let `evil.html` masquerade as image/png.
function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < 12) return null
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { ext: 'png', mime: 'image/png' }
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' }
  }
  // GIF: 47 49 46 38 (37 | 39) 61
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return { ext: 'gif', mime: 'image/gif' }
  }
  // WebP: 52 49 46 46 ?? ?? ?? ?? 57 45 42 50  (RIFF...WEBP)
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { ext: 'webp', mime: 'image/webp' }
  }
  return null
}

// Filenames are always SHA1 + known image ext. Anything else is path traversal
// or a tampered request — 404 immediately.
const ASSET_FILENAME_RE = /^[a-f0-9]{40}\.(png|jpg|gif|webp)$/
const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

const CreateSchema = z.object({
  body: z.string().max(256 * 1024).optional(),
})

const PatchSchema = z
  .object({
    body: z.string().max(256 * 1024).optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => v.body !== undefined || v.archived !== undefined, {
    message: 'patch must include body or archived',
  })

const ReorderSchema = z.object({
  orderedIds: z.array(z.number().int().positive()).max(10000),
})

export const notesRoutes = new Hono()

notesRoutes.get('/api/notes', (c) => {
  // `?archived=1` → archived only; `?archived=0` (default) → active only;
  // `?archived=all` → both (used by debug / future bulk views).
  const param = c.req.query('archived') ?? '0'
  let where: string
  if (param === '1' || param === 'true') where = 'WHERE archived = 1'
  else if (param === 'all') where = ''
  else where = 'WHERE archived = 0'
  const rows = getDb()
    .prepare(
      `SELECT id, body, sort_order as sortOrder,
              archived as archivedInt,
              created_at as createdAt, updated_at as updatedAt
       FROM note ${where} ORDER BY sort_order ASC, id ASC`,
    )
    .all() as Array<Omit<NoteDTO, 'archived'> & { archivedInt: number }>
  // SQLite stores booleans as integers; project to a real boolean for clients.
  const entries: NoteDTO[] = rows.map(({ archivedInt, ...rest }) => ({
    ...rest,
    archived: archivedInt === 1,
  }))
  return c.json({ entries })
})

notesRoutes.post('/api/notes', async (c) => {
  if (!originAllowed(c)) return c.json({ error: { code: 'origin', message: 'cross-origin denied' } }, 403)
  const body = await c.req.json().catch(() => ({}))
  const parsed = CreateSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: { code: 'invalid', message: parsed.error.message } }, 400)

  const db = getDb()
  // Insert at the top: sort_order = MIN(existing) - 1, or 0 when empty.
  const minRow = db.prepare(`SELECT MIN(sort_order) as min FROM note`).get() as { min: number | null }
  const sortOrder = minRow.min === null ? 0 : minRow.min - 1
  const now = Date.now()
  const r = db
    .prepare(`INSERT INTO note(body, sort_order, created_at, updated_at) VALUES(?, ?, ?, ?)`)
    .run(parsed.data.body ?? '', sortOrder, now, now)
  return c.json({ id: Number(r.lastInsertRowid), sortOrder }, 201)
})

notesRoutes.patch('/api/notes/:id', async (c) => {
  if (!originAllowed(c)) return c.json({ error: { code: 'origin', message: 'cross-origin denied' } }, 403)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.json({ error: { code: 'invalid', message: 'bad id' } }, 400)
  const body = await c.req.json().catch(() => null)
  const parsed = PatchSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: { code: 'invalid', message: parsed.error.message } }, 400)
  // Build a dynamic UPDATE so callers can patch either field independently
  // without clobbering the other (autosave keeps writing body; archive
  // button only writes archived).
  const sets: string[] = []
  const values: Array<string | number> = []
  if (parsed.data.body !== undefined) {
    sets.push('body = ?')
    values.push(parsed.data.body)
  }
  if (parsed.data.archived !== undefined) {
    sets.push('archived = ?')
    values.push(parsed.data.archived ? 1 : 0)
  }
  sets.push('updated_at = ?')
  values.push(Date.now())
  values.push(id)
  const r = getDb()
    .prepare(`UPDATE note SET ${sets.join(', ')} WHERE id = ?`)
    .run(...values)
  if (r.changes === 0) return c.json({ error: { code: 'not_found' } }, 404)
  return c.json({ ok: true })
})

notesRoutes.delete('/api/notes/:id', (c) => {
  if (!originAllowed(c)) return c.json({ error: { code: 'origin', message: 'cross-origin denied' } }, 403)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.json({ error: { code: 'invalid', message: 'bad id' } }, 400)
  const r = getDb().prepare(`DELETE FROM note WHERE id = ?`).run(id)
  if (r.changes === 0) return c.json({ error: { code: 'not_found' } }, 404)
  // Best-effort cleanup of the asset directory. Safe to call even if it
  // never existed (rmSync with force:true is silent on ENOENT).
  try {
    rmSync(getNoteAssetDir(id), { recursive: true, force: true })
  } catch {
    /* ignore — asset dir cleanup is best-effort */
  }
  return c.json({ ok: true })
})

notesRoutes.post('/api/notes/:id/assets', async (c) => {
  if (!originAllowed(c)) return c.json({ error: { code: 'origin', message: 'cross-origin denied' } }, 403)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.json({ error: { code: 'invalid', message: 'bad id' } }, 400)

  // Verify the note exists so we don't accept assets for ghost ids.
  const row = getDb().prepare('SELECT id FROM note WHERE id = ?').get(id) as { id: number } | null
  if (!row) return c.json({ error: { code: 'not_found' } }, 404)

  // Reject oversized uploads early via Content-Length if the client provides
  // it. The body read below is also bounded — we cap the buffer rather than
  // streaming, since 5 MB is small.
  const len = c.req.header('content-length')
  if (len && Number(len) > MAX_ASSET_BYTES * 1.1) {
    return c.json({ error: { code: 'too_large', message: 'file exceeds 5MB' } }, 413)
  }

  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string') {
    return c.json({ error: { code: 'invalid', message: 'missing file field' } }, 400)
  }
  if (file.size > MAX_ASSET_BYTES) {
    return c.json({ error: { code: 'too_large', message: 'file exceeds 5MB' } }, 413)
  }

  const buf = new Uint8Array(await file.arrayBuffer())
  const sniff = sniffImage(buf)
  if (!sniff) {
    return c.json({ error: { code: 'unsupported_type', message: 'only PNG/JPEG/GIF/WebP allowed' } }, 415)
  }

  const hash = createHash('sha1').update(buf).digest('hex')
  const filename = `${hash}.${sniff.ext}`
  const dir = getNoteAssetDir(id)
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    /* dir may already exist */
  }
  const path = join(dir, filename)
  if (!existsSync(path)) {
    writeFileSync(path, buf)
  }
  return c.json({ url: `/api/notes/${id}/assets/${filename}` }, 201)
})

notesRoutes.get('/api/notes/:id/assets/:filename', (c) => {
  const id = Number(c.req.param('id'))
  const filename = c.req.param('filename')
  if (!Number.isFinite(id)) return c.text('not found', 404)
  if (!filename || !ASSET_FILENAME_RE.test(filename)) return c.text('not found', 404)
  const path = join(getNoteAssetDir(id), filename)
  if (!existsSync(path)) return c.text('not found', 404)
  const ext = filename.split('.').pop() ?? ''
  const mime = EXT_TO_MIME[ext] ?? 'application/octet-stream'
  const buf = readFileSync(path)
  return c.body(buf, 200, {
    'Content-Type': mime,
    'Cache-Control': 'private, max-age=31536000, immutable',
  })
})

notesRoutes.post('/api/notes/reorder', async (c) => {
  if (!originAllowed(c)) return c.json({ error: { code: 'origin', message: 'cross-origin denied' } }, 403)
  const body = await c.req.json().catch(() => null)
  const parsed = ReorderSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: { code: 'invalid', message: parsed.error.message } }, 400)
  const db = getDb()
  const now = Date.now()
  // Re-number all listed ids starting from 0. Ids not in the list keep their
  // current sort_order — but they'll likely sort after the renumbered set
  // because most renumbered values are small. That's acceptable: the frontend
  // always sends the full list of visible note ids.
  const stmt = db.prepare(`UPDATE note SET sort_order = ?, updated_at = ? WHERE id = ?`)
  const txn = db.transaction(() => {
    parsed.data.orderedIds.forEach((id, idx) => {
      stmt.run(idx, now, id)
    })
  })
  txn()
  return c.json({ ok: true })
})
