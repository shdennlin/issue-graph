// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { useQuickSwitcherStore } from './quickSwitcherStore'
import type { RecentItem } from '../components/quickSwitcher/types'

const sample = (id: string, label = id): RecentItem => ({
  id, kind: 'issue', label, tabId: 't1', scopeLabel: 'Alpha', ref: label,
})

describe('quickSwitcherStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useQuickSwitcherStore.setState({ open: false, recents: [] })
  })

  it('opens and closes the palette', () => {
    useQuickSwitcherStore.getState().openPalette()
    expect(useQuickSwitcherStore.getState().open).toBe(true)
    useQuickSwitcherStore.getState().closePalette()
    expect(useQuickSwitcherStore.getState().open).toBe(false)
  })

  it('pushes recents most-recent-first, deduped, capped at 8', () => {
    const { pushRecent } = useQuickSwitcherStore.getState()
    for (let i = 0; i < 10; i++) pushRecent(sample(`a${i}`))
    const ids = useQuickSwitcherStore.getState().recents.map((r) => r.id)
    expect(ids).toHaveLength(8)
    expect(ids[0]).toBe('a9')
  })

  it('moves an existing recent to the front on re-push', () => {
    const { pushRecent } = useQuickSwitcherStore.getState()
    pushRecent(sample('a'))
    pushRecent(sample('b'))
    pushRecent(sample('a'))
    const ids = useQuickSwitcherStore.getState().recents.map((r) => r.id)
    expect(ids).toEqual(['a', 'b'])
  })

  it('persists recents to localStorage', () => {
    useQuickSwitcherStore.getState().pushRecent(sample('a'))
    const raw = localStorage.getItem('issue-graph-quick-switcher-recents')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!).recents[0].id).toBe('a')
  })
})
