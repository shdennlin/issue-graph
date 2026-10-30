// Workstreams — the cross-feature overview.
//
// The question it answers is "I have three features in flight; which one is
// stuck?" A card already shows one issue's stage and whether a session is on
// it, but nothing showed the shape of a FEATURE: which issues belong to it, in
// what order, and what is holding it up.
//
// Same rows the MCP's list_workstreams / get_workstream return, so a person and
// an agent are looking at one thing. Both can create, rename, add, remove and
// delete — a workstream is issue-graph's own data, so an agent writing it does
// not cross the boundary that keeps Linear's state single-writer.
//
// Order is NOT stored. The server topologically sorts members over `blocks`
// every read, so a relation edited in Linear reorders this list with nobody
// re-queuing anything.
//
// All decisions live in lib/agentSession.ts and lib/lifecycle.ts; this file is
// a shell, because vitest cannot test JSX in this repo.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, Pencil, Search, Trash2, X } from 'lucide-react'
import { api } from '../lib/api'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { compactAge, formatAbsolute } from '../lib/relativeTime'
import { stageTimeline } from '@shared/stageHistory.js'
import { isStale } from '@shared/staleness.js'
import { useT, type DictKey } from '../i18n'
import { visibleRows, type Scope, type SortKey, type StageFilter } from '../lib/workstreamList'

const AGE_UNIT_KEYS: Record<'m' | 'h' | 'd', DictKey> = {
  m: 'issueNode.ageMinutes',
  h: 'issueNode.ageHours',
  d: 'issueNode.ageDays',
}

interface Summary {
  id: number
  name: string
  /** The note's first line. There is no separate description column — a
   *  second free-text field beside the note would be two places to write one
   *  thing, and one of them always stale. */
  summary: string | null
  stage: string | null
  status: 'active' | 'archived'
  createdAt: number
  updatedAt: number
  archivedAt: number | null
  progress: { total: number; done: number }
}

const SCOPE_KEYS: Record<Scope, DictKey> = {
  active: 'workstreams.scopeActive',
  all: 'workstreams.scopeAll',
  archived: 'workstreams.scopeArchived',
}

