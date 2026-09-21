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

import { useCallback, useEffect, useState } from 'react'
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, Trash2, X } from 'lucide-react'
import { api } from '../lib/api'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { compactAge, formatAbsolute } from '../lib/relativeTime'
import { stageTimeline } from '@shared/stageHistory.js'
import { useT, type DictKey } from '../i18n'

const AGE_UNIT_KEYS: Record<'m' | 'h' | 'd', DictKey> = {
  m: 'issueNode.ageMinutes',
  h: 'issueNode.ageHours',
  d: 'issueNode.ageDays',
}

interface Summary {
  id: number
  name: string
  stage: string | null
  status: 'active' | 'archived'
  createdAt: number
  updatedAt: number
  archivedAt: number | null
  progress: { total: number; done: number }
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
  const [showArchived, setShowArchived] = useState(false)
  // Two-step confirm, inline rather than window.confirm(): a browser that has
  // had "prevent this page creating more dialogs" ticked silently returns
  // false, and the dialog blocks the whole page besides. Keyed by
  // `<id>:<action>` so arming one row's delete does not arm another's.
  // Motivated by a real loss — a workstream went in one stray click.
  const [armed, setArmed] = useState<string | null>(null)

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

  const loadList = useCallback(async () => {
    try {
      setList((await api.fetchBatches(showArchived)).entries)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [showArchived])

  // Inlined rather than `void loadList()`: calling a function that sets state
  // from inside an effect trips react-hooks/set-state-in-effect. Same shape as
  // LifecycleSettings' mount fetch, `live` guard and all — it is the pattern
  // this repo already passes lint with.
  useEffect(() => {
    let live = true
    // `showArchived` has to be in BOTH places: this is the fetch that actually
    // populates the list, and with an empty dep array the checkbox changed a
    // flag that nothing ever read again.
    api
      .fetchBatches(showArchived)
      .then((r) => {
        if (live) setList(r.entries)
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      live = false
    }
  }, [showArchived])

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

          <div className="workstream-actions">
            <button
              onClick={() => {
                const name = window.prompt(t('workstreams.namePrompt'))
                if (name?.trim()) void run(() => api.createBatch(name.trim(), []))
              }}
            >
              {t('workstreams.create')}
            </button>
            <label className="workstream-archived-toggle">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              {t('workstreams.showArchived')}
            </label>
          </div>

          {list.length === 0 && <p className="settings-hint">{t('workstreams.empty')}</p>}

          {list.map((ws) => {
            const isOpen = open.has(ws.id)
            return (
              <div key={ws.id} className={`workstream${ws.status === 'archived' ? ' is-archived' : ''}`}>
                <div className="workstream-head">
                  <button className="workstream-toggle" onClick={() => toggle(ws.id)}>
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <input
                    className="workstream-name"
                    defaultValue={ws.name}
                    aria-label={t('workstreams.name')}
                    onBlur={(e) => {
                      const name = e.target.value.trim()
                      if (name && name !== ws.name) void run(() => api.renameBatch(ws.id, name))
                    }}
                  />
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
                  <span className="workstream-progress">
                    {ws.progress.done}/{ws.progress.total}
                  </span>
                  {/* Last touched, not created: a list sorted by creation puts
                      a workstream nobody has looked at in three weeks above one
                      that moved this morning. The full dates are in the title,
                      because the badge has room for one number. */}
                  <span
                    className="workstream-when"
                    title={[
                      `${t('workstreams.created')}: ${formatAbsolute(ws.createdAt)}`,
                      `${t('workstreams.updated')}: ${formatAbsolute(ws.updatedAt)}`,
                      ws.archivedAt
                        ? `${t('workstreams.archived')}: ${formatAbsolute(ws.archivedAt)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join('\n')}
                  >
                    {ageText(ws.archivedAt ?? ws.updatedAt)}
                  </span>
                  {/* Isolate works on an archived workstream too — that is the
                      only way to look at one at all, now that the board honours
                      an explicit pick over its archived filter. */}
                  <button className="workstream-isolate" onClick={() => isolate(ws.id)} title={t('workstreams.isolate')}>
                    {t('workstreams.isolateShort')}
                  </button>
                  {/* Two-step, both of them: archiving and deleting are the two
                      actions here you cannot undo by clicking again. */}
                  <button
                    className={`workstream-act${armed === `${ws.id}:archive` ? ' is-armed' : ''}`}
                    title={ws.status === 'archived' ? t('workstreams.unarchive') : t('workstreams.archive')}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (armed !== `${ws.id}:archive`) {
                        setArmed(`${ws.id}:archive`)
                        return
                      }
                      setArmed(null)
                      void run(() =>
                        api.setBatchStatus(ws.id, ws.status === 'archived' ? 'active' : 'archived'),
                      )
                    }}
                  >
                    {armed === `${ws.id}:archive` ? (
                      t('common.confirm')
                    ) : ws.status === 'archived' ? (
                      <ArchiveRestore size={14} />
                    ) : (
                      <Archive size={14} />
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
                    {armed === `${ws.id}:delete` ? t('common.confirm') : <Trash2 size={14} />}
                  </button>
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
