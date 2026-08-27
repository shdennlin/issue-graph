import { describe, expect, it } from 'vitest'
import type { Edge } from 'reactflow'
import type { DetectedSchema, GraphData, NormalizedIssue } from '@shared/types.js'
import type { Filters } from '../store/viewStore'
import type { ViewContext } from './types'
import { dependencyView } from './dependency'

function mk(
  id: string,
  opts: { blocks?: string[]; parent?: string | null; children?: string[] } = {},
): NormalizedIssue {
  return {
    id,
    identifier: id,
    title: id,
    url: '',
    priority: 0,
    state: { name: 'Backlog', type: 'backlog' },
    assignee: null,
    labels: [],
    parent: opts.parent ?? null,
    children: opts.children ?? [],
    relations: (opts.blocks ?? []).map((t) => ({ type: 'blocks' as const, targetIdentifier: t })),
    createdAt: '',
    updatedAt: '',
    completedAt: null,
  }
}

const emptyFilters: Filters = {
  stateTypes: [],
  stateNames: [],
  recencyWindow: 'any',
  recencyMode: 'updated',
  negated: [],
  activeOnly: false,
  myIssuesOnly: false,
  staleOnly: false,
  primaryValues: [],
  typeValues: [],
  priorities: [],
  assignees: [],
  prefixSelections: {},
  groupSelections: {},
  orphanValues: [],
  designdocFilter: 'all',
  dueFilter: 'any',
  projectIds: [],
  milestoneIds: [],
}

const emptySchema: DetectedSchema = {
  primaryGroup: null,
  typeGroup: null,
  prefixes: [],
  orphans: [],
  otherGroups: [],
}

function ctx(issues: NormalizedIssue[], overrides: Partial<ViewContext> = {}): ViewContext {
  const data: GraphData = { issues, labels: [], fetchedAt: 0 }
  return {
    data,
    schema: emptySchema,
    filters: emptyFilters,
    staleDays: 30,
    myUserId: null,
    myUserName: null,
    selection: [],
    focusedId: null,
    chainRootIds: [],
    mixGroupBy: null,
    chainDepthUp: null,
    chainDepthDown: null,
    showRelated: false,
    showHierarchy: false,
    density: 'default',
    maxColsPerRow: 4,
    search: '',
    ...overrides,
  }
}

function hierEdges(edges: Edge[]): Edge[] {
  return edges.filter((e) => (e.data as { relationType?: string } | undefined)?.relationType === 'hierarchy')
}

describe('dependencyView hierarchy edges', () => {
  it('draws no hierarchy edges when the toggle is off', () => {
    const issues = [mk('P', { children: ['C'] }), mk('C', { parent: 'P' })]
    expect(hierEdges(dependencyView.build(ctx(issues)).edges)).toEqual([])
  })

  it('draws a parent→child edge when the toggle is on', () => {
    const issues = [mk('P', { children: ['C'] }), mk('C', { parent: 'P' })]
    const edges = hierEdges(dependencyView.build(ctx(issues, { showHierarchy: true })).edges)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ source: 'P', target: 'C' })
  })

  it('emits one edge per link even though both endpoints declare it', () => {
    // P.children lists C and C.parent points back at P — the same link seen
    // from both sides. Without dedup this would render as a double stroke.
    const issues = [mk('P', { children: ['C'] }), mk('C', { parent: 'P' })]
    const edges = hierEdges(dependencyView.build(ctx(issues, { showHierarchy: true })).edges)
    expect(edges.map((e) => e.id)).toEqual(['hier:P->C'])
  })

  it('still draws the link when only the child knows about it', () => {
    // children(first: 20) can truncate the parent's list while the child
    // still carries `parent` — the edge must survive that.
    const issues = [mk('P'), mk('C', { parent: 'P' })]
    const edges = hierEdges(dependencyView.build(ctx(issues, { showHierarchy: true })).edges)
    expect(edges.map((e) => e.id)).toEqual(['hier:P->C'])
  })

  it('skips links whose other end is not rendered', () => {
    const issues = [mk('P', { children: ['GHOST'] })]
    expect(hierEdges(dependencyView.build(ctx(issues, { showHierarchy: true })).edges)).toEqual([])
  })

  it('carries no arrowhead — an arrow would read as a dependency', () => {
    const issues = [mk('P', { children: ['C'] }), mk('C', { parent: 'P' })]
    const edges = hierEdges(dependencyView.build(ctx(issues, { showHierarchy: true })).edges)
    // The key must be PRESENT and undefined, not merely absent: React Flow
    // spreads defaultEdgeOptions before the edge object, so an absent key
    // lets the default arrowhead through. Asserting only `toBeUndefined()`
    // would pass in both cases and catch nothing.
    expect(Object.prototype.hasOwnProperty.call(edges[0]!, 'markerEnd')).toBe(true)
    expect(edges[0]!.markerEnd).toBeUndefined()
  })

  it('uses the dedicated hierarchy stroke, not the blocks or related color', () => {
    const issues = [mk('P', { children: ['C'] }), mk('C', { parent: 'P' })]
    const edges = hierEdges(dependencyView.build(ctx(issues, { showHierarchy: true })).edges)
    expect(edges[0]!.style?.stroke).toBe('var(--edge-hierarchy)')
  })

  it('leaves blocks edges untouched when hierarchy is on', () => {
    const issues = [mk('A', { blocks: ['B'], children: ['B'] }), mk('B', { parent: 'A' })]
    const all = dependencyView.build(ctx(issues, { showHierarchy: true })).edges
    const blocks = all.filter((e) => (e.data as { relationType?: string })?.relationType === 'blocks')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ id: 'A->B', markerEnd: { type: 'arrowclosed' } })
  })
})
