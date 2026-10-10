import { describe, expect, it } from 'vitest'
import { isJumpArrival, routeJump } from './previewTab'

describe('routeJump', () => {
  it('stays put when there are no tabs yet', () => {
    expect(routeJump([], null)).toEqual({ kind: 'stay' })
  })

  it('creates a preview tab when none exists, leaving the active tab alone', () => {
    expect(routeJump([{ id: 'a' }, { id: 'b' }], 'a')).toEqual({ kind: 'create' })
  })

  it('reuses the existing preview tab rather than opening another', () => {
    const tabs = [{ id: 'a' }, { id: 'p', preview: true }]
    expect(routeJump(tabs, 'a')).toEqual({ kind: 'reuse', tabId: 'p' })
  })

  it('stays when the preview tab is already the active one', () => {
    const tabs = [{ id: 'a' }, { id: 'p', preview: true }]
    expect(routeJump(tabs, 'p')).toEqual({ kind: 'stay' })
  })

  it('creates a new preview once the old one has been kept', () => {
    const tabs = [{ id: 'a' }, { id: 'p', preview: false }]
    expect(routeJump(tabs, 'a')).toEqual({ kind: 'create' })
  })
})

describe('isJumpArrival', () => {
  const q = (s: string) => new URLSearchParams(s)

  it('treats a protocol-handler launch as a jump', () => {
    expect(isJumpArrival(q('proto=web%2Bissuegraph%3A%2F%2Fone%2FONE-1'))).toBe(true)
  })

  it('treats a marked focus or chain link as a jump', () => {
    expect(isJumpArrival(q('w=one&focus=ONE-1&detail=1&peek=1'))).toBe(true)
    expect(isJumpArrival(q('w=one&chain=ONE-1&peek=1'))).toBe(true)
  })

  it("does not treat the app's own focus URL as a jump — a reload must stay in its tab", () => {
    expect(isJumpArrival(q('w=one&focus=ONE-1&view=mix'))).toBe(false)
  })

  it('ignores the mark when the link pins nothing', () => {
    expect(isJumpArrival(q('w=one&peek=1'))).toBe(false)
  })
})
