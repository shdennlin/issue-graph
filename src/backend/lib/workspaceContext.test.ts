import { describe, expect, it } from 'vitest'
import {
  getCurrentWorkspaceId,
  LEGACY_WORKSPACE_ID,
  runWithWorkspace,
} from './workspaceContext.js'

describe('workspaceContext', () => {
  it('returns null outside any runWithWorkspace block', () => {
    expect(getCurrentWorkspaceId()).toBeNull()
  })

  it('exposes the id inside runWithWorkspace', () => {
    runWithWorkspace('client_a', () => {
      expect(getCurrentWorkspaceId()).toBe('client_a')
    })
  })

  it('isolates concurrent async branches by their own context', async () => {
    // Two parallel async chains, each tagged with a different workspace id.
    // Without proper AsyncLocalStorage isolation they would clobber each
    // other; assert that each chain's microtasks see its own id.
    const seen: Array<{ tag: string; wid: string | null }> = []
    await Promise.all([
      runWithWorkspace('a', async () => {
        await Promise.resolve()
        seen.push({ tag: 'first', wid: getCurrentWorkspaceId() })
      }),
      runWithWorkspace('b', async () => {
        await Promise.resolve()
        seen.push({ tag: 'second', wid: getCurrentWorkspaceId() })
      }),
    ])
    expect(seen.find((e) => e.tag === 'first')?.wid).toBe('a')
    expect(seen.find((e) => e.tag === 'second')?.wid).toBe('b')
  })

  it('supports nested runs (inner overrides outer for its scope)', () => {
    runWithWorkspace('outer', () => {
      expect(getCurrentWorkspaceId()).toBe('outer')
      runWithWorkspace('inner', () => {
        expect(getCurrentWorkspaceId()).toBe('inner')
      })
      expect(getCurrentWorkspaceId()).toBe('outer')
    })
  })

  it('restores prior context after the block returns', () => {
    runWithWorkspace('temp', () => {
      expect(getCurrentWorkspaceId()).toBe('temp')
    })
    expect(getCurrentWorkspaceId()).toBeNull()
  })

  it('exposes a stable LEGACY_WORKSPACE_ID sentinel', () => {
    expect(LEGACY_WORKSPACE_ID).toBe('__legacy__')
  })
})
