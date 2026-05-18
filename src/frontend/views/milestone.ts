import type { Edge, Node } from 'reactflow'
import type { ViewDefinition } from './types'
import { issueNodeHeight } from './types'
import { applyFilters } from './filters'
import { computeConnectivity } from './connectivity'
import { chooseColumnCount, packIntoColumns } from './containerLayout'
import { projectColor } from '../lib/projectColor'
import { buildChainLayout } from './chainLayout'
import type { IssueStateType, NormalizedIssue } from '@shared/types.js'

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

// Same fallback contract as project view. Milestone buckets borrow the
// parent project's color so all milestones of the same project share a tint
// — visually clusters them, and reinforces cross-project edges as the
// boundary-crossing case.
const FALLBACK_COLOR = 'var(--fg-muted)'
// Sentinel for "this issue has a project but no milestone within it" —
// surfaces as a per-project "(No milestone)" bucket pinned last in the
// project's milestone list. Issues without a project are skipped entirely
// (milestone view's whole point is project/milestone structure).
const NO_MILESTONE_KEY = '__nomilestone'

// State sort order within a milestone bucket: actively-worked first, then
// queued, then waiting, then closed. Mirrors what Linear users skim for.
const STATE_RANK: Record<IssueStateType, number> = {
  started: 0,
  unstarted: 1,
  triage: 2,
  backlog: 3,
  completed: 4,
  canceled: 5,
}

interface MilestoneBucket {
  key: string
  projectId: string
  projectName: string
  projectColor: string
  milestoneId: string | null
  milestoneName: string
  milestoneSortOrder: number | null
  /** Linear ISO date string (YYYY-MM-DD) or null. Only set for real milestones,
   *  never for the per-project '(No milestone)' bucket. */
  milestoneTargetDate: string | null
  issues: NormalizedIssue[]
}

