// Filter-panel derivations, extracted verbatim from FilterPanel.tsx so the
// chip/facet bar can consume them without re-deriving anything.
//
// **Every memo here is load-bearing. React Compiler is NOT enabled** — see the
// CLAUDE.md section that corrects an earlier claim to the contrary. `counts`
// alone runs five full leave-one-out passes over every issue and recomputes on
// each filter toggle, so dropping a memo (or adding a spurious dep) turns every
// hover and pan into a five-pass rescan.
//
// This module deliberately reads the stores itself rather than taking props:
// it is consumed by whichever filter UI is mounted, and prop-drilling seven
// derived structures through a chip bar would be worse than the coupling.

import { useMemo } from 'react'
import type { IssueStateType, NormalizedLabel } from '@shared/types.js'
import { useGraphStore } from '../../store/graphStore'
import { useViewStore } from '../../store/viewStore'
import { useSchemaStore } from '../../store/schemaStore'
import { applyFiltersExcluding, milestoneFilterKey } from '../../views/filters'
import { groupLabels } from '../../lib/labelSchema'

export interface StateNameRow {
  name: string
  count: number
  position: number
}

export interface MilestoneRow {
  key: string
  milestoneId: string | null
  name: string
  sortOrder: number | null
  count: number
}

export interface ProjectRow {
  projId: string
  name: string
  color: string | null
  count: number
  children: MilestoneRow[]
}

