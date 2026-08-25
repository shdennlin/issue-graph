// "Views" control at the head of the facet bar: save the current filter/view
// state under a name, and recall anyone's saved view in one click.
//
// Server-backed on purpose. Pins are personal and live in localStorage; saved
// views exist to be shared, so they live in the workspace's own graph.db and
// everyone reaching this instance sees the same list. There is no auth in this
// tool by design, so there is no author and no ownership — anyone can rename or
// delete any view, exactly as with notes and annotations today.

import { useEffect, useRef, useState } from 'react'
import { Bookmark, Check, Pencil, Trash2 } from 'lucide-react'
import { useClickOutside } from '../../hooks/useClickOutside'
import { useSavedViewsStore } from '../../store/savedViewsStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { applySavedQuery, flushUrlSync } from '../../store/urlSync'
import { apiErrorMessage } from '../../lib/apiErrorMessage'
import { formatRelative } from '../../lib/relativeTime'
import { useT } from '../../i18n'

export function SavedViewsChip() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => {
    setOpen(false)
    setNaming(false)
    setRenamingId(null)
  })

  const views = useSavedViewsStore((s) => s.views)
  const error = useSavedViewsStore((s) => s.error)
  const load = useSavedViewsStore((s) => s.load)
  const create = useSavedViewsStore((s) => s.create)
  const rename = useSavedViewsStore((s) => s.rename)
  const update = useSavedViewsStore((s) => s.update)
  const remove = useSavedViewsStore((s) => s.remove)
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)

  // Views are per workspace (each has its own graph.db), so refetch on switch.
  useEffect(() => {
    if (workspaceId) void load()
  }, [workspaceId, load])

  const currentQuery = () => {
    // The URL write is debounced by 200ms, so a filter changed a moment ago
    // would otherwise be missing from what we capture.
    flushUrlSync()
    return window.location.search
  }

  const submitNew = () => {
    const name = draft.trim()
    if (!name) return
    void create(name, currentQuery())
    setDraft('')
    setNaming(false)
  }

  return (
    <div className="facet-chip-wrap" ref={ref}>
      <button
        type="button"
        className="facet-chip facet-views"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Bookmark size={11} /> {t('savedViews.label')}
        {views.length > 0 && <span className="facet-option-count">{views.length}</span>}
      </button>

      {open && (
        <div className="facet-popover">
          {error !== null && (
            <div className="facet-empty facet-error">{apiErrorMessage(error, t)}</div>
          )}

          <div className="facet-option-list">
            {views.length === 0 && !naming && (
              <div className="facet-empty">{t('savedViews.empty')}</div>
            )}
            {views.map((v) => (
              <div className="facet-option-row" key={v.id}>
                {renamingId === v.id ? (
                  <input
                    className="facet-search"
                    defaultValue={v.name}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void rename(v.id, e.currentTarget.value)
                        setRenamingId(null)
                      }
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    onBlur={() => setRenamingId(null)}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      className="facet-option"
                      onClick={() => {
                        applySavedQuery(v.query)
                        setOpen(false)
                      }}
                      title={t('savedViews.updatedAt', { when: formatRelative(v.updatedAt) })}
                    >
                      <span className="facet-option-label">{v.name}</span>
                    </button>
                    <button
                      type="button"
                      className="facet-pin"
                      onClick={() => void update(v.id, currentQuery())}
                      aria-label={t('savedViews.updateToCurrent')}
                      title={t('savedViews.updateToCurrent')}
                    >
                      <Check size={11} />
                    </button>
                    <button
                      type="button"
                      className="facet-pin"
                      onClick={() => setRenamingId(v.id)}
                      aria-label={t('savedViews.rename')}
                      title={t('savedViews.rename')}
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      type="button"
                      className="facet-pin"
                      onClick={() => {
                        // Anyone can delete anyone's view — no auth by design —
                        // so a confirm is the only guard, and enough for a
                        // localhost-scale tool.
                        if (window.confirm(t('savedViews.confirmDelete', { name: v.name }))) {
                          void remove(v.id)
                        }
                      }}
                      aria-label={t('savedViews.delete')}
                      title={t('savedViews.delete')}
                    >
                      <Trash2 size={11} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          {naming ? (
            <input
              className="facet-search"
              value={draft}
              autoFocus
              placeholder={t('savedViews.namePlaceholder')}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitNew()
                if (e.key === 'Escape') setNaming(false)
              }}
            />
          ) : (
            <button type="button" className="facet-option" onClick={() => setNaming(true)}>
              <span className="facet-option-label">+ {t('savedViews.saveCurrent')}</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
