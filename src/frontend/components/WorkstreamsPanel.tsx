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
import { Archive, ArchiveRestore, Bot, ChevronDown, ChevronRight, Pause, Trash2, X } from 'lucide-react'
import { api } from '../lib/api'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { indexSessionsByIssue, sessionPresence } from '../lib/agentSession'
import { compactAge, formatAbsolute } from '../lib/relativeTime'
import { useT, type DictKey } from '../i18n'

const AGE_UNIT_KEYS: Record<'m' | 'h' | 'd', DictKey> = {
  m: 'issueNode.ageMinutes',
  h: 'issueNode.ageHours',
  d: 'issueNode.ageDays',
}

interface Member {
  identifier: string
  claimedBy: string | null
  doneAt: number | null
  blockedBy: string[]
}
interface Detail {
  id: number
  name: string
  progress: { total: number; done: number; claimed: number }
  members: Member[]
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
  const setFocusedId = useViewStore((s) => s.setFocusedId)
  const setChainRootIds = useViewStore((s) => s.setChainRootIds)
  const graph = useGraphStore((s) => s.graph)

  const [list, setList] = useState<Summary[]>([])
  const [details, setDetails] = useState<Record<number, Detail>>({})
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
  const sessionsByIssue = indexSessionsByIssue(graph?.data.agentSessions)
  const issuesById = new Map((graph?.data.issues ?? []).map((i) => [i.identifier, i]))

  const loadList = useCallback(async () => {
    try {
      setList((await api.fetchBatches(showArchived)).entries)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [showArchived])

  const loadDetail = useCallback(async (id: number) => {
    try {
      const d = await api.fetchBatch(id)
      setDetails((prev) => ({ ...prev, [id]: d }))
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

  const toggle = (id: number) => {
    // The fetch sits OUTSIDE the updater: React may call an updater more than
    // once, so a side effect in there can fire twice. eslint-plugin-react-hooks
    // flags exactly this, and it is right to.
    const wasOpen = open.has(id)
    setOpen((prev) => {
      const next = new Set(prev)
      if (wasOpen) next.delete(id)
      else next.add(id)
      return next
    })
    if (!wasOpen) void loadDetail(id)
  }

  /** Every mutation refreshes, including a failed one — otherwise the panel
   *  shows what was attempted rather than what the server holds. */
  const run = async (fn: () => Promise<unknown>, detailId?: number) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    await loadList()
    if (detailId !== undefined) await loadDetail(detailId)
    await useGraphStore.getState().refetchSilent()
  }

  /** Show only this workstream on the graph. Reuses chain isolation rather
   *  than adding a second "show a subset" mechanism. */
  const isolate = (d: Detail) => {
    setChainRootIds(d.members.map((m) => m.identifier))
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
            const d = details[ws.id]
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
                  {isOpen && d && (
                    <button onClick={() => isolate(d)} title={t('workstreams.isolate')}>
                      {t('workstreams.isolateShort')}
                    </button>
                  )}
                  {/* Archiving before deleting, and in that order: one is
                      reversible and the other takes the members' history with
                      it. */}
                  {/* Archiving before deleting, and in that order: one is
                      reversible and the other takes the members' history with
                      it. Both ask twice all the same. */}
                  <button
                    className={armed === `${ws.id}:archive` ? 'confirm-armed' : ''}
                    onClick={(e) => {
                      e.stopPropagation()
                      const key = `${ws.id}:archive`
                      if (armed !== key) return setArmed(key)
                      setArmed(null)
                      void run(() =>
                        api.setBatchStatus(ws.id, ws.status === 'archived' ? 'active' : 'archived'),
                      )
                    }}
                    title={ws.status === 'archived' ? t('workstreams.unarchive') : t('workstreams.archive')}
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
                    className={armed === `${ws.id}:delete` ? 'confirm-armed danger' : ''}
                    onClick={(e) => {
                      e.stopPropagation()
                      const key = `${ws.id}:delete`
                      if (armed !== key) return setArmed(key)
                      setArmed(null)
                      void run(() => api.deleteBatch(ws.id))
                    }}
                    title={t('workstreams.delete')}
                  >
                    {armed === `${ws.id}:delete` ? t('common.confirm') : <Trash2 size={14} />}
                  </button>
                </div>

                {isOpen && d && (
                  <ul className="workstream-members">
                    {d.members.map((m) => {
                      const presence = sessionPresence(sessionsByIssue.get(m.identifier))
                      const issue = issuesById.get(m.identifier)
                      return (
                        <li
                          key={m.identifier}
                          className={`workstream-member${m.doneAt ? ' is-done' : ''}`}
                        >
                          <button
                            className="workstream-id"
                            onClick={() => {
                              setFocusedId(m.identifier)
                              close()
                            }}
                          >
                            {m.identifier}
                          </button>
                          <span className="workstream-title">{issue?.title ?? ''}</span>
                          {presence.kind !== 'none' && (
                            <span className={`session-badge is-${presence.kind}`}>
                              {presence.kind === 'active' ? <Bot size={11} /> : <Pause size={11} />}
                              {compactAge(presence.lastSeen).value}
                              {compactAge(presence.lastSeen).unit}
                            </span>
                          )}
                          {/* Blocked by a MEMBER of this workstream. An outside
                              blocker is not shown here — it is a reason the issue
                              is not ready, not part of this feature's shape. */}
                          {m.blockedBy.length > 0 && (
                            <span className="workstream-blocked">
                              ⛔ {m.blockedBy.join(', ')}
                            </span>
                          )}
                          <button
                            className="workstream-remove"
                            title={t('workstreams.removeMember')}
                            onClick={() =>
                              void run(() => api.removeBatchMember(ws.id, m.identifier), ws.id)
                            }
                          >
                            <X size={12} />
                          </button>
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