export function useFilterCounts() {
  const graph = useGraphStore((s) => s.graph)
  const filters = useViewStore((s) => s.filters)
  const staleDays = useViewStore((s) => s.staleDays)
  const search = useViewStore((s) => s.search)
  const { schema, workflowStates } = useSchemaStore()

  // Stable reference for the issues array so the leave-one-out useMemos
  // below have a referentially-stable dependency. `graph?.data.issues ?? []`
  // would produce a fresh `[]` literal each render whenever graph is null,
  // tripping react-hooks/exhaustive-deps and forcing recomputation.
  const rawIssues = graph?.data.issues
  const issues = useMemo(() => rawIssues ?? [], [rawIssues])
  const myUserName = graph?.data.viewer?.displayName ?? null

  // Leave-one-out counts: for each filter dimension, count issues that pass
  // ALL OTHER active filters. So "(unassigned) 11" means clicking it would
  // reveal 11 issues — not "11 unassigned issues exist somewhere in cache,
  // most of which are hidden by Active-only".
  const counts = useMemo(() => {
    const byState: Record<string, number> = {}
    const byStateName = new Map<string, { name: string; type: IssueStateType; count: number }>()
    const byPrio: Record<number, number> = {}
    const byAssignee = new Map<string, number>()
    const byLabel = new Map<string, number>()

    // State counts (excluding state filter from applied set)
    for (const i of applyFiltersExcluding(issues, filters, staleDays, myUserName, search, 'state')) {
      byState[i.state.type] = (byState[i.state.type] ?? 0) + 1
      const sn = byStateName.get(i.state.name)
      if (sn) sn.count += 1
      else byStateName.set(i.state.name, { name: i.state.name, type: i.state.type, count: 1 })
    }
    // Priority counts (excluding priority filter)
    for (const i of applyFiltersExcluding(issues, filters, staleDays, myUserName, search, 'priority')) {
      byPrio[i.priority] = (byPrio[i.priority] ?? 0) + 1
    }
    // Assignee counts (excluding assignee + myIssuesOnly).
    // Use a stable canonical string for the unassigned bucket so the value
    // stored in `filters.assignees` (and in the URL) doesn't shift across
    // locales — display-only translation happens at render time.
    for (const i of applyFiltersExcluding(issues, filters, staleDays, myUserName, search, 'assignee')) {
      const a = i.assignee?.displayName ?? '(unassigned)'
      byAssignee.set(a, (byAssignee.get(a) ?? 0) + 1)
    }
    // Label counts: primary, type, prefix, group and orphan all key into
    // i.labels, so one leave-one-out pass with every label dimension dropped
    // serves all five sections. Dropping only the section's own dimension
    // would be stricter, but in an exclusive group it zeroes every sibling
    // the moment one is picked — leaving no visible way to switch.
    const labelSet = applyFiltersExcluding(issues, filters, staleDays, myUserName, search, 'label')
    for (const i of labelSet) {
      for (const l of i.labels) byLabel.set(l.id, (byLabel.get(l.id) ?? 0) + 1)
    }
    // Project + milestone counts share the same leave-one-out base since they
    // are one hierarchical dimension. '__noproject' covers issues without a
    // Linear project — mirrors the Project view's grouping key so the filter
    // and view stay in sync.
    const byProject = new Map<string, { name: string; color: string | null; count: number }>()
    const byMilestone = new Map<
      string,
      {
        projectId: string
        milestoneId: string | null
        milestoneName: string
        sortOrder: number | null
        count: number
      }
    >()
    for (const i of applyFiltersExcluding(issues, filters, staleDays, myUserName, search, 'project')) {
      const projId = i.project?.id ?? '__noproject'
      // Stable canonical name — translation of "(No project)" happens at
      // render time; canonical English keeps URL / filter state stable
      // across locales.
      const name = i.project?.name ?? '(No project)'
      const color = i.project?.color ?? null
      const cur = byProject.get(projId)
      if (cur) cur.count += 1
      else byProject.set(projId, { name, color, count: 1 })

      // Milestone counts only apply to issues with a project. Issues with
      // no project never appear under any milestone (milestones are
      // project-scoped in Linear).
      if (i.project) {
        const msId = i.projectMilestone?.id ?? null
        const msKey = milestoneFilterKey(i.project.id, msId)
        const msCur = byMilestone.get(msKey)
        if (msCur) msCur.count += 1
        else {
          byMilestone.set(msKey, {
            projectId: i.project.id,
            milestoneId: msId,
            milestoneName: i.projectMilestone?.name ?? '(No milestone)',
            sortOrder: i.projectMilestone?.sortOrder ?? null,
            count: 1,
          })
        }
      }
    }
    return { byState, byStateName, byPrio, byAssignee, byLabel, byProject, byMilestone }
  }, [issues, filters, staleDays, myUserName, search])

  // Group state names by canonical type. Source = union of:
  //   1. Workflow states fetched from the backend (full list, including ones
  //      with 0 current matches — e.g. "Review", "Duplicate" if no issue is
  //      currently in those states).
  //   2. State names observed on cached issues (covers backends that don't
  //      implement fetchWorkflowStates).
  // Counts come from cached data (a state with 0 issues shows count=0).
  const stateNamesByType = useMemo(() => {
    const groups: Record<IssueStateType, StateNameRow[]> = {
      backlog: [], unstarted: [], started: [], completed: [], canceled: [], triage: [],
    }
    const seen = new Map<string, { type: IssueStateType; position: number }>() // name → meta
    // Pass 1: workflow states from API (carry their declared position).
    for (const ws of workflowStates) {
      // Skip unknown types — e.g. a stale cache containing Linear's "cancelled"
      // (British) instead of our canonical "canceled" would crash groups[ws.type].
      if (!groups[ws.type]) continue
      seen.set(ws.name, { type: ws.type, position: ws.position ?? 999 })
      groups[ws.type].push({
        name: ws.name,
        count: counts.byStateName.get(ws.name)?.count ?? 0,
        position: ws.position ?? 999,
      })
    }
    // Pass 2: cached issue states not already covered.
    for (const { name, type, count } of counts.byStateName.values()) {
      if (seen.has(name)) continue
      groups[type].push({ name, count, position: 1000 })
    }
    // Sort each group by Linear's `position` first, then by name for stability.
    for (const k of Object.keys(groups) as IssueStateType[]) {
      groups[k].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    }
    return groups
  }, [counts.byStateName, workflowStates])

  const primaryLabels = useMemo(() => {
    if (!schema.primaryGroup) return []
    const map = new Map<string, { id: string; name: string }>()
    for (const lab of issues.flatMap((i) => i.labels)) {
      if (lab.group?.name === schema.primaryGroup) map.set(lab.id, { id: lab.id, name: lab.name })
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [schema.primaryGroup, issues])

  const typeLabels = useMemo(() => {
    if (!schema.typeGroup) return []
    const map = new Map<string, { id: string; name: string }>()
    for (const lab of issues.flatMap((i) => i.labels)) {
      if (lab.group?.name === schema.typeGroup) map.set(lab.id, { id: lab.id, name: lab.name })
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [schema.typeGroup, issues])

  // Label sections beyond primary/type/prefix. Classified by the same helper
  // the detail panel uses, over the labels actually present in the current
  // issue set — so a label can never be filterable here yet unnamed there,
  // and vice versa. The 'orphan' bucket is a subtraction (everything no
  // earlier bucket claimed), which is what makes a label the schema has not
  // seen yet still reachable instead of silently unfilterable.
  //
  // Memoized: this walks every issue's every label, and the filter UI
  // re-renders on each filter toggle. (It was briefly written unmemoized on
  // the strength of a CLAUDE.md claim that React Compiler was enabled — it is
  // not.)
  const otherLabelSections = useMemo(() => {
    const presentLabels = new Map<string, NormalizedLabel>()
    for (const i of issues) for (const l of i.labels) presentLabels.set(l.id, l)
    return groupLabels([...presentLabels.values()], schema)
      .filter((sec) => sec.kind === 'group' || sec.kind === 'orphan')
      .map((sec) => ({
        ...sec,
        labels: [...sec.labels].sort((a, b) => a.name.localeCompare(b.name)),
      }))
  }, [issues, schema])

  const assignees = useMemo(() => {
    return [...counts.byAssignee.entries()].sort((a, b) => b[1] - a[1])
  }, [counts.byAssignee])

  // Hierarchical project/milestone list. Each project entry carries its
  // (already-filtered, sorted) milestone children. Projects with no
  // milestones at all render as a flat row. Sorting mirrors the milestone
  // view: parent projects by issue count desc, '(No project)' pinned last;
  // milestones within a project by Linear sortOrder asc with the
  // '(No milestone)' bucket last.
  const projectsWithMilestones = useMemo((): ProjectRow[] => {
    // Bucket milestones by project for O(1) lookup during projects iteration.
    const msByProject = new Map<string, MilestoneRow[]>()
    for (const [key, m] of counts.byMilestone) {
      const list = msByProject.get(m.projectId) ?? []
      list.push({
        key,
        milestoneId: m.milestoneId,
        name: m.milestoneName,
        sortOrder: m.sortOrder,
        count: m.count,
      })
      msByProject.set(m.projectId, list)
    }
    for (const list of msByProject.values()) {
      list.sort((a, b) => {
        if (a.milestoneId === null) return 1
        if (b.milestoneId === null) return -1
        const sa = a.sortOrder ?? Number.POSITIVE_INFINITY
        const sb = b.sortOrder ?? Number.POSITIVE_INFINITY
        if (sa !== sb) return sa - sb
        return a.name.localeCompare(b.name)
      })
    }
    const rows = [...counts.byProject.entries()].sort((a, b) => {
      if (a[0] === '__noproject') return 1
      if (b[0] === '__noproject') return -1
      return b[1].count - a[1].count
    })
    return rows.map(([projId, p]) => {
      // Treat the only-child '(No milestone)' as 'no real milestones' —
      // rendering a single grey '(No milestone)' child under every flat
      // project would be redundant noise. Flat row instead.
      const children = msByProject.get(projId) ?? []
      const hasRealMilestones = children.some((c) => c.milestoneId !== null)
      return { projId, name: p.name, color: p.color, count: p.count, children: hasRealMilestones ? children : [] }
    })
  }, [counts.byProject, counts.byMilestone])

  // Deliberately NOT memoized — both were plain expressions in FilterPanel and
  // the comment there explains why: a useMemo would be over-engineering for
  // the issue count.
  const showDesigndocFilter = (graph?.hasDesigndoc ?? false) && (graph?.data.designdocs?.length ?? 0) > 0
  const showDueFilter = (graph?.data.issues ?? []).some((i) => !!i.dueDate)

  return {
    issues,
    counts,
    stateNamesByType,
    primaryLabels,
    typeLabels,
    otherLabelSections,
    assignees,
    projectsWithMilestones,
    showDesigndocFilter,
    showDueFilter,
  }
}
