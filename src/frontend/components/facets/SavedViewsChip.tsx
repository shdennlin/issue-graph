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
import { useViewStore } from '../../store/viewStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { applySavedQuery, flushUrlSync } from '../../store/urlSync'
import { apiErrorMessage } from '../../lib/apiErrorMessage'
import { documentTitle, savedViewStatus } from '../../lib/savedViewMatch'
import { formatRelative } from '../../lib/relativeTime'
import { useT } from '../../i18n'

/** The app name as index.html shipped it, captured once at module load.
 *  Read per-component it would re-capture a title this code had already
 *  rewritten, and each remount would nest another segment. */
const BASE_TITLE = typeof document === 'undefined' ? '' : document.title

export function SavedViewsChip() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [renamingId, setRenamingId] = useState<number | null>(null)
  // Inline rather than window.confirm(): a browser that has had "prevent this
  // page from creating additional dialogs" ticked suppresses confirm() and
  // returns false forever, which presents as a delete button that silently
  // does nothing. An in-page step cannot be switched off.
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => {
    setOpen(false)
    setNaming(false)
    setRenamingId(null)
    setConfirmingId(null)
  })

  const views = useSavedViewsStore((s) => s.views)
  const error = useSavedViewsStore((s) => s.error)
  const load = useSavedViewsStore((s) => s.load)
  const create = useSavedViewsStore((s) => s.create)
  const rename = useSavedViewsStore((s) => s.rename)
  const update = useSavedViewsStore((s) => s.update)
  const remove = useSavedViewsStore((s) => s.remove)
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  // Naming the view you are actually on. Recomputed from the URL rather than
  // remembered, so it survives a reload, recognises a shared link that happens
  // to match, and stops claiming a view the moment you edit away from it.
  //
  // These two store reads exist to SUBSCRIBE: window.location is not reactive,
  // so without them a filter change would not re-render and the name would go
  // stale. Same `void` idiom as useHistoryAvailability in urlSync. Left
  // unmemoized deliberately — a handful of string comparisons is cheaper than
  // a dependency array the linter cannot verify.
  const filters = useViewStore((s) => s.filters)
  const activeView = useViewStore((s) => s.activeView)
  void filters
  void activeView
  const appliedId = useViewStore((s) => s.appliedSavedViewId)
  const setAppliedId = useViewStore((s) => s.setAppliedSavedViewId)
  const { view: current, dirty } = savedViewStatus(window.location.search, views, appliedId)

  // Adopt an exact match as the reference point, so edits made after arriving
  // on a shared link that equals a saved view still show as divergence.
  useEffect(() => {
    if (current && !dirty && current.id !== appliedId) setAppliedId(current.id)
  }, [current, dirty, appliedId, setAppliedId])

  // Only named when there is more than one workspace — repeating the sole
  // workspace's name on every window distinguishes nothing.
  const profiles = useWorkspaceStore((s) => s.profiles)
  const workspaceName =
    profiles.length > 1 ? (profiles.find((p) => p.id === workspaceId)?.name ?? null) : null
  useEffect(() => {
    document.title = documentTitle(current, dirty, workspaceName, BASE_TITLE)
  }, [current, dirty, workspaceName])

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
    // Not setting appliedId here: create() resolves asynchronously, and the
    // new view matches the current state exactly, so the adopt-effect above
    // picks it up as soon as the list refreshes.
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
        <Bookmark size={11} />
        <span className="facet-option-label">
          {current ? `${current.name}${dirty ? ' *' : ''}` : t('savedViews.label')}
        </span>
        {views.length > 0 && !current && (
          <span className="facet-option-count">{views.length}</span>
        )}
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
                {confirmingId === v.id ? (
                  <>
                    <span className="facet-confirm-text">
                      {t('savedViews.confirmDelete', { name: v.name })}
                    </span>
                    <button
                      type="button"
                      className="facet-view-action is-danger"
                      onClick={() => {
                        // A deleted view can no longer be this tab's reference
                        // point; the store only owns the list now.
                        if (appliedId === v.id) setAppliedId(null)
                        void remove(v.id)
                        setConfirmingId(null)
                      }}
                    >
                      {t('savedViews.confirmYes')}
                    </button>
                    <button
                      type="button"
                      className="facet-view-action"
                      onClick={() => setConfirmingId(null)}
                    >
                      {t('common.cancel')}
                    </button>
                  </>
                ) : renamingId === v.id ? (
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
                      className={`facet-option${current?.id === v.id ? ' is-selected' : ''}`}
                      onClick={() => {
                        applySavedQuery(v.query)
                        setAppliedId(v.id)
                        setOpen(false)
                      }}
                      title={t('savedViews.updatedAt', { when: formatRelative(v.updatedAt) })}
                    >
                      <span className="facet-option-label">{v.name}</span>
                    </button>
                    <button
                      type="button"
                      className="facet-view-action"
                      onClick={() => void update(v.id, currentQuery())}
                      aria-label={t('savedViews.updateToCurrent')}
                      title={t('savedViews.updateToCurrent')}
                    >
                      <Check size={11} />
                    </button>
                    <button
                      type="button"
                      className="facet-view-action"
                      onClick={() => setRenamingId(v.id)}
                      aria-label={t('savedViews.rename')}
                      title={t('savedViews.rename')}
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      type="button"
                      className="facet-view-action"
                      onClick={() => setConfirmingId(v.id)}
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
