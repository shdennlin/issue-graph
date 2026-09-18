import { describe, expect, it } from 'vitest'
import type {
  DetectedSchema,
  GraphData,
  LifecycleStageDTO,
  NormalizedIssue,
  WorkstreamSummaryDTO,
} from '@shared/types.js'
import type { Filters } from '../store/viewStore'
import type { StageNodeData } from '../components/nodes/StageNode'
import type { ViewContext } from './types'
import { buildFocused, buildOverview, stageNodeHeight, workstreamView } from './workstream'

const DAY = 86_400_000

function stage(key: string, over: Partial<LifecycleStageDTO> = {}): LifecycleStageDTO {
  return {
    id: 1,
    key,
    name: key,
    sortOrder: 0,
    states: [],
    nextCommand: null,
    shows: [],
    staleAfterDays: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

function ws(id: number, over: Partial<WorkstreamSummaryDTO> = {}): WorkstreamSummaryDTO {
  return {
    id,
    name: `W${id}`,
    members: [],
    stage: null,
    stageEnteredAt: null,
    status: 'active',
    assignees: [],
    notes: {},
    links: [],
    ...over,
  }
}

function issue(identifier: string): NormalizedIssue {
  return {
    id: identifier,
    identifier,
    title: identifier,
    url: '',
    priority: 0,
    state: { name: 'In Progress', type: 'started' },
    assignee: null,
    labels: [],
    parent: null,
    children: [],
    relations: [],
    createdAt: '',
    updatedAt: '',
    completedAt: null,
  }
}

const d = (n: { data: unknown }) => n.data as StageNodeData

function ctx(over: Partial<ViewContext> = {}): ViewContext {
  const { data: dataOver, ...rest } = over
  const data: GraphData = { issues: [], labels: [], fetchedAt: 0, ...dataOver }
  return {
    data,
    schema: {} as DetectedSchema,
    filters: {} as Filters,
    staleDays: 14,
    myUserId: null,
    myUserName: null,
    selection: [],
    focusedId: null,
    chainRootIds: [],
    chainDepthUp: null,
    chainDepthDown: null,
    showRelated: false,
    showHierarchy: false,
    density: 'default',
    maxColsPerRow: 4,
    search: '',
    mixGroupBy: null,
    focusedWorkstreamId: null,
    ...rest,
  }
}

describe('overview — where everyone is standing', () => {
  const stages = [stage('discuss', { sortOrder: 0 }), stage('impl', { sortOrder: 1 })]

  it('numbers stages from 1 in sortOrder, whatever order they arrive in', () => {
    const nodes = buildOverview([], [stages[1]!, stages[0]!].sort((a, b) => a.sortOrder - b.sortOrder))
    expect(nodes.map((n) => [d(n).ordinal, d(n).name])).toEqual([
      [1, 'discuss'],
      [2, 'impl'],
    ])
  })

  it('puts an unstaged workstream in a slot before the pipeline, not nowhere', () => {
    // A workstream someone created and never staged is exactly the one at risk
    // of being forgotten. Dropping it would also make this view disagree with
    // the Workstreams panel about how many exist.
    const nodes = buildOverview([ws(1)], stages)
    expect(d(nodes[0]!)).toMatchObject({ ordinal: 0, placeholder: 'notStarted' })
    expect(d(nodes[0]!).streams.map((s) => s.name)).toEqual(['W1'])
  })

  it('draws no such slot when nobody is unstaged', () => {
    const nodes = buildOverview([ws(1, { stage: 'impl' })], stages)
    expect(nodes.map((n) => d(n).ordinal)).toEqual([1, 2])
  })

  it('keeps a workstream whose stage was deleted from the lifecycle', () => {
    // Deleting a stage must not take the workstreams standing on it off the
    // board — they would simply stop existing here with nothing to explain it.
    const nodes = buildOverview([ws(1, { stage: 'retired-stage' })], stages)
    expect(d(nodes[0]!).placeholder).toBe('notStarted')
    expect(d(nodes[0]!).streams).toHaveLength(1)
  })

  it('marks a stage current when anyone is on it, and not otherwise', () => {
    const nodes = buildOverview([ws(1, { stage: 'impl' })], stages)
    expect(nodes.map((n) => d(n).current)).toEqual([false, true])
  })

  it('counts days on the stage and flags the ones past their own threshold', () => {
    // Per stage, because the honest answer differs wildly: a Discuss stage can
    // legitimately run for a fortnight, CI sitting for a day is wrong.
    const streams = [ws(1, { stage: 'discuss', stageEnteredAt: Date.now() - 6 * DAY })]
    const lenient = buildOverview(streams, [stage('discuss', { staleAfterDays: null })])
    const strict = buildOverview(streams, [stage('discuss', { staleAfterDays: 5 })])
    expect(d(lenient[0]!).streams[0]).toMatchObject({ days: 6, stale: false })
    expect(d(strict[0]!).streams[0]).toMatchObject({ days: 6, stale: true })
    expect(d(strict[0]!).stale).toBe(true)
  })

  it('grows the node with the number of workstreams on it', () => {
    const one = buildOverview([ws(1, { stage: 'impl' })], stages)
    const three = buildOverview(
      [ws(1, { stage: 'impl' }), ws(2, { stage: 'impl' }), ws(3, { stage: 'impl' })],
      stages,
    )
    expect(three[1]!.height!).toBeGreaterThan(one[1]!.height!)
  })
})

describe('focused — one workstream across the whole pipeline', () => {
  const stages = [stage('discuss', { sortOrder: 0 }), stage('impl', { sortOrder: 1, shows: ['issues'] })]

  it('draws every stage, not only the one it is on', () => {
    // The point of the row is seeing what is behind and ahead; drawing only the
    // current stage would answer a question the panel already answers.
    const nodes = buildFocused(ws(1, { stage: 'impl' }), stages, ctx())
    expect(nodes).toHaveLength(2)
  })

  it('dates only the stage it is actually on', () => {
    // `stageEnteredAt` times the CURRENT occupancy, so putting it on any other
    // stage would date a stay that is not happening.
    const w = ws(1, { stage: 'impl', stageEnteredAt: Date.now() - 2 * DAY })
    const nodes = buildFocused(w, stages, ctx())
    expect(d(nodes[0]!)).toMatchObject({ current: false, daysHere: null })
    expect(d(nodes[1]!)).toMatchObject({ current: true, daysHere: 2 })
  })

  it('never marks a stage stale when the workstream is not on it', () => {
    const w = ws(1, { stage: 'discuss', stageEnteredAt: Date.now() - 99 * DAY })
    const nodes = buildFocused(w, [stage('discuss'), stage('impl', { staleAfterDays: 1 })], ctx())
    expect(d(nodes[1]!).stale).toBe(false)
  })

  it('resolves members from the cache and sizes the stage by what it will draw', () => {
    const w = ws(1, { stage: 'impl', members: ['A-1', 'A-2'] })
    const nodes = buildFocused(w, stages, ctx({ data: { issues: [issue('A-1'), issue('A-2')], labels: [], fetchedAt: 0 } }))
    expect(d(nodes[1]!).render?.members.map((m) => m.identifier)).toEqual(['A-1', 'A-2'])
    expect(nodes[1]!.height).toBe(stageNodeHeight(2))
  })

  it('sizes a stage for its missing members too, because they are still drawn', () => {
    // An uncached member is listed as missing rather than dropped, so it takes
    // a row — and a height computed without it would overlap the next node.
    const w = ws(1, { stage: 'impl', members: ['A-1', 'GONE-9'] })
    const nodes = buildFocused(w, stages, ctx({ data: { issues: [issue('A-1')], labels: [], fetchedAt: 0 } }))
    expect(nodes[1]!.height).toBe(stageNodeHeight(2))
  })
})

describe('the view as a whole', () => {
  it('says the pipeline is unconfigured rather than drawing an empty canvas', () => {
    // A blank canvas reads as "nothing is happening" when the truth is
    // "nothing is configured", and those want different actions.
    const { nodes, edges } = workstreamView.build(ctx({ data: { issues: [], labels: [], fetchedAt: 0, workstreams: [ws(1)] } }))
    expect(nodes).toHaveLength(1)
    expect((nodes[0]!.data as StageNodeData).placeholder).toBe('noStages')
    expect(edges).toEqual([])
  })

  it('leaves archived workstreams off the board', () => {
    const { nodes } = workstreamView.build(
      ctx({
        data: {
          issues: [],
          labels: [],
          fetchedAt: 0,
          lifecycle: [stage('impl')],
          workstreams: [ws(1, { stage: 'impl' }), ws(2, { stage: 'impl', status: 'archived' })],
        },
      }),
    )
    expect((nodes[0]!.data as StageNodeData).streams.map((s) => s.id)).toEqual([1])
  })

  it('chains the stages in pipeline order so a wrapped row still reads as one sequence', () => {
    const { edges } = workstreamView.build(
      ctx({
        data: {
          issues: [],
          labels: [],
          fetchedAt: 0,
          lifecycle: [stage('a', { sortOrder: 0 }), stage('b', { sortOrder: 1 }), stage('c', { sortOrder: 2 })],
          workstreams: [],
        },
      }),
    )
    expect(edges.map((e) => `${e.source}>${e.target}`)).toEqual(['stage:a>stage:b', 'stage:b>stage:c'])
  })

  it('expands the workstream named by focusedWorkstreamId', () => {
    const base = {
      issues: [],
      labels: [],
      fetchedAt: 0,
      lifecycle: [stage('impl')],
      workstreams: [ws(7, { stage: 'impl' })],
    }
    const overview = workstreamView.build(ctx({ data: base }))
    const focused = workstreamView.build(ctx({ data: base, focusedWorkstreamId: 7 }))
    expect((overview.nodes[0]!.data as StageNodeData).render).toBeNull()
    expect((focused.nodes[0]!.data as StageNodeData).render).not.toBeNull()
  })

  it('falls back to the overview when the focused workstream is gone', () => {
    // A stale `?stream=` in a bookmark must not blank the view.
    const { nodes } = workstreamView.build(
      ctx({
        focusedWorkstreamId: 999,
        data: { issues: [], labels: [], fetchedAt: 0, lifecycle: [stage('impl')], workstreams: [ws(1)] },
      }),
    )
    expect((nodes[0]!.data as StageNodeData).render).toBeNull()
  })
})
