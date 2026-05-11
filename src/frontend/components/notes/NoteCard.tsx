import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Archive, ArchiveRestore, Check, Trash2 } from 'lucide-react'
import { deriveTitle } from '../../lib/noteTitle'
import { ConfirmIconButton } from './ConfirmIconButton'
import { NoteThumbnail } from './NoteThumbnail'
import type { NoteDTO } from '@shared/types.js'

interface Props {
  note: NoteDTO
  onOpen: () => void
  onDelete: () => void
  onToggleArchive: () => void
  /** When false (archived view), drag handles + transforms are disabled. */
  draggable?: boolean
  /** True when this card is currently in the archived bucket. */
  archived?: boolean
}

export function NoteCard({
  note,
  onOpen,
  onDelete,
  onToggleArchive,
  draggable = true,
  archived = false,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: note.id,
    disabled: !draggable,
  })
  const title = deriveTitle(note.body)
  const isEmpty = note.body.trim().length === 0

  function onCardKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen()
    }
  }

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (target.closest('.confirm-icon-button')) return
    onOpen()
  }

  const style: React.CSSProperties = draggable
    ? {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        cursor: isDragging ? 'grabbing' : 'pointer',
      }
    : { cursor: 'pointer' }

  // When the card is non-draggable (archived view), don't spread dnd-kit's
  // attributes/listeners — they'd intercept pointer events for a drag that
  // can never happen.
  const dndProps = draggable ? { ...attributes, ...listeners } : {}

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`note-card${isDragging ? ' dragging' : ''}${archived ? ' archived' : ''}`}
      onClick={onClick}
      onKeyDown={onCardKey}
      aria-label={`Open note: ${title}`}
      {...dndProps}
    >
      <div className="note-card-actions">
        <ConfirmIconButton
          icon={archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          confirmIcon={<Check size={14} />}
          title={archived ? 'Restore note' : 'Archive note'}
          confirmTitle={archived ? 'Click again to restore' : 'Click again to archive'}
          ariaLabel={archived ? 'Restore note' : 'Archive note'}
          tone="warning"
          className="note-card-action"
          onConfirm={onToggleArchive}
        />
        <ConfirmIconButton
          icon={<Trash2 size={14} />}
          confirmIcon={<Check size={14} />}
          title="Delete note"
          confirmTitle="Click again to delete"
          ariaLabel="Delete note"
          tone="danger"
          className="note-card-action"
          onConfirm={onDelete}
        />
      </div>
      <h3 className={`note-card-title${isEmpty ? ' empty' : ''}`}>{title}</h3>
      {!isEmpty && <NoteThumbnail body={note.body} />}
    </div>
  )
}
