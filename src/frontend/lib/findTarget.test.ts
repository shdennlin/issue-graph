import { describe, it, expect } from 'vitest'
import { findTarget } from './findTarget'

const base = { panelOpen: false, pointerOverPanel: false, focusInPanel: false, focusInCanvas: true }

describe('findTarget', () => {
  it('opens the canvas finder when nothing else claims the keystroke', () => {
    expect(findTarget(base)).toBe('canvas')
  })

  // The reported bug: body is the active element after clicking panel text.
  it('leaves find to the browser when the pointer is over the open detail panel', () => {
    expect(findTarget({ ...base, panelOpen: true, pointerOverPanel: true })).toBe('native')
  })

  it('leaves find to the browser when focus is inside the detail panel', () => {
    expect(findTarget({ ...base, panelOpen: true, focusInPanel: true, focusInCanvas: false })).toBe('native')
  })

  it('still opens the canvas finder with the panel open when the pointer is on the canvas', () => {
    expect(findTarget({ ...base, panelOpen: true })).toBe('canvas')
  })

  it('leaves find to the browser when focus is in the toolbar or a modal', () => {
    expect(findTarget({ ...base, focusInCanvas: false })).toBe('native')
  })
})
