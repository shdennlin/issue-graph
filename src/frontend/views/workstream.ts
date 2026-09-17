// Workstream view — one container per feature in flight.
//
// The panel answers "which of my features is stuck" as a list; this answers it
// as a picture, with the cards themselves showing each issue's stage, its Linear
// state, and whether a session is on it. Same containers as the project and mix
// views, so nothing new had to be invented for the layout.
//
// Two ways it differs from project, both because membership here is explicit
// rather than a property of the issue:
//
// 1. An issue can belong to SEVERAL workstreams. React Flow keys nodes by id and
//    a node has one parent, so it is drawn in the first workstream that claims
//    it and listed nowhere else. Duplicating the card would duplicate its edges
//    and make the blocks graph read wrong, which is worse than the omission —
//    the shared issue is still findable, just drawn once.
// 2. Issues in no workstream are dropped, not bucketed into "(none)". Project
//    view keeps orphans because every issue has a project slot; a workstream is
//    something someone deliberately grouped, so "everything else" is the whole
//    backlog and would bury the four containers that matter.

import type { Edge, Node } from 'reactflow'
import type { ViewDefinition } from './types'
import { issueNodeHeight } from './types'
import { applyFilters } from './filters'
import { computeConnectivity } from './connectivity'
import { computeHierarchyCounts } from './hierarchy'
import { chooseColumnCount, packIntoColumns } from './containerLayout'
import { buildChainLayout } from './chainLayout'
import { rollupProgress } from '../lib/issueProgress'

const PADDING = 30
const HEADER = 32
const NODE_W = 320
const GAP_Y = 14
const GAP_X = 30
const INNER_GAP_X = 16
const ROW_GAP = 30

function computeContainerWidth(cols: number): number {
  return PADDING * 2 + NODE_W * cols + INNER_GAP_X * Math.max(0, cols - 1)
}
const MAX_ROW_WIDTH = computeContainerWidth(1) * 4 + GAP_X * 3

const COLOR = 'var(--accent)'

export const workstreamView: ViewDefinition = {
  id: 'workstream',
  label: 'Workstreams',
  description: 'One container per workstream — the features currently in flight.',
  build(ctx) {
    const {
      data,
      filters,
      staleDays,
      myUserName,
      selection,
      focusedId,
      chainRootIds,
      density,
      maxColsPerRow,
      search,
      measuredHeights,
    } = ctx

    // Chain mode dissolves the containers, as every container view does — the
    // chain is the subject then, not the grouping.
    if (chainRootIds.length > 0) return buildChainLayout(ctx, () => null)

    const NODE_H = issueNodeHeight(density)
    const heightFor = (id: string) => measuredHeights?.get(id) ?? NODE_H
    const conn = computeConnectivity(data.issues)
    const hier = computeHierarchyCounts(data.issues)

    const visible = applyFilters(data.issues, filters, staleDays, myUserName, search, focusedId)
    const byId = new Map(visible.map((i) => [i.identifier, i]))

    const streams = data.workstreams ?? []
    const claimed = new Set<string>()
    const buckets = streams
      .map((ws) => {
        const issues = ws.members
          // Filtered-out members simply are not drawn — the view respects the
          // filter bar like every other view rather than overriding it.
          .map((id) => byId.get(id))
          .filter((i): i is NonNullable<typeof i> => i !== undefined)
          // First workstream to claim an issue draws it. See the header note.
          .filter((i) => !claimed.has(i.identifier))
        for (const i of issues) claimed.add(i.identifier)
        return { ws, issues }
      })
      // A workstream whose members are all filtered out draws nothing, so it is
      // dropped rather than left as an empty box implying it has no work.
      .filter((b) => b.issues.length > 0)

    const nodes: Node[] = []
    let rowY = 0
    let rowMaxH = 0
    let rowWidth = 0

    for (const { ws, issues } of buckets) {
      const cols = chooseColumnCount(issues.length, maxColsPerRow)
      const containerW = computeContainerWidth(cols)
      const heights = issues.map((iss) => ({ id: iss.identifier, h: heightFor(iss.identifier) }))
      const { placed, maxColumnHeight } = packIntoColumns(heights, cols, GAP_Y)
      const containerHeight = HEADER + PADDING / 2 + maxColumnHeight + PADDING / 2

      if (rowWidth > 0 && rowWidth + GAP_X + containerW > MAX_ROW_WIDTH) {
        rowY += rowMaxH + ROW_GAP
        rowMaxH = 0
        rowWidth = 0
      }
      const xOffset = rowWidth === 0 ? 0 : rowWidth + GAP_X
      rowMaxH = Math.max(rowMaxH, containerHeight)
      rowWidth = xOffset + containerW

      const containerId = `workstream:${ws.id}`
      const { done, total } = rollupProgress(issues)
      nodes.push({
        id: containerId,
        type: 'mixedContainer',
        data: {
          bucket: {
            id: String(ws.id),
            name: ws.name,
            color: COLOR,
            count: issues.length,
            // Issue-state progress, NOT the workstream's claim/done counters.
            // The two answer different questions — "how much of this feature is
            // finished in Linear" versus "how far has the agent queue got" — and
            // the container header is asking the first.
            progress: { done, total },
            projectId: null,
          },
        },
        position: { x: xOffset, y: rowY },
        width: containerW,
        height: containerHeight,
        style: { width: containerW, height: containerHeight },
      })

      issues.forEach((iss, i) => {
        const id = iss.identifier
        const p = placed[i]!
        nodes.push({
          id,
          type: 'issue',
          data: {
            issue: iss,
            focused: focusedId === id,
            selected: selection.includes(id),
            isChainRoot: chainRootIds.includes(id),
            connectivity: conn.get(id),
            hierarchy: hier.get(id),
          },
          parentNode: containerId,
          position: {
            x: PADDING + p.col * (NODE_W + INNER_GAP_X),
            y: HEADER + PADDING / 2 + p.y,
          },
          width: NODE_W,
          height: p.h,
        })
      })
    }

    // Edges only between drawn nodes. A `blocks` edge leaving the workstream
    // has nothing to point at here — the panel reports those as blockers in
    // text, which is the honest place for a relation the picture cannot show.
    const drawn = new Set(nodes.filter((n) => n.type === 'issue').map((n) => n.id))
    const edges: Edge[] = []
    for (const id of drawn) {
      const issue = byId.get(id)
      if (!issue) continue
      for (const r of issue.relations) {
        if (r.type !== 'blocks' || !drawn.has(r.targetIdentifier)) continue
        edges.push({ id: `${id}->${r.targetIdentifier}`, source: id, target: r.targetIdentifier })
      }
    }

    return { nodes, edges }
  },
}
