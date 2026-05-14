import { Archive, ArchiveRestore, Check, Plus, Trash2 } from 'lucide-react'
import { useNotesStore } from '../../store/notesStore'
import { deriveSnippet, deriveTitle } from '../../lib/noteTitle'
import { ConfirmIconButton } from './ConfirmIconButton'

interface Props {
  onOpenNote: (id: number) => void
  archived?: boolean
}

export function NotesListView({ onOpenNote, archived = false }: Props) {
  const notes = useNotesStore((s) => (archived ? s.archivedNotes : s.notes))
  const status = useNotesStore((s) => s.status)
  const create = useNotesStore((s) => s.create)
  const del = useNotesStore((s) => s.delete)
  const setArchived = useNotesStore((s) => s.setArchived)

  async function onCreate() {
    const id = await create()
    onOpenNote(id)
  }

  return (
    <div className="notes-list">
      {!archived && (
        <button type="button" className="notes-list-new" onClick={onCreate}>
          <Plus size={16} /> New note
        </button>
      )}
      {status === 'loading' && notes.length === 0 && (
        <div className="notes-grid-empty">Loading…</div>
      )}
      {status !== 'loading' && notes.length === 0 && (
        <div className="notes-grid-empty">
          {archived ? <p>No archived notes.</p> : (
            <p>No notes yet — click <strong>New note</strong> to start.</p>
          )}
        </div>
      )}
      {notes.map((n) => {
        const title = deriveTitle(n.body)
        const snippet = deriveSnippet(n.body)
        const isEmpty = n.body.trim().length === 0
        return (
          <div
            key={n.id}
            role="button"
            tabIndex={0}
            className="notes-list-row"
            onClick={() => onOpenNote(n.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpenNote(n.id)
              }
            }}
          >
            <div className="notes-list-row-text">
              <div className={`notes-list-row-title${isEmpty ? ' empty' : ''}`}>{title}</div>
              {snippet && <div className="notes-list-row-snippet">{snippet}</div>}
            </div>
            <ConfirmIconButton
              icon={archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
              confirmIcon={<Check size={14} />}
              title={archived ? 'Restore note' : 'Archive note'}
              confirmTitle={archived ? 'Click again to restore' : 'Click again to archive'}
              ariaLabel={archived ? 'Restore note' : 'Archive note'}
              tone="warning"
              className="notes-list-row-action"
              onConfirm={() => setArchived(n.id, !archived)}
            />
            <ConfirmIconButton
              icon={<Trash2 size={14} />}
              confirmIcon={<Check size={14} />}
              title="Delete note"
              confirmTitle="Click again to delete"
              ariaLabel="Delete note"
              tone="danger"
              className="notes-list-row-action"
              onConfirm={() => del(n.id)}
            />
          </div>
        )
      })}
    </div>
  )
}
