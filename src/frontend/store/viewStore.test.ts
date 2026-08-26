// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { defaultFilters, useViewStore } from './viewStore'

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

describe('viewStore overlay toggles — localStorage stickiness', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useViewStore.setState({ showRelated: false, showHierarchy: false })
  })

  // These setters are the only writers of their localStorage keys, and no
  // other test reads them — a typo in the key name would silently stop the
  // preference from surviving a reload, with nothing failing.
  it('setShowHierarchy persists under ig-show-hierarchy', () => {
    useViewStore.getState().setShowHierarchy(true)
    expect(window.localStorage.getItem('ig-show-hierarchy')).toBe('1')
    useViewStore.getState().setShowHierarchy(false)
    expect(window.localStorage.getItem('ig-show-hierarchy')).toBe('0')
  })

  it('setShowRelated persists under ig-show-related', () => {
    useViewStore.getState().setShowRelated(true)
    expect(window.localStorage.getItem('ig-show-related')).toBe('1')
  })

  it('the two toggles do not share a key', () => {
    useViewStore.getState().setShowHierarchy(true)
    expect(window.localStorage.getItem('ig-show-related')).toBeNull()
    expect(useViewStore.getState().showRelated).toBe(false)
  })
})

describe('viewStore — label group / orphan filter toggles', () => {
  beforeEach(() => {
    useViewStore.setState({ filters: { ...defaultFilters } })
  })

  it('toggleGroupLabel adds an id under its group name', () => {
    useViewStore.getState().toggleGroupLabel('Platform', 'l1')
    expect(useViewStore.getState().filters.groupSelections).toEqual({ Platform: ['l1'] })
  })

  it('toggleGroupLabel removes an already-selected id', () => {
    useViewStore.getState().toggleGroupLabel('Platform', 'l1')
    useViewStore.getState().toggleGroupLabel('Platform', 'l1')
    expect(useViewStore.getState().filters.groupSelections).toEqual({ Platform: [] })
  })

  it('toggleGroupLabel leaves other groups untouched', () => {
    useViewStore.getState().toggleGroupLabel('Platform', 'l1')
    useViewStore.getState().toggleGroupLabel('Severity', 'l2')
    expect(useViewStore.getState().filters.groupSelections).toEqual({
      Platform: ['l1'],
      Severity: ['l2'],
    })
  })

  it('toggleOrphan flips an id in the flat orphan list', () => {
    useViewStore.getState().toggleOrphan('l9')
    expect(useViewStore.getState().filters.orphanValues).toEqual(['l9'])
    useViewStore.getState().toggleOrphan('l9')
    expect(useViewStore.getState().filters.orphanValues).toEqual([])
  })
})

describe('viewStore.toggleStateType — the state tree', () => {
  beforeEach(() => {
    useViewStore.setState({ filters: defaultFilters })
  })

  // Names refine within their own type, so switching a type OFF has to take
  // its children with it — leaving them behind would keep matching issues of a
  // type the user just unchecked.
  it('drops the names belonging to a type being switched off', () => {
    useViewStore.setState({
      filters: {
        ...defaultFilters,
        stateTypes: ['started', 'unstarted'],
        stateNames: ['unstarted::Todo', 'started::In Progress'],
      },
    })
    useViewStore.getState().toggleStateType('unstarted')
    const f = useViewStore.getState().filters
    expect(f.stateTypes).toEqual(['started'])
    // Only the unchecked type's children go; the other branch is independent,
    // which is the whole point of the tree.
    expect(f.stateNames).toEqual(['started::In Progress'])
  })

  it('leaves names untouched when switching a type on', () => {
    useViewStore.setState({
      filters: { ...defaultFilters, stateTypes: [], stateNames: ['unstarted::Todo'] },
    })
    useViewStore.getState().toggleStateType('started')
    expect(useViewStore.getState().filters.stateNames).toEqual(['unstarted::Todo'])
  })

  // Pre-existing sibling behaviour, pinned here so the two clears stay together.
  it('clears activeOnly when switching on a non-active state', () => {
    useViewStore.setState({ filters: { ...defaultFilters, activeOnly: true, stateTypes: [] } })
    useViewStore.getState().toggleStateType('completed')
    expect(useViewStore.getState().filters.activeOnly).toBe(false)
  })

  it('keeps activeOnly when switching a non-active state back off', () => {
    useViewStore.setState({
      filters: { ...defaultFilters, activeOnly: true, stateTypes: ['completed'] },
    })
    useViewStore.getState().toggleStateType('completed')
    expect(useViewStore.getState().filters.activeOnly).toBe(true)
  })
})
