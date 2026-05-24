import { useEffect, useRef, useState } from 'react'
import { Archive, LayoutGrid, List, X } from 'lucide-react'
import { useViewStore } from '../../store/viewStore'
import { useNotesStore } from '../../store/notesStore'
import { ModalHeader } from '../ModalHeader'
import { NotesGridView } from './NotesGridView'
import { NotesListView } from './NotesListView'
import { NoteEditor } from './NoteEditor'
import { NotesSearchInput } from './NotesSearchInput'
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
  const searchInputRef = useRef<HTMLInputElement | null>(null)

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
  //
  // Cmd/Ctrl+F is context-aware:
  //   - grid/list view → focus the top-level notes search input
  //   - editor view    → handled by NoteEditor (opens in-note find bar)
  // The Esc handler also bails when the in-note find bar is open so the
  // find bar can dismiss itself first instead of the whole modal closing.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // If the in-note find bar is open, let it handle Esc.
        if (useViewStore.getState().noteFindOpen) return
        e.preventDefault()
        void flushPending()
        setNotesOpen(false)
        return
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        // Editor view handles its own Cmd+F; only intercept for the grid/list.
        if (useViewStore.getState().focusedNoteId !== null) return
        e.preventDefault()
        const el = searchInputRef.current
        if (el) {
          el.focus()
          el.select()
        }
      }
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
          <ModalHeader title={headerTitle} onClose={close} hideClose />
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
              <NotesSearchInput ref={searchInputRef} />
            </>
          )}
          <button
            type="button"
            className="icon-only notes-modal-close"
            onClick={close}
            title={t('common.closeEsc')}
            aria-label={t('common.close')}
          >
            <X size={16} />
          </button>
        </div>
        <div className="notes-modal-body">
          {focusedNoteId !== null ? (
            focusedNoteExists ? (
              <NoteEditor
                // Force a remount when the open note changes (e.g. URL Back/
                // Forward jumps from note N to M without passing through grid)
                // so internal state — mode, find bar, debounced save — resets
                // cleanly instead of carrying over to a different note.
                key={focusedNoteId}
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
