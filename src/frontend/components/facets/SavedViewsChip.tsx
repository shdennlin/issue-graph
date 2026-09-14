// "Views" control at the head of the facet bar: save the current filter/view
// state under a name, and recall anyone's saved view in one click.
//
// Server-backed on purpose. Pins are personal and live in localStorage; saved
// views exist to be shared, so they live in the workspace's own graph.db and
// everyone reaching this instance sees the same list. There is no auth in this
// tool by design, so there is no author and no ownership — anyone can rename or
// delete any view, exactly as with notes and annotations today.

import { useRef, useState } from 'react'
import { Check, ChevronDown, GripVertical, Pencil, Trash2 } from 'lucide-react'
import { useClickOutside } from '../../hooks/useClickOutside'
import { useSavedViewsStore } from '../../store/savedViewsStore'
import { useViewStore } from '../../store/viewStore'
import { applySavedQuery, currentQuery } from '../../store/urlSync'
import { apiErrorMessage } from '../../lib/apiErrorMessage'
import { activeViewLabel, useActiveSavedView } from '../../hooks/useActiveSavedView'
import { formatRelative } from '../../lib/relativeTime'
import { useT } from '../../i18n'

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
  // Only the grip is draggable, so the row's primary button stays a plain
  // click-to-apply target — no press-and-hold arming state, and no chance of a
  // stray drag swallowing a click on the name.
  const [dragId, setDragId] = useState<number | null>(null)
  const [dragOverId, setDragOverId] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, open, () => {
    setOpen(false)
    setNaming(false)
    setRenamingId(null)
    setConfirmingId(null)
  })

  const views = useSavedViewsStore((s) => s.views)
  const error = useSavedViewsStore((s) => s.error)
  const create = useSavedViewsStore((s) => s.create)
  const rename = useSavedViewsStore((s) => s.rename)
  const update = useSavedViewsStore((s) => s.update)
  const reorder = useSavedViewsStore((s) => s.reorder)
  const remove = useSavedViewsStore((s) => s.remove)
  // Which view is in play, and whether we have edited away from it. Fetching
  // the list, adopting an exact match and the window title all moved to
  // SavedViewSync — they have to keep happening while this menu is unmounted,
  // which is most of the time now that the panel auto-hides.
  const status = useActiveSavedView()
  const { view: current } = status
  const label = activeViewLabel(status)
  const appliedId = useViewStore((s) => s.appliedSavedViewId)
  const setAppliedId = useViewStore((s) => s.setAppliedSavedViewId)
  const dragIdx = dragId === null ? -1 : views.findIndex((v) => v.id === dragId)

  const submitNew = () => {
    const name = draft.trim()
    if (!name) return
    // Not setting appliedId here: create() resolves asynchronously, and the
    // new view matches the current state exactly, so SavedViewSync's
    // adopt-effect picks it up as soon as the list refreshes.
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
        {/* No leading icon. A bookmark glyph restated the row's category,
            which its position and weight already say, while pinning the name
            away from the left edge the rows below align to. The trailing
            chevron replaces it and carries information the icon did not:
            that this opens something. */}
        <span className="facet-option-label">{label ?? t('savedViews.label')}</span>
        {views.length > 0 && !current && (
          <span className="facet-option-count">{views.length}</span>
        )}
        <ChevronDown size={12} className="facet-views-caret" />
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
            {views.map((v, idx) => (
              <div
                className={[
                  'facet-option-row',
                  dragId === v.id ? 'is-dragging' : '',
                  // Which EDGE of the target row gets the line depends on the
                  // direction of travel: dragging down lands the row after the
                  // target, dragging up lands it before. A line on the wrong
                  // side is worse than no line — it predicts the wrong result.
                  dragOverId === v.id && dragId !== v.id
                    ? dragIdx > idx
                      ? 'is-drop-above'
                      : 'is-drop-below'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                key={v.id}
                onDragOver={(e) => {
                  if (dragId === null || dragId === v.id) return
                  // preventDefault is what marks this a valid drop target;
                  // without it the browser refuses the drop and the gesture
                  // ends in the snap-back animation with nothing happening.
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDragOverId(v.id)
                }}
                onDragLeave={(e) => {
                  // dragleave fires when the cursor crosses onto a CHILD of
                  // this row too, which would blink the drop line off and on
                  // as the pointer passes over the buttons. Only a leave that
                  // actually exits the row counts.
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
                  setDragOverId((id) => (id === v.id ? null : id))
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const from = dragId
                  setDragId(null)
                  setDragOverId(null)
                  // `idx` is this row's index in the CURRENT list. Dropping on
                  // a row below means "go where it is", which after lifting the
                  // dragged row out lands just past it — the behaviour a drop
                  // onto the last row has to have to mean "put it last".
                  if (from !== null && from !== v.id) void reorder(from, idx)
                }}
              >
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
                    {views.length > 1 && (
                      <span
                        className="facet-view-grip"
                        draggable
                        role="button"
                        tabIndex={-1}
                        aria-label={t('savedViews.reorder')}
                        title={t('savedViews.reorder')}
                        onDragStart={(e) => {
                          setDragId(v.id)
                          e.dataTransfer.effectAllowed = 'move'
                          // Firefox ignores a drag that carries no payload.
                          e.dataTransfer.setData('text/plain', String(v.id))
                        }}
                        onDragEnd={() => {
                          setDragId(null)
                          setDragOverId(null)
                        }}
                      >
                        <GripVertical size={11} />
                      </span>
                    )}
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
