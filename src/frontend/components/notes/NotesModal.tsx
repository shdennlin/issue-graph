import { useEffect, useState } from 'react'
import { Archive, LayoutGrid, List } from 'lucide-react'
import { useViewStore } from '../../store/viewStore'
import { useNotesStore } from '../../store/notesStore'
import { ModalHeader } from '../ModalHeader'
import { NotesGridView } from './NotesGridView'
import { NotesListView } from './NotesListView'
import { NoteEditor } from './NoteEditor'
import { UndoToast } from './UndoToast'
import { useT } from '../../i18n'

type ViewMode = 'grid' | 'list'

const VIEW_MODE_KEY = 'ig-notes-view-mode'

function loadViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'grid'
  const raw = window.localStorage?.getItem(VIEW_MODE_KEY)
  return raw === 'list' ? 'list' : 'grid'
}

export function NotesModal() {
  const open = useViewStore((s) => s.notesOpen)
  const focusedNoteId = useViewStore((s) => s.focusedNoteId)
  const setNotesOpen = useViewStore((s) => s.setNotesOpen)
  const setFocusedNoteId = useViewStore((s) => s.setFocusedNoteId)
  const flushPending = useNotesStore((s) => s.flushPending)
  const noteCount = useNotesStore((s) => s.notes.length)
  const archivedCount = useNotesStore((s) => s.archivedNotes.length)
  const loadArchived = useNotesStore((s) => s.loadArchived)
  const focusedNoteExists = useNotesStore(
    (s) =>
      focusedNoteId !== null &&
      (s.notes.some((n) => n.id === focusedNoteId) ||
        s.archivedNotes.some((n) => n.id === focusedNoteId)),
  )
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode)
  const [showArchived, setShowArchived] = useState(false)
  const t = useT()

  function updateViewMode(m: ViewMode) {
    setViewMode(m)
    try {
      window.localStorage?.setItem(VIEW_MODE_KEY, m)
    } catch {
      /* localStorage may throw in private mode — ignore */
    }
  }

  // When the user flips into Archived view, lazy-load the archived bucket so
  // we don't waste a fetch for users who never open it.
  useEffect(() => {
    if (showArchived) void loadArchived()
  }, [showArchived, loadArchived])

  // Esc closes the entire modal regardless of sub-view (grid or editor).
  // Matches the dominant modal-app convention (Notion, Linear, Heptabase):
  // one rule, one keystroke, always closes. To navigate editor → grid use
  // the ← Back button in the editor toolbar. focusedNoteId is intentionally
  // preserved so the next `n` toggle reopens to the same view.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      void flushPending()
      setNotesOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, flushPending, setNotesOpen])

  if (!open) return null

  const close = () => {
    void flushPending()
    setNotesOpen(false)
  }

  const backToGrid = () => {
    void flushPending()
    setFocusedNoteId(null)
  }

  const visibleCount = showArchived ? archivedCount : noteCount
  const headerTitle = focusedNoteId !== null
    ? t('notes.note')
    : showArchived
      ? archivedCount > 0
        ? t('notes.archivedWithCount', { count: archivedCount })
        : t('notes.archived')
      : noteCount > 0
        ? t('notes.workspaceNotesWithCount', { count: noteCount })
        : t('notes.workspaceNotes')
  void visibleCount

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal notes-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t('notes.workspaceNotesAria')}
      >
        <div className="notes-modal-header-row">
          <ModalHeader title={headerTitle} onClose={close} />
          {focusedNoteId === null && (
            <>
              <button
                type="button"
                className={`icon-text${showArchived ? ' active' : ''}`}
                onClick={() => setShowArchived((v) => !v)}
                title={showArchived ? t('notes.backToActive') : t('notes.showArchived')}
                aria-pressed={showArchived}
              >
                <Archive size={14} />
                {showArchived ? t('notes.activeShort') : t('notes.archivedShort')}
              </button>
              <div className="notes-view-toggle" role="tablist" aria-label={t('notes.viewModeAria')}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === 'grid'}
                  className={`icon-only${viewMode === 'grid' ? ' active' : ''}`}
                  onClick={() => updateViewMode('grid')}
                  title={t('notes.gridView')}
                >
                  <LayoutGrid size={16} />
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === 'list'}
                  className={`icon-only${viewMode === 'list' ? ' active' : ''}`}
                  onClick={() => updateViewMode('list')}
                  title={t('notes.listView')}
                >
                  <List size={16} />
                </button>
              </div>
            </>
          )}
        </div>
        <div className="notes-modal-body">
          {focusedNoteId !== null ? (
            focusedNoteExists ? (
              <NoteEditor
                noteId={focusedNoteId}
                onBack={backToGrid}
                onCloseModal={close}
              />
            ) : (
              <div className="notes-grid-empty" aria-live="polite">{t('notes.loadingNote')}</div>
            )
          ) : viewMode === 'grid' ? (
            <NotesGridView
              archived={showArchived}
              onOpenNote={(id) => setFocusedNoteId(id)}
            />
          ) : (
            <NotesListView
              archived={showArchived}
              onOpenNote={(id) => setFocusedNoteId(id)}
            />
          )}
        </div>
        <UndoToast />
      </div>
    </div>
  )
}
