// Build the notification scope directly, with the facet UI the graph uses.
//
// Until now the scope could only be *copied* — pick a saved view, or snapshot
// whatever the facet bar happened to hold. Both take the answer to a different
// question ("what do I draw?") and reuse it for this one ("what should
// interrupt me?"), so expressing a scope that no view describes meant building
// the view first, saving it, and then throwing it away.
//
// The draft is local and nothing leaves this component until Save. That is the
// difference from the facet bar, where every click is immediately the truth:
// here a half-built filter would silence real notifications while you were
// still assembling it.

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useNotificationStore } from '../store/notificationStore'
import { useSchemaStore } from '../store/schemaStore'
import { defaultFilters, type Filters } from '../store/viewStore'
import { applyFacetPick } from '../store/filterToggles'
import { serializeFilters } from '../store/filterCodec'
import { parseScope } from '../lib/notificationScope'
import { stateColorVar, stateLabelFor } from '../lib/colors'
import { useFilterCounts } from './facets/useFilterCounts'
import {
  buildFacets,
  isNegated,
  selectedValues,
  toggleValue,
  type FacetDef,
  type FacetOption,
} from './facets/facetModel'
import { useLocale, useT } from '../i18n'

/**
 * The disclosure. Owns nothing but `open`, so the body — and the five
 * leave-one-out passes behind its counts — does not run while Settings is
 * merely mounted. The dropdown and "Use my current filters" above stay the
 * quick paths; this is the one you open when neither of them can say it.
 */
export function NotificationScopeEditor() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const scopeQuery = useNotificationStore((s) => s.scopeQuery)

  return (
    <div className="notif-scope-editor">
      <button
        type="button"
        className="notif-scope-disclosure"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {t(open ? 'notifications.scopeEditClose' : 'notifications.scopeEditOpen')}
      </button>
      {/* Keyed on the stored query so choosing a saved view from the dropdown
          while this is open re-seeds the draft. The alternative — an effect
          that copies scopeQuery into state — is the set-state-in-effect that
          eslint-plugin-react-hooks v7 flags, and it would have left the draft
          stale for one render either way. */}
      {open && <ScopeEditorBody key={scopeQuery} onDone={() => setOpen(false)} />}
    </div>
  )
}

function ScopeEditorBody({ onDone }: { onDone: () => void }) {
  const t = useT()
  const locale = useLocale()
  const scopeQuery = useNotificationStore((s) => s.scopeQuery)
  const setScopeQuery = useNotificationStore((s) => s.setScopeQuery)
  const { schema, primaryGroupSingular } = useSchemaStore()

  // Seeded once, at mount.
  //
  // `parseScope` returns null for "notify me about everything", so opening the
  // editor from that state needs a Filters that genuinely constrains nothing.
  // `defaultFilters` is NOT that: its `stateTypes` holds four of the six types,
  // so saving an untouched draft would quietly turn "everything" into
  // "everything except Completed and Canceled" — the transitions an
  // agent-review notification exists to report. An empty `stateTypes` is the
  // neutral value: `applyFilters` skips the state check entirely when the list
  // is empty, and the codec round-trips it as `state=any`.
  const [draft, setDraft] = useState<Filters>(
    () => parseScope(scopeQuery)?.filters ?? { ...defaultFilters, stateTypes: [] },
  )
  const [draftSearch, setDraftSearch] = useState<string>(
    () => parseScope(scopeQuery)?.search ?? '',
  )

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
  } = useFilterCounts({ filters: draft, search: draftSearch })

  // Same shape as FacetBar's, and for the same reason: prefix sections come
  // straight off the detected schema and each becomes a facet titled with the
  // literal token.
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
        filters: draft,
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
      draft,
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

  const save = () => {
    setScopeQuery(serializeFilters({ filters: draft, search: draftSearch }).toString())
    onDone()
  }

  return (
    <div className="notif-scope-build">
      <div className="settings-help">{t('notifications.scopeEditHint')}</div>

      <label className="notif-scope-search">
        <span>{t('notifications.scopeEditSearch')}</span>
        <input
          value={draftSearch}
          placeholder={t('notifications.scopeEditSearchPlaceholder')}
          onChange={(e) => setDraftSearch(e.target.value)}
        />
      </label>

      {/* Only the dimensions the cached graph currently has values for:
          `buildFacets` drops a facet with nothing in it. A stored scope that
          constrains such a dimension is therefore carried by the draft and
          preserved on Save, but cannot be edited here until the data comes
          back — the same blind spot the scope *summary* above already documents,
          and it errs the same safe way, by keeping a constraint rather than
          quietly dropping one. */}
      <div className="notif-facet-grid">
        {facets.map((facet) => (
          <ScopeFacet
            key={facet.id}
            facet={facet}
            draft={draft}
            onPick={(value, isChild) =>
              setDraft((d) => applyFacetPick(d, facet, value, isChild))
            }
          />
        ))}
      </div>

      <div className="notif-scope-actions">
        <button type="button" className="is-primary" onClick={save}>
          {t('notifications.scopeEditSave')}
        </button>
        {/* Closing IS the revert: the body unmounts and the draft with it, so
            reopening seeds from the stored query again. */}
        <button type="button" onClick={onDone}>
          {t('notifications.scopeEditCancel')}
        </button>
      </div>
    </div>
  )
}

/** One dimension: a title and its option rows, children nested one level. */
function ScopeFacet({
  facet,
  draft,
  onPick,
}: {
  facet: FacetDef
  draft: Filters
  onPick: (value: string, isChild: boolean) => void
}) {
  const t = useT()
  const selected = new Set(selectedValues(draft, facet))
  // Leave-one-out counts answer "pick this and N remain". Under negation
  // picking a value EXCLUDES it, so the number describes the wrong set —
  // suppressed rather than complemented, as in the facet bar.
  const negated = isNegated(draft, facet)

  const row = (o: FacetOption, isChild: boolean) => (
    <button
      type="button"
      key={o.value}
      className={`facet-option${isChild ? ' is-child' : ''}${selected.has(o.value) ? ' is-selected' : ''}`}
      onClick={() => onPick(o.value, isChild)}
    >
      <span
        className={`facet-checkbox${facet.selection === 'single' ? ' is-radio' : ''}`}
        data-checked={selected.has(o.value)}
      />
      {o.tint && <span className="facet-option-dot" style={{ background: o.tint }} />}
      <span className="facet-option-label">{o.label}</span>
      {o.count !== undefined && !negated && <span className="facet-option-count">{o.count}</span>}
    </button>
  )

  return (
    <div className="notif-facet">
      {/* A negated dimension ticks the values it EXCLUDES, and a checkbox looks
          the same either way. The facet bar can leave that to the chip row's
          NOT button; a bare option grid has no such carrier, so the inversion
          has to ride on the title or an exclusion reads as an allow-list. */}
      <div className="notif-facet-title">
        {facet.title}
        {negated && <span className="notif-facet-not">{t('notifications.scopeIsNot')}</span>}
      </div>
      {facet.selection === 'toggle' ? (
        // `toggleValue`, not `selected` — the two are the same for both current
        // quick filters and were opposite for the one that used to default to
        // on, which is the bug this spelling prevents coming back.
        <button type="button" className="facet-option" onClick={() => onPick('', false)}>
          <span className="facet-checkbox" data-checked={toggleValue(draft, facet)} />
          <span className="facet-option-label">{facet.title}</span>
        </button>
      ) : (
        facet.options.map((o) => (
          <div key={o.value}>
            {row(o, false)}
            {(o.children ?? []).map((c) => row(c, true))}
          </div>
        ))
      )}
    </div>
  )
}
