import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, HelpCircle, X } from 'lucide-react'
import type { IssueStateType, NormalizedLabel } from '@shared/types.js'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { useSchemaStore } from '../store/schemaStore'
import { useResizable } from '../hooks/useResizable'
import { stateColorVar, stateIcon, stateLabelFor } from '../lib/colors'
import { applyFiltersExcluding, milestoneFilterKey, NO_MILESTONE_TOKEN } from '../views/filters'
import { groupLabels } from '../lib/labelSchema'
import { projectColor } from '../lib/projectColor'
import { Tooltip } from './Tooltip'
import { useLocale, useT, type DictKey } from '../i18n'

const ALL_STATES: IssueStateType[] = ['started', 'unstarted', 'backlog', 'triage', 'completed', 'canceled']
const PRIORITIES = [1, 2, 3, 4, 0]
const PRIORITY_KEYS: Record<number, DictKey> = {
  0: 'filterPanel.priorityNoPriority',
  1: 'filterPanel.priorityUrgent',
  2: 'filterPanel.priorityHigh',
  3: 'filterPanel.priorityMedium',
  4: 'filterPanel.priorityLow',
}

// Collapsed sidebar sections persist across reloads. Stored as
// { sectionId: true } — only collapsed sections are written, so newly-
// added sections default to open and the map doesn't grow unbounded.
const COLLAPSE_STORAGE_KEY = 'ig-filter-collapsed-v1'

function readCollapsedMap(): Record<string, true> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function useCollapsedState(id: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsedMap()[id] === true)
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        const map = readCollapsedMap()
        if (next) map[id] = true
        else delete map[id]
        localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(map))
      } catch {
        // Silent — full quota / disabled storage shouldn't block UI state.
      }
      return next
    })
  }, [id])
  return [collapsed, toggle]
}

function CollapsibleSection({
  id,
  title,
  activeCount,
  onClear,
  children,
}: {
  id: string
  title: ReactNode
  activeCount: number
  onClear?: () => void
  children: ReactNode
}) {
  const [collapsed, toggle] = useCollapsedState(id)
  const hasActive = activeCount > 0
  const t = useT()
  return (
    <section>
      <h4 className="filter-section-heading">
        <button
          type="button"
          className="filter-section-toggle"
          onClick={toggle}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span className="filter-section-title">{title}</span>
          {hasActive && (
            <span className="filter-section-count" aria-label={t('filterPanel.activeAria', { count: activeCount })}>
              {activeCount}
            </span>
          )}
        </button>
        {hasActive && onClear && (
          <button
            type="button"
            className="filter-section-clear"
            onClick={onClear}
            aria-label={t('filterPanel.sectionClear')}
            title={t('filterPanel.sectionClear')}
          >
            <X size={12} />
          </button>
        )}
      </h4>
      {!collapsed && children}
    </section>
  )
}

