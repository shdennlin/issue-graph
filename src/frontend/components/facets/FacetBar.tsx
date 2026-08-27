// Horizontal filter bar: active filters render as removable chips, everything
// else costs no space until you ask for it via "+ Filter".
//
// Intentionally thin. Which facets exist, what they contain and which chips to
// draw all come from facetModel (pure, tested); mutation goes through
// viewStore's existing toggle actions, which carry semantics that are not a
// function of `Filters` alone — notably `toggleStateType` auto-clearing
// `activeOnly`. Anything written into this JSX is untestable by construction,
// because vitest runs `environment: 'node'` with no DOM.

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Pin, PinOff, Plus, RotateCcw, X } from 'lucide-react'
import type { IssueStateType } from '@shared/types.js'
import { useGraphStore } from '../../store/graphStore'
import { defaultFilters, useViewStore } from '../../store/viewStore'
import { useSchemaStore } from '../../store/schemaStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { isPinned, readPins, togglePin, writePins } from '../../lib/pinnedFilters'
import { useClickOutside } from '../../hooks/useClickOutside'
import { fuzzyScore } from '../quickSwitcher/fuzzyMatch'
import { stateColorVar, stateLabelFor } from '../../lib/colors'
import { useLocale, useT } from '../../i18n'
import { useSavedViewsStore } from '../../store/savedViewsStore'
import { savedViewStatus } from '../../lib/savedViewMatch'
import { applySavedQuery } from '../../store/urlSync'
import { SavedViewsChip } from './SavedViewsChip'
import { useFilterCounts } from './useFilterCounts'
import {
  buildFacets,
  chipsFromFilters,
  clearFacetPatch,
  isFacetAtDefault,
  isNegated,
  partitionPinned,
  toggleNegated,
  searchFacetValues,
  selectedValues,
  toggleValue,
  type FacetSearchHit,
  type FacetDef,
  type FacetOption,
  type PinnedFilter,
} from './facetModel'

