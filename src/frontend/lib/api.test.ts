// @vitest-environment happy-dom
//
// Covers one thing: the shared `http` helper's handling of responses with no
// body. It is not exported, so it is exercised through the callers that hit it.
//
// This was a real defect found by using the UI. DELETE returns 204, `http` called
// res.json() unconditionally, and the resulting "Unexpected end of JSON input"
// read as a failed request even though the delete had succeeded — so the caller
// skipped its refresh, left the deleted row on screen, and the next click on it
// 404'd. DELETE /api/saved-views has returned 204 since it shipped, so the same
// defect was already sitting in savedViewsStore's delete path.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { api } from './api'
import { authKey } from './linearAuth'
import { useWorkspaceStore } from '../store/workspaceStore'

const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const respond = (status: number, body: string | null, contentType = 'application/json') =>
  mockFetch.mockResolvedValue(
    new Response(body, { status, headers: body === null ? {} : { 'Content-Type': contentType } }),
  )

describe('http response bodies', () => {
  it('resolves a 204 instead of throwing on the empty body', async () => {
    respond(204, null)
    await expect(api.deleteStage(1)).resolves.toBeUndefined()
  })

  it('resolves a 200 whose body is empty', async () => {
    // Not hypothetical: a proxy or a handler returning c.body(null, 200) both
    // produce this, and it must not read as a failure either.
    respond(200, '')
    await expect(api.deleteStage(1)).resolves.toBeUndefined()
  })

  it('still parses a normal JSON body', async () => {
    respond(200, JSON.stringify({ entries: [{ key: 'impl' }] }))
    await expect(api.fetchLifecycle()).resolves.toEqual({ entries: [{ key: 'impl' }] })
  })

  it('still raises the server’s message on an error status', async () => {
    respond(409, JSON.stringify({ error: { code: 'invalid', message: 'already exists' } }))
    await expect(api.createStage({ name: 'X' })).rejects.toThrow(/already exists/)
  })

  it('covers the saved-view delete that had the same defect', async () => {
    respond(204, null)
    await expect(api.deleteSavedView(1)).resolves.toBeUndefined()
  })
})

// A write's URL and its bearer token must name the SAME workspace. They used to
// be read at two different moments — the header before `await`, the `?w=` after
// it inside http() — so a tab switch during a token renewal sent workspace A's
// Linear token to workspace B's route. The write's own workspace is now passed
// in once and both are built from it.
describe('write routing', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(
      authKey('team_a'),
      JSON.stringify({ token: 'a-token', expiresAt: Date.now() + 3600_000 }),
    )
    // The tab now shows B, as if the user switched while the write was pending.
    useWorkspaceStore.setState({ currentWorkspaceId: 'team_b' })
    respond(200, '{"ok":true}')
  })

  it('routes an issue update to the workspace it was issued in, with that workspace\'s token', async () => {
    await api.updateIssue('ENG-1', { priority: 1 }, 'team_a')
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(new URL(url, 'http://x').searchParams.get('w')).toBe('team_a')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer a-token')
  })

  it('routes a comment the same way', async () => {
    await api.addIssueComment('ENG-1', 'hi', 'team_a')
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(new URL(url, 'http://x').searchParams.get('w')).toBe('team_a')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer a-token')
  })
})
