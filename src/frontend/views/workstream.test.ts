import { describe, expect, it } from 'vitest'
import type { Node } from 'reactflow'
import type {
  DetectedSchema,
  GraphData,
  LifecycleStageDTO,
  WorkstreamSummaryDTO,
} from '@shared/types.js'
import type { Filters } from '../store/viewStore'
import type { StageNodeData } from '../components/nodes/StageNode'
import type { ViewContext } from './types'
import { serpentine, workstreamView } from './workstream'

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
    stageEvents: [],
    note: null,
    createdAt: 0,
    updatedAt: 0,
    archivedAt: null,
    status: 'active',
    assignees: [],
    notes: {},
    links: [],
    ...over,
  }
}

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

describe('the view as a whole', () => {
  it('says the pipeline is unconfigured rather than drawing an empty canvas', () => {
    // A blank canvas reads as "nothing is happening" when the truth is
    // "nothing is configured", and those want different actions.
    const { nodes, edges } = workstreamView.build(
      ctx({ data: { issues: [], labels: [], fetchedAt: 0, workstreams: [ws(1)] } }),
    )
    expect(nodes).toHaveLength(1)
    expect((nodes[0]!.data as StageNodeData).placeholder).toBe('noStages')
    expect(edges).toEqual([])
  })

  it('draws nothing but the pipeline when no workstream exists yet', () => {
    const { nodes } = workstreamView.build(
      ctx({ data: { issues: [], labels: [], fetchedAt: 0, lifecycle: [stage('impl')], workstreams: [] } }),
    )
    expect(nodes).toEqual([])
  })
})

describe('one container per workstream', () => {
  const lifecycle = [
    stage('discuss', { sortOrder: 0 }),
    stage('impl', { sortOrder: 1, shows: ['issues'] }),
  ]

  const build = (over: Partial<GraphData> = {}, focused: number | null = null) =>
    workstreamView.build(
      ctx({ focusedWorkstreamId: focused, data: { issues: [], labels: [], fetchedAt: 0, lifecycle, ...over } }),
    )

  const containers = (nodes: Node[]) => nodes.filter((n) => n.type === 'mixedContainer')

  it('draws every workstream, each with the whole pipeline inside it', () => {
    // The earlier cut drew ONE shared pipeline with workstreams as name chips,
    // which answered "who is where" and nothing else.
    const { nodes } = build({ workstreams: [ws(1, { stage: 'impl' }), ws(2, { stage: 'discuss' })] })
    expect(containers(nodes)).toHaveLength(2)
    const stages = nodes.filter((n) => n.type === 'stage')
    expect(stages).toHaveLength(4)
    expect(stages.every((n) => typeof n.parentNode === 'string')).toBe(true)
  })

  it('keeps each workstream on its own pipeline, with no edge between them', () => {
    const { edges } = build({ workstreams: [ws(1), ws(2)] })
    expect(edges).toHaveLength(2)
    for (const e of edges) {
      expect(e.source.split('/')[0]).toBe(e.target.split('/')[0])
    }
  })

  it('stacks the containers so two workstreams cannot overlap', () => {
    const { nodes } = build({ workstreams: [ws(1), ws(2)] })
    const [a, b] = containers(nodes)
    expect(b!.position.y).toBeGreaterThanOrEqual(a!.position.y + (a!.height ?? 0))
  })

  it('isolates to one workstream when focusedWorkstreamId is set', () => {
    const { nodes } = build({ workstreams: [ws(1), ws(2)] }, 2)
    expect(containers(nodes)).toHaveLength(1)
    expect(nodes[0]!.id).toBe('workstream:2')
  })

  it('falls back to every workstream when the isolated one is gone', () => {
    // A stale `?stream=` in a bookmark must not look like "no workstreams
    // exist", which is a different and much more alarming thing.
    const { nodes } = build({ workstreams: [ws(1), ws(2)] }, 999)
    expect(containers(nodes)).toHaveLength(2)
  })

  it('leaves archived workstreams off the board entirely', () => {
    const { nodes } = build({ workstreams: [ws(1), ws(2, { status: 'archived' })] })
    expect(containers(nodes)).toHaveLength(1)
  })
})

