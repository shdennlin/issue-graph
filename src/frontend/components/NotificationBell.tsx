import { useRef } from 'react'
import { Bell } from 'lucide-react'
import { useClickOutside } from '../hooks/useClickOutside'
import type { ChangedField } from '../lib/issueDiff'
import { unreadCount, useNotificationStore } from '../store/notificationStore'
import { useViewStore } from '../store/viewStore'
import { currentQuery } from '../store/urlSync'
import { useT, useLocale, type DictKey } from '../i18n'
import { priorityLabelFor } from '../lib/colors'
import type { NotificationEntry } from '../store/notificationStore'
import type { Locale } from '../i18n/store'

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
  const scopeQuery = useNotificationStore((s) => s.scopeQuery)
  const setScopeQuery = useNotificationStore((s) => s.setScopeQuery)
  const t = useT()
  const locale = useLocale()

  const scoped = scopeQuery !== ''

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
            <span className="notif-popover-actions">
              {/* The moment you decide this is too noisy is while you are
                  reading the list, not while you are in Settings — so the
                  narrowing lives here too. Same stored value either way. */}
              <button
                type="button"
                className="notif-popover-link"
                onClick={() => setScopeQuery(currentQuery())}
                title={t('notifications.scopeCurrentHint')}
              >
                {t('notifications.scopeOnlyThese')}
              </button>
              {entries.length > 0 && (
                <button type="button" className="notif-popover-link" onClick={() => clear()}>
                  {t('notifications.clear')}
                </button>
              )}
            </span>
          </div>

          {scoped && (
            <div className="notif-popover-scope">
              {t('notifications.scopeNarrowed')}
              <button
                type="button"
                className="notif-popover-link"
                onClick={() => setScopeQuery('')}
              >
                {t('notifications.scopeReset')}
              </button>
            </div>
          )}

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
                  <span className="notif-row-what">{summarize(e, t, locale)}</span>
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
  e: NotificationEntry,
  t: (k: DictKey) => string,
  locale: Locale,
): string {
  if (e.kind === 'created') return t('notifications.created')
  // "→ In Review · +bug · new comment" — the value where there is one, the
  // field name where naming the value would say less than naming the field.
  return e.fields
    .map((f) => {
      const to = e.to[f]
      if (to === undefined) return t(FIELD_KEY[f])
      if (to === null) return `${t(FIELD_KEY[f])} —`
      if (f === 'priority') return `→ ${priorityLabelFor(Number(to), locale)}`
      if (f === 'labels') return to
      return `→ ${to}`
    })
    .join(' · ')
}
