// Horizontal filter bar: active filters render as removable chips, everything
// else costs no space until you ask for it via "+ Filter".
//
// Intentionally thin. Which facets exist, what they contain and which chips to
// draw all come from facetModel (pure, tested); mutation goes through
// viewStore's existing toggle actions, which carry semantics that are not a
// function of `Filters` alone — notably `toggleStateType` auto-clearing
// `activeOnly`. Anything written into this JSX is untestable by construction,
// because vitest runs `environment: 'node'` with no DOM.

import { useMemo, useRef, useState } from 'react'
import { ChevronDown, Pin, PinOff, Plus, X } from 'lucide-react'
import type { IssueStateType } from '@shared/types.js'
import { useGraphStore } from '../../store/graphStore'
import { defaultFilters, useViewStore } from '../../store/viewStore'
import { useSchemaStore } from '../../store/schemaStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { isPinned, readPins, togglePin, writePins } from '../../lib/pinnedFilters'
import { useClickOutside } from '../../hooks/useClickOutside'
import { stateColorVar, stateLabelFor } from '../../lib/colors'
import { useLocale, useT } from '../../i18n'
import { SavedViewsChip } from './SavedViewsChip'
import { useFilterCounts } from './useFilterCounts'
import {
  buildFacets,
  chipsFromFilters,
  clearFacetPatch,
  isFacetAtDefault,
  pinnedChips,
  selectedValues,
  type FacetDef,
  type FacetOption,
  type PinnedFilter,
} from './facetModel'

/** Long option lists get a search box; short ones would just be noise. */
const SEARCH_THRESHOLD = 8

