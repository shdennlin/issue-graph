import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NormalizedIssue } from '@shared/types.js'

// cache.js and sync.js both reach db.js, which imports `bun:sqlite` — a
// specifier Node cannot resolve, so without these the suite cannot even load.
// Same pattern and same reason as webhooks.test.ts. factory.js is mocked for
// control rather than necessity: what these tests vary is the adapter's
// capabilities and which credential it was built with.
const ISSUES: NormalizedIssue[] = [
  { id: 'uuid-1', identifier: 'ENG-1' } as NormalizedIssue,
]
vi.mock('../cache.js', () => ({ readCachedIssues: () => ISSUES }))
vi.mock('../sync.js', () => ({ readViewerCached: () => null }))

const updateIssue = vi.fn(async (_id: string, _patch: Record<string, unknown>): Promise<void> => undefined)
const addComment = vi.fn(async (_id: string, _body: string): Promise<void> => undefined)
const fetchIssueDetail = vi.fn(async (id: string) => ({ id, comments: [] }))
let backend: Record<string, unknown> = {}
// The spy that proves the point of the whole feature: writes must be built from
// the *caller's* token, not from the workspace's stored key.
const buildBackendWithToken = vi.fn((_token: string) => backend)
vi.mock('../sources/factory.js', () => ({
  getBackend: () => backend,
  buildBackendWithToken: (token: string) => buildBackendWithToken(token),
}))

import { AuthError } from '../sources/types.js'
import { __resetIssueDetailCacheForTests, issueRoutes } from './issue.js'

const AUTH = { authorization: 'Bearer user-oauth-token' }

/** The shared error envelope, typed so assertions read `.error.code`. */
async function errorCode(res: Response): Promise<string> {
  const body = (await res.json()) as { error?: { code?: string } }
  return body.error?.code ?? ''
}

function patch(body: unknown, headers: Record<string, string> = AUTH) {
  return issueRoutes.request('/api/issues/ENG-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function comment(body: unknown, headers: Record<string, string> = AUTH) {
  return issueRoutes.request('/api/issues/ENG-1/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  updateIssue.mockClear()
  addComment.mockClear()
  fetchIssueDetail.mockClear()
  updateIssue.mockImplementation(async () => undefined)
  buildBackendWithToken.mockClear()
  backend = { name: 'fake', updateIssue, addComment, fetchIssueDetail }
  __resetIssueDetailCacheForTests()
})

describe('the write gate', () => {
  it('refuses a request with no Authorization header', async () => {
    const res = await patch({ stateId: 's1' }, {})
    expect(res.status).toBe(401)
    expect(await errorCode(res)).toBe('unauthenticated')
    expect(updateIssue).not.toHaveBeenCalled()
  })

  // Rejected locally rather than forwarded: an empty credential would come back
  // from Linear as the same 401, only after a round trip and with a worse
  // message in the network log.
  it.each(['Bearer', 'Bearer   ', ''])('refuses a header with no credential (%p)', async (header) => {
    const res = await patch({ stateId: 's1' }, { authorization: header })
    expect(res.status).toBe(401)
    expect(updateIssue).not.toHaveBeenCalled()
  })

  it('guards the comment route the same way', async () => {
    const res = await comment({ body: 'hi' }, {})
    expect(res.status).toBe(401)
    expect(addComment).not.toHaveBeenCalled()
  })

  // The server deliberately does not judge the token — only that one is
  // present. Linear decides, and its verdict comes back as AuthError.
  it('passes a token it cannot judge through to the adapter', async () => {
    const res = await patch({ stateId: 's1' }, { authorization: 'Bearer probably-garbage' })
    expect(res.status).toBe(200)
    expect(buildBackendWithToken).toHaveBeenCalledWith('probably-garbage')
  })

  it('answers 401, not 502, when the adapter reports the token was rejected', async () => {
    updateIssue.mockImplementation(async () => {
      throw new AuthError('Linear auth failed: 401')
    })
    const res = await patch({ stateId: 's1' })
    expect(res.status).toBe(401)
    expect(await errorCode(res)).toBe('unauthenticated')
  })

  it('rejects a cross-origin write before looking at the token', async () => {
    const res = await patch({ stateId: 's1' }, { ...AUTH, origin: 'http://evil.test', host: 'localhost' })
    expect(res.status).toBe(403)
    expect(await errorCode(res)).toBe('origin')
  })

  it('does not leak whether an issue exists to an unauthenticated caller', async () => {
    const res = await issueRoutes.request('/api/issues/NOPE-9', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stateId: 's1' }),
    })
    expect(res.status).toBe(401)
  })
})