export const milestoneView: ViewDefinition = {
  id: 'milestone',
  label: 'Milestone',
  description:
    'Linear project milestones as containers. Issues without a project are hidden; per-project "(No milestone)" bucket holds the rest.',
  build(ctx) {
    const {
      data,
      filters,
      staleDays,
      myUserName,
      focusedId,
      chainRootId,
      density,
      search,
      measuredHeights,
    } = ctx
    // Chain mode: container/backdrop layout obscures dependency flow — switch
    // to dagre and keep project identity via a 4px left stripe on each card.
    if (chainRootId) {
      return buildChainLayout(ctx, (issue) => {
        if (!issue.project?.id) return null
        const color = projectColor(issue.project.id, issue.project.color, FALLBACK_COLOR)
        if (color === FALLBACK_COLOR) return null
        return { color, label: issue.project.name }
      })
    }
    const NODE_H = issueNodeHeight(density)
    let issues = applyFilters(data.issues, filters, staleDays, myUserName, search)
    // Milestone view is project-centric. Issues with no project carry no
    // structural signal here, so drop them before bucketing.
    issues = issues.filter((i) => i.project != null)
    const conn = computeConnectivity(data.issues)
    const heightFor = (id: string): number => measuredHeights?.get(id) ?? NODE_H

    const buckets = new Map<string, MilestoneBucket>()
    for (const i of issues) {
      const projId = i.project!.id
      const projName = i.project!.name
      const msId = i.projectMilestone?.id ?? null
      const msName = i.projectMilestone?.name ?? '(No milestone)'
      const msSort = i.projectMilestone?.sortOrder ?? null
      const key = `${projId}::${msId ?? NO_MILESTONE_KEY}`
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          projectId: projId,
          projectName: projName,
          projectColor: projectColor(i.project!.id, i.project!.color, FALLBACK_COLOR),
          milestoneId: msId,
          milestoneName: msName,
          milestoneSortOrder: msSort,
          milestoneTargetDate: i.projectMilestone?.targetDate ?? null,
          issues: [],
        })
      }
      buckets.get(key)!.issues.push(i)
    }

    // Sort issues inside each bucket: state rank → priority (urgent=1 first,
    // none=0 last) → identifier.
    for (const b of buckets.values()) {
      b.issues.sort((a, c) => {
        const sr = STATE_RANK[a.state.type] - STATE_RANK[c.state.type]
        if (sr !== 0) return sr
        // Linear priority: 0=none, 1=urgent, 2=high, 3=med, 4=low. Push 0 last.
        const ap = a.priority === 0 ? 99 : a.priority
        const cp = c.priority === 0 ? 99 : c.priority
        if (ap !== cp) return ap - cp
        return a.identifier.localeCompare(c.identifier)
      })
    }

    // Project ordering = largest project first (sum of issues across all its
    // milestones), matching project view's "biggest gets attention" rule.
    const projectSizes = new Map<string, number>()
    for (const b of buckets.values()) {
      projectSizes.set(b.projectId, (projectSizes.get(b.projectId) ?? 0) + b.issues.length)
    }

    const ordered = [...buckets.values()].sort((a, b) => {
      const pa = projectSizes.get(a.projectId) ?? 0
      const pb = projectSizes.get(b.projectId) ?? 0
      if (pa !== pb) return pb - pa
      // Same project: sortOrder asc; no-milestone bucket pinned last.
      if (a.projectId === b.projectId) {
        if (a.milestoneId === null) return 1
        if (b.milestoneId === null) return -1
        const sa = a.milestoneSortOrder ?? Number.POSITIVE_INFINITY
        const sb = b.milestoneSortOrder ?? Number.POSITIVE_INFINITY
        if (sa !== sb) return sa - sb
        return a.milestoneName.localeCompare(b.milestoneName)
      }
      // Different same-size projects: stable by name.
      return a.projectName.localeCompare(b.projectName)
    })

    // Per-project swimlane layout. Group buckets by project so each project's
    // milestones cluster vertically as a single horizontal band; cross-project
    // visual breaks (PROJECT_GAP) are much larger than within-project wraps
    // (ROW_GAP) so the eye can chunk "same project" without reading container
    // titles.
    const ROW_GAP = 30
    const PROJECT_GAP = 70
    // Frame around milestone containers — leaves room for the project name
    // label at the top and breathing space on the other three sides.
    const BACKDROP_HEADER = 44
    const BACKDROP_PAD = 18
    const groupedByProject = new Map<string, MilestoneBucket[]>()
    for (const b of ordered) {
      const list = groupedByProject.get(b.projectId) ?? []
      list.push(b)
      groupedByProject.set(b.projectId, list)
    }

    // Backdrops are collected separately and prepended below — React Flow
    // renders nodes in array order, so backdrops must appear first to sit
    // *behind* the milestone containers and issue cards.
    const backdrops: Node[] = []
    const nodes: Node[] = []
    const issueToBucket = new Map<string, string>()
    let cursorY = 0
    for (const group of groupedByProject.values()) {
      const projectTop = cursorY
      const contentStartY = projectTop + BACKDROP_HEADER
      const contentStartX = BACKDROP_PAD
      let rowY = contentStartY
      let rowMaxH = 0
      let rowWidth = 0
      let projectBottom = contentStartY
      let projectRight = contentStartX
      const firstBucket = group[0]!
      const projectColorVal = firstBucket.projectColor
      const projectName = firstBucket.projectName
      const projectIssueCount = group.reduce((sum, b) => sum + b.issues.length, 0)
      const projectDoneCount = group.reduce(
        (sum, b) => sum + b.issues.filter((iss) => iss.state.type === 'completed').length,
        0,
      )

      for (const b of group) {
        const cols = chooseColumnCount(b.issues.length)
        const containerW = computeContainerWidth(cols)
        const heights = b.issues.map((iss) => ({
          id: iss.identifier,
          h: heightFor(iss.identifier),
        }))
        const { placed, maxColumnHeight } = packIntoColumns(heights, cols, GAP_Y)
        const containerHeight = HEADER + PADDING / 2 + maxColumnHeight + PADDING / 2

        if (rowWidth > 0 && rowWidth + GAP_X + containerW > MAX_ROW_WIDTH) {
          rowY += rowMaxH + ROW_GAP
          rowMaxH = 0
          rowWidth = 0
        }
        const xOffset = rowWidth === 0 ? contentStartX : contentStartX + rowWidth + GAP_X
        rowMaxH = Math.max(rowMaxH, containerHeight)
        rowWidth = (rowWidth === 0 ? 0 : rowWidth + GAP_X) + containerW
        projectBottom = Math.max(projectBottom, rowY + containerHeight)
        projectRight = Math.max(projectRight, xOffset + containerW)

        // Title drops the project prefix — the backdrop carries the project
        // name now, repeating it on every container is just noise.
        const displayName = b.milestoneName
        const containerId = `milestone:${b.key}`
        const done = b.issues.filter((iss) => iss.state.type === 'completed').length
        nodes.push({
          id: containerId,
          type: 'mixedContainer',
          data: {
            bucket: {
              id: b.key,
              name: displayName,
              color: b.projectColor,
              count: b.issues.length,
              progress: { done, total: b.issues.length },
              targetDate: b.milestoneTargetDate,
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
            // See project.ts for the rationale on omitting `extent: 'parent'`.
            position: {
              x: PADDING + p.col * (NODE_W + INNER_GAP_X),
              y: HEADER + PADDING / 2 + p.y,
            },
            width: NODE_W,
            height: p.h,
          })
          issueToBucket.set(id, b.key)
        })
      }

      const backdropW = projectRight + BACKDROP_PAD
      const backdropH = projectBottom + BACKDROP_PAD - projectTop
      backdrops.push({
        id: `projectBackdrop:${firstBucket.projectId}`,
        type: 'projectBackdrop',
        data: {
          projectName,
          color: projectColorVal,
          done: projectDoneCount,
          total: projectIssueCount,
        },
        position: { x: 0, y: projectTop },
        width: backdropW,
        height: backdropH,
        style: { width: backdropW, height: backdropH },
        selectable: false,
        draggable: false,
      })

      cursorY = projectBottom + BACKDROP_PAD + PROJECT_GAP
    }

    // Edge classification (3-tier, ordered by severity):
    //   1. Same milestone bucket          → no class (default subtle stroke)
    //   2. Different milestone, same project → 'cross-milestone-edge' (orange
    //      dashed — sequencing warning: an issue is blocked by another in a
    //      later milestone of the same project)
    //   3. Different project              → 'cross-bucket-edge' (red solid —
    //      stronger signal; reuses the existing token shared with mix/project)
    const issueIds = new Set(issues.map((i) => i.identifier))
    const issueToProject = new Map<string, string>()
    for (const i of issues) issueToProject.set(i.identifier, i.project!.id)
    const edges: Edge[] = []
    for (const i of issues) {
      for (const r of i.relations) {
        if (r.type !== 'blocks') continue
        if (!issueIds.has(r.targetIdentifier)) continue
        const srcBucket = issueToBucket.get(i.identifier)
        const dstBucket = issueToBucket.get(r.targetIdentifier)
        const srcProj = issueToProject.get(i.identifier)
        const dstProj = issueToProject.get(r.targetIdentifier)
        let className: string | undefined
        let kind: 'same' | 'cross-milestone' | 'cross-project' = 'same'
        if (srcProj !== dstProj) {
          className = 'cross-bucket-edge'
          kind = 'cross-project'
        } else if (srcBucket !== dstBucket) {
          className = 'cross-milestone-edge'
          kind = 'cross-milestone'
        }
        edges.push({
          // See mix.ts for the bezier-in-container-views rationale.
          type: 'default',
          pathOptions: { curvature: 0.4 },
          id: `${i.identifier}->${r.targetIdentifier}`,
          source: i.identifier,
          target: r.targetIdentifier,
          className,
          data: { crossBucket: kind !== 'same', edgeKind: kind },
        })
      }
    }

    return { nodes: [...backdrops, ...nodes], edges }
  },
}
