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