describe('time on every stage, not just the current one', () => {
  const lifecycle = [stage('discuss', { sortOrder: 0 }), stage('impl', { sortOrder: 1 })]
  const NOW_DAYS = (n: number) => Date.now() - n * DAY

  const stageNodes = (w: WorkstreamSummaryDTO) =>
    workstreamView
      .build(ctx({ data: { issues: [], labels: [], fetchedAt: 0, lifecycle, workstreams: [w] } }))
      .nodes.filter((n) => n.type === 'stage')
      .map((n) => n.data as StageNodeData)

  it('dates a stage the workstream has already left', () => {
    // This is the whole point of the history table: before it, six of seven
    // stages were blank and the picture showed a position without a journey.
    const w = ws(1, {
      stage: 'impl',
      stageEnteredAt: NOW_DAYS(2),
      stageEvents: [
        { stageKey: 'discuss', at: NOW_DAYS(5) },
        { stageKey: 'impl', at: NOW_DAYS(2) },
      ],
    })
    const [discuss, impl] = stageNodes(w)
    expect(discuss).toMatchObject({ visited: true, age: { value: 3, unit: 'd' }, current: false })
    expect(impl).toMatchObject({ visited: true, age: { value: 2, unit: 'd' }, current: true })
  })

  it('leaves a stage it has never reached undated', () => {
    // `visited` is what separates "arrived today, 0 days" from "never been" —
    // `daysHere: 0` cannot say which.
    const w = ws(1, { stage: 'discuss', stageEvents: [{ stageKey: 'discuss', at: Date.now() }] })
    const [discuss, impl] = stageNodes(w)
    expect(discuss).toMatchObject({ visited: true, age: { value: 0, unit: 'm' } })
    expect(impl).toMatchObject({ visited: false, age: null })
  })

  it('counts a second lap rather than averaging it away', () => {
    const w = ws(1, {
      stage: 'discuss',
      stageEvents: [
        { stageKey: 'discuss', at: NOW_DAYS(9) },
        { stageKey: 'impl', at: NOW_DAYS(6) },
        { stageKey: 'discuss', at: NOW_DAYS(1) },
      ],
    })
    const [discuss] = stageNodes(w)
    expect(discuss).toMatchObject({ visits: 2, age: { value: 1, unit: 'd' }, current: true })
  })

  it('never marks a stage stale when the workstream is not on it', () => {
    const w = ws(1, {
      stage: 'discuss',
      stageEnteredAt: NOW_DAYS(99),
      stageEvents: [{ stageKey: 'discuss', at: NOW_DAYS(99) }],
    })
    const nodes = workstreamView.build(
      ctx({
        data: {
          issues: [],
          labels: [],
          fetchedAt: 0,
          lifecycle: [stage('discuss'), stage('impl', { sortOrder: 1, staleAfterDays: 1 })],
          workstreams: [w],
        },
      }),
    ).nodes.filter((n) => n.type === 'stage')
    expect((nodes[1]!.data as StageNodeData).stale).toBe(false)
  })
})

describe('serpentine layout', () => {
  it('runs every other row backwards so the flow never jumps back to the margin', () => {
    //   0 → 1 → 2 → 3
    //               ↓
    //   7 ← 6 ← 5 ← 4
    const cols = 4
    expect([0, 1, 2, 3].map((i) => serpentine(i, cols))).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: 2 },
      { row: 0, col: 3 },
    ])
    expect([4, 5, 6, 7].map((i) => serpentine(i, cols))).toEqual([
      { row: 1, col: 3 },
      { row: 1, col: 2 },
      { row: 1, col: 1 },
      { row: 1, col: 0 },
    ])
  })

  it('puts the row break directly below its predecessor, so the drop is vertical', () => {
    const cols = 4
    expect(serpentine(3, cols).col).toBe(serpentine(4, cols).col)
    expect(serpentine(7, cols).col).toBe(serpentine(8, cols).col)
  })

  it('degrades to a single column', () => {
    expect([0, 1, 2].map((i) => serpentine(i, 1))).toEqual([
      { row: 0, col: 0 },
      { row: 1, col: 0 },
      { row: 2, col: 0 },
    ])
  })
})

describe('wrapping honours the Issues-per-row setting', () => {
  const lifecycle = Array.from({ length: 6 }, (_, i) => stage(`s${i}`, { sortOrder: i }))

  const layout = (maxColsPerRow: number) => {
    const { nodes, edges } = workstreamView.build(
      ctx({
        maxColsPerRow,
        data: { issues: [], labels: [], fetchedAt: 0, lifecycle, workstreams: [ws(1, { stage: 's0' })] },
      }),
    )
    return { container: nodes.find((n) => n.type === 'mixedContainer')!, edges }
  }

  it('narrows the container and adds rows as the setting drops', () => {
    const wide = layout(6)
    const narrow = layout(3)
    expect(narrow.container.width!).toBeLessThan(wide.container.width!)
    expect(narrow.container.height!).toBeGreaterThan(wide.container.height!)
  })

  it('drops straight down at a row break and sideways within a row', () => {
    // The handles are picked per edge; getting this wrong sends the row-break
    // edge out of the side and across the whole container.
    // Three per row, and the NOTES card takes cell 0 — so row 0 is
    // [notes, s0, s1] and row 1 is [s4, s3, s2] read right-to-left.
    const { edges } = layout(3)
    expect(edges[0]).toMatchObject({ sourceHandle: 's-r', targetHandle: 't-l' })
    expect(edges[1]).toMatchObject({ sourceHandle: 's-b', targetHandle: 't-t' })
    // Second row runs right-to-left, so it leaves the LEFT side.
    expect(edges[2]).toMatchObject({ sourceHandle: 's-l', targetHandle: 't-r' })
  })
})
