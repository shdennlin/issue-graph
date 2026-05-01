import { useMemo } from 'react'
import type { IssueStateType } from '@shared/types.js'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { useSchemaStore } from '../store/schemaStore'
import { useResizable } from '../hooks/useResizable'
import { stateColorVar, stateIcon, stateLabel } from '../lib/colors'
import { applyFiltersExcluding } from '../views/filters'

const ALL_STATES: IssueStateType[] = ['started', 'unstarted', 'backlog', 'triage', 'completed', 'canceled']
const PRIORITIES = [1, 2, 3, 4, 0]
const PRIORITY_NAMES: Record<number, string> = { 0: 'No priority', 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low' }

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
  const resetFilters = useViewStore((s) => s.resetFilters)

  const issues = graph?.data.issues ?? []
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
    return { byState, byStateName, byPrio, byAssignee, byLabel }
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
      <section>
        <h4>Quick</h4>
        <label>
          <input
            type="checkbox"
            checked={filters.activeOnly}
            onChange={(e) => setFilter('activeOnly', e.target.checked)}
          />
          Active only
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
      </section>

      <section>
        <h4>State</h4>
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
                  onChange={() => toggleStateType(t)}
                  title="Toggle the whole group"
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
                      onChange={() => toggleStateName(c.name)}
                    />
                    <span style={{ color: 'var(--fg-muted)' }}>{c.name}</span>
                    <span className="count">{c.count}</span>
                  </label>
                ))}
              </div>
            </div>
          )
        })}
      </section>

      {primaryLabels.length > 0 && (
        <section>
          <h4>{primaryGroupSingular ? `${primaryGroupSingular}s` : schema.primaryGroup}</h4>
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
        </section>
      )}

      {typeLabels.length > 0 && (
        <section>
          <h4>{schema.typeGroup}</h4>
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
        </section>
      )}

      <section>
        <h4>Priority</h4>
        {PRIORITIES.map((p) => (
          <label key={p}>
            <input type="checkbox" checked={filters.priorities.includes(p)} onChange={() => togglePriority(p)} />
            {PRIORITY_NAMES[p]}
            <span className="count">{counts.byPrio[p] ?? 0}</span>
          </label>
        ))}
      </section>

      <section>
        <h4>Assignee</h4>
        {assignees.slice(0, 30).map(([name, count]) => (
          <label key={name}>
            <input type="checkbox" checked={filters.assignees.includes(name)} onChange={() => toggleAssignee(name)} />
            {name}
            <span className="count">{count}</span>
          </label>
        ))}
      </section>

      {schema.prefixes.map((g) => (
        <section key={g.token}>
          <h4>{g.token}:</h4>
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
        </section>
      ))}

      {showDesigndocFilter && (
        <section>
          <h4>Design doc</h4>
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
        </section>
      )}

      <button onClick={resetFilters} style={{ marginTop: 8 }}>Reset filters</button>
    </aside>
  )
}