// The feature is per-person attribution, and it is only real if the token that
// arrives is the one used. A shared adapter would attribute every change to the
// owner of the workspace's API key, which is the thing this replaced.
describe('the caller\'s identity', () => {
  it('builds the adapter from the token on the request', async () => {
    await patch({ stateId: 's1' })
    expect(buildBackendWithToken).toHaveBeenCalledWith('user-oauth-token')
  })

  it('does the same for comments', async () => {
    await comment({ body: 'hi' })
    expect(buildBackendWithToken).toHaveBeenCalledWith('user-oauth-token')
  })

  it('builds a fresh adapter per write rather than reusing one', async () => {
    await patch({ stateId: 's1' }, { authorization: 'Bearer alice' })
    await patch({ stateId: 's1' }, { authorization: 'Bearer bob' })
    expect(buildBackendWithToken.mock.calls.map((c) => c[0])).toEqual(['alice', 'bob'])
  })

  it('never builds one for a read', async () => {
    await issueRoutes.request('/api/issues/ENG-1')
    expect(buildBackendWithToken).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/issues/:identifier', () => {
  it('passes the backend id, not the human identifier, to the adapter', async () => {
    const res = await patch({ stateId: 's1' })
    expect(res.status).toBe(200)
    expect(updateIssue).toHaveBeenCalledWith('uuid-1', { stateId: 's1' })
  })

  // The distinction the whole patch shape exists for.
  it('forwards an explicit null assigneeId so unassigning is possible', async () => {
    await patch({ assigneeId: null })
    expect(updateIssue).toHaveBeenCalledWith('uuid-1', { assigneeId: null })
  })

  it('omits an absent assigneeId rather than clearing it', async () => {
    await patch({ stateId: 's1' })
    const sent = updateIssue.mock.calls[0]?.[1]
    expect(sent && 'assigneeId' in sent).toBe(false)
  })

  it('rejects an empty patch instead of reporting a change that never happened', async () => {
    const res = await patch({})
    expect(res.status).toBe(400)
    expect(updateIssue).not.toHaveBeenCalled()
  })

  it('rejects a patch whose only keys are unknown', async () => {
    const res = await patch({ title: 'nope' })
    expect(res.status).toBe(400)
    expect(updateIssue).not.toHaveBeenCalled()
  })

  it.each([0, 4])('accepts priority %i', async (priority) => {
    const res = await patch({ priority })
    expect(res.status).toBe(200)
    expect(updateIssue).toHaveBeenCalledWith('uuid-1', { priority })
  })

  // Bounded in the route so a typo is a readable 400 rather than a 502
  // carrying Linear's own validation error back to the user.
  it.each([-1, 5, 1.5])('rejects an out-of-range priority (%p)', async (priority) => {
    const res = await patch({ priority })
    expect(res.status).toBe(400)
    expect(updateIssue).not.toHaveBeenCalled()
  })

  it('forwards label deltas', async () => {
    await patch({ addedLabelIds: ['l1'], removedLabelIds: ['l2'] })
    expect(updateIssue).toHaveBeenCalledWith('uuid-1', {
      addedLabelIds: ['l1'],
      removedLabelIds: ['l2'],
    })
  })

  it.each(['addedLabelIds', 'removedLabelIds'])('rejects an empty %s as malformed, not as a write', async (key) => {
    const res = await patch({ [key]: [] })
    expect(res.status).toBe(400)
    expect(updateIssue).not.toHaveBeenCalled()
  })

  it('404s an identifier that is not in the cache', async () => {
    const res = await issueRoutes.request('/api/issues/NOPE-9', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...AUTH },
      body: JSON.stringify({ stateId: 's1' }),
    })
    expect(res.status).toBe(404)
  })

  it('501s when the adapter cannot write, rather than pretending it worked', async () => {
    backend = { name: 'readonly', fetchIssueDetail }
    const res = await patch({ stateId: 's1' })
    expect(res.status).toBe(501)
    expect(await errorCode(res)).toBe('not_supported')
  })

  it('502s when the adapter throws for any reason other than auth', async () => {
    updateIssue.mockImplementation(async () => {
      throw new Error('Linear declined')
    })
    const res = await patch({ stateId: 's1' })
    expect(res.status).toBe(502)
    expect(await errorCode(res)).toBe('write_failed')
  })
})

describe('POST /api/issues/:identifier/comments', () => {
  it('posts the body through to the adapter', async () => {
    const res = await comment({ body: 'looks done to me' })
    expect(res.status).toBe(200)
    expect(addComment).toHaveBeenCalledWith('uuid-1', 'looks done to me')
  })

  it.each([{ body: '' }, { body: '   ' }, {}])('rejects an empty comment (%p)', async (payload) => {
    const res = await comment(payload)
    expect(res.status).toBe(400)
    expect(addComment).not.toHaveBeenCalled()
  })

  it('501s when the adapter cannot comment', async () => {
    backend = { name: 'readonly', fetchIssueDetail }
    const res = await comment({ body: 'hi' })
    expect(res.status).toBe(501)
  })
})

// The detail route caches for ten minutes. A write that does not bust it leaves
// the panel showing the pre-write copy for that long, which reads as the write
// having silently failed.
describe('the detail cache after a write', () => {
  it('serves a repeated read from cache while nothing has changed', async () => {
    await issueRoutes.request('/api/issues/ENG-1')
    await issueRoutes.request('/api/issues/ENG-1')
    expect(fetchIssueDetail).toHaveBeenCalledTimes(1)
  })

  it('is busted by a successful patch', async () => {
    await issueRoutes.request('/api/issues/ENG-1')
    await patch({ stateId: 's1' })
    await issueRoutes.request('/api/issues/ENG-1')
    expect(fetchIssueDetail).toHaveBeenCalledTimes(2)
  })

  it('is busted by a new comment', async () => {
    await issueRoutes.request('/api/issues/ENG-1')
    await comment({ body: 'hi' })
    await issueRoutes.request('/api/issues/ENG-1')
    expect(fetchIssueDetail).toHaveBeenCalledTimes(2)
  })

  it('is left alone by a rejected write', async () => {
    await issueRoutes.request('/api/issues/ENG-1')
    await patch({ stateId: 's1' }, {})
    await issueRoutes.request('/api/issues/ENG-1')
    expect(fetchIssueDetail).toHaveBeenCalledTimes(1)
  })
})