/** Long option lists get a search box; short ones would just be noise. */
const SEARCH_THRESHOLD = 8
/** Cross-facet search results are capped — see searchFacetValues for why. */
const SEARCH_RESULT_LIMIT = 12

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

  // How many values each facet currently has applied, so the picker can show
  // "State 5" rather than the number of states that exist.
  const activeCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of facets) {
      if (isFacetAtDefault(filters, f, defaultFilters)) continue
      m.set(f.id, selectedValues(filters, f).length)
    }
    return m
  }, [facets, filters])

  // Only offered when something actually differs from the defaults — unlike
  // the chips, which deliberately surface non-neutral defaults too.
  const anyNonDefault = facets.some((f) => !isFacetAtDefault(filters, f, defaultFilters))

  // The view to revert TO: one that was applied and has since been edited.
  const savedViews = useSavedViewsStore((s) => s.views)
  const appliedId = useSavedViewsStore((s) => s.appliedId)
  const setAppliedId = useSavedViewsStore((s) => s.setAppliedId)
  const { view: statusView, dirty } = savedViewStatus(window.location.search, savedViews, appliedId)
  const dirtyView = dirty ? statusView : null

  // Being ON a saved view is itself a state worth being able to leave, even
  // when that view's filters happen to equal the defaults — which is exactly
  // when the old `anyNonDefault` test hid the button and left no way out.
  const canReset = anyNonDefault || statusView !== null

  const chips = useMemo(
    () => chipsFromFilters(filters, facets, t),
    [filters, facets, t],
  )

  const facetById = (id: string) => facets.find((f) => f.id === id)

  const clearFacet = (facet: FacetDef) => {
    const patch = clearFacetPatch(facet, filters)
    for (const [k, v] of Object.entries(patch)) {
      setFilter(k as keyof typeof filters, v as never)
    }
  }

  // The picker lists EVERY facet, including ones already in use. Filtering it
  // down to untouched facets seemed to avoid duplicating the chips, but chips
  // are a summary while the picker is navigation — hiding an active facet meant
  // that once you had picked one state, "+ Filter -> State" no longer existed
  // and there was no obvious way back in to add a second.
  const availableFacets = facets


  return (
    <div className="facet-bar">
      {/* Leads the panel: a saved view sets everything below it. */}
      <SavedViewsChip />
      <div className="facet-sep" />

      {/* Second row, above the chips rather than after them. Sitting below a
          growing list meant every filter added pushed this button down and the
          open menu jumped with it — so you could not pick several in a row
          without chasing the thing you were clicking. */}
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
            activeCounts={activeCounts}
            pins={pins}
            onTogglePin={(p) => applyPins(togglePin(pins, p))}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>

      {chips.length > 0 && <div className="facet-sep" />}
      {chips.map((chip) => {
        const facet = facetById(chip.facetId)
        if (!facet) return null
        return (
          // A row, not a pill. Pills are a horizontal-flow device — stacked
          // full-width in a narrow panel their rounded caps mean nothing and
          // six outlines compete with the panel's own. Structure comes from
          // column alignment instead, so the panel carries one border total.
          <div
            className={`facet-chip-wrap facet-row${chip.operator === 'isNotAnyOf' ? ' is-negated' : ''}`}
            key={chip.facetId}
            style={chip.tint ? { ['--chip-tint' as string]: chip.tint } : undefined}
          >
            <span className="facet-row-label" title={chip.title}>
              {chip.title}
            </span>
            {chip.operator && facet.selection === 'multi' && (
              // Only legible when it deviates. "is any of" is the default, so
              // showing it always spent a third of the row's width restating
              // what the absence of a marker already says.
              <button
                type="button"
                className="facet-row-op"
                onClick={() => setFilter('negated', toggleNegated(filters, facet))}
                title={t(
                  chip.operator === 'isNotAnyOf'
                    ? 'filterPanel.chipIsNotAnyOf'
                    : 'filterPanel.chipIsAnyOf',
                )}
                aria-pressed={chip.operator === 'isNotAnyOf'}
                aria-label={t('filterPanel.toggleNegate')}
              >
                {chip.operator === 'isNotAnyOf' ? t('filterPanel.opNot') : t('filterPanel.opIs')}
              </button>
            )}
            {chip.summary && (
              <button
                type="button"
                className="facet-row-value"
                onClick={() => setOpenFacetId(openFacetId === facet.id ? null : facet.id)}
                aria-expanded={openFacetId === facet.id}
              >
                {chip.tint && <span className="facet-row-dot" />}
                <span className="facet-row-text">{chip.summary}</span>
              </button>
            )}
            <button
              type="button"
              className="facet-row-x"
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

      {/* Two different destinations, so they are two buttons rather than one
          that changes meaning. "Clear all" used to be neither: chips now
          include constraints live at their defaults, so it never hid, and
          wiping every filter is rarely what you want after tweaking a view. */}
      {dirtyView && (
        <button
          type="button"
          className="facet-clear-all"
          onClick={() => applySavedQuery(dirtyView.query)}
          title={dirtyView.name}
        >
          <RotateCcw size={11} /> {t('savedViews.revert')}
        </button>
      )}
      {canReset && (
        <button
          type="button"
          className="facet-clear-all"
          onClick={() => {
            resetFilters()
            // Leaving the view deliberately, so drop it as the reference point
            // rather than reporting "temp *" — the name reverts to the generic
            // label, which is the honest description of where you now are.
            setAppliedId(null)
          }}
        >
          <RotateCcw size={11} /> {t('filterPanel.resetDefaults')}
        </button>
      )}
    </div>
  )
}


/**
 * Binds a facet's option clicks to the store actions that own its semantics.
 *
 * Not a pure reducer, deliberately: `toggleStateType` auto-clears `activeOnly`,
 * and checking a completed/canceled state has to widen the sync window or the
 * result looks empty. Neither is a function of `Filters`.
 */
function useFacetPick(facet: FacetDef) {
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
  // has to widen the scope — otherwise the user sees a near-empty result and
  // reads it as a broken filter. Carried over from the sidebar verbatim.
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
    }
  }

  return { pick, selected }
}

/**
 * The option rows for one facet: search box when the list is long, then a
 * checkbox row per value (plus nested children for the two-level facets).
 *
 * Shared by the chip popover and the picker's submenu so the two can never
 * drift apart.
 */
function FacetOptionList({
  facet,
  pins,
  onTogglePin,
}: {
  facet: FacetDef
  pins: PinnedFilter[]
  onTogglePin: (pin: PinnedFilter) => void
}) {
  const t = useT()
  const [query, setQuery] = useState('')
  const filters = useViewStore((s) => s.filters)
  const { pick, selected } = useFacetPick(facet)
  // Counts are leave-one-out: "pick this and N issues remain". Under negation
  // picking a value EXCLUDES it, so that number is answering a question nobody
  // asked. Suppressed rather than recomputed as a complement — an honest gap
  // beats a confident wrong number.
  const negated = isNegated(filters, facet)

  if (facet.selection === 'toggle') {
    return (
      <button type="button" className="facet-option" onClick={() => pick('', false)}>
        {/* toggleValue, not `selected` — for quick:active the two are opposite,
            and using `selected` ticked "Active only" when it was switched off. */}
        <span className="facet-checkbox" data-checked={toggleValue(filters, facet)} />
        <span className="facet-option-label">{facet.title}</span>
      </button>
    )
  }

  const q = query.trim().toLowerCase()
  const matches = (o: FacetOption) =>
    o.label.toLowerCase().includes(q) ||
    (o.children ?? []).some((c) => c.label.toLowerCase().includes(q))
  // Pinned values sit at the top: pinning is purely a display preference here,
  // which is what keeps it from being a second representation of filter state.
  const { pinned, rest } = partitionPinned(facet, pins)
  const visiblePinned = q ? pinned.filter(matches) : pinned
  const visibleRest = q ? rest.filter(matches) : rest

  const renderOption = (o: FacetOption, isChild: boolean, parentValue?: string) => {
    const pin: PinnedFilter = { facetId: facet.id, value: o.value }
    const pinned = isPinned(pins, pin)
    return (
      // A row rather than one button: the pin toggle is a second control, and
      // HTML forbids nesting a button inside a button.
      <div className="facet-option-row" key={o.value}>
        <button
          type="button"
          className={`facet-option${isChild ? ' is-child' : ''}${selected.has(o.value) ? ' is-selected' : ''}`}
          onClick={() => pick(o.value, isChild, parentValue)}
        >
          {/* `single` facets are mutually exclusive, so their box is round —
              the same convention as a radio, without the input semantics that
              made click-to-clear awkward in the old sidebar. */}
          <span
            className={`facet-checkbox${facet.selection === 'single' ? ' is-radio' : ''}`}
            data-checked={selected.has(o.value)}
          />
          {o.tint && <span className="facet-option-dot" style={{ background: o.tint }} />}
          <span className="facet-option-label">{o.label}</span>
          {o.count !== undefined && !negated && (
            <span className="facet-option-count">{o.count}</span>
          )}
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
        {visiblePinned.length + visibleRest.length === 0 && (
          <div className="facet-empty">{t('filterPanel.noFacetMatch')}</div>
        )}
        {visiblePinned.map((o) => (
          <div key={o.value}>
            {renderOption(o, false)}
            {(o.children ?? []).map((c) => renderOption(c, true, o.value))}
          </div>
        ))}
        {visiblePinned.length > 0 && visibleRest.length > 0 && <div className="facet-divider" />}
        {visibleRest.map((o) => (
          <div key={o.value}>
            {renderOption(o, false)}
            {(o.children ?? []).map((c) => renderOption(c, true, o.value))}
          </div>
        ))}
      </div>
    </>
  )
}

/** A facet's options on their own, anchored to a chip. */
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
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, true, onClose)
  return (
    <div className="facet-popover" ref={ref}>
      <FacetOptionList facet={facet} pins={pins} onTogglePin={onTogglePin} />
    </div>
  )
}

