// How one change-log entry reads as a line of text. Shared by the bell's rows
// and the toast, and pulled out of NotificationBell.tsx because `.tsx` is
// outside vitest's reach — the wording is the part worth pinning.

import type { DictKey, Locale } from '../i18n'
import { priorityLabelFor } from './colors'
import type { ChangedField } from './issueDiff'
import type { StoredEntry } from './notificationHistory'

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

export function summarizeEntry(
  e: StoredEntry,
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

/** Rows the toast spells out before it falls back to "+N more". It floats over
 *  the graph, so a burst of twenty must not become a column of twenty. */
export const TOAST_ROWS = 3

export function toastPreview<E>(
  entries: readonly E[],
  max: number = TOAST_ROWS,
): { shown: E[]; more: number } {
  return { shown: entries.slice(0, max), more: Math.max(0, entries.length - max) }
}
