import type { Edge, Node } from 'reactflow'
import type { ViewDefinition } from './types'
import { issueNodeHeight } from './types'
import { applyFilters } from './filters'
import { computeChain } from './chain'
import { computeConnectivity } from './connectivity'
import { chooseColumnCount, packIntoColumns } from './containerLayout'
import { projectColor } from '../lib/projectColor'
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
  build({
    data,
    filters,
    staleDays,
    myUserName,
    focusedId,
    chainRootId,
    showRelated,
    density,
    search,
    measuredHeights,
  }) {
    const NODE_H = issueNodeHeight(density)
    let issues
    if (chainRootId) {
      const { members } = computeChain(data.issues, chainRootId, {
        includeRelatedNeighbors: showRelated,
      })
      issues = data.issues.filter((i) => members.has(i.identifier))
    } else {
      issues = applyFilters(data.issues, filters, staleDays, myUserName, search)
    }
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
    const groupedByProject = new Map<string, MilestoneBucket[]>()
    for (const b of ordered) {
      const list = groupedByProject.get(b.projectId) ?? []
      list.push(b)
      groupedByProject.set(b.projectId, list)
    }

    const nodes: Node[] = []
    const issueToBucket = new Map<string, string>()
    let cursorY = 0
    for (const group of groupedByProject.values()) {
      // Each project group runs its own packing pass with fresh row state, so
      // wrapping happens *within* the project's swimlane and never bleeds
      // into the next project's vertical space.
      let rowY = cursorY
      let rowMaxH = 0
      let rowWidth = 0
      let projectBottom = cursorY

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
        const xOffset = rowWidth === 0 ? 0 : rowWidth + GAP_X
        rowMaxH = Math.max(rowMaxH, containerHeight)
        rowWidth = xOffset + containerW
        projectBottom = Math.max(projectBottom, rowY + containerHeight)

        const displayName = `${b.projectName} / ${b.milestoneName}`
        const containerId = `milestone:${b.key}`
        // 'done' = completed only. Canceled doesn't count toward progress —
        // it's "won't ship" rather than "shipped".
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
      cursorY = projectBottom + PROJECT_GAP
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
          id: `${i.identifier}->${r.targetIdentifier}`,
          source: i.identifier,
          target: r.targetIdentifier,
          className,
          data: { crossBucket: kind !== 'same', edgeKind: kind },
        })
      }
    }

    return { nodes, edges }
  },
}
