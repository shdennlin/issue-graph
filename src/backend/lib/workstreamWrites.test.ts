import { describe, it, expect } from 'vitest'
import { isWorkstreamWrite } from './workstreamWrites.js'

describe('isWorkstreamWrite', () => {
  it.each([
    ['POST', '/api/batches'],
    ['PATCH', '/api/batches/3'],
    ['PUT', '/api/batches/3/notes/impl'],
    ['POST', '/api/batches/3/links/impl'],
    ['DELETE', '/api/batches/3/members/ONE-1'],
    ['POST', '/api/lifecycle/reorder'],
    ['PUT', '/api/fields/runbook'],
    ['POST', '/api/agent-sessions'],
    ['DELETE', '/api/agent-sessions/abc'],
  ])('announces %s %s', (method, path) => {
    expect(isWorkstreamWrite(method, path, 200)).toBe(true)
  })

  it('ignores reads', () => {
    expect(isWorkstreamWrite('GET', '/api/batches', 200)).toBe(false)
  })

  it('ignores a write that failed — including a 401 on the session endpoint', () => {
    // Otherwise anyone who can reach the endpoint could make every open tab
    // refetch without holding the token.
    expect(isWorkstreamWrite('POST', '/api/agent-sessions', 401)).toBe(false)
    expect(isWorkstreamWrite('PATCH', '/api/batches/3', 400)).toBe(false)
  })

  it('ignores writes elsewhere, and does not match on a shared prefix alone', () => {
    expect(isWorkstreamWrite('POST', '/api/notes', 200)).toBe(false)
    expect(isWorkstreamWrite('POST', '/api/batchesX', 200)).toBe(false)
  })
})
