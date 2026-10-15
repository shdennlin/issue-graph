import { describe, expect, it } from 'vitest'
import type { Edge } from 'reactflow'
import type { DetectedSchema, GraphData, NormalizedIssue } from '@shared/types.js'
import type { Filters } from '../store/viewStore'
import type { ViewContext } from './types'
import { dependencyView } from './dependency'

function mk(
  id: string,
  opts: {
    blocks?: string[]
    related?: string[]
    parent?: string | null
    children?: string[]
    stateType?: NormalizedIssue['state']['type']
  } = {},
): NormalizedIssue {
  return {
    id,
    identifier: id,
    title: id,
    url: '',
    priority: 0,
    state: { name: opts.stateType ?? 'Backlog', type: opts.stateType ?? 'backlog' },
    assignee: null,
    labels: [],
    parent: opts.parent ?? null,
    children: opts.children ?? [],
    relations: [
      ...(opts.blocks ?? []).map((t) => ({ type: 'blocks' as const, targetIdentifier: t })),
      ...(opts.related ?? []).map((t) => ({ type: 'related' as const, targetIdentifier: t })),
    ],
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
  recencyIgnoreLinked: true,
  negated: [],
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
    focusedWorkstreamId: null,
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

describe('dependencyView chain isolation and the state filter', () => {
  // The default State filter excludes completed/canceled. Chain mode used to
  // skip the filter bar wholesale, so a Done card rendered under a State panel
  // that said Done was hidden. The blocks WALK still has to see through Done
  // issues (an off-state blocker must not fragment the chain); only what gets
  // DRAWN is filtered.
  const activeOnly: Filters = { ...emptyFilters, stateTypes: ['unstarted', 'started', 'triage', 'backlog'] }
  const ids = (c: ViewContext) =>
    dependencyView
      .build(c)
      .nodes.map((n) => n.id)
      .sort()

  it('hides a Done member of the chain', () => {
    const issues = [mk('A', { blocks: ['B'] }), mk('B', { stateType: 'completed' })]
    expect(ids(ctx(issues, { filters: activeOnly, chainRootIds: ['A'] }))).toEqual(['A'])
  })

  it('walks THROUGH a Done blocker so the far side of the chain survives', () => {
    const issues = [
      mk('A', { blocks: ['B'] }),
      mk('B', { blocks: ['C'], stateType: 'completed' }),
      mk('C'),
    ]
    expect(ids(ctx(issues, { filters: activeOnly, chainRootIds: ['A'] }))).toEqual(['A', 'C'])
  })

  it('hides a Done related neighbour', () => {
    const issues = [mk('A', { related: ['R'] }), mk('R', { stateType: 'completed' })]
    expect(ids(ctx(issues, { filters: activeOnly, chainRootIds: ['A'], showRelated: true }))).toEqual(['A'])
  })

  it('hides a Done hierarchy neighbour', () => {
    const issues = [
      mk('A', { children: ['K'] }),
      mk('K', { parent: 'A', stateType: 'canceled' }),
    ]
    expect(ids(ctx(issues, { filters: activeOnly, chainRootIds: ['A'], showHierarchy: true }))).toEqual(['A'])
  })

  it('keeps a Done root: choosing it is an explicit act the filter must not overrule', () => {
    const issues = [mk('A', { blocks: ['B'], stateType: 'completed' }), mk('B')]
    expect(ids(ctx(issues, { filters: activeOnly, chainRootIds: ['A'] }))).toEqual(['A', 'B'])
  })

  it('honours a negated State facet', () => {
    const f: Filters = { ...emptyFilters, stateTypes: ['completed'], negated: ['state'] }
    const issues = [mk('A', { blocks: ['B'] }), mk('B', { stateType: 'completed' })]
    expect(ids(ctx(issues, { filters: f, chainRootIds: ['A'] }))).toEqual(['A'])
  })

  it('leaves every other filter ignored in chain mode', () => {
    // Only the state dimension is applied. A project filter that matches
    // nothing must not empty the chain.
    const f: Filters = { ...activeOnly, projectIds: ['nope'] }
    const issues = [mk('A', { blocks: ['B'] }), mk('B')]
    expect(ids(ctx(issues, { filters: f, chainRootIds: ['A'] }))).toEqual(['A', 'B'])
  })

  it('changes nothing when the State filter is empty', () => {
    const issues = [mk('A', { blocks: ['B'] }), mk('B', { stateType: 'completed' })]
    expect(ids(ctx(issues, { filters: emptyFilters, chainRootIds: ['A'] }))).toEqual(['A', 'B'])
  })
})