export function FilterPanel() {
  const graph = useGraphStore((s) => s.graph)
  const filters = useViewStore((s) => s.filters)
  const { schema, primaryGroupSingular, workflowStates } = useSchemaStore()
  const setFilter = useViewStore((s) => s.setFilter)
  const toggleStateType = useViewStore((s) => s.toggleStateType)
  const togglePrimary = useViewStore((s) => s.togglePrimary)
  const toggleType = useViewStore((s) => s.toggleType)
  const togglePriority = useViewStore((s) => s.togglePriority)
  const toggleAssignee = useViewStore((s) => s.toggleAssignee)
  const togglePrefix = useViewStore((s) => s.togglePrefix)
  const toggleGroupLabel = useViewStore((s) => s.toggleGroupLabel)
  const toggleOrphan = useViewStore((s) => s.toggleOrphan)
  const toggleStateName = useViewStore((s) => s.toggleStateName)
  const toggleProject = useViewStore((s) => s.toggleProject)
  const toggleMilestone = useViewStore((s) => s.toggleMilestone)
  const resetFilters = useViewStore((s) => s.resetFilters)
  const t = useT()
  const locale = useLocale()

  // Stable reference for the issues array so the leave-one-out useMemos
  // below have a referentially-stable dependency. `graph?.data.issues ?? []`
  // would produce a fresh `[]` literal each render whenever graph is null,
  // tripping react-hooks/exhaustive-deps and forcing recomputation.
  const rawIssues = graph?.data.issues
  const issues = useMemo(() => rawIssues ?? [], [rawIssues])
  const staleDays = useViewStore((s) => s.staleDays)
  const search = useViewStore((s) => s.search)
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
    // locales — display-only translation happens at render time below.
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
    const byProject = new Map<
      string,
      { name: string; color: string | null; count: number }
    >()
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
    const groups: Record<IssueStateType, { name: string; count: number; position: number }[]> = {
      backlog: [], unstarted: [], started: [], completed: [], canceled: [], triage: [],
    }
    const seen = new Map<string, { type: IssueStateType; position: number }>() // name → meta
    // Pass 1: workflow states from API (carry their declared position).
    for (const ws of workflowStates) {
      // Skip unknown types — e.g. a stale cache containing Linear's "cancelled"
      // (British) instead of our canonical "canceled" would crash groups[ws.type].
      if (!groups[ws.type]) continue
      seen.set(ws.name, { type: ws.type, position: ws.position ?? 999 })
      groups[ws.type].push({ name: ws.name, count: counts.byStateName.get(ws.name)?.count ?? 0, position: ws.position ?? 999 })
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
  const presentLabels = new Map<string, NormalizedLabel>()
  for (const i of issues) for (const l of i.labels) presentLabels.set(l.id, l)
  const otherLabelSections = groupLabels([...presentLabels.values()], schema)
    .filter((sec) => sec.kind === 'group' || sec.kind === 'orphan')
    .map((sec) => ({
      ...sec,
      labels: [...sec.labels].sort((a, b) => a.name.localeCompare(b.name)),
    }))

  const assignees = useMemo(() => {
    return [...counts.byAssignee.entries()].sort((a, b) => b[1] - a[1])
  }, [counts.byAssignee])

  // Hierarchical project/milestone list. Each project entry carries its
  // (already-filtered, sorted) milestone children. Projects with no
  // milestones at all render as a flat row in the JSX. Sorting mirrors
  // the milestone view: parent projects by issue count desc, '(No project)'
  // pinned last; milestones within a project by Linear sortOrder asc with
  // the '(No milestone)' bucket last.
  const projectsWithMilestones = useMemo(() => {
    // Bucket milestones by project for O(1) lookup during projects iteration.
    const msByProject = new Map<
      string,
      Array<{ key: string; milestoneId: string | null; name: string; sortOrder: number | null; count: number }>
    >()
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

  const showDesigndocFilter = (graph?.hasDesigndoc ?? false) && (graph?.data.designdocs?.length ?? 0) > 0
  // Only surface the due-date filter when the workspace actually uses due
  // dates — otherwise the section is dead UI. Cheap O(N) scan; runs once
  // per render via useMemo would be over-engineering for the issue count.
  const showDueFilter = (graph?.data.issues ?? []).some((i) => !!i.dueDate)

  const { width, startResize, resizing } = useResizable({
    storageKey: 'ig-filter-panel-w',
    defaultWidth: 240,
    min: 180,
    max: 480,
    side: 'left',
  })

  return (
    <aside
      className={`filter-panel${resizing ? ' is-resizing' : ''}`}
      style={{ width, flexShrink: 0 }}
    >
      <div className="resize-handle resize-handle-right" onMouseDown={startResize} title="Drag to resize" />
      <CollapsibleSection
        id="quick"
        title={t('filterPanel.quick')}
        activeCount={
          (filters.activeOnly ? 1 : 0) +
          (filters.myIssuesOnly ? 1 : 0) +
          (filters.staleOnly ? 1 : 0)
        }
        onClear={() => {
          setFilter('activeOnly', false)
          setFilter('myIssuesOnly', false)
          setFilter('staleOnly', false)
        }}
      >
        <label>
          <input
            type="checkbox"
            checked={filters.activeOnly}
            onChange={(e) => setFilter('activeOnly', e.target.checked)}
          />
          {t('filterPanel.activeOnly')}
          <Tooltip text={t('filterPanel.activeOnlyHelp')}>
            <span
              tabIndex={0}
              aria-label={t('filterPanel.activeOnlyHelpAria')}
              className="filter-help-icon"
            >
              <HelpCircle size={14} />
            </span>
          </Tooltip>
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.myIssuesOnly}
            onChange={(e) => setFilter('myIssuesOnly', e.target.checked)}
          />
          {t('filterPanel.myIssues')}
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.staleOnly}
            onChange={(e) => setFilter('staleOnly', e.target.checked)}
          />
          {t('filterPanel.staleOnly')}
        </label>
      </CollapsibleSection>

      <CollapsibleSection
        id="state"
        title={t('filterPanel.state')}
        activeCount={filters.stateTypes.length + filters.stateNames.length}
        onClear={() => {
          setFilter('stateTypes', [])
          setFilter('stateNames', [])
        }}
      >
        {/* Hierarchical: each canonical type is a row; if multiple actual state
            names roll up to it, they appear as indented children. Empty types
            are hidden. Toggle the type checkbox to select the whole group; the
            child checkboxes filter by the literal Linear state.name. */}
        {/* Hide types whose count is 0 — including ones in default stateTypes
            like 'triage' that the workspace doesn't actually use. */}
        {ALL_STATES.filter((type) => stateNamesByType[type].length > 0).map((type) => {
          const children = stateNamesByType[type]
          const groupCount = counts.byState[type] ?? 0
          return (
            <div key={type} className="state-group">
              <label className="state-group-header">
                <input
                  type="checkbox"
                  checked={filters.stateTypes.includes(type)}
                  onChange={() => {
                    const willBeChecked = !filters.stateTypes.includes(type)
                    toggleStateType(type)
                    // Lazy-fetch: when the user opts into a state type the
                    // default sync doesn't pull (canceled, or completed older
                    // than 30 days), trigger backend to extend its query
                    // window. Backend dedupes if already covered.
                    if (willBeChecked && (type === 'canceled' || type === 'completed')) {
                      useGraphStore.getState().extendScope(365)
                    }
                  }}
                  title={
                    type === 'canceled' || type === 'completed'
                      ? t('filterPanel.stateGroupTitleFetch')
                      : t('filterPanel.stateGroupTitle')
                  }
                />
                <span className="glyph" style={{ color: stateColorVar(type) }}>{stateIcon(type)}</span>
                <span style={{ fontWeight: 600 }}>{stateLabelFor(type, locale)}</span>
                <span className="count">{groupCount}</span>
              </label>
              {/* Always show children — the user can see the actual Linear state
                  names even when there's only one (matches what they see in Linear). */}
              <div className="state-children">
                {children.map((c) => (
                  <label key={c.name} className="state-child">
                    <input
                      type="checkbox"
                      checked={filters.stateNames.includes(c.name)}
                      onChange={() => {
                        const willBeChecked = !filters.stateNames.includes(c.name)
                        toggleStateName(c.name)
                        // Same lazy-fetch trigger for the granular state name
                        // when its canonical type isn't covered by default.
                        if (willBeChecked && (type === 'canceled' || type === 'completed')) {
                          useGraphStore.getState().extendScope(365)
                        }
                      }}
                    />
                    <span style={{ color: 'var(--fg-muted)' }}>{c.name}</span>
                    <span className="count">{c.count}</span>
                  </label>
                ))}
              </div>
            </div>
          )
        })}
      </CollapsibleSection>

      {primaryLabels.length > 0 && (
        <CollapsibleSection
          id="primary"
          title={primaryGroupSingular ? `${primaryGroupSingular}s` : (schema.primaryGroup ?? t('filterPanel.group'))}
          activeCount={filters.primaryValues.length}
          onClear={() => setFilter('primaryValues', [])}
        >
          {primaryLabels.map((l) => (
            <label key={l.id}>
              <input
                type="checkbox"
                checked={filters.primaryValues.includes(l.id)}
                onChange={() => togglePrimary(l.id)}
              />
              {l.name}
              <span className="count">{counts.byLabel.get(l.id) ?? 0}</span>
            </label>
          ))}
        </CollapsibleSection>
      )}

      {typeLabels.length > 0 && (
        <CollapsibleSection
          id="type"
          title={schema.typeGroup ?? t('filterPanel.type')}
          activeCount={filters.typeValues.length}
          onClear={() => setFilter('typeValues', [])}
        >
          {typeLabels.map((l) => (
            <label key={l.id}>
              <input
                type="checkbox"
                checked={filters.typeValues.includes(l.id)}
                onChange={() => toggleType(l.id)}
              />
              {l.name}
              <span className="count">{counts.byLabel.get(l.id) ?? 0}</span>
            </label>
          ))}
        </CollapsibleSection>
      )}

      <CollapsibleSection
        id="priority"
        title={t('filterPanel.priority')}
        activeCount={filters.priorities.length}
        onClear={() => setFilter('priorities', [])}
      >
        {PRIORITIES.map((p) => (
          <label key={p}>
            <input type="checkbox" checked={filters.priorities.includes(p)} onChange={() => togglePriority(p)} />
            {t(PRIORITY_KEYS[p]!)}
            <span className="count">{counts.byPrio[p] ?? 0}</span>
          </label>
        ))}
      </CollapsibleSection>

      <CollapsibleSection
        id="assignee"
        title={t('filterPanel.assignee')}
        activeCount={filters.assignees.length}
        onClear={() => setFilter('assignees', [])}
      >
        {assignees.slice(0, 30).map(([name, count]) => (
          <label key={name}>
            <input type="checkbox" checked={filters.assignees.includes(name)} onChange={() => toggleAssignee(name)} />
            {name === '(unassigned)' ? t('common.unassigned') : name}
            <span className="count">{count}</span>
          </label>
        ))}
      </CollapsibleSection>

      {projectsWithMilestones.length > 0 && (
        <CollapsibleSection
          id="project"
          title={t('filterPanel.projectMilestone')}
          activeCount={filters.projectIds.length + filters.milestoneIds.length}
          onClear={() => {
            setFilter('projectIds', [])
            setFilter('milestoneIds', [])
          }}
        >
          {/* Hierarchical: each project is a parent row; if the project has
              milestones, they appear as indented children. Mirrors the state
              filter's two-level structure (parent + children are independent
              checkboxes; milestoneIds takes precedence over projectIds when
              non-empty — see filters.ts). */}
          {projectsWithMilestones.map(({ projId, name, color, count, children }) => {
            const isNoProject = projId === '__noproject'
            const dotColor = projectColor(projId, color, 'var(--fg-muted)')
            return (
              <div key={projId} className="state-group">
                <label className="state-group-header">
                  <input
                    type="checkbox"
                    checked={filters.projectIds.includes(projId)}
                    onChange={() => toggleProject(projId)}
                  />
                  {!isNoProject && (
                    <span
                      className="project-color-dot"
                      style={{ background: dotColor }}
                      aria-hidden="true"
                    />
                  )}
                  <span style={{ fontWeight: 600 }}>
                    {isNoProject ? t('common.noProject') : name}
                  </span>
                  <span className="count">{count}</span>
                </label>
                {children.length > 0 && (
                  <div className="state-children">
                    {children.map((c) => (
                      <label key={c.key} className="state-child">
                        <input
                          type="checkbox"
                          checked={filters.milestoneIds.includes(c.key)}
                          onChange={() => toggleMilestone(c.key)}
                        />
                        <span style={{ color: 'var(--fg-muted)' }}>
                          {c.milestoneId === null ? t('filterPanel.noMilestone') : c.name}
                        </span>
                        <span className="count">{c.count}</span>
                      </label>
                    ))}
                    {/* Show '(No milestone)' explicitly if it has a count and
                        wasn't already included above — happens when the project
                        has both milestone-tagged and untagged issues. */}
                    {(() => {
                      const noneKey = `${projId}::${NO_MILESTONE_TOKEN}`
                      const alreadyShown = children.some((c) => c.key === noneKey)
                      const noneCount = counts.byMilestone.get(noneKey)?.count ?? 0
                      if (alreadyShown || noneCount === 0) return null
                      return (
                        <label key={noneKey} className="state-child">
                          <input
                            type="checkbox"
                            checked={filters.milestoneIds.includes(noneKey)}
                            onChange={() => toggleMilestone(noneKey)}
                          />
                          <span style={{ color: 'var(--fg-muted)' }}>
                            {t('filterPanel.noMilestone')}
                          </span>
                          <span className="count">{noneCount}</span>
                        </label>
                      )
                    })()}
                  </div>
                )}
              </div>
            )
          })}
        </CollapsibleSection>
      )}

      {schema.prefixes.map((g) => (
        <CollapsibleSection
          key={g.token}
          id={`prefix:${g.token}`}
          title={`${g.token}:`}
          activeCount={(filters.prefixSelections[g.token] ?? []).length}
          onClear={() => setFilter('prefixSelections', { ...filters.prefixSelections, [g.token]: [] })}
        >
          {g.labels.map((l) => (
            <label key={l.id}>
              <input
                type="checkbox"
                checked={(filters.prefixSelections[g.token] ?? []).includes(l.id)}
                onChange={() => togglePrefix(g.token, l.id)}
              />
              {l.name.replace(`${g.token}:`, '').trim()}
              <span className="count">{counts.byLabel.get(l.id) ?? 0}</span>
            </label>
          ))}
        </CollapsibleSection>
      ))}

      {otherLabelSections.map((sec) => {
        const isOrphan = sec.kind === 'orphan'
        const selected = isOrphan ? filters.orphanValues : (filters.groupSelections[sec.key] ?? [])
        return (
          <CollapsibleSection
            key={`${sec.kind}:${sec.key}`}
            id={`${sec.kind}:${sec.key}`}
            title={isOrphan ? t('filterPanel.otherLabels') : sec.key}
            activeCount={selected.length}
            onClear={() =>
              isOrphan
                ? setFilter('orphanValues', [])
                : setFilter('groupSelections', { ...filters.groupSelections, [sec.key]: [] })
            }
          >
            {sec.labels.map((l) => (
              <label key={l.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(l.id)}
                  onChange={() => (isOrphan ? toggleOrphan(l.id) : toggleGroupLabel(sec.key, l.id))}
                />
                {l.name}
                <span className="count">{counts.byLabel.get(l.id) ?? 0}</span>
              </label>
            ))}
          </CollapsibleSection>
        )
      })}

      {showDesigndocFilter && (
        <CollapsibleSection
          id="designdoc"
          title={t('filterPanel.designDoc')}
          activeCount={filters.designdocFilter !== 'all' ? 1 : 0}
          onClear={() => setFilter('designdocFilter', 'all')}
        >
          {(['all', 'has', 'missing'] as const).map((v) => (
            <label key={v}>
              <input
                type="radio"
                name="designdoc"
                checked={filters.designdocFilter === v}
                onChange={() => setFilter('designdocFilter', v)}
              />
              {v === 'all' ? t('filterPanel.designDocAll') : v === 'has' ? t('filterPanel.designDocHas') : t('filterPanel.designDocMissing')}
            </label>
          ))}
        </CollapsibleSection>
      )}

      {showDueFilter && (
        <CollapsibleSection
          id="due"
          title={t('filterPanel.dueDate')}
          activeCount={filters.dueFilter !== 'any' ? 1 : 0}
          onClear={() => setFilter('dueFilter', 'any')}
        >
          {(['any', 'has', 'overdue', 'soon7', 'soon30'] as const).map((v) => (
            <label key={v}>
              <input
                type="radio"
                name="dueFilter"
                checked={filters.dueFilter === v}
                onChange={() => setFilter('dueFilter', v)}
              />
              {v === 'any'
                ? t('filterPanel.dueDateAny')
                : v === 'has'
                  ? t('filterPanel.dueDateHas')
                  : v === 'overdue'
                    ? t('filterPanel.dueDateOverdue')
                    : v === 'soon7'
                      ? t('filterPanel.dueDateSoon7')
                      : t('filterPanel.dueDateSoon30')}
            </label>
          ))}
        </CollapsibleSection>
      )}

      <button onClick={resetFilters} className="filter-reset">{t('filterPanel.resetFilters')}</button>
    </aside>
  )
}
