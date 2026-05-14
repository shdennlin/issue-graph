import type { Edge, Node } from 'reactflow'
import type { ViewDefinition } from './types'
import { issueNodeHeight } from './types'
import { applyFilters } from './filters'
import { computeChain } from './chain'
import { getPrimaryLabel } from '../lib/labelSchema'
import { computeConnectivity } from './connectivity'
import { chooseColumnCount, packIntoColumns } from './containerLayout'

const PADDING = 30
const HEADER = 32
// Card CSS width is 320 — keep this in sync so issues fit cleanly inside the
// container without spilling past its right edge.
const NODE_W = 320
const GAP_Y = 14
const GAP_X = 30
// Gap between columns inside a multi-column container. Smaller than GAP_X
// (which separates whole containers) so the columns read as part of the
// same group rather than as adjacent containers.
const INNER_GAP_X = 16
function computeContainerWidth(cols: number): number {
  return PADDING * 2 + NODE_W * cols + INNER_GAP_X * Math.max(0, cols - 1)
}
// Max row width for outer grid wrapping. Keep close to the old "4 buckets
// per row" cap so the canvas-wide layout shape doesn't surprise users who
// got used to the previous behavior.
const MAX_ROW_WIDTH = computeContainerWidth(1) * 4 + GAP_X * 3

export const mixView: ViewDefinition = {
  id: 'mix',
  label: 'Mix',
  description: 'Buckets as containers + issues inside. Cross-bucket edges highlighted.',
  build({ data, schema, filters, staleDays, myUserName, focusedId, chainRootId, showRelated, density, search, measuredHeights }) {
    const NODE_H = issueNodeHeight(density)
    // Chain isolation: when a root is set, replace user filters with the
    // chain's connected component — mirrors the dependency-view behavior
    // so an off-state blocker doesn't fragment the chain across views.
    let issues
    if (chainRootId) {
      const { members } = computeChain(data.issues, chainRootId, {
        includeRelatedNeighbors: showRelated,
      })
      issues = data.issues.filter((i) => members.has(i.identifier))
    } else {
      issues = applyFilters(data.issues, filters, staleDays, myUserName, search)
    }
    const conn = computeConnectivity(data.issues)
    // Per-issue height resolver — measured value when available (post-paint
    // re-layout pass), density estimate otherwise. Same mechanism as the
    // dependency view; without this, tall cards (long titles + many chips)
    // overlap within their bucket because we stack them at NODE_H steps.
    const heightFor = (id: string): number => measuredHeights?.get(id) ?? NODE_H

    const buckets = new Map<string, { name: string; color: string; issues: typeof issues }>()
    for (const i of issues) {
      const lab = getPrimaryLabel(i, schema)
      const key = lab?.id ?? '__unclassified'
      const name = lab?.name ?? 'Unclassified'
      const color = lab?.color ?? '#888'
      if (!buckets.has(key)) buckets.set(key, { name, color, issues: [] })
      buckets.get(key)!.issues.push(i)
    }

    const ordered = [...buckets.entries()].sort((a, b) => b[1].issues.length - a[1].issues.length)

    // Outer grid: pack buckets row-by-row using each one's actual width
    // (which now varies based on its issue count → column count). Wrap to
    // a new row when the next bucket would overflow MAX_ROW_WIDTH. Each
    // row starts below the tallest container of the previous row so a
    // giant bucket doesn't push the next row down absurdly.
    const ROW_GAP = 30
    const nodes: Node[] = []
    const issueToBucket = new Map<string, string>()
    let rowY = 0
    let rowMaxH = 0
    let rowWidth = 0
    ordered.forEach(([key, b]) => {
      // Pack issues into N columns inside this bucket so a long list
      // doesn't become an unscannable vertical strip.
      const cols = chooseColumnCount(b.issues.length)
      const containerW = computeContainerWidth(cols)
      const heights = b.issues.map((iss) => ({ id: iss.identifier, h: heightFor(iss.identifier) }))
      const { placed, maxColumnHeight } = packIntoColumns(heights, cols, GAP_Y)
      const containerHeight = HEADER + PADDING / 2 + maxColumnHeight + PADDING / 2

      // Wrap to next row if this bucket wouldn't fit in the current row.
      if (rowWidth > 0 && rowWidth + GAP_X + containerW > MAX_ROW_WIDTH) {
        rowY += rowMaxH + ROW_GAP
        rowMaxH = 0
        rowWidth = 0
      }
      const xOffset = rowWidth === 0 ? 0 : rowWidth + GAP_X
      rowMaxH = Math.max(rowMaxH, containerHeight)
      rowWidth = xOffset + containerW

      const containerId = `bucket:${key}`
      nodes.push({
        id: containerId,
        type: 'mixedContainer',
        data: { bucket: { id: key, name: b.name, color: b.color, count: b.issues.length } },
        position: { x: xOffset, y: rowY },
        width: containerW,
        height: containerHeight,
        style: { width: containerW, height: containerHeight },
      })
      b.issues.forEach((iss, i) => {
        const id = iss.identifier
        const p = placed[i]!
        nodes.push({
          id,
          type: 'issue',
          data: {
            issue: iss,
            focused: focusedId === id,
            isChainRoot: chainRootId === id,
            connectivity: conn.get(id),
          },
          parentNode: containerId,
          extent: 'parent',
          position: {
            x: PADDING + p.col * (NODE_W + INNER_GAP_X),
            y: HEADER + PADDING / 2 + p.y,
          },
          width: NODE_W,
          height: p.h,
        })
        issueToBucket.set(id, key)
      })
    })

    const issueIds = new Set(issues.map((i) => i.identifier))
    const edges: Edge[] = []
    for (const i of issues) {
      for (const r of i.relations) {
        if (r.type !== 'blocks') continue
        if (!issueIds.has(r.targetIdentifier)) continue
        const cross = issueToBucket.get(i.identifier) !== issueToBucket.get(r.targetIdentifier)
        edges.push({
          id: `${i.identifier}->${r.targetIdentifier}`,
          source: i.identifier,
          target: r.targetIdentifier,
          className: cross ? 'cross-bucket-edge' : undefined,
          data: { crossBucket: cross },
        })
      }
    }

    return { nodes, edges }
  },
}
