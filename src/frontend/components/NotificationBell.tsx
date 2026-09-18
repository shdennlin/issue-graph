import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { useClickOutside } from '../hooks/useClickOutside'
import type { ChangedField } from '../lib/issueDiff'
import { unreadCount, useNotificationStore } from '../store/notificationStore'
import { useGraphStore } from '../store/graphStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import {
  computeNudges,
  pruneDismissals,
  readDismissals,
  writeDismissals,
} from '../lib/stageNudges'
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
const EMPTY_DISMISSALS: ReadonlySet<string> = new Set()

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

  // Advanced only by the interval, and only while the popover is open — the
  // rows need to know what "today" is, and reading Date.now() in the render
  // body is the impure read eslint-plugin-react-hooks v7 flags.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!open) return
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [open])

  // Standing conditions, re-derived rather than stored — see stageNudges.ts.
  // A nudge stops being true the moment someone acts on it, so persisting one
  // would mean it outlived the thing it was reporting.
  const graph = useGraphStore((s) => s.graph)
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const setActiveView = useViewStore((s) => s.setActiveView)
  const setFocusedWorkstreamId = useViewStore((s) => s.setFocusedWorkstreamId)
  // Ordinary state that happens to be persisted, carrying the workspace it was
  // loaded for. Two rules pushed it into this shape and both are right: an
  // effect that re-reads it on a workspace change is set-state-in-effect, and
  // reading localStorage inside the memo instead makes the memo impure and its
  // cache key a lie. Adjusting during render is React's documented answer for
  // state that must reset when an input changes, and it needs no effect.
  const [dismissals, setDismissals] = useState(() => ({
    wid: workspaceId,
    keys: readDismissals(workspaceId) as ReadonlySet<string>,
  }))
  if (dismissals.wid !== workspaceId) {
    setDismissals({ wid: workspaceId, keys: readDismissals(workspaceId) })
  }
  // Until that re-render lands, treat the other workspace's dismissals as
  // absent rather than applying them to this one's workstreams.
  const dismissed = dismissals.wid === workspaceId ? dismissals.keys : EMPTY_DISMISSALS

  const nudges = useMemo(
    () => (graph ? computeNudges(graph.data, now, dismissed) : []),
    [graph, now, dismissed],
  )

  const dismiss = (key: string) => {
    const next = new Set(dismissed)
    next.add(key)
    // Pruned on write as well as on read: a key whose workstream is gone can
    // never match again, and nothing else would ever clean it up.
    const kept: ReadonlySet<string> = new Set(
      pruneDismissals(next, graph?.data.workstreams ?? []),
    )
    setDismissals({ wid: workspaceId, keys: kept })
    writeDismissals(workspaceId, kept)
  }

  // A nudge nobody has seen is unread by any reasonable reading of the word,
  // so it has to move the badge — otherwise the whole feature is invisible
  // until someone happens to open the bell.
  const unread = unreadCount(entries) + nudges.length

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

          {/* Above the change log, because a nudge is something to DO and the
              log is something that happened. Each row is its own dismiss: the
              log's "clear" is about entries and must not silence a condition
              that is still true. */}
          {nudges.length > 0 && (
            <div className="notif-nudges">
              {nudges.map((n) => (
                <div key={n.key} className={`notif-nudge notif-nudge-${n.kind}`}>
                  <button
                    type="button"
                    className="notif-nudge-main"
                    onClick={() => {
                      // The target is a STAGE, not an issue — so this expands
                      // the workstream rather than focusing a card.
                      setActiveView('workstream')
                      setFocusedWorkstreamId(n.workstreamId)
                      setOpen(false)
                    }}
                  >
                    <span className="notif-nudge-name">{n.workstreamName}</span>
                    <span className="notif-nudge-why">
                      {n.kind === 'evidence'
                        ? t('stage.nudgeEvidence', { stage: n.stageName })
                        : t('stage.nudgeStale', { stage: n.stageName, n: n.days ?? 0 })}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="notif-popover-link"
                    onClick={() => dismiss(n.key)}
                    title={t('stage.nudgeDismissHint')}
                  >
                    {t('stage.nudgeDismiss')}
                  </button>
                </div>
              ))}
            </div>
          )}

          {entries.length === 0 && nudges.length === 0 ? (
            <div className="notif-popover-empty">{t('notifications.empty')}</div>
          ) : (
            <div className="notif-popover-list">
              {entries.slice(0, RENDER_LIMIT).map((e) => (
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
                  <span className="notif-row-when">{when(e.at, now)}</span>
                </button>
              ))}
            </div>
          )}

          <div className="notif-popover-foot">
            {entries.length > RENDER_LIMIT
              ? t('notifications.moreHidden', { count: entries.length - RENDER_LIMIT })
              : t('notifications.olderHint')}
          </div>
        </div>
      )}
    </div>
  )
}

/** The log keeps up to MAX_ENTRIES, but a popover that mounts a thousand
 *  buttons re-renders all of them on every store write. Older than this is
 *  what the recency facet is for. */
const RENDER_LIMIT = 200

/** `13:48` for something from today, `09-16` for anything older. What makes
 *  the row read as a record of an event rather than a claim about now. */
function when(at: number, now: number): string {
  const d = new Date(at)
  const today = new Date(now)
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return sameDay
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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
