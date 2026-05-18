import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronDown, ChevronRight, Copy, Edit3, Eye } from 'lucide-react'
import { useNotesStore } from '../../store/notesStore'
import { notesApi } from '../../lib/notesApi'
import { formatShortcut, NOTE_TOGGLE_KEYS } from '../../lib/platform'
import { formatAbsolute, formatRelative } from '../../lib/relativeTime'
import { findIssueIds } from '../../lib/issueLinks'
import { priorityLabelFor, stateColorVar, stateIcon } from '../../lib/colors'
import { useGraphStore } from '../../store/graphStore'
import { useViewStore } from '../../store/viewStore'
import { useClickOutside } from '../../hooks/useClickOutside'
import { useLocale } from '../../i18n'
import { NotePreview } from './NotePreview'

const SHOW_REFS_KEY = 'ig-note-show-refs-v1'
type CopyMode = 'full' | 'body' | 'refs'

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
  const [copied, setCopied] = useState(false)
  const [copyMenuOpen, setCopyMenuOpen] = useState(false)
  const copyMenuRef = useRef<HTMLDivElement | null>(null)
  useClickOutside(copyMenuRef, copyMenuOpen, () => setCopyMenuOpen(false))
  const [showRefs, setShowRefs] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false
    try { return localStorage.getItem(SHOW_REFS_KEY) === '1' } catch { return false }
  })
  const toggleShowRefs = () => {
    setShowRefs((prev) => {
      const next = !prev
      try { localStorage.setItem(SHOW_REFS_KEY, next ? '1' : '0') } catch { /* silent */ }
      return next
    })
  }
  const locale = useLocale()
  const issues = useGraphStore((s) => s.graph?.data.issues)
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

  const body = note?.body ?? ''
  const referencedIssues = useMemo(() => {
    const ids = findIssueIds(body)
    if (ids.length === 0) return []
    const byId = new Map((issues ?? []).map((i) => [i.identifier, i] as const))
    const seen = new Set<string>()
    const out: { id: string; issue: ReturnType<typeof byId.get> }[] = []
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push({ id, issue: byId.get(id) })
    }
    return out
  }, [body, issues])
  const resolvedIssues = useMemo(
    () => referencedIssues.filter((r): r is { id: string; issue: NonNullable<typeof r.issue> } => r.issue !== undefined),
    [referencedIssues],
  )
  const unresolvedIds = useMemo(
    () => referencedIssues.filter((r) => r.issue === undefined).map((r) => r.id),
    [referencedIssues],
  )

  const hasBody = body.trim().length > 0
  const hasRefs = resolvedIssues.length > 0 || unresolvedIds.length > 0
  const canCopy = hasBody || hasRefs

  function buildPayload(mode: CopyMode): string {
    const refLines: string[] = []
    if (mode !== 'body' && hasRefs) {
      refLines.push('**Referenced issues:**')
      for (const { issue } of resolvedIssues) {
        // Linear's actual state name (e.g. "Review") not the canonical type
        // label ("In Progress") — the AI consumer needs to match what the
        // human sees in Linear, and the human's vocabulary is the custom name.
        const state = issue.state.name
        const priority = priorityLabelFor(issue.priority, locale)
        refLines.push(`- **${issue.identifier}** · ${state} · ${priority} · ${issue.title}`)
      }
      for (const id of unresolvedIds) {
        refLines.push(`- **${id}** · (not in cache)`)
      }
    }
    if (mode === 'refs') return refLines.join('\n')
    if (mode === 'body') return body.trimEnd()
    const parts = [body.trimEnd()]
    if (refLines.length > 0) parts.push('', '---', ...refLines)
    return parts.join('\n')
  }

  async function copyAs(mode: CopyMode) {
    if (!note) return
    const payload = buildPayload(mode)
    if (!payload) return
    try {
      await navigator.clipboard.writeText(payload)
      setCopied(true)
      setCopyMenuOpen(false)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setUploadError('Copy failed — clipboard unavailable')
    }
  }

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
        <div className="note-copy-split" ref={copyMenuRef}>
          <button
            type="button"
            className="icon-text note-copy-main"
            onClick={() => copyAs('full')}
            disabled={!canCopy}
            title="Copy note + referenced issue statuses (for AI)"
            aria-label="Copy as Markdown"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy note + issues'}
          </button>
          <button
            type="button"
            className="icon-only note-copy-chevron"
            onClick={() => setCopyMenuOpen((o) => !o)}
            disabled={!canCopy}
            aria-haspopup="menu"
            aria-expanded={copyMenuOpen}
            aria-label="Copy options"
            title="Copy options"
          >
            <ChevronDown size={12} />
          </button>
          {copyMenuOpen && (
            <div className="toolbar-overflow-menu note-copy-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="toolbar-overflow-item"
                onClick={() => copyAs('body')}
                disabled={!hasBody}
              >
                Copy note only
              </button>
              <button
                type="button"
                role="menuitem"
                className="toolbar-overflow-item"
                onClick={() => copyAs('refs')}
                disabled={!hasRefs}
              >
                Copy referenced issues only
              </button>
            </div>
          )}
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
      {hasRefs && (
        <div className="note-editor-issue-refs" aria-label="Referenced issues">
          <button
            type="button"
            className="note-editor-issue-refs-toggle"
            onClick={toggleShowRefs}
            aria-expanded={showRefs}
          >
            {showRefs ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Referenced issues ({resolvedIssues.length + unresolvedIds.length})
          </button>
          {showRefs && <>
          {resolvedIssues.map(({ issue: iss }) => (
            <button
              key={iss.identifier}
              type="button"
              className="note-editor-issue-ref"
              onClick={() => {
                useViewStore.getState().setFocusedId(iss.identifier)
                useViewStore.getState().requestPanToFocused()
                onCloseModal()
              }}
              title={`Open ${iss.identifier} in graph`}
            >
              <span className="note-editor-issue-ref-id">{iss.identifier}</span>
              <span
                className="note-editor-issue-ref-state"
                style={{ color: stateColorVar(iss.state.type) }}
                aria-hidden
              >
                {stateIcon(iss.state.type)}
              </span>
              <span className="note-editor-issue-ref-state-label">
                {iss.state.name}
              </span>
              <span className="note-editor-issue-ref-priority">
                {priorityLabelFor(iss.priority, locale)}
              </span>
              <span className="note-editor-issue-ref-title">{iss.title}</span>
            </button>
          ))}
          {unresolvedIds.map((id) => (
            <div key={id} className="note-editor-issue-ref is-unresolved" title="Not in graph cache">
              <span className="note-editor-issue-ref-id">{id}</span>
              <span className="note-editor-issue-ref-title">(not in cache)</span>
            </div>
          ))}
          </>}
        </div>
      )}
    </div>
  )
}
