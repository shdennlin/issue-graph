// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { useViewStore } from './viewStore'

describe('viewStore.setFocusedId — detailPanelOpen behavior', () => {
  beforeEach(() => {
    useViewStore.setState({
      focusedId: null,
      detailPanelOpen: false,
      detailPanelAutoOpen: false,
    })
  })

  it('auto-open ON: focusing an issue opens the panel', () => {
    useViewStore.setState({ detailPanelAutoOpen: true })
    useViewStore.getState().setFocusedId('A')
    expect(useViewStore.getState().detailPanelOpen).toBe(true)
  })

  it('auto-open OFF + panel closed: focusing leaves the panel closed', () => {
    useViewStore.getState().setFocusedId('A')
    expect(useViewStore.getState().detailPanelOpen).toBe(false)
  })

  it('auto-open OFF + panel manually opened: switching focus keeps panel open', () => {
    useViewStore.setState({ focusedId: 'A', detailPanelOpen: true })
    useViewStore.getState().setFocusedId('B')
    const s = useViewStore.getState()
    expect(s.focusedId).toBe('B')
    expect(s.detailPanelOpen).toBe(true)
  })

  it('clearing focus (id=null) closes the panel even when it was open', () => {
    useViewStore.setState({ focusedId: 'A', detailPanelOpen: true })
    useViewStore.getState().setFocusedId(null)
    expect(useViewStore.getState().detailPanelOpen).toBe(false)
  })
})

describe('viewStore.openProjectPanel / closeProjectPanel — panel mutex', () => {
  beforeEach(() => {
    useViewStore.setState({
      focusedId: null,
      detailPanelOpen: false,
      detailPanelAutoOpen: false,
      focusedProjectId: null,
      projectPanelOpen: false,
    })
  })

  it('openProjectPanel sets focusedProjectId + opens the panel', () => {
    useViewStore.getState().openProjectPanel('proj-1')
    const s = useViewStore.getState()
    expect(s.focusedProjectId).toBe('proj-1')
    expect(s.projectPanelOpen).toBe(true)
  })

  it('openProjectPanel closes a currently-open issue detail panel (mutex)', () => {
    useViewStore.setState({ focusedId: 'A', detailPanelOpen: true })
    useViewStore.getState().openProjectPanel('proj-1')
    const s = useViewStore.getState()
    expect(s.projectPanelOpen).toBe(true)
    expect(s.detailPanelOpen).toBe(false)
    // focusedId preserved — only the panel visibility flips.
    expect(s.focusedId).toBe('A')
  })

  it('setFocusedId that opens the detail panel closes a currently-open project panel (mutex)', () => {
    useViewStore.setState({
      detailPanelAutoOpen: true,
      focusedProjectId: 'proj-1',
      projectPanelOpen: true,
    })
    useViewStore.getState().setFocusedId('B')
    const s = useViewStore.getState()
    expect(s.detailPanelOpen).toBe(true)
    expect(s.projectPanelOpen).toBe(false)
  })

  it('closeProjectPanel clears both focusedProjectId and visibility', () => {
    useViewStore.setState({ focusedProjectId: 'proj-1', projectPanelOpen: true })
    useViewStore.getState().closeProjectPanel()
    const s = useViewStore.getState()
    expect(s.projectPanelOpen).toBe(false)
    expect(s.focusedProjectId).toBeNull()
  })
})
