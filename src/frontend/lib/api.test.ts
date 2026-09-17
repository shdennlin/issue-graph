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
