import { describe, it, expect } from 'vitest'
import { resolveRecents } from './resolveRecents'
import type { Candidate, RecentItem } from './types'

const live = (tabId: string, identifier: string, scope = 'Alpha'): Candidate => ({
  kind: 'issue', id: `${tabId}:${identifier}`, label: `${identifier} live`, identifier,
  tabId, scopeLabel: scope, hint: '', state: { name: 'Done', type: 'completed' },
})
const recent = (tabId: string, identifier: string, scope = 'Alpha'): RecentItem => ({
  id: `${tabId}:${identifier}`, kind: 'issue', label: `${identifier} stale`, tabId, scopeLabel: scope, ref: identifier,
})
const fallback = (r: RecentItem): Candidate => ({
  kind: 'issue', id: r.id, label: r.label, identifier: String(r.ref), tabId: r.tabId, scopeLabel: r.scopeLabel, hint: '',
})

describe('resolveRecents', () => {
  it('finds the live candidate even when the recent was saved from another tab', () => {
    const [c] = resolveRecents([recent('closedTab', 'ONE-1')], [live('t1', 'ONE-1')], fallback)
    expect(c).toMatchObject({ id: 't1:ONE-1', label: 'ONE-1 live' })
    expect((c as any).state).toBeDefined()
  })

  it('does not cross workspaces that share an identifier', () => {
    const [c] = resolveRecents([recent('x', 'ONE-1', 'Beta')], [live('t1', 'ONE-1', 'Alpha')], fallback)
    expect(c!.label).toBe('ONE-1 stale')
  })

  it('falls back to the stored record when the issue is no longer a candidate', () => {
    const [c] = resolveRecents([recent('x', 'ONE-9')], [live('t1', 'ONE-1')], fallback)
    expect(c!.label).toBe('ONE-9 stale')
  })

  it('lists an issue once when it was opened from two tabs', () => {
    const out = resolveRecents([recent('a', 'ONE-1'), recent('b', 'ONE-1')], [live('t1', 'ONE-1')], fallback)
    expect(out).toHaveLength(1)
  })

  it('keeps recents in order', () => {
    const out = resolveRecents([recent('a', 'ONE-2'), recent('a', 'ONE-1')], [live('t1', 'ONE-1'), live('t1', 'ONE-2')], fallback)
    expect(out.map((c) => (c as any).identifier)).toEqual(['ONE-2', 'ONE-1'])
  })
})