/**
 * Cascading "Add filter" menu: the facet list stays put while the highlighted
 * row's options fly out beside it.
 *
 * Both hover and click open a submenu. Hover alone would strand keyboard and
 * touch users; click alone loses the speed that makes a cascading menu worth
 * having over the previous replace-in-place popover.
 */
function FacetPicker({
  facets,
  activeCounts,
  pins,
  onTogglePin,
  onClose,
}: {
  facets: FacetDef[]
  activeCounts: Map<string, number>
  pins: PinnedFilter[]
  onTogglePin: (pin: PinnedFilter) => void
  onClose: () => void
}) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  // The submenu aligns with the row that opened it, so it cannot live inside
  // the row: `.facet-option-list` scrolls, and a scroll container clips
  // absolutely-positioned children. It stays a sibling of the list and takes
  // its offset from the row instead.
  const [openRow, setOpenRow] = useState<HTMLElement | null>(null)
  const [subTop, setSubTop] = useState(0)
  useClickOutside(ref, true, onClose)

  useLayoutEffect(() => {
    if (!openRow) return
    const list = listRef.current
    // offsetParent is the popover (the list itself is unpositioned), so
    // offsetTop is already in the coordinate space the submenu is placed in.
    // Subtracting scrollTop keeps them aligned while the list scrolls; the 4px
    // accounts for the submenu's own padding so the first option lines up with
    // the row rather than sitting 4px below it.
    const update = () => setSubTop(openRow.offsetTop - (list?.scrollTop ?? 0) - 4)
    update()
    list?.addEventListener('scroll', update)
    return () => list?.removeEventListener('scroll', update)
  }, [openRow])

  const q = query.trim().toLowerCase()
  const visible = q ? facets.filter((f) => f.title.toLowerCase().includes(q)) : facets
  const openFacet = visible.find((f) => f.id === openId) ?? null

  // A query searches VALUES across every facet, not just dimension names — the
  // dimension is the part you already know, and you open this menu because you
  // remember the value, not the taxonomy it was filed under.
  const hits = useMemo(
    () => searchFacetValues(facets, query, fuzzyScore, SEARCH_RESULT_LIMIT),
    [facets, query],
  )

  return (
    <div className="facet-popover facet-menu" ref={ref} role="menu">
      <input
        className="facet-search"
        value={query}
        autoFocus
        placeholder={t('filterPanel.addFilterPlaceholder')}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpenId(null)
          setOpenRow(null)
        }}
      />
      <div className="facet-option-list" ref={listRef}>
        {visible.length === 0 && hits.length === 0 && (
          <div className="facet-empty">{t('filterPanel.noFacetMatch')}</div>
        )}
        {visible.map((f) => (
          <button
            type="button"
            role="menuitem"
            className={`facet-option${openId === f.id ? ' is-open' : ''}`}
            key={f.id}
            onMouseEnter={(e) => {
              setOpenId(f.id)
              setOpenRow(e.currentTarget)
            }}
            onFocus={(e) => {
              setOpenId(f.id)
              setOpenRow(e.currentTarget)
            }}
            onClick={(e) => {
              setOpenId(f.id)
              setOpenRow(e.currentTarget)
            }}
            aria-haspopup={f.options.length > 0 ? 'menu' : undefined}
            aria-expanded={openId === f.id}
          >
            <span className="facet-option-label">{f.title}</span>
            {/* Shows what is already picked when the facet is in use, and how
                much there is to pick from when it is not — so the picker keeps
                advertising what is filterable, the discoverability the sidebar
                gave away for free. */}
            {f.options.length > 0 &&
              (activeCounts.get(f.id) ? (
                <span className="facet-option-count is-active">{activeCounts.get(f.id)}</span>
              ) : (
                <span className="facet-option-count">{f.options.length}</span>
              ))}
            {f.options.length > 0 && <ChevronRight size={12} />}
          </button>
        ))}

        {hits.length > 0 && (
          <>
            {visible.length > 0 && <div className="facet-divider" />}
            {hits.map((h) => (
              <FacetSearchRow key={`${h.facet.id}:${h.option.value}`} hit={h} />
            ))}
          </>
        )}
      </div>

      {openFacet && (
        <div className="facet-submenu" key={openFacet.id} style={{ top: subTop }}>
          <FacetOptionList facet={openFacet} pins={pins} onTogglePin={onTogglePin} />
        </div>
      )}
    </div>
  )
}

/**
 * One cross-facet search result: "Dimension › Value", applied on click.
 *
 * Its own component because the toggle actions come from a hook, and a hook
 * cannot be called inside the `.map()` that produces these rows.
 */
function FacetSearchRow({ hit }: { hit: FacetSearchHit }) {
  const { pick, selected } = useFacetPick(hit.facet)
  const isSelected = selected.has(hit.option.value)
  return (
    <button
      type="button"
      className={`facet-option${isSelected ? ' is-selected' : ''}`}
      onClick={() => pick(hit.option.value, hit.isChild, hit.parentValue)}
    >
      <span
        className={`facet-checkbox${hit.facet.selection === 'single' ? ' is-radio' : ''}`}
        data-checked={isSelected}
      />
      <span className="facet-option-label">
        <span className="facet-hit-facet">{hit.facet.title}</span>
        {hit.option.label}
      </span>
      {hit.option.count !== undefined && (
        <span className="facet-option-count">{hit.option.count}</span>
      )}
    </button>
  )
}