export function WorkstreamsPanel() {
  const t = useT()
  const ageText = (ts: number) => {
    const a = compactAge(ts)
    return t(AGE_UNIT_KEYS[a.unit], { count: a.value })
  }
  const close = () => useViewStore.getState().setWorkstreamsOpen(false)
  const setActiveView = useViewStore((s) => s.setActiveView)
  const setFocusedWorkstreamId = useViewStore((s) => s.setFocusedWorkstreamId)
  const graph = useGraphStore((s) => s.graph)

  const [list, setList] = useState<Summary[]>([])
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  // Archived ones are off the board by design, but this panel is the one place
  // they have to remain reachable — otherwise archiving is indistinguishable
  // from deleting, and nobody would risk it.
  const [scope, setScope] = useState<Scope>('active')
  // The server is ALWAYS asked for archived rows too, and narrowing to a side
  // is the client's job (visibleRows). It used to fetch only what the scope
  // showed, which made the default "Active" scope claim "no workstreams yet"
  // on a workspace whose twenty workstreams were all archived — the screen
  // could not even say that they existed.
  // Two-step confirm, inline rather than window.confirm(): a browser that has
  // had "prevent this page creating more dialogs" ticked silently returns
  // false, and the dialog blocks the whole page besides. Keyed by
  // `<id>:<action>` so arming one row's delete does not arm another's.
  // Motivated by a real loss — a workstream went in one stray click.
  const [armed, setArmed] = useState<string | null>(null)
  // Finding one is the job of this screen once there are a few dozen, so search
  // is first in the toolbar and takes focus on open. Held in component state,
  // not the URL: it is a scratch filter for a modal, not a view to share.
  const [query, setQuery] = useState('')
  const [stageFilter, setStageFilter] = useState<StageFilter>(null)
  const [sort, setSort] = useState<SortKey>('updated')
  // Which row's name is being edited. The name is text until asked for — an
  // always-live <input> clips a long title at the box edge, which is exactly
  // what made these rows unreadable.
  const [renaming, setRenaming] = useState<number | null>(null)

  const stages = graph?.data.lifecycle ?? []
  // Read once per open rather than in the render body: reading the clock while
  // rendering is the impurity `react-hooks` flags, and it is right to — the
  // same render would otherwise produce a different duration each time.
  const [now] = useState(() => Date.now())
  const stageNames = new Map((graph?.data.lifecycle ?? []).map((st) => [st.key, st.name]))
  /** The history lives on the graph payload, which carries archived rows too —
   *  this modal is the one screen that lists them. */
  const eventsById = new Map((graph?.data.workstreams ?? []).map((w) => [w.id, w.stageEvents]))
  /** A key with no stage is one that was deleted or renamed. Shown as the raw
   *  key rather than dropped: the history is what happened, and a leg that
   *  vanished because somebody edited the pipeline afterwards would be a lie. */
  const stageName = (key: string) => stageNames.get(key) ?? key
  /** When each workstream arrived at its CURRENT stage, and how long that stage
   *  may run before it counts as stalled. Both are the board's own numbers, so
   *  this list and the board cannot disagree about what is stuck. */
  const enteredById = new Map((graph?.data.workstreams ?? []).map((w) => [w.id, w.stageEnteredAt]))
  const staleAfterByStage = new Map(stages.map((st) => [st.key, st.staleAfterDays]))

  // The summary endpoint does not carry when a workstream arrived at its
  // stage; the graph payload does. Joined here so the "on stage" sort has it,
  // keyed on the payload's array (not the per-render Map above) so it only
  // recomputes when the data does.
  const graphWorkstreams = graph?.data.workstreams
  const listWithArrival = useMemo(() => {
    const arrival = new Map((graphWorkstreams ?? []).map((w) => [w.id, w.stageEnteredAt]))
    return list.map((w) => ({ ...w, stageEnteredAt: arrival.get(w.id) ?? null }))
  }, [list, graphWorkstreams])
  const rows = useMemo(
    () => visibleRows(listWithArrival, { query, stage: stageFilter, sort, scope }),
    [listWithArrival, query, stageFilter, sort, scope],
  )

  const loadList = useCallback(async () => {
    try {
      setList((await api.fetchBatches(true)).entries)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // Inlined rather than `void loadList()`: calling a function that sets state
  // from inside an effect trips react-hooks/set-state-in-effect. Same shape as
  // LifecycleSettings' mount fetch, `live` guard and all — it is the pattern
  // this repo already passes lint with.
  useEffect(() => {
    let live = true
    api
      .fetchBatches(true)
      .then((r) => {
        if (live) setList(r.entries)
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      live = false
    }
  }, [])

  // No fetch here any more. Expanding used to pull the workstream's detail for
  // its member list; the history it shows instead already rides the graph
  // payload, so opening a row costs nothing.
  const toggle = (id: number) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Every mutation refreshes, including a failed one — otherwise the panel
   *  shows what was attempted rather than what the server holds. */
  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    await loadList()
    await useGraphStore.getState().refetchSilent()
  }

  /** Show only this workstream on the graph. Reuses chain isolation rather
   *  than adding a second "show a subset" mechanism. */
  // Focus THIS workstream on the board. It used to set `chainRootIds`, which
  // puts the graph into chain mode — and chain mode dissolves the workstream
  // view entirely (see views/workstream.ts), so the one control named
  // "isolate" was the one that could not isolate a workstream. Works for an
  // archived one too: the view lets an explicitly focused workstream through
  // its archived filter.
  const isolate = (id: number) => {
    setActiveView('workstream')
    setFocusedWorkstreamId(id)
    close()
  }

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal workstreams-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{t('workstreams.title')}</h3>
          <button onClick={close} aria-label={t('common.close')}>
            <X size={16} />
          </button>
        </div>

        {/* Disarms on a click that is NOT one of the arming buttons. Those
            stopPropagation, or the button's own click would bubble here and
            cancel the arm it had just set — which is what happened first. */}
        <div className="modal-body" onClick={() => setArmed(null)}>
          <p className="settings-hint">{t('workstreams.hint')}</p>

          <div className="workstream-toolbar">
            <label className="workstream-search">
              <Search size={16} />
              <input
                autoFocus
                type="search"
                value={query}
                placeholder={t('workstreams.searchPlaceholder')}
                aria-label={t('workstreams.search')}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {/* null = any stage, '' = on no stage. Distinct on purpose: the
                second is how you find what was never put on the pipeline. */}
            <select
              className="workstream-filter"
              aria-label={t('workstreams.filterStage')}
              value={stageFilter === null ? '__any' : stageFilter}
              onChange={(e) => setStageFilter(e.target.value === '__any' ? null : e.target.value)}
            >
              <option value="__any">{t('workstreams.anyStage')}</option>
              <option value="">{t('workstreams.noStage')}</option>
              {stages.map((st) => (
                <option key={st.key} value={st.key}>
                  {st.name}
                </option>
              ))}
            </select>
            <select
              className="workstream-filter"
              aria-label={t('workstreams.sort')}
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="updated">{t('workstreams.sortUpdated')}</option>
              <option value="onStage">{t('workstreams.sortOnStage')}</option>
              <option value="created">{t('workstreams.sortCreated')}</option>
              <option value="name">{t('workstreams.sortName')}</option>
            </select>
          </div>

          <div className="workstream-actions">
            <button
              onClick={() => {
                const name = window.prompt(t('workstreams.namePrompt'))
                if (name?.trim()) void run(() => api.createBatch(name.trim(), []))
              }}
            >
              {t('workstreams.create')}
            </button>
            <div className="workstream-scope" role="group" aria-label={t('workstreams.scope')}>
              {(['active', 'all', 'archived'] as const).map((sc) => (
                <button
                  key={sc}
                  className={scope === sc ? 'is-on' : ''}
                  aria-pressed={scope === sc}
                  onClick={() => setScope(sc)}
                >
                  {t(SCOPE_KEYS[sc])}
                </button>
              ))}
            </div>
            <span className="workstream-count">
              {t('workstreams.count', { shown: rows.length, total: list.length })}
            </span>
          </div>

          {list.length === 0 && <p className="settings-hint">{t('workstreams.empty')}</p>}
          {list.length > 0 && rows.length === 0 && (
            <p className="settings-hint">
              {scope === 'active' && !query.trim() && stageFilter === null
                ? t('workstreams.noneActive', { n: list.length })
                : t('workstreams.noMatch')}{' '}
              {scope === 'active' && (
                <button className="workstream-link" onClick={() => setScope('all')}>
                  {t('workstreams.showAll')}
                </button>
              )}
            </p>
          )}

          {rows.length > 0 && (
            <div className="workstream-colhead" aria-hidden>
              <span />
              <span>{t('workstreams.colName')}</span>
              <span>{t('lifecycle.title')}</span>
              <span>{t('workstreams.members')}</span>
              <span>{t('workstreams.onStage')}</span>
              <span>{t('workstreams.updated')}</span>
              <span>{t('workstreams.created')}</span>
              <span />
            </div>
          )}

          {rows.map((ws) => {
            const isOpen = open.has(ws.id)
            const archived = ws.status === 'archived'
            const lastTouched = ws.archivedAt ?? ws.updatedAt
            return (
              <div key={ws.id} className={`workstream${archived ? ' is-archived' : ''}`}>
                <div className="workstream-head">
                  <button
                    className="workstream-toggle"
                    onClick={() => toggle(ws.id)}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>

                  {/* The FULL title, wrapped — never clipped. Clicking it opens
                      the history, like the chevron; renaming is the pencil. */}
                  <div className="workstream-main">
                    {renaming === ws.id ? (
                      <input
                        className="workstream-name"
                        autoFocus
                        defaultValue={ws.name}
                        aria-label={t('workstreams.name')}
                        onBlur={(e) => {
                          setRenaming(null)
                          const name = e.target.value.trim()
                          if (name && name !== ws.name) void run(() => api.renameBatch(ws.id, name))
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur()
                          if (e.key === 'Escape') {
                            e.currentTarget.value = ws.name
                            e.currentTarget.blur()
                          }
                        }}
                      />
                    ) : (
                      <button className="workstream-title-text" onClick={() => toggle(ws.id)}>
                        <span className="workstream-num">#{ws.id}</span>
                        {ws.name}
                      </button>
                    )}
                    {/* The note's first line. A workstream called "featA" says
                        nothing next to two others; the sentence somebody
                        already wrote says what it is, and costs no second
                        field to keep in step. */}
                    {ws.summary && (
                      <p className="workstream-summary" title={ws.summary}>
                        {ws.summary}
                      </p>
                    )}
                  </div>

                  {/* The pipeline is per workspace, so every workstream picks
                      from the same list. "—" takes it off the pipeline without
                      archiving it: not started and shelved are different. */}
                  <select
                    className="workstream-stage"
                    aria-label={t('lifecycle.title')}
                    value={ws.stage ?? ''}
                    onChange={(e) => void run(() => api.setBatchStage(ws.id, e.target.value || null))}
                  >
                    <option value="">{'\u2014'}</option>
                    {stages.map((st) => (
                      <option key={st.key} value={st.key}>
                        {st.name}
                      </option>
                    ))}
                  </select>
                  <span className="workstream-progress" title={t('workstreams.members')}>
                    {ws.progress.done}/{ws.progress.total}
                  </span>
                  {/* How long it has sat on THIS stage — the question the list
                      exists to answer. Lit only when it has overrun what that
                      stage allows; a Discuss stage with no limit never lights,
                      however long it runs. An archived row has no live stage. */}
                  {(() => {
                    const entered = enteredById.get(ws.id) ?? null
                    if (archived || !ws.stage || entered === null) {
                      return <span className="workstream-onstage is-none">{'\u2014'}</span>
                    }
                    const limit = staleAfterByStage.get(ws.stage) ?? null
                    const stale = isStale(entered, limit, now)
                    return (
                      <span
                        className={`workstream-onstage${stale ? ' is-stale' : ''}`}
                        title={
                          limit === null
                            ? formatAbsolute(entered)
                            : t('workstreams.onStageLimit', { date: formatAbsolute(entered), days: limit })
                        }
                      >
                        {ageText(entered)}
                      </span>
                    )
                  })()}
                  {/* Dates are columns, not prose under the title: a fixed
                      width per column is what lets the eye run down the list
                      comparing them. Last touched first — a list sorted by
                      creation puts something nobody has opened in three weeks
                      above what moved this morning. */}
                  <span className="workstream-date" title={formatAbsolute(lastTouched)}>
                    {archived ? `${t('workstreams.archived')} ` : ''}
                    {formatAbsolute(lastTouched)}
                  </span>
                  <span className="workstream-date" title={formatAbsolute(ws.createdAt)}>
                    <span>{formatAbsolute(ws.createdAt)}</span>
                  </span>
                  <div className="workstream-buttons">
                    <button
                      className="workstream-act"
                      title={t('workstreams.rename')}
                      onClick={() => setRenaming(ws.id)}
                    >
                      <Pencil size={16} />
                    </button>
                    {/* Isolate works on an archived workstream too — that is
                        the only way to look at one at all, now that the board
                        honours an explicit pick over its archived filter. */}
                    <button
                      className="workstream-isolate"
                      onClick={() => isolate(ws.id)}
                      title={t('workstreams.isolate')}
                    >
                      {t('workstreams.isolateShort')}
                    </button>
                    {/* Two-step, both of them: archiving and deleting are the
                        two actions here you cannot undo by clicking again. */}
                    <button
                      className={`workstream-act${armed === `${ws.id}:archive` ? ' is-armed' : ''}`}
                      title={archived ? t('workstreams.unarchive') : t('workstreams.archive')}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (armed !== `${ws.id}:archive`) {
                          setArmed(`${ws.id}:archive`)
                          return
                        }
                        setArmed(null)
                        void run(() => api.setBatchStatus(ws.id, archived ? 'active' : 'archived'))
                      }}
                    >
                      {armed === `${ws.id}:archive` ? (
                        t('common.confirm')
                      ) : archived ? (
                        <ArchiveRestore size={16} />
                      ) : (
                        <Archive size={16} />
                      )}
                    </button>
                    <button
                      className={`workstream-act${armed === `${ws.id}:delete` ? ' is-armed' : ''}`}
                      title={t('workstreams.delete')}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (armed !== `${ws.id}:delete`) {
                          setArmed(`${ws.id}:delete`)
                          return
                        }
                        setArmed(null)
                        void run(() => api.deleteBatch(ws.id))
                      }}
                    >
                      {armed === `${ws.id}:delete` ? t('common.confirm') : <Trash2 size={16} />}
                    </button>
                  </div>
                </div>
                  {isOpen && (
                  // The HISTORY, not the issue list. Where each workstream's
                  // issues are is already the board's whole subject, and
                  // editing membership is detail work that belongs in the
                  // panel beside the board — this modal's job is the set of
                  // workstreams, not the inside of one.
                  //
                  // How a feature GOT here is the question nothing else
                  // answered. The data has been there since the first move:
                  // `stageEvents` records every arrival, and until now it only
                  // ever surfaced as "5d here" and a small revisit glyph.
                  <ul className="workstream-history">
                    {stageTimeline(eventsById.get(ws.id) ?? [], now).length === 0 && (
                      <li className="workstream-history-empty">{t('workstreams.neverMoved')}</li>
                    )}
                    {stageTimeline(eventsById.get(ws.id) ?? [], now).map((leg, i) => {
                      const age = compactAge(leg.enteredAt, leg.leftAt ?? now)
                      return (
                        <li
                          key={`${leg.stageKey}:${leg.enteredAt}:${i}`}
                          className={`workstream-leg${leg.current ? ' is-current' : ''}`}
                        >
                          <span className="workstream-leg-name">
                            {stageName(leg.stageKey)}
                          </span>
                          <span className="workstream-leg-when">
                            {formatAbsolute(leg.enteredAt)}
                          </span>
                          <span className="workstream-leg-age">
                            {t(AGE_UNIT_KEYS[age.unit], { count: age.value })}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}

          {error && <p className="settings-error">{error}</p>}
        </div>
      </div>
    </div>
  )
}
