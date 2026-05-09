import type { Edge, Node } from 'reactflow'
import type { ViewDefinition } from './types'
import { issueNodeHeight } from './types'
import { applyFilters } from './filters'
import { computeConnectivity } from './connectivity'

const PADDING = 30
const HEADER = 32
const NODE_W = 320
const GAP_Y = 14
const GAP_X = 30
const CONTAINER_W = NODE_W + PADDING * 2

// Neutral color for the project container header. Projects don't have
// a label-schema color the way buckets do (the label schema is
// label-based, not project-based), so we render them in a uniform
// muted gray to signal "this is a structural grouping, not a category".
const PROJECT_COLOR = 'var(--fg-muted)'
const NO_PROJECT_KEY = '__noproject'

export const projectView: ViewDefinition = {
  id: 'project',
  label: 'Project',
  description: 'Linear projects as containers + issues inside. Cross-project edges highlighted.',
  build({ data, filters, staleDays, myUserName, focusedId, density, search, measuredHeights }) {
    const NODE_H = issueNodeHeight(density)
    const issues = applyFilters(data.issues, filters, staleDays, myUserName, search)
    const conn = computeConnectivity(data.issues)
    const heightFor = (id: string): number => measuredHeights?.get(id) ?? NODE_H

    const buckets = new Map<string, { name: string; color: string; issues: typeof issues }>()
    for (const i of issues) {
      const key = i.project?.id ?? NO_PROJECT_KEY
      const name = i.project?.name ?? '(No project)'
      if (!buckets.has(key)) buckets.set(key, { name, color: PROJECT_COLOR, issues: [] })
      buckets.get(key)!.issues.push(i)
    }

    // Sort: largest projects first, "(No project)" pinned last regardless of size
    // — orphan issues are noise relative to actual project work.
    const ordered = [...buckets.entries()].sort((a, b) => {
      if (a[0] === NO_PROJECT_KEY) return 1
      if (b[0] === NO_PROJECT_KEY) return -1
      return b[1].issues.length - a[1].issues.length
    })

    const COLS = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(ordered.length))))
    const ROW_GAP = 30
    const nodes: Node[] = []
    const issueToProject = new Map<string, string>()
    let rowY = 0
    let rowMaxH = 0
    ordered.forEach(([key, b], idx) => {
      const col = idx % COLS
      if (col === 0 && idx > 0) {
        rowY += rowMaxH + ROW_GAP
        rowMaxH = 0
      }
      const issuePositions: Array<{ id: string; y: number; h: number }> = []
      let cursorY = HEADER + PADDING / 2
      b.issues.forEach((iss, i) => {
        const h = heightFor(iss.identifier)
        issuePositions.push({ id: iss.identifier, y: cursorY, h })
        cursorY += h
        if (i < b.issues.length - 1) cursorY += GAP_Y
      })
      const containerHeight = cursorY + PADDING / 2
      rowMaxH = Math.max(rowMaxH, containerHeight)
      const containerId = `project:${key}`
      const xOffset = col * (CONTAINER_W + GAP_X)
      nodes.push({
        id: containerId,
        type: 'mixedContainer',
        data: { bucket: { id: key, name: b.name, color: b.color, count: b.issues.length } },
        position: { x: xOffset, y: rowY },
        width: CONTAINER_W,
        height: containerHeight,
        style: { width: CONTAINER_W, height: containerHeight },
      })
      b.issues.forEach((iss, i) => {
        const id = iss.identifier
        const pos = issuePositions[i]!
        nodes.push({
          id,
          type: 'issue',
          data: { issue: iss, focused: focusedId === id, connectivity: conn.get(id) },
          parentNode: containerId,
          extent: 'parent',
          position: { x: PADDING, y: pos.y },
          width: NODE_W,
          height: pos.h,
        })
        issueToProject.set(id, key)
      })
    })

    const issueIds = new Set(issues.map((i) => i.identifier))
    const edges: Edge[] = []
    for (const i of issues) {
      for (const r of i.relations) {
        if (r.type !== 'blocks') continue
        if (!issueIds.has(r.targetIdentifier)) continue
        const cross = issueToProject.get(i.identifier) !== issueToProject.get(r.targetIdentifier)
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
