import { describe, it, expect } from 'vitest'
import { isValidWorkspaceId, slugifyWorkspaceName } from './workspaceSlug.js'

describe('slugifyWorkspaceName', () => {
  it('lowercases and joins words with dashes', () => {
    expect(slugifyWorkspaceName('Acme Inc.')).toBe('acme-inc')
    expect(slugifyWorkspaceName('OneLegion')).toBe('onelegion')
  })

  it('collapses runs of separators rather than repeating dashes', () => {
    expect(slugifyWorkspaceName('a   b')).toBe('a-b')
    expect(slugifyWorkspaceName('a__/__b')).toBe('a-b')
  })

  it('trims leading and trailing separators', () => {
    expect(slugifyWorkspaceName('  Acme  ')).toBe('acme')
    expect(slugifyWorkspaceName('---Acme---')).toBe('acme')
  })

  it('drops non-latin characters rather than passing them through', () => {
    expect(slugifyWorkspaceName('客戶 A')).toBe('a')
  })

  it('returns empty when nothing usable survives, instead of inventing an id', () => {
    expect(slugifyWorkspaceName('客戶')).toBe('')
    expect(slugifyWorkspaceName('!!!')).toBe('')
    expect(slugifyWorkspaceName('')).toBe('')
  })

  // Truncating at the length cap can leave a trailing dash, which the id rules
  // do not forbid but which looks like a typo in a URL.
  it('never emits a trailing dash after truncation', () => {
    const out = slugifyWorkspaceName('a'.repeat(63) + ' bcd')
    expect(out.endsWith('-')).toBe(false)
    expect(out.length).toBeLessThanOrEqual(64)
  })

  // The whole point of the helper: whatever it produces must be submittable.
  it('always produces something the id rules accept', () => {
    for (const name of ['Acme Inc.', 'OneLegion', '  spaced  ', 'a'.repeat(80), 'Client / A']) {
      const slug = slugifyWorkspaceName(name)
      if (slug === '') continue
      expect(isValidWorkspaceId(slug), `${name} -> ${slug}`).toBe(true)
    }
  })
})

describe('isValidWorkspaceId', () => {
  it('matches the backend rules', () => {
    expect(isValidWorkspaceId('onelegion')).toBe(true)
    expect(isValidWorkspaceId('client-a')).toBe(true)
    expect(isValidWorkspaceId('..')).toBe(false)
    expect(isValidWorkspaceId('a/b')).toBe(false)
    expect(isValidWorkspaceId('A')).toBe(false)
    expect(isValidWorkspaceId('-lead')).toBe(false)
    expect(isValidWorkspaceId('active')).toBe(false)
    expect(isValidWorkspaceId('')).toBe(false)
  })
})
