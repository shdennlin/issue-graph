import type { Edge, Node } from 'reactflow'
import type { ViewDefinition } from './types'
import { issueNodeHeight } from './types'
import { applyFilters } from './filters'
import { computeConnectivity } from './connectivity'
import { chooseColumnCount, packIntoColumns } from './containerLayout'
import { projectColor } from '../lib/projectColor'
import { buildChainLayout } from './chainLayout'
import { fanOutCurvatures } from './edgeStyle'

const PADDING = 30
const HEADER = 32
const NODE_W = 320
const GAP_Y = 14
const GAP_X = 30
const INNER_GAP_X = 16
function computeContainerWidth(cols: number): number {
  return PADDING * 2 + NODE_W * cols + INNER_GAP_X * Math.max(0, cols - 1)
}
const MAX_ROW_WIDTH = computeContainerWidth(1) * 4 + GAP_X * 3

// Falls back to muted gray when a project has no Linear color set, or for
// the synthetic '(No project)' bucket. Real project colors come from
// NormalizedIssue.project.color (Linear hex) and pass through as-is so the
// tint matches the color the user sees in the Linear app.
const FALLBACK_COLOR = 'var(--fg-muted)'
const NO_PROJECT_KEY = '__noproject'

export const projectView: ViewDefinition = {
  id: 'project',
  label: 'Project',
  description: 'Linear projects as containers + issues inside. Cross-project edges highlighted.',
  build(ctx) {
    const { data, filters, staleDays, myUserName, focusedId, chainRootId, density, maxColsPerRow, search, measuredHeights } = ctx
    // Chain mode: dissolve project containers and switch to dagre — project
    // membership is preserved as a 4px left stripe on each card so the user
    // still sees which project each chain member belongs to.
    if (chainRootId) {
      return buildChainLayout(ctx, (issue) => {
        if (!issue.project?.id) return null
        const color = projectColor(issue.project.id, issue.project.color, FALLBACK_COLOR)
        if (color === FALLBACK_COLOR) return null
        return { color, label: issue.project.name }
      })
    }
    const NODE_H = issueNodeHeight(density)
    const issues = applyFilters(data.issues, filters, staleDays, myUserName, search)
    const conn = computeConnectivity(data.issues)
    const heightFor = (id: string): number => measuredHeights?.get(id) ?? NODE_H

    const buckets = new Map<string, { name: string; color: string; issues: typeof issues }>()
    for (const i of issues) {
      const key = i.project?.id ?? NO_PROJECT_KEY
      const name = i.project?.name ?? '(No project)'
      const color = projectColor(i.project?.id, i.project?.color, FALLBACK_COLOR)
      if (!buckets.has(key)) buckets.set(key, { name, color, issues: [] })
      buckets.get(key)!.issues.push(i)
    }

    // Sort: largest projects first, "(No project)" pinned last regardless of size
    // — orphan issues are noise relative to actual project work.
    const ordered = [...buckets.entries()].sort((a, b) => {
      if (a[0] === NO_PROJECT_KEY) return 1
      if (b[0] === NO_PROJECT_KEY) return -1
      return b[1].issues.length - a[1].issues.length
    })

    const ROW_GAP = 30
    const nodes: Node[] = []
    const issueToProject = new Map<string, string>()
    let rowY = 0
    let rowMaxH = 0
    let rowWidth = 0
    ordered.forEach(([key, b]) => {
      const cols = chooseColumnCount(b.issues.length, maxColsPerRow)
      const containerW = computeContainerWidth(cols)
      const heights = b.issues.map((iss) => ({ id: iss.identifier, h: heightFor(iss.identifier) }))
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

      const containerId = `project:${key}`
      // 'done' counts only completed (excludes canceled — matches the
      // semantics used by milestone view).
      const done = b.issues.filter((iss) => iss.state.type === 'completed').length
      nodes.push({
        id: containerId,
        type: 'mixedContainer',
        data: {
          bucket: {
            id: key,
            name: b.name,
            color: b.color,
            count: b.issues.length,
            progress: { done, total: b.issues.length },
          },
        },
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
          // Intentionally NOT setting `extent: 'parent'` — issues should be
          // free to be dragged outside their container if the user wants to
          // rearrange. The container still tints the area they started in,
          // so the visual association is preserved on first paint. Drag
          // positions are reset on re-layout (density change, view switch).
          position: {
            x: PADDING + p.col * (NODE_W + INNER_GAP_X),
            y: HEADER + PADDING / 2 + p.y,
          },
          width: NODE_W,
          height: p.h,
        })
        issueToProject.set(id, key)
      })
    })

    const issueIds = new Set(issues.map((i) => i.identifier))
    const curvatures = fanOutCurvatures(issues, issueIds)
    const edges: Edge[] = []
    for (const i of issues) {
      for (const r of i.relations) {
        if (r.type !== 'blocks') continue
        if (!issueIds.has(r.targetIdentifier)) continue
        const cross = issueToProject.get(i.identifier) !== issueToProject.get(r.targetIdentifier)
        const edgeId = `${i.identifier}->${r.targetIdentifier}`
        edges.push({
          // See mix.ts / edgeStyle.ts for bezier + fan-out rationale.
          type: 'default',
          pathOptions: { curvature: curvatures.get(edgeId) ?? 0.4 },
          id: edgeId,
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
