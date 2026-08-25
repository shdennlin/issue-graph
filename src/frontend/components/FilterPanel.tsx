import { useCallback, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, HelpCircle, X } from 'lucide-react'
import type { IssueStateType } from '@shared/types.js'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { useSchemaStore } from '../store/schemaStore'
import { useResizable } from '../hooks/useResizable'
import { stateColorVar, stateIcon, stateLabelFor } from '../lib/colors'
import { NO_MILESTONE_TOKEN } from '../views/filters'
import { shortPrefixDisplay } from '../lib/labelSchema'
import { projectColor } from '../lib/projectColor'
import { Tooltip } from './Tooltip'
import { useLocale, useT, type DictKey } from '../i18n'
import { useFilterCounts } from './facets/useFilterCounts'

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
  const filters = useViewStore((s) => s.filters)
  const { schema, primaryGroupSingular } = useSchemaStore()
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

  // Every derivation below used to live inline here; it now lives in
  // useFilterCounts so the facet bar can share it. The memoization moved
  // verbatim — see that module's header for why it is load-bearing.
  const {
    counts,
    stateNamesByType,
    primaryLabels,
    typeLabels,
    otherLabelSections,
    assignees,
    projectsWithMilestones,
    showDesigndocFilter,
    showDueFilter,
  } = useFilterCounts()

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
              {shortPrefixDisplay(l.name, g.token)}
              <span className="count">{counts.byLabel.get(l.id) ?? 0}</span>
            </label>
          ))}
        </CollapsibleSection>
      ))}

      {otherLabelSections.map((sec) => {
        const isOrphan = sec.kind === 'orphan'
        const selected = isOrphan ? filters.orphanValues : (filters.groupSelections[sec.key] ?? [])
        // autodetect measures exclusivity empirically — a group is exclusive
        // when no issue in the cache carries two of its labels. Picking two
        // would then always yield the same result as picking one, so the
        // control is a radio. Clicking the active one clears it (a radio
        // fires no change event in that case, hence onClick).
        const exclusive =
          !isOrphan && (schema.otherGroups.find((g) => g.name === sec.key)?.exclusive ?? false)
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
              <label key={l.id} title={exclusive ? t('filterPanel.exclusiveHint') : undefined}>
                <input
                  type={exclusive ? 'radio' : 'checkbox'}
                  name={exclusive ? `filter-group-${sec.key}` : undefined}
                  checked={selected.includes(l.id)}
                  onChange={() => {
                    if (exclusive) return
                    if (isOrphan) toggleOrphan(l.id)
                    else toggleGroupLabel(sec.key, l.id)
                  }}
                  onClick={() => {
                    if (!exclusive) return
                    setFilter('groupSelections', {
                      ...filters.groupSelections,
                      [sec.key]: selected.includes(l.id) ? [] : [l.id],
                    })
                  }}
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

      {/* Unconditional, unlike the due/designdoc sections: every issue has
          createdAt/updatedAt, so there is no empty-data case that would leave
          this as dead UI. */}
      <CollapsibleSection
        id="time"
        title={t('filterPanel.recency')}
        activeCount={filters.recencyWindow !== 'any' ? 1 : 0}
        onClear={() => {
          setFilter('recencyWindow', 'any')
          setFilter('recencyMode', 'updated')
        }}
      >
        {(['updated', 'created'] as const).map((m) => (
          <label key={m}>
            <input
              type="radio"
              name="recencyMode"
              checked={filters.recencyMode === m}
              onChange={() => setFilter('recencyMode', m)}
            />
            {m === 'updated'
              ? t('filterPanel.recencyModeUpdated')
              : t('filterPanel.recencyModeCreated')}
          </label>
        ))}
        <div className="sep-h" />
        {(['any', 'today', '7d', '30d'] as const).map((w) => (
          <label key={w}>
            <input
              type="radio"
              name="recencyWindow"
              checked={filters.recencyWindow === w}
              onChange={() => setFilter('recencyWindow', w)}
            />
            {w === 'any'
              ? t('filterPanel.recencyAny')
              : w === 'today'
                ? t('filterPanel.recencyToday')
                : w === '7d'
                  ? t('filterPanel.recency7d')
                  : t('filterPanel.recency30d')}
          </label>
        ))}
      </CollapsibleSection>

      <button onClick={resetFilters} className="filter-reset">{t('filterPanel.resetFilters')}</button>
    </aside>
  )
}
