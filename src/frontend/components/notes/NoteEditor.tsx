import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Edit3, Eye } from 'lucide-react'
import { useNotesStore } from '../../store/notesStore'
import { notesApi } from '../../lib/notesApi'
import { formatShortcut, NOTE_TOGGLE_KEYS } from '../../lib/platform'
import { formatAbsolute, formatRelative } from '../../lib/relativeTime'
import { NotePreview } from './NotePreview'

interface Props {
  noteId: number
  onBack: () => void
  onCloseModal: () => void
}

type Mode = 'edit' | 'preview'

function findNote(noteId: number) {
  const s = useNotesStore.getState()
  return s.notes.find((n) => n.id === noteId) ?? s.archivedNotes.find((n) => n.id === noteId)
}

export function NoteEditor({ noteId, onBack, onCloseModal }: Props) {
  // Look in both active and archived buckets so the editor still works when
  // opened from the archived view.
  const note = useNotesStore(
    (s) => s.notes.find((n) => n.id === noteId) ?? s.archivedNotes.find((n) => n.id === noteId),
  )
  const updateBody = useNotesStore((s) => s.updateBody)
  const flushPending = useNotesStore((s) => s.flushPending)

  const [mode, setMode] = useState<Mode>(() => {
    const initial = findNote(noteId)
    return (initial?.body?.trim().length ?? 0) > 0 ? 'preview' : 'edit'
  })
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  // `now` advances once a minute so the "updated 2 min ago" label ages in
  // place. Updating less often keeps re-renders cheap; the label resolution
  // is in minutes anyway.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  async function insertImage(file: File) {
    if (!note) return
    setUploadError(null)
    setUploading(true)
    try {
      const { url } = await notesApi.uploadAsset(note.id, file)
      const ta = textareaRef.current
      const md = `![${file.name}](${url})`
      if (ta) {
        const start = ta.selectionStart ?? note.body.length
        const end = ta.selectionEnd ?? note.body.length
        const before = note.body.slice(0, start)
        const after = note.body.slice(end)
        // Add surrounding newlines if not already on a fresh line.
        const sep = before.endsWith('\n') || before.length === 0 ? '' : '\n'
        const next = before + sep + md + '\n' + after
        updateBody(note.id, next)
        // Restore caret after the inserted markdown on the next tick.
        const caret = (before + sep + md + '\n').length
        requestAnimationFrame(() => {
          ta.focus()
          ta.setSelectionRange(caret, caret)
        })
      } else {
        updateBody(note.id, (note.body ? note.body + '\n' : '') + md + '\n')
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          e.preventDefault()
          void insertImage(file)
          return
        }
      }
    }
  }

  function onDrop(e: React.DragEvent<HTMLTextAreaElement>) {
    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (imageFiles.length === 0) return
    e.preventDefault()
    // Sequential so caret tracking stays sane.
    void (async () => {
      for (const f of imageFiles) {
        await insertImage(f)
      }
    })()
  }

  function onDragOver(e: React.DragEvent<HTMLTextAreaElement>) {
    if (e.dataTransfer?.types?.includes('Files')) e.preventDefault()
  }

  // Focus the textarea on first mount so the user can start typing immediately.
  useEffect(() => {
    if (mode === 'edit') textareaRef.current?.focus()
  }, [mode])

  // Cmd+E and Cmd+/ both toggle edit/preview. We accept both because Cmd+E
  // is the conventional binding but gets swallowed by the macOS Edit menu's
  // "Use Selection for Find" accelerator in Chrome PWA windows — the
  // keydown never reaches JS. Cmd+/ matches no menu accelerator, so it
  // works everywhere. The displayed hint (see NOTE_TOGGLE_KEYS in
  // ../../lib/platform) switches between the two based on standalone mode.
  // Backspace (the key labeled "delete" on Mac) acts as ← Back when focus
  // is NOT inside a text input — so typing keeps working but pressing
  // Backspace anywhere else navigates one level back to the grid.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && !e.shiftKey && (e.key.toLowerCase() === 'e' || e.key === '/')) {
        e.preventDefault()
        setMode((m) => (m === 'edit' ? 'preview' : 'edit'))
        return
      }
      if (e.key === 'Backspace') {
        if (e.metaKey || e.ctrlKey || e.altKey) return
        const target = e.target as HTMLElement | null
        const tag = target?.tagName?.toLowerCase()
        // Never steal Backspace from text inputs / textareas / contenteditable
        // — that would break the user's typing.
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
        e.preventDefault()
        onBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  // Flush any pending debounced save on unmount (e.g. user closed the modal
  // mid-edit), so we never lose the latest keystrokes.
  useEffect(() => {
    return () => {
      void flushPending()
    }
  }, [flushPending])

  if (!note) {
    return (
      <div className="note-editor empty">
        <p>Note not found.</p>
        <button type="button" onClick={onBack}>
          ← Back
        </button>
      </div>
    )
  }

  return (
    <div className="note-editor">
      <div className="note-editor-toolbar">
        <button type="button" className="icon-text" onClick={onBack} title="Back to grid (Esc)">
          <ArrowLeft size={14} /> Back
        </button>
        <div className="note-editor-mode-toggle" role="tablist" aria-label="Editor mode">
          <button
            type="button"
            role="tab"
            className={`icon-text${mode === 'edit' ? ' active' : ''}`}
            aria-selected={mode === 'edit'}
            onClick={() => setMode('edit')}
            title={`Edit (${formatShortcut(NOTE_TOGGLE_KEYS)})`}
          >
            <Edit3 size={14} /> Edit
          </button>
          <button
            type="button"
            role="tab"
            className={`icon-text${mode === 'preview' ? ' active' : ''}`}
            aria-selected={mode === 'preview'}
            onClick={() => setMode('preview')}
            title={`Preview (${formatShortcut(NOTE_TOGGLE_KEYS)})`}
          >
            <Eye size={14} /> Preview
          </button>
        </div>
        <span className="note-editor-meta" aria-live="polite">
          {uploading ? (
            <span className="note-editor-meta-status">Uploading…</span>
          ) : (
            <>
              <span
                className="note-editor-meta-updated"
                title={`Updated ${new Date(note.updatedAt).toLocaleString()}`}
              >
                Updated {formatRelative(note.updatedAt, now)}
              </span>
              <span className="note-editor-meta-sep">·</span>
              <span
                className="note-editor-meta-created"
                title={`Created ${new Date(note.createdAt).toLocaleString()}`}
              >
                Created {formatAbsolute(note.createdAt)}
              </span>
            </>
          )}
        </span>
      </div>
      {uploadError && (
        <div className="note-editor-error" role="alert">
          {uploadError}
        </div>
      )}
      {mode === 'edit' ? (
        <textarea
          ref={textareaRef}
          className="note-editor-textarea"
          value={note.body}
          onChange={(e) => updateBody(noteId, e.target.value)}
          onPaste={onPaste}
          onDrop={onDrop}
          onDragOver={onDragOver}
          placeholder="Start typing… Markdown supported. Reference issues like PROJ-123. Paste or drop images to upload."
          spellCheck={false}
        />
      ) : (
        <NotePreview
          body={note.body}
          onCloseModal={onCloseModal}
          onBodyChange={(next) => updateBody(noteId, next)}
        />
      )}
    </div>
  )
}
