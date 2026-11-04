// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { useViewStore } from './viewStore'
import { useWorkspaceStore } from './workspaceStore'
import { registerViewportBridge, switchToTab, forgetTab, peekTabViewport, loadTab } from './tabStateStore'

// Regression: the Quick Switcher called setActiveTab directly and never
// snapshotted the tab it was leaving, so coming back restored an OLDER
// viewport (or none) and the camera landed in empty space.
describe('switchToTab', () => {
  let live = { x: 0, y: 0, zoom: 1 }
  let restored: unknown = null
  let unregister: () => void

  beforeEach(() => {
    localStorage.clear()
    forgetTab('a')
    forgetTab('b')
    live = { x: 0, y: 0, zoom: 1 }
    restored = null
    unregister = registerViewportBridge(
      () => live,
      (vp) => { restored = vp },
      () => {},
    )
    useWorkspaceStore.setState({
      tabs: [{ id: 'a', workspaceId: 'w' }, { id: 'b', workspaceId: 'w' }],
      activeTabId: 'a',
      currentWorkspaceId: 'w',
    })
    useViewStore.setState({ activeView: 'workstream' })
  })

  it('saves the leaving tab’s live viewport before activating the target', () => {
    live = { x: -500, y: -300, zoom: 0.9 }
    switchToTab('b')
    expect(useWorkspaceStore.getState().activeTabId).toBe('b')
    expect(peekTabViewport('a')).toEqual({ x: -500, y: -300, zoom: 0.9 })
    unregister()
  })

  it('restores that viewport when coming back', () => {
    live = { x: -500, y: -300, zoom: 0.9 }
    switchToTab('b')
    live = { x: 10, y: 20, zoom: 1.2 }
    switchToTab('a')
    expect(peekTabViewport('b')).toEqual({ x: 10, y: 20, zoom: 1.2 })
    // App.tsx's effect runs loadTab on activeTabId change; emulate it.
    loadTab('a')
    expect(restored).toEqual({ x: -500, y: -300, zoom: 0.9 })
    unregister()
  })

  it('clears a queued restore when the next tab has none to restore', () => {
    live = { x: -500, y: -300, zoom: 0.9 }
    switchToTab('b')           // a saved; b has no snapshot yet
    loadTab('a')               // queues a's viewport
    expect(restored).not.toBeNull()
    // b has no snapshot: the canvas must be told to drop a's queued viewport.
    loadTab('b')
    expect(restored).toBeNull()
  })

  it('is a no-op when the target is already active', () => {
    live = { x: 1, y: 2, zoom: 1 }
    switchToTab('a')
    expect(peekTabViewport('a')).toBeNull()
    unregister()
  })
})
