import { forwardRef } from 'react'
import { useNotesStore } from '../../store/notesStore'
import { useT } from '../../i18n'

/**
 * Top-level filter input for the Notes modal grid/list view. Visually
 * mirrors `<InlineSearch />` (the canvas-side finder) so the two search
 * surfaces feel like siblings: bare `<input type="search">` (browser
 * provides the clear cross), no custom decoration. Reads/writes
 * `notesSearch` in the notes store (session-scoped). Ref forwards to the
 * underlying <input> so Cmd+F can focus it from NotesModal.
 */
export const NotesSearchInput = forwardRef<HTMLInputElement>(function NotesSearchInput(_props, ref) {
  const query = useNotesStore((s) => s.notesSearch)
  const setQuery = useNotesStore((s) => s.setNotesSearch)
  const t = useT()

  return (
    <div className="notes-search">
      <input
        ref={ref}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('notes.searchPlaceholder')}
        aria-label={t('notes.searchPlaceholder')}
        spellCheck={false}
      />
    </div>
  )
})
