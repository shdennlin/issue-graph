import { describe, it, expect } from 'vitest'
import { syncFailureKind } from './syncStatus.js'

// A first-time user's most likely mistake is a typo'd API key. The sync then
// fails with auth_error and the graph renders empty — previously with nothing
// on screen to say why, because isAuthConfigured() only asks whether a key is
// *present*, and a wrong key is present. This classifies the last sync so the
// banner can say which of the two it is.
describe('syncFailureKind', () => {
  it('flags rejected credentials distinctly — the one the user can fix', () => {
    expect(syncFailureKind('auth_error')).toBe('auth')
  })

  it('flags other failures generically', () => {
    expect(syncFailureKind('rate_limited')).toBe('error')
    expect(syncFailureKind('api_error')).toBe('error')
    expect(syncFailureKind('partial')).toBe('error')
  })

  // 'started' is a sync still in flight. Reporting it as a failure would make
  // the banner flash on every refresh.
  it('says nothing about a successful or in-flight sync', () => {
    expect(syncFailureKind('success')).toBeNull()
    expect(syncFailureKind('started')).toBeNull()
  })

  it('says nothing when there is no sync history at all', () => {
    expect(syncFailureKind(null)).toBeNull()
    expect(syncFailureKind(undefined)).toBeNull()
    expect(syncFailureKind('')).toBeNull()
  })

  // Statuses are written by sync.ts and read back out of SQLite, so a row can
  // outlive the build that wrote it.
  it('treats an unrecognised status as a generic failure rather than ignoring it', () => {
    expect(syncFailureKind('some_future_status')).toBe('error')
  })
})
