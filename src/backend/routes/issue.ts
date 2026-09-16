import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { buildBackendWithToken, getBackend } from '../sources/factory.js'
import { readCachedIssues } from '../cache.js'
import { readViewerCached } from '../sync.js'
import { AuthError } from '../sources/types.js'
import { bearerToken, originAllowed } from '../lib/http.js'

interface CacheEntry { detail: unknown; ts: number }
const detailCache = new Map<string, CacheEntry>()
const TTL_MS = 10 * 60 * 1000

/** A write just changed this issue upstream, so the cached detail is a lie.
 *  Without this the panel keeps serving the pre-write copy for ten minutes. */
function bustDetail(identifier: string): void {
  detailCache.delete(identifier)
}

/** Test-only: the cache is module state, so it survives between cases and a
 *  suite exercising cache behaviour would otherwise depend on test order.
 *  Same convention as __resetRateLimitForTests / resetBackendForTests. */
export function __resetIssueDetailCacheForTests(): void {
  detailCache.clear()
}

export const issueRoutes = new Hono()

issueRoutes.get('/api/issues/:identifier', async (c) => {
  const identifier = c.req.param('identifier')
  // Identifier → backend id via cached lookup.
  const issues = readCachedIssues()
  const match = issues.find((i) => i.identifier === identifier)
  if (!match) return c.json({ error: { code: 'not_found', message: `No cached issue ${identifier}` } }, 404)

  const cached = detailCache.get(identifier)
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return c.json({ data: cached.detail })
  }

  try {
    const detail = await getBackend().fetchIssueDetail(match.id)
    detailCache.set(identifier, { detail, ts: Date.now() })
    return c.json({ data: detail })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ error: { code: 'fetch_failed', message } }, 502)
  }
})

// ─── Write-back ──────────────────────────────────────────────────────────────
//
// The only routes in this app that change something outside it, and the only
// ones that act as somebody in particular: a write carries the caller's own
// Linear OAuth token, which is used for that one call and then forgotten. The
// server stores nothing and validates nothing about it — Linear answers both
// "may this person write" and "who wrote this", and attributes the change to
// them rather than to the owner of the workspace's API key.
//
// Reads are untouched and still use the workspace's stored key: sync is a
// shared background pull into one cache, not an action by a person.
//
// The guards run inline rather than as `app.use` middleware to match the rest
// of the codebase (every mutating route calls originAllowed(c) inline) and
// because route suites drive this sub-app directly — a guard mounted on the
// root app in index.ts would not be exercised by any test.

/** Shared prelude for both write routes: origin, the caller's token, and the
 *  identifier → backend id lookup. Returns what the handler needs or the
 *  response to send. */
function authorizeWrite(
  c: Context,
  identifier: string,
): { id: string; token: string } | { response: Response } {
  if (!originAllowed(c)) {
    return { response: c.json({ error: { code: 'origin', message: 'cross-origin denied' } }, 403) }
  }
  const token = bearerToken(c.req.header('authorization'))
  if (!token) {
    // The only thing checked locally: that a credential was presented at all.
    // Whether it is *valid* is Linear's answer to give, and it gives it as the
    // same 401 further down, so the two failures read identically to a client.
    return { response: unauthenticated(c) }
  }
  const match = readCachedIssues().find((i) => i.identifier === identifier)
  if (!match) {
    return {
      response: c.json({ error: { code: 'not_found', message: `No cached issue ${identifier}` } }, 404),
    }
  }
  return { id: match.id, token }
}

function unauthenticated(c: Context): Response {
  return c.json(
    {
      error: {
        code: 'unauthenticated',
        message: 'Connect your Linear account to make changes.',
      },
    },
    401,
  )
}

/**
 * Turn an adapter failure into a response.
 *
 * AuthError is split out from the generic 502 so the client can tell "reconnect
 * your account" from "the write itself failed" — a rejected or expired token is
 * the one failure the user can actually fix, and a 502 would send them looking
 * at the wrong thing. `gql` already maps Linear's 401/403 onto AuthError.
 */
function writeFailure(c: Context, err: unknown): Response {
  if (err instanceof AuthError) return unauthenticated(c)
  const message = err instanceof Error ? err.message : String(err)
  return c.json({ error: { code: 'write_failed', message } }, 502)
}

// `.optional()` vs `.nullable()` is the contract, not a formality: an absent
// assigneeId leaves the assignee alone, an explicit null unassigns. Collapsing
// them would make unassigning impossible.
const PatchBody = z.object({
  stateId: z.string().min(1).optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  // Linear's range. Bounded here so a typo becomes a 400 with a readable
  // message rather than a 502 carrying Linear's own validation error.
  priority: z.number().int().min(0).max(4).optional(),
  // `.min(1)`: an empty array survives the "is the patch empty" check below but
  // means "change nothing", so without this it reaches the adapter and comes
  // back as a 502 for what is really a malformed request.
  addedLabelIds: z.array(z.string().min(1)).min(1).optional(),
  removedLabelIds: z.array(z.string().min(1)).min(1).optional(),
})

issueRoutes.patch('/api/issues/:identifier', async (c) => {
  const identifier = c.req.param('identifier')
  const auth = authorizeWrite(c, identifier)
  if ('response' in auth) return auth.response

  const parsed = PatchBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: { code: 'invalid', message: parsed.error.message } }, 400)
  }
  // Zod strips unknown keys, so an empty object here means the caller asked for
  // nothing. Rejecting it keeps the adapter's "never report success for a
  // no-op" rule from having to be re-derived per backend.
  if (Object.keys(parsed.data).length === 0) {
    return c.json({ error: { code: 'invalid', message: 'No fields to update.' } }, 400)
  }

  // Built per request from the caller's token, never the shared instance — see
  // buildBackendWithToken for why a mutated shared one would be wrong twice.
  const backend = buildBackendWithToken(auth.token)
  if (typeof backend.updateIssue !== 'function') {
    return c.json(
      { error: { code: 'not_supported', message: 'Backend does not support issue updates.' } },
      501,
    )
  }

  try {
    await backend.updateIssue(auth.id, parsed.data)
    bustDetail(identifier)
    return c.json({ ok: true })
  } catch (err) {
    return writeFailure(c, err)
  }
})

const CommentBody = z.object({ body: z.string().trim().min(1) })

issueRoutes.post('/api/issues/:identifier/comments', async (c) => {
  const identifier = c.req.param('identifier')
  const auth = authorizeWrite(c, identifier)
  if ('response' in auth) return auth.response

  const parsed = CommentBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: { code: 'invalid', message: parsed.error.message } }, 400)
  }

  const backend = buildBackendWithToken(auth.token)
  if (typeof backend.addComment !== 'function') {
    return c.json(
      { error: { code: 'not_supported', message: 'Backend does not support comments.' } },
      501,
    )
  }

  try {
    await backend.addComment(auth.id, parsed.data.body)
    // The comment list lives inside the cached detail, so this is the only way
    // the new comment becomes visible without waiting out the TTL.
    bustDetail(identifier)
    return c.json({ ok: true })
  } catch (err) {
    return writeFailure(c, err)
  }
})

issueRoutes.get('/api/me', (c) => {
  const cached = readCachedIssues()
  const viewer = readViewerCached()
  return c.json({ viewer, issuesCached: cached.length })
})
