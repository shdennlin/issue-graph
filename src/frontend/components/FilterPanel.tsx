import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, HelpCircle, X } from 'lucide-react'
import type { IssueStateType } from '@shared/types.js'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { useSchemaStore } from '../store/schemaStore'
import { useResizable } from '../hooks/useResizable'
import { stateColorVar, stateIcon, stateLabel } from '../lib/colors'
import { applyFiltersExcluding } from '../views/filters'
import { Tooltip } from './Tooltip'

const ALL_STATES: IssueStateType[] = ['started', 'unstarted', 'backlog', 'triage', 'completed', 'canceled']
const PRIORITIES = [1, 2, 3, 4, 0]
const PRIORITY_NAMES: Record<number, string> = { 0: 'No priority', 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low' }

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
            <span className="filter-section-count" aria-label={`${activeCount} active`}>
              {activeCount}
            </span>
          )}
        </button>
        {hasActive && onClear && (
          <button
            type="button"
            className="filter-section-clear"
            onClick={onClear}
            aria-label="Clear filters in this section"
            title="Clear filters in this section"
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
  const toggleStateName = useViewStore((s) => s.toggleStateName)
  const toggleProject = useViewStore((s) => s.toggleProject)
  const resetFilters = useViewStore((s) => s.resetFilters)

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
    // Assignee counts (excluding assignee + myIssuesOnly)
    for (const i of applyFiltersExcluding(issues, filters, staleDays, myUserName, search, 'assignee')) {
      const a = i.assignee?.displayName ?? '(unassigned)'
      byAssignee.set(a, (byAssignee.get(a) ?? 0) + 1)
    }
    // Label counts: primary, type, prefix all live in i.labels. Use the
    // strictest leave-one-out (drop only the relevant label dimension) but
    // since all label-based filters share a key into i.labels, we count all
    // three from each respective leave-one-out set. For simplicity, count
    // labels from the base "all-but-prefix" pass; primary/type users will
    // see counts that respect prefix filters too. Acceptable approximation.
    const labelSet = applyFiltersExcluding(issues, filters, staleDays, myUserName, search, 'primary')
    for (const i of labelSet) {
      for (const l of i.labels) byLabel.set(l.id, (byLabel.get(l.id) ?? 0) + 1)
    }
    // Project counts (excluding project filter). '__noproject' covers
    // issues without a Linear project — mirrors the Project view's
    // grouping key so the filter and view stay in sync.
    const byProject = new Map<string, { name: string; count: number }>()
    for (const i of applyFiltersExcluding(issues, filters, staleDays, myUserName, search, 'project')) {
      const id = i.project?.id ?? '__noproject'
      const name = i.project?.name ?? '(No project)'
      const cur = byProject.get(id)
      if (cur) cur.count += 1
      else byProject.set(id, { name, count: 1 })
    }
    return { byState, byStateName, byPrio, byAssignee, byLabel, byProject }
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

  const assignees = useMemo(() => {
    return [...counts.byAssignee.entries()].sort((a, b) => b[1] - a[1])
  }, [counts.byAssignee])

  // Sort projects: largest first, '(No project)' pinned to end so orphan
  // issues don't dominate the visual landing position. Mirrors the
  // Project view's ordering for consistency.
  const projects = useMemo(() => {
    return [...counts.byProject.entries()].sort((a, b) => {
      if (a[0] === '__noproject') return 1
      if (b[0] === '__noproject') return -1
      return b[1].count - a[1].count
    })
  }, [counts.byProject])

  const showDesigndocFilter = (graph?.hasDesigndoc ?? false) && (graph?.data.designdocs?.length ?? 0) > 0

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
        title="Quick"
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
          Active only
          <Tooltip text="Hides completed & canceled. Click those rows in State to fetch up to 1 year back.">
            <span
              tabIndex={0}
              aria-label="Active only filter help"
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
          My issues
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.staleOnly}
            onChange={(e) => setFilter('staleOnly', e.target.checked)}
          />
          Stale only
        </label>
      </CollapsibleSection>

      <CollapsibleSection
        id="state"
        title="State"
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
        {ALL_STATES.filter((t) => stateNamesByType[t].length > 0).map((t) => {
          const children = stateNamesByType[t]
          const groupCount = counts.byState[t] ?? 0
          return (
            <div key={t} className="state-group">
              <label className="state-group-header">
                <input
                  type="checkbox"
                  checked={filters.stateTypes.includes(t)}
                  onChange={() => {
                    const willBeChecked = !filters.stateTypes.includes(t)
                    toggleStateType(t)
                    // Lazy-fetch: when the user opts into a state type the
                    // default sync doesn't pull (canceled, or completed older
                    // than 30 days), trigger backend to extend its query
                    // window. Backend dedupes if already covered.
                    if (willBeChecked && (t === 'canceled' || t === 'completed')) {
                      useGraphStore.getState().extendScope(365)
                    }
                  }}
                  title={
                    t === 'canceled' || t === 'completed'
                      ? `Toggle the whole group (will fetch up to 365 days back)`
                      : 'Toggle the whole group'
                  }
                />
                <span className="glyph" style={{ color: stateColorVar(t) }}>{stateIcon(t)}</span>
                <span style={{ fontWeight: 600 }}>{stateLabel(t)}</span>
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
                        if (willBeChecked && (t === 'canceled' || t === 'completed')) {
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
          title={primaryGroupSingular ? `${primaryGroupSingular}s` : (schema.primaryGroup ?? 'Group')}
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
          title={schema.typeGroup ?? 'Type'}
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
        title="Priority"
        activeCount={filters.priorities.length}
        onClear={() => setFilter('priorities', [])}
      >
        {PRIORITIES.map((p) => (
          <label key={p}>
            <input type="checkbox" checked={filters.priorities.includes(p)} onChange={() => togglePriority(p)} />
            {PRIORITY_NAMES[p]}
            <span className="count">{counts.byPrio[p] ?? 0}</span>
          </label>
        ))}
      </CollapsibleSection>

      <CollapsibleSection
        id="assignee"
        title="Assignee"
        activeCount={filters.assignees.length}
        onClear={() => setFilter('assignees', [])}
      >
        {assignees.slice(0, 30).map(([name, count]) => (
          <label key={name}>
            <input type="checkbox" checked={filters.assignees.includes(name)} onChange={() => toggleAssignee(name)} />
            {name}
            <span className="count">{count}</span>
          </label>
        ))}
      </CollapsibleSection>

      {projects.length > 0 && (
        <CollapsibleSection
          id="project"
          title="Project"
          activeCount={filters.projectIds.length}
          onClear={() => setFilter('projectIds', [])}
        >
          {projects.map(([id, { name, count }]) => (
            <label key={id}>
              <input
                type="checkbox"
                checked={filters.projectIds.includes(id)}
                onChange={() => toggleProject(id)}
              />
              {name}
              <span className="count">{count}</span>
            </label>
          ))}
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

      {showDesigndocFilter && (
        <CollapsibleSection
          id="designdoc"
          title="Design doc"
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
              {v}
            </label>
          ))}
        </CollapsibleSection>
      )}

      <button onClick={resetFilters} className="filter-reset">Reset filters</button>
    </aside>
  )
}
