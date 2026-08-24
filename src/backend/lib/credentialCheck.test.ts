import { describe, it, expect } from 'vitest'
import { classifyCredentialFailure } from './credentialCheck.js'
import { AuthError, RateLimitError } from '../sources/types.js'

// The setup form used to accept any string as an API key: a typo saved fine and
// only surfaced as an empty graph after the first sync 401'd. Checking the key
// at submit time means separating "Linear says no" — which the user must fix —
// from "we could not ask Linear right now", which they should not be blocked by.
describe('classifyCredentialFailure', () => {
  it('treats an auth failure as a rejected key', () => {
    expect(classifyCredentialFailure(new AuthError('Linear auth failed: 401'))).toBe('rejected')
  })

  // Matching on name as well as instanceof: the error crosses a module boundary
  // and a duplicated class identity would silently fall through to 'unreachable',
  // which would let a bad key save.
  it('recognises an auth failure by name even without class identity', () => {
    const e = new Error('Linear auth failed: 401')
    e.name = 'AuthError'
    expect(classifyCredentialFailure(e)).toBe('rejected')
  })

  // A rate limit or a network blip says nothing about whether the key is valid.
  // Refusing to save on these would strand a user behind a transient outage.
  it('treats everything else as unreachable, not rejected', () => {
    expect(classifyCredentialFailure(new RateLimitError('429'))).toBe('unreachable')
    expect(classifyCredentialFailure(new TypeError('fetch failed'))).toBe('unreachable')
    expect(classifyCredentialFailure(new Error('ETIMEDOUT'))).toBe('unreachable')
  })

  it('handles non-Error throws without crashing the route', () => {
    expect(classifyCredentialFailure('boom')).toBe('unreachable')
    expect(classifyCredentialFailure(null)).toBe('unreachable')
    expect(classifyCredentialFailure(undefined)).toBe('unreachable')
  })
})
