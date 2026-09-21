import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../lib/api'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { useResizable } from '../hooks/useResizable'
import { formatAbsolute } from '../lib/relativeTime'
import { useT } from '../i18n'

// The workstream itself: the things that belong to the FEATURE rather than to
// any one step of it. Sibling of StagePanel, same shell, and the two close
// each other because they dock on the same edge.
export function WorkstreamPanel() {
  const t = useT()
  const id = useViewStore((s) => s.workstreamPanelId)
  const close = useViewStore((s) => s.closeWorkstreamPanel)
  const graph = useGraphStore((s) => s.graph)
  const refetchSilent = useGraphStore((s) => s.refetchSilent)
  const setFocusedId = useViewStore((s) => s.setFocusedId)
  const setDetailPanelOpen = useViewStore((s) => s.setDetailPanelOpen)
  const [busy, setBusy] = useState(false)
  const titleOf = (identifier: string) =>
    graph?.data.issues.find((i) => i.identifier === identifier)?.title ?? ''

  const [viewportW, setViewportW] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  )
  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const sideMax = Math.max(360, Math.floor(viewportW * 0.5))
  const { width, startResize, resizing } = useResizable({
    storageKey: 'ig-workstream-panel-w',
    defaultWidth: 380,
    min: 300,
    max: sideMax,
    side: 'right',
  })

  const workstream = (graph?.data.workstreams ?? []).find((w) => w.id === id)
  const noteFromServer = workstream?.note ?? ''

  const [draft, setDraft] = useState(() => ({ id: id ?? -1, note: noteFromServer }))
  const [noteState, setNoteState] = useState<'clean' | 'dirty' | 'saving'>('clean')
  const saveTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
  }, [])

  // Adjusted during render rather than synced in an effect, so switching
  // workstreams cannot carry a half-written note across.
  if (id !== null && draft.id !== id) setDraft({ id, note: noteFromServer })
  if (id === null || !workstream) return null
  const note = draft.id === id ? draft.note : noteFromServer

  const saveNote = async (body: string) => {
    if (body.trim() === noteFromServer.trim()) {
      setNoteState('clean')
      return
    }
    setNoteState('saving')
    // Explicit null clears it; the route treats absent as "leave alone".
    const trimmed = body.trim()
    await api.setBatchNote(workstream.id, trimmed.length === 0 ? null : trimmed)
    await refetchSilent()
    setNoteState('clean')
  }

  return (
    <aside
      className={`stage-panel${resizing ? ' is-resizing' : ''}`}
      style={{ width: Math.min(width, sideMax), flexShrink: 0 }}
    >
      <div className="resize-handle resize-handle-left" onMouseDown={startResize} />
      <div className="stage-panel-header">
        <div>
          <div className="stage-panel-ws">{t('workstreams.title')}</div>
          <h2 className="stage-panel-title">{workstream.name}</h2>
        </div>
        <button className="icon-only" onClick={close} aria-label={t('common.close')}>
          <X size={16} />
        </button>
      </div>

      <div className="stage-panel-body">
        <h4>{t('stage.notesTitle')}</h4>
        <p className="settings-hint">{t('workstreams.noteHint')}</p>
        <textarea
          className="stage-panel-note"
          rows={8}
          value={note}
          placeholder={t('workstreams.notePlaceholder')}
          onChange={(e) => {
            const next = e.target.value
            setDraft({ id, note: next })
            setNoteState('dirty')
            if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
            saveTimer.current = window.setTimeout(() => void saveNote(next), 700)
          }}
          onBlur={() => {
            if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
            void saveNote(note)
          }}
        />
        <div className="stage-panel-row">
          <span className="stage-panel-savestate">{t(`stage.note_${noteState}` as 'stage.note_clean')}</span>
        </div>

        {/* Membership is edited HERE, beside the board, not in the
            Workstreams modal. That modal is the set of workstreams — rename,
            archive, delete, and how each one got where it is; who belongs to
            one is the inside of one, which is this panel's whole subject. */}
        <h4>{t('workstreams.members')}</h4>
        {workstream.members.length === 0 ? (
          <p className="settings-hint">{t('workstreams.noMembers')}</p>
        ) : (
          <ul className="stage-panel-links">
            {workstream.members.map((m) => (
              <li key={m} className="ws-member">
                <button
                  type="button"
                  className="ws-member-id"
                  onClick={() => {
                    // This view draws no issue cards, so focusing alone would
                    // highlight nothing — the detail panel reads the focused
                    // issue out of graph data by identifier instead.
                    setFocusedId(m)
                    setDetailPanelOpen(true)
                  }}
                >
                  {m}
                </button>
                <span className="ws-member-title">{titleOf(m)}</span>
                <button
                  type="button"
                  className="ws-member-remove"
                  title={t('workstreams.removeMember')}
                  aria-label={t('workstreams.removeMember')}
                  disabled={busy}
                  onClick={() => {
                    setBusy(true)
                    void api
                      .removeBatchMember(workstream.id, m)
                      .then(() => refetchSilent())
                      .finally(() => setBusy(false))
                  }}
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <h4>{t('workstreams.dates')}</h4>
        <ul className="stage-panel-dates">
          <li>
            <span>{t('workstreams.created')}</span>
            <span>{formatAbsolute(workstream.createdAt)}</span>
          </li>
          <li>
            <span>{t('workstreams.updated')}</span>
            <span>{formatAbsolute(workstream.updatedAt)}</span>
          </li>
          {workstream.archivedAt !== null && (
            <li>
              <span>{t('workstreams.archived')}</span>
              <span>{formatAbsolute(workstream.archivedAt)}</span>
            </li>
          )}
        </ul>
      </div>
    </aside>
  )
}
