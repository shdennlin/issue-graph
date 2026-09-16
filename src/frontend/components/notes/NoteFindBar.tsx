import { forwardRef } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useT } from '../../i18n'

interface Props {
  query: string
  onQueryChange: (q: string) => void
  matchIndex: number          // 0-based; meaningless when matchCount === 0
  matchCount: number
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

/**
 * Floating find bar rendered inside NoteEditor. Enter/Shift+Enter cycle
 * matches; Esc closes. The input ref is forwarded so NoteEditor can focus
 * it when Cmd+F (re)opens the bar.
 */
export const NoteFindBar = forwardRef<HTMLInputElement, Props>(function NoteFindBar(
  { query, onQueryChange, matchIndex, matchCount, onNext, onPrev, onClose },
  ref,
) {
  const t = useT()
  const hasQuery = query.length > 0
  const positionLabel = hasQuery
    ? matchCount === 0
      ? t('notes.findInNoteNoMatch')
      : t('notes.findInNoteMatchPosition', { index: matchIndex + 1, total: matchCount })
    : ''

  return (
    <div className="note-find-bar" role="search">
      <input
        ref={ref}
        type="search"
        className="note-find-bar-input"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            // Stop NotesModal's window-level Esc handler from firing too.
            e.stopPropagation()
            onClose()
            return
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) onPrev()
            else onNext()
          }
        }}
        placeholder={t('notes.findInNotePlaceholder')}
        aria-label={t('notes.findInNotePlaceholder')}
        spellCheck={false}
      />
      <span className="note-find-bar-position" aria-live="polite">
        {positionLabel}
      </span>
      <button
        type="button"
        className="icon-only note-find-bar-nav"
        onClick={onPrev}
        disabled={matchCount === 0}
        aria-label={t('notes.findInNotePrev')}
        title={t('notes.findInNotePrev')}
      >
        <ChevronUp size={14} />
      </button>
      <button
        type="button"
        className="icon-only note-find-bar-nav"
        onClick={onNext}
        disabled={matchCount === 0}
        aria-label={t('notes.findInNoteNext')}
        title={t('notes.findInNoteNext')}
      >
        <ChevronDown size={14} />
      </button>
      <button
        type="button"
        className="icon-only note-find-bar-close"
        onClick={onClose}
        aria-label={t('notes.findInNoteClose')}
        title={t('notes.findInNoteClose')}
      >
        <X size={14} />
      </button>
    </div>
  )
})
