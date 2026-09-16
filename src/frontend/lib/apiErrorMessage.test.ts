import { describe, it, expect } from 'vitest'
import { apiErrorKey } from './apiErrorMessage.js'

// Route errors are rendered straight into the setup form, and the server writes
// them in English only. Translating by the `code` the server already sends
// keeps the backend free of locale concerns.
describe('apiErrorKey', () => {
  it('maps every error code the workspace routes can return', () => {
    for (const code of [
      'invalid',
      'invalid_id',
      'exists',
      'key_rejected',
      'key_rejected_unchanged',
      'not_found',
      'unconfigured',
      'switch_in_progress',
      'switch_failed',
    ]) {
      expect(apiErrorKey(code), code).not.toBeNull()
    }
  })

  it('distinguishes a rejected new key from a rejected replacement', () => {
    expect(apiErrorKey('key_rejected')).not.toBe(apiErrorKey('key_rejected_unchanged'))
  })

  // An unknown code must fall back to the server's own sentence rather than
  // rendering a raw dictionary path at the user.
  it('returns null for an unknown or absent code', () => {
    expect(apiErrorKey('something_new')).toBeNull()
    expect(apiErrorKey(null)).toBeNull()
    expect(apiErrorKey(undefined)).toBeNull()
    expect(apiErrorKey('')).toBeNull()
  })
})
