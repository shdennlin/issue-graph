import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import { useNotesStore } from '../../store/notesStore'
import { matchesNote } from '../../lib/notesMatch'
import { useT } from '../../i18n'
import { NoteCard } from './NoteCard'

interface Props {
  onOpenNote: (id: number) => void
  archived?: boolean
}

export function NotesGridView({ onOpenNote, archived = false }: Props) {
  const allNotes = useNotesStore((s) => (archived ? s.archivedNotes : s.notes))
  const status = useNotesStore((s) => s.status)
  const create = useNotesStore((s) => s.create)
  const del = useNotesStore((s) => s.delete)
  const reorder = useNotesStore((s) => s.reorder)
  const setArchived = useNotesStore((s) => s.setArchived)
  const search = useNotesStore((s) => s.notesSearch)
  const setSearch = useNotesStore((s) => s.setNotesSearch)
  const t = useT()
  const filtering = search.trim().length > 0
  const notes = filtering ? allNotes.filter((n) => matchesNote(search, n.body)) : allNotes

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function onCreate() {
    const id = await create()
    onOpenNote(id)
  }

  function onDragEnd(event: DragEndEvent) {
    if (archived) return // reordering only supported for active set
    if (filtering) return // reorder semantics are unclear under a filter
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = notes.findIndex((n) => n.id === active.id)
    const newIndex = notes.findIndex((n) => n.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(notes, oldIndex, newIndex)
    void reorder(reordered.map((n) => n.id))
  }

  return (
    <div className="notes-grid" role="list">
      {!archived && !filtering && (
        <button
          type="button"
          className="note-card note-card-new"
          onClick={onCreate}
          aria-label="Create new note"
        >
          <Plus size={28} />
          <span>New note</span>
        </button>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={notes.map((n) => n.id)} strategy={rectSortingStrategy}>
          {notes.map((n) => (
            <NoteCard
              key={n.id}
              note={n}
              archived={archived}
              draggable={!archived && !filtering}
              highlight={search}
              onOpen={() => onOpenNote(n.id)}
              onDelete={() => del(n.id)}
              onToggleArchive={() => setArchived(n.id, !n.archived)}
            />
          ))}
        </SortableContext>
      </DndContext>
      {status === 'loading' && notes.length === 0 && (
        <div className="notes-grid-empty" aria-live="polite">
          Loading…
        </div>
      )}
      {status !== 'loading' && notes.length === 0 && (
        <div className="notes-grid-empty">
          {filtering ? (
            <p>
              {t('notes.noMatches')} “{search}”.{' '}
              <button type="button" className="link-button" onClick={() => setSearch('')}>
                {t('notes.clearSearch')}
              </button>
            </p>
          ) : archived ? (
            <p>No archived notes.</p>
          ) : (
            <p>No notes yet — click <strong>New note</strong> to start.</p>
          )}
        </div>
      )}
    </div>
  )
}
