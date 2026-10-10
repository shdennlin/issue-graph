import { describe, expect, it } from 'vitest'
import { tabLabel, workspaceHue, type TabLabelState } from './tabLabel'

const base: TabLabelState = {
  activeView: 'dependency',
  focusedId: null,
  focusedWorkstreamId: null,
  savedViewName: null,
}
const names = (id: number) => (id === 18 ? 'mlx-tool-choice-implementation' : null)

describe('tabLabel', () => {
  it('names a focused workstream by its name', () => {
    expect(tabLabel({ ...base, activeView: 'workstream', focusedWorkstreamId: 18 }, names)).toEqual({
      kind: 'workstream',
      id: 18,
      name: 'mlx-tool-choice-implementation',
    })
  })

  it('keeps the id when the name is not in reach, so the caller can fall back to #id', () => {
    expect(tabLabel({ ...base, activeView: 'workstream', focusedWorkstreamId: 7 }, names)).toEqual({
      kind: 'workstream',
      id: 7,
      name: null,
    })
  })

  it('names the workstream overview as such', () => {
    expect(tabLabel({ ...base, activeView: 'workstream' }, names)).toEqual({ kind: 'workstreams' })
  })

  it('ignores a leftover focused issue in the workstream view, which draws no issues', () => {
    expect(tabLabel({ ...base, activeView: 'workstream', focusedId: 'ONE-1' }, names)).toEqual({ kind: 'workstreams' })
  })

  it('names a tab on an issue by the issue — what a Raycast jump sets', () => {
    expect(tabLabel({ ...base, focusedId: 'ONE-395', savedViewName: 'Mine' }, names)).toEqual({
      kind: 'issue',
      identifier: 'ONE-395',
    })
  })

  it('falls back to the saved view, then to the view itself', () => {
    expect(tabLabel({ ...base, activeView: 'mix', savedViewName: 'Mine' }, names)).toEqual({ kind: 'saved', name: 'Mine' })
    expect(tabLabel({ ...base, activeView: 'mix' }, names)).toEqual({ kind: 'view', view: 'mix' })
  })
})

describe('workspaceHue', () => {
  it('is stable for a workspace and in range', () => {
    expect(workspaceHue('onelegion')).toBe(workspaceHue('onelegion'))
    expect(workspaceHue('onelegion')).toBeGreaterThanOrEqual(0)
    expect(workspaceHue('onelegion')).toBeLessThan(360)
  })

  it('tells two workspaces apart', () => {
    expect(workspaceHue('onelegion')).not.toBe(workspaceHue('verse'))
  })
})
