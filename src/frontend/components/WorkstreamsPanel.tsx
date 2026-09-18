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
import { Bot, ChevronDown, ChevronRight, Pause, Trash2, X } from 'lucide-react'
import { api } from '../lib/api'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { indexSessionsByIssue, sessionPresence } from '../lib/agentSession'
import { compactAge } from '../lib/relativeTime'
import { useT } from '../i18n'

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
  progress: { total: number; done: number }
}

export function WorkstreamsPanel() {
  const t = useT()
  const close = () => useViewStore.getState().setWorkstreamsOpen(false)
  const setFocusedId = useViewStore((s) => s.setFocusedId)
  const setChainRootIds = useViewStore((s) => s.setChainRootIds)
  const graph = useGraphStore((s) => s.graph)

  const [list, setList] = useState<Summary[]>([])
  const [details, setDetails] = useState<Record<number, Detail>>({})
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const sessionsByIssue = indexSessionsByIssue(graph?.data.agentSessions)
  const issuesById = new Map((graph?.data.issues ?? []).map((i) => [i.identifier, i]))

  const loadList = useCallback(async () => {
    try {
      setList((await api.fetchBatches()).entries)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

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
    api
      .fetchBatches()
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

        <div className="modal-body">
          <p className="settings-hint">{t('workstreams.hint')}</p>

          {list.length === 0 && <p className="settings-hint">{t('workstreams.empty')}</p>}

          {list.map((ws) => {
            const d = details[ws.id]
            const isOpen = open.has(ws.id)
            return (
              <div key={ws.id} className="workstream">
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
                  <span className="workstream-progress">
                    {ws.progress.done}/{ws.progress.total}
                  </span>
                  {isOpen && d && (
                    <button onClick={() => isolate(d)} title={t('workstreams.isolate')}>
                      {t('workstreams.isolateShort')}
                    </button>
                  )}
                  <button
                    onClick={() => void run(() => api.deleteBatch(ws.id))}
                    title={t('workstreams.delete')}
                  >
                    <Trash2 size={14} />
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
