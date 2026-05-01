import { useMemo } from 'react'
import type { IssueStateType } from '@shared/types.js'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { useSchemaStore } from '../store/schemaStore'
import { stateLabel } from '../lib/colors'

const ALL_STATES: IssueStateType[] = ['started', 'unstarted', 'backlog', 'triage', 'completed', 'canceled']
const PRIORITIES = [1, 2, 3, 4, 0]
const PRIORITY_NAMES: Record<number, string> = { 0: 'No priority', 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low' }

export function FilterPanel() {
  const graph = useGraphStore((s) => s.graph)
  const filters = useViewStore((s) => s.filters)
  const { schema, primaryGroupSingular } = useSchemaStore()
  const setFilter = useViewStore((s) => s.setFilter)
  const toggleStateType = useViewStore((s) => s.toggleStateType)
  const togglePrimary = useViewStore((s) => s.togglePrimary)
  const toggleType = useViewStore((s) => s.toggleType)
  const togglePriority = useViewStore((s) => s.togglePriority)
  const toggleAssignee = useViewStore((s) => s.toggleAssignee)
  const togglePrefix = useViewStore((s) => s.togglePrefix)
  const resetFilters = useViewStore((s) => s.resetFilters)

  const issues = graph?.data.issues ?? []

  const counts = useMemo(() => {
    const byState: Record<string, number> = {}
    const byPrio: Record<number, number> = {}
    const byAssignee = new Map<string, number>()
    const byLabel = new Map<string, number>()
    for (const i of issues) {
      byState[i.state.type] = (byState[i.state.type] ?? 0) + 1
      byPrio[i.priority] = (byPrio[i.priority] ?? 0) + 1
      const a = i.assignee?.displayName ?? '(unassigned)'
      byAssignee.set(a, (byAssignee.get(a) ?? 0) + 1)
      for (const l of i.labels) byLabel.set(l.id, (byLabel.get(l.id) ?? 0) + 1)
    }
    return { byState, byPrio, byAssignee, byLabel }
  }, [issues])

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

  return (
    <aside className="filter-panel">
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
        {ALL_STATES.map((s) => (
          <label key={s}>
            <input type="checkbox" checked={filters.stateTypes.includes(s)} onChange={() => toggleStateType(s)} />
            {stateLabel(s)}
            <span className="count">{counts.byState[s] ?? 0}</span>
          </label>
        ))}
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
