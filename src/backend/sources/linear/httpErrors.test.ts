import { describe, expect, it } from 'vitest'
import { errorForStatus } from './index.js'
import { AuthError, ForbiddenError, RateLimitError } from '../types.js'

// 401 and 403 are different answers to different questions, and folding them
// together cost a real token: the write path clears the caller's stored
// credential on `unauthenticated`, so a permission failure used to delete a
// perfectly good OAuth token. 401 means "who are you"; 403 means "I know who
// you are, and no".
describe('errorForStatus', () => {
  it('maps 401 to AuthError — the credential itself was refused', () => {
    expect(errorForStatus(401)).toBeInstanceOf(AuthError)
  })

  it('maps 403 to ForbiddenError, NOT AuthError', () => {
    const err = errorForStatus(403)
    expect(err).toBeInstanceOf(ForbiddenError)
    expect(err).not.toBeInstanceOf(AuthError)
  })

  it('maps 429 to RateLimitError', () => {
    expect(errorForStatus(429)).toBeInstanceOf(RateLimitError)
  })

  it('returns null for a status it does not classify, leaving the caller to decide', () => {
    expect(errorForStatus(200)).toBeNull()
    expect(errorForStatus(500)).toBeNull()
  })
})
