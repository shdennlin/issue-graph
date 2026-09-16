import { useRef } from 'react'
import { Bell } from 'lucide-react'
import { useClickOutside } from '../hooks/useClickOutside'
import type { ChangedField } from '../lib/issueDiff'
import { unreadCount, useNotificationStore } from '../store/notificationStore'
import { useViewStore } from '../store/viewStore'
import { useT, type DictKey } from '../i18n'

/**
 * Anchored popover, not a modal.
 *
 * Clicking a row puts the issue on the canvas, so the canvas has to stay
 * visible behind it — a modal backdrop would mean dismissing before you could
 * see the thing you asked for.
 */
export function NotificationBell({ iconSize }: { iconSize: number }) {
  const open = useViewStore((s) => s.notificationsOpen)
  const setOpen = useViewStore((s) => s.setNotificationsOpen)
  const setFocusedId = useViewStore((s) => s.setFocusedId)
  const entries = useNotificationStore((s) => s.entries)
  const markAllRead = useNotificationStore((s) => s.markAllRead)
  const clear = useNotificationStore((s) => s.clear)
  const t = useT()

  const ref = useRef<HTMLDivElement | null>(null)
  useClickOutside(ref, open, () => setOpen(false))

  const unread = unreadCount(entries)

  return (
    <div className="notif-anchor" ref={ref}>
      <button
        type="button"
        className="icon-only"
        onClick={() => {
          const next = !open
          setOpen(next)
          // Opening is the acknowledgement — the list is right there.
          if (next) markAllRead()
        }}
        title={t('notifications.bellTitle')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('notifications.bellAria')}
      >
        <Bell size={iconSize} />
        {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-popover" role="menu">
          <div className="notif-popover-head">
            <span>{t('notifications.panelTitle')}</span>
            {entries.length > 0 && (
              <button type="button" className="notif-popover-link" onClick={() => clear()}>
                {t('notifications.clear')}
              </button>
            )}
          </div>

          {entries.length === 0 ? (
            <div className="notif-popover-empty">{t('notifications.empty')}</div>
          ) : (
            <div className="notif-popover-list">
              {entries.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className="notif-row"
                  onClick={() => {
                    // `focusedId` reaches applyFilters as its `alwaysInclude`
                    // argument, so the issue appears even when the current
                    // filters exclude it — which is the normal case here, since
                    // the whole point is reporting changes outside your view.
                    setFocusedId(e.identifier)
                    setOpen(false)
                  }}
                >
                  <span className="notif-row-id">{e.identifier}</span>
                  <span className="notif-row-title">{e.title}</span>
                  <span className="notif-row-what">{summarize(e.kind, e.fields, t)}</span>
                </button>
              ))}
            </div>
          )}

          <div className="notif-popover-foot">{t('notifications.olderHint')}</div>
        </div>
      )}
    </div>
  )
}

const FIELD_KEY: Record<ChangedField, DictKey> = {
  title: 'notifications.fieldTitle',
  state: 'notifications.fieldState',
  assignee: 'notifications.fieldAssignee',
  priority: 'notifications.fieldPriority',
  labels: 'notifications.fieldLabels',
  project: 'notifications.fieldProject',
  milestone: 'notifications.fieldMilestone',
  dueDate: 'notifications.fieldDueDate',
  comment: 'notifications.fieldComment',
}

function summarize(
  kind: 'created' | 'changed',
  fields: ChangedField[],
  t: (k: DictKey) => string,
): string {
  if (kind === 'created') return t('notifications.created')
  return fields.map((f) => t(FIELD_KEY[f])).join(' · ')
}