export function FacetBar() {
  const t = useT()
  const locale = useLocale()
  const filters = useViewStore((s) => s.filters)
  const setFilter = useViewStore((s) => s.setFilter)
  const resetFilters = useViewStore((s) => s.resetFilters)
  const { schema, primaryGroupSingular } = useSchemaStore()
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

  const [openFacetId, setOpenFacetId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  // Pins live in localStorage, so they are mirrored into state rather than read
  // during render — reading storage in a render body is both a side effect and
  // a way to miss updates.
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const [pins, setPins] = useState<PinnedFilter[]>(() => readPins(workspaceId))
  const [pinnedFor, setPinnedFor] = useState<string | null>(workspaceId)
  if (pinnedFor !== workspaceId) {
    // Workspace changed: swap in that workspace's own pins. Pins hold raw
    // label/project/assignee tokens, which mean nothing elsewhere.
    setPinnedFor(workspaceId)
    setPins(readPins(workspaceId))
  }
  const applyPins = (next: PinnedFilter[]) => {
    setPins(next)
    writePins(workspaceId, next)
  }

  // Prefix sections come straight off the detected schema; each becomes its own
  // facet titled with the literal token.
  const prefixSections = useMemo(
    () =>
      (schema.prefixes ?? []).map((g) => ({
        token: g.token,
        labels: [...g.labels].sort((a, b) => a.name.localeCompare(b.name)),
      })),
    [schema.prefixes],
  )

  const facets = useMemo(
    () =>
      buildFacets({
        filters,
        t,
        schema,
        primaryGroupSingular,
        counts,
        stateNamesByType,
        primaryLabels,
        typeLabels,
        otherLabelSections,
        prefixSections,
        assignees,
        projectsWithMilestones,
        stateColor: (s) => stateColorVar(s),
        stateLabel: (s) => stateLabelFor(s, locale),
        showDesigndocFilter,
        showDueFilter,
      }),
    [
      filters,
      t,
      schema,
      primaryGroupSingular,
      counts,
      stateNamesByType,
      primaryLabels,
      typeLabels,
      otherLabelSections,
      prefixSections,
      assignees,
      projectsWithMilestones,
      locale,
      showDesigndocFilter,
      showDueFilter,
    ],
  )

  const chips = useMemo(
    () => chipsFromFilters(filters, facets, t, defaultFilters),
    [filters, facets, t],
  )
  const inactivePins = useMemo(() => pinnedChips(filters, facets, pins), [filters, facets, pins])

  const facetById = (id: string) => facets.find((f) => f.id === id)

  const clearFacet = (facet: FacetDef) => {
    const patch = clearFacetPatch(facet, filters, defaultFilters)
    for (const [k, v] of Object.entries(patch)) {
      setFilter(k as keyof typeof filters, v as never)
    }
  }

  // Facets the picker offers: everything currently at its default. Once a facet
  // is active it already has a chip, so listing it again would be redundant.
  const availableFacets = facets.filter((f) => isFacetAtDefault(filters, f, defaultFilters))

  return (
    <div className="facet-bar">
      {/* Leads the bar: a saved view sets everything to its right. */}
      <SavedViewsChip />
      <div className="facet-sep" />
      {chips.map((chip) => {
        const facet = facetById(chip.facetId)
        if (!facet) return null
        return (
          <div className="facet-chip-wrap" key={chip.facetId}>
            <button
              type="button"
              className="facet-chip is-active"
              onClick={() => setOpenFacetId(openFacetId === facet.id ? null : facet.id)}
              aria-expanded={openFacetId === facet.id}
              style={chip.tint ? { ['--chip-tint' as string]: chip.tint } : undefined}
            >
              <span className="facet-chip-title">{chip.title}</span>
              {chip.summary && <span className="facet-chip-value">{chip.summary}</span>}
              {facet.selection !== 'toggle' && <ChevronDown size={12} />}
            </button>
            <button
              type="button"
              className="facet-chip-x"
              onClick={() => clearFacet(facet)}
              aria-label={t('filterPanel.removeChip')}
              title={t('filterPanel.removeChip')}
            >
              <X size={11} />
            </button>
            {openFacetId === facet.id && (
              <FacetPopover
                facet={facet}
                pins={pins}
                onTogglePin={(p) => applyPins(togglePin(pins, p))}
                onClose={() => setOpenFacetId(null)}
              />
            )}
          </div>
        )
      })}

      {/* Pinned-but-inactive: one click away, but visually recessive so they
          never read as an applied filter. */}
      {inactivePins.map((chip) => {
        const facet = facetById(chip.facetId)
        if (!facet) return null
        const popoverId = `pin:${chip.facetId}:${chip.summary}`
        return (
          <div className="facet-chip-wrap" key={popoverId}>
            <button
              type="button"
              className="facet-chip is-pinned"
              onClick={() => setOpenFacetId(openFacetId === popoverId ? null : popoverId)}
              aria-expanded={openFacetId === popoverId}
              title={chip.title}
            >
              <Pin size={10} />
              <span className="facet-chip-value">{chip.summary}</span>
            </button>
            {openFacetId === popoverId && (
              <FacetPopover
                facet={facet}
                pins={pins}
                onTogglePin={(p) => applyPins(togglePin(pins, p))}
                onClose={() => setOpenFacetId(null)}
              />
            )}
          </div>
        )
      })}

      <div className="facet-chip-wrap">
        <button
          type="button"
          className="facet-chip facet-add"
          onClick={() => setPickerOpen((v) => !v)}
          aria-expanded={pickerOpen}
          aria-label={t('filterPanel.addFilterAria')}
        >
          <Plus size={12} /> {t('filterPanel.addFilter')}
        </button>
        {pickerOpen && (
          <FacetPicker
            facets={availableFacets}
            onPick={(id) => {
              setPickerOpen(false)
              setOpenFacetId(id)
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>

      {chips.length > 0 && (
        <button type="button" className="facet-clear-all" onClick={resetFilters}>
          {t('filterPanel.clearAll')}
        </button>
      )}
    </div>
  )
}

function FacetPicker({
  facets,
  onPick,
  onClose,
}: {
  facets: FacetDef[]
  onPick: (id: string) => void
  onClose: () => void
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, true, onClose)
  return (
    <div className="facet-popover" ref={ref} role="menu">
      {facets.length === 0 && <div className="facet-empty">{t('filterPanel.noFacetMatch')}</div>}
      {facets.map((f) => (
        <button
          type="button"
          role="menuitem"
          className="facet-option"
          key={f.id}
          onClick={() => onPick(f.id)}
        >
          <span className="facet-option-label">{f.title}</span>
          {/* Option count, so the picker still advertises what is filterable —
              the discoverability a sidebar gave away for free. */}
          {f.options.length > 0 && (
            <span className="facet-option-count">{f.options.length}</span>
          )}
        </button>
      ))}
    </div>
  )
}

function FacetPopover({
  facet,
  pins,
  onTogglePin,
  onClose,
}: {
  facet: FacetDef
  pins: PinnedFilter[]
  onTogglePin: (pin: PinnedFilter) => void
  onClose: () => void
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  useClickOutside(ref, true, onClose)

  const filters = useViewStore((s) => s.filters)
  const setFilter = useViewStore((s) => s.setFilter)
  const toggleStateType = useViewStore((s) => s.toggleStateType)
  const toggleStateName = useViewStore((s) => s.toggleStateName)
  const togglePrimary = useViewStore((s) => s.togglePrimary)
  const toggleType = useViewStore((s) => s.toggleType)
  const togglePriority = useViewStore((s) => s.togglePriority)
  const toggleAssignee = useViewStore((s) => s.toggleAssignee)
  const togglePrefix = useViewStore((s) => s.togglePrefix)
  const toggleGroupLabel = useViewStore((s) => s.toggleGroupLabel)
  const toggleOrphan = useViewStore((s) => s.toggleOrphan)
  const toggleProject = useViewStore((s) => s.toggleProject)
  const toggleMilestone = useViewStore((s) => s.toggleMilestone)

  const selected = new Set(selectedValues(filters, facet))

  // Completed/canceled data may sit outside the sync window, so checking one
  // has to widen the scope or the user sees a near-empty result and reads it
  // as a broken filter. Carried over from the sidebar verbatim.
  const extendIfArchival = (type: IssueStateType, willCheck: boolean) => {
    if (willCheck && (type === 'completed' || type === 'canceled')) {
      useGraphStore.getState().extendScope(365)
    }
  }

  const pick = (value: string, isChild: boolean, parentValue?: string) => {
    switch (facet.kind) {
      case 'quick':
        if (facet.id === 'quick:active') setFilter('activeOnly', !filters.activeOnly)
        else if (facet.id === 'quick:mine') setFilter('myIssuesOnly', !filters.myIssuesOnly)
        else setFilter('staleOnly', !filters.staleOnly)
        break
      case 'state':
        if (isChild) {
          if (parentValue) extendIfArchival(parentValue as IssueStateType, !selected.has(value))
          toggleStateName(value)
        } else {
          extendIfArchival(value as IssueStateType, !selected.has(value))
          toggleStateType(value as IssueStateType)
        }
        break
      case 'primary': togglePrimary(value); break
      case 'type': toggleType(value); break
      case 'priority': togglePriority(Number(value)); break
      case 'assignee': toggleAssignee(value); break
      case 'project':
        if (isChild) toggleMilestone(value)
        else toggleProject(value)
        break
      case 'prefix': togglePrefix(facet.id.slice('prefix:'.length), value); break
      case 'group': toggleGroupLabel(facet.id.slice('group:'.length), value); break
      case 'orphan': toggleOrphan(value); break
      case 'designdoc': setFilter('designdocFilter', value as 'all' | 'has' | 'missing'); break
      case 'due': setFilter('dueFilter', value as typeof filters.dueFilter); break
      case 'time': setFilter('recencyWindow', value as typeof filters.recencyWindow); break
      case 'tag': break
    }
  }

  const q = query.trim().toLowerCase()
  const visible = q
    ? facet.options.filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          (o.children ?? []).some((c) => c.label.toLowerCase().includes(q)),
      )
    : facet.options

  const renderOption = (o: FacetOption, isChild: boolean, parentValue?: string) => {
    const pin: PinnedFilter = { facetId: facet.id, value: o.value }
    const pinned = isPinned(pins, pin)
    return (
      // Row, not a button, because the pin toggle is a second control and HTML
      // forbids nesting one button inside another.
      <div className="facet-option-row" key={o.value}>
        <button
          type="button"
          className={`facet-option${isChild ? ' is-child' : ''}${selected.has(o.value) ? ' is-selected' : ''}`}
          onClick={() => pick(o.value, isChild, parentValue)}
        >
          {o.tint && <span className="facet-option-dot" style={{ background: o.tint }} />}
          <span className="facet-option-label">{o.label}</span>
          {o.count !== undefined && <span className="facet-option-count">{o.count}</span>}
        </button>
        <button
          type="button"
          className={`facet-pin${pinned ? ' is-pinned' : ''}`}
          onClick={() => onTogglePin(pin)}
          aria-label={pinned ? t('filterPanel.unpin') : t('filterPanel.pin')}
          title={pinned ? t('filterPanel.unpin') : t('filterPanel.pin')}
        >
          {pinned ? <PinOff size={11} /> : <Pin size={11} />}
        </button>
      </div>
    )
  }

  return (
    <div className="facet-popover" ref={ref}>
      {facet.selection === 'toggle' ? (
        <button type="button" className="facet-option" onClick={() => pick('', false)}>
          <span className="facet-option-label">{facet.title}</span>
        </button>
      ) : (
        <>
          {facet.options.length > SEARCH_THRESHOLD && (
            <input
              className="facet-search"
              value={query}
              autoFocus
              placeholder={t('filterPanel.facetSearch')}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <div className="facet-option-list">
            {visible.length === 0 && (
              <div className="facet-empty">{t('filterPanel.noFacetMatch')}</div>
            )}
            {visible.map((o) => (
              <div key={o.value}>
                {renderOption(o, false)}
                {(o.children ?? []).map((c) => renderOption(c, true, o.value))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
