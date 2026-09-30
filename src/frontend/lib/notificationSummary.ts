// How one change-log entry reads as a line of text. Shared by the bell's rows
// and the toast, and pulled out of NotificationBell.tsx because `.tsx` is
// outside vitest's reach — the wording is the part worth pinning.

import type { IssueStateType } from '@shared/types.js'
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
      if (f === 'comment') return `${t(FIELD_KEY[f])}: ${to}`
      if (to === null) return `${t(FIELD_KEY[f])} —`
      if (f === 'priority') return `→ ${priorityLabelFor(Number(to), locale)}`
      if (f === 'labels') return to
      return `→ ${to}`
    })
    .join(' · ')
}

/** How a value is coloured. A state takes its canonical type, so it matches
 *  the graph; priority flags only the two levels that ask for attention. */
export type Tone = IssueStateType | 'warn' | 'danger' | 'none'

export interface LineValue {
  text: string
  tone?: Tone
}

/**
 * One moved field, as the toast draws it: "Status  Todo → In Review".
 *
 * Structured rather than a string because the two sides are coloured
 * separately, and a string would push that parsing into the component, where
 * nothing can test it.
 */
export interface ChangeLine {
  label: string
  from?: LineValue
  to?: LineValue
}

const LINE_KEY: Record<ChangedField, DictKey> = {
  title: 'notifications.line.title',
  state: 'notifications.line.state',
  assignee: 'notifications.line.assignee',
  priority: 'notifications.line.priority',
  labels: 'notifications.line.labels',
  project: 'notifications.line.project',
  milestone: 'notifications.line.milestone',
  dueDate: 'notifications.line.dueDate',
  comment: 'notifications.line.comment',
}

function priorityTone(p: number): Tone | undefined {
  if (p === 1) return 'danger'
  if (p === 2) return 'warn'
  return undefined
}

export function describeEntry(
  e: StoredEntry,
  t: (k: DictKey) => string,
  locale: Locale,
): ChangeLine[] {
  const value = (
    f: ChangedField,
    raw: string | null | undefined,
    stateType: IssueStateType | undefined,
  ): LineValue | undefined => {
    if (raw === undefined) return undefined
    // A cleared field: a word rather than a dash, which read as punctuation.
    if (raw === null) return { text: t('notifications.line.none'), tone: 'none' }
    if (f === 'priority') {
      const p = Number(raw)
      const tone = priorityTone(p)
      return { text: priorityLabelFor(p, locale), ...(tone ? { tone } : {}) }
    }
    if (f === 'state' && stateType) return { text: raw, tone: stateType }
    return { text: raw }
  }

  if (e.kind === 'created') {
    const to = value('state', e.to.state, e.stateType?.to)
    return [{ label: t('notifications.line.created'), ...(to ? { to } : {}) }]
  }

  return e.fields.map((f) => {
    if (f === 'comment') {
      // An entry from before excerpts existed has none; it still says "new".
      const said = e.to.comment ?? t('notifications.line.commentNew')
      return { label: t(LINE_KEY[f]), to: { text: e.commentAuthor ? `${e.commentAuthor}: ${said}` : said } }
    }
    const from = value(f, e.from?.[f], e.stateType?.from)
    const to = value(f, e.to[f], e.stateType?.to)
    return { label: t(LINE_KEY[f]), ...(from ? { from } : {}), ...(to ? { to } : {}) }
  })
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
