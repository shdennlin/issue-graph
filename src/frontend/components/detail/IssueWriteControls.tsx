// The three write-back controls, kept out of DetailPanel because that file is
// already 750 lines and these have their own dependencies (the write store, the
// option derivations, the capability check).
//
// Each renders nothing at all when the server has no Linear OAuth application
// configured: a control that cannot work is worse than no control. When the
// server has one but this browser holds no unexpired token, they render
// disabled with the reason — that state is recoverable by the user, so hiding
// it would be unhelpful.

import { useState } from 'react'
import type { NormalizedIssue, NormalizedLabel, Priority } from '@shared/types.js'
import { useCapabilityStore } from '../../store/capabilityStore'
import { useIssueWriteStore } from '../../store/issueWriteStore'
import { useSchemaStore } from '../../store/schemaStore'
import { useGraphStore } from '../../store/graphStore'
import {
  addableLabels,
  assigneeOptionsFrom,
  labelOptionsFrom,
  matchCurrentState,
  statusOptionsFor,
} from '../../lib/writeOptions'
import { priorityLabelFor } from '../../lib/colors'
import { useLocale } from '../../i18n'
import { apiErrorMessage } from '../../lib/apiErrorMessage'
import { useT } from '../../i18n'
import { useViewStore } from '../../store/viewStore'

/** The sentinel option value for "nobody". Not a display name — this never
 *  reaches a URL, unlike the facet filter's '(unassigned)'. */
const UNASSIGNED = '__none__'

function useWriteGate() {
  const writeEnabled = useCapabilityStore((s) => s.writeEnabled)
  // Subscribed, not read from localStorage at render time: returning from the
  // Linear authorize redirect must re-enable these controls without a reload.
  const unlocked = useCapabilityStore((s) => s.unlocked)
  return { show: writeEnabled === true, unlocked }
}

function WriteError({ identifier }: { identifier: string }) {
  const t = useT()
  const err = useIssueWriteStore((s) => s.error[identifier])
  if (err === undefined) return null
  return (
    <div className="detail-write-error" role="alert">
      {apiErrorMessage(err, t)}
    </div>
  )
}

export function StatusControl({ issue }: { issue: NormalizedIssue }) {
  const t = useT()
  const { show, unlocked } = useWriteGate()
  const workflowStates = useSchemaStore((s) => s.workflowStates)
  const setState = useIssueWriteStore((s) => s.setState)
  const saving = useIssueWriteStore((s) => s.status[issue.identifier] === 'saving')

  if (!show) return null

  const options = statusOptionsFor(workflowStates, issue.team?.key)
  // No options means the state list never loaded (GET /api/labels failed, which
  // schemaStore swallows). Offering an empty dropdown would look broken.
  if (options.length === 0) return null
  const current = matchCurrentState(options, issue.state)

  return (
    <>
      <select
        className="detail-write-select"
        aria-label={t('detailPanel.changeState')}
        title={t('detailPanel.changeState')}
        disabled={!unlocked || saving}
        value={current?.id ?? ''}
        onChange={(e) => {
          const next = options.find((o) => o.id === e.target.value)
          if (!next || next.id === current?.id) return
          void setState(issue.identifier, { id: next.id, name: next.name, type: next.type })
        }}
      >
        {/* Only present when the current state could not be matched — a state
            renamed upstream since the last sync. Showing an empty selection is
            honest; silently selecting a neighbour would not be. */}
        {!current && <option value="">{issue.state.name}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
      <WriteError identifier={issue.identifier} />
    </>
  )
}

export function AssigneeControl({ issue }: { issue: NormalizedIssue }) {
  const t = useT()
  const { show, unlocked } = useWriteGate()
  const graph = useGraphStore((s) => s.graph)
  const setAssignee = useIssueWriteStore((s) => s.setAssignee)
  const saving = useIssueWriteStore((s) => s.status[issue.identifier] === 'saving')

  if (!show) return null

  const options = assigneeOptionsFrom(graph?.data.issues ?? [])
  const currentId = issue.assignee?.id ?? null
  // The current assignee may not be in the derived list — they could have been
  // unassigned from everything else, or their id may be missing from the cache.
  // Append them so the dropdown can show what the issue actually says.
  const withCurrent =
    currentId && !options.some((o) => o.id === currentId) && issue.assignee
      ? [issue.assignee, ...options]
      : options

  return (
    <>
      <select
        className="detail-write-select"
        aria-label={t('detailPanel.changeAssignee')}
        title={t('detailPanel.changeAssignee')}
        disabled={!unlocked || saving}
        value={currentId ?? UNASSIGNED}
        onChange={(e) => {
          const v = e.target.value
          if (v === (currentId ?? UNASSIGNED)) return
          const next = v === UNASSIGNED ? null : (withCurrent.find((o) => o.id === v) ?? null)
          void setAssignee(issue.identifier, next)
        }}
      >
        <option value={UNASSIGNED}>{t('detailPanel.unassignedShort')}</option>
        {withCurrent.map((a) => (
          <option key={a.id} value={a.id}>{a.displayName}</option>
        ))}
      </select>
      <WriteError identifier={issue.identifier} />
    </>
  )
}

export function CommentComposer({
  identifier,
  onPosted,
}: {
  identifier: string
  onPosted: () => void
}) {
  const t = useT()
  const { show, unlocked } = useWriteGate()
  const [body, setBody] = useState('')
  const addComment = useIssueWriteStore((s) => s.addComment)
  const saving = useIssueWriteStore((s) => s.status[identifier] === 'saving')

  if (!show) return null

  const submit = async () => {
    const text = body.trim()
    if (!text || saving) return
    const ok = await addComment(identifier, text)
    // Only clear on success — throwing away what someone just typed because
    // the network blinked is the one failure they cannot recover from.
    if (ok) {
      setBody('')
      onPosted()
    }
  }

  return (
    <div className="detail-comment-composer">
      <textarea
        rows={3}
        style={{ width: '100%' }}
        value={body}
        disabled={!unlocked || saving}
        placeholder={t('detailPanel.commentPlaceholder')}
        onChange={(e) => setBody(e.target.value)}
      />
      <button
        type="button"
        className="primary"
        disabled={!unlocked || saving || body.trim().length === 0}
        onClick={() => void submit()}
      >
        {saving ? t('detailPanel.commentSending') : t('detailPanel.commentSend')}
      </button>
      <WriteError identifier={identifier} />
    </div>
  )
}

/** Linear's fixed range, low number = high urgency. Listed rather than
 *  generated so the order in the dropdown is the order a person expects. */
const PRIORITIES: Priority[] = [0, 1, 2, 3, 4]

export function PriorityControl({ issue }: { issue: NormalizedIssue }) {
  const t = useT()
  const locale = useLocale()
  const { show, unlocked } = useWriteGate()
  const setPriority = useIssueWriteStore((s) => s.setPriority)
  const saving = useIssueWriteStore((s) => s.status[issue.identifier] === 'saving')

  if (!show) return null

  return (
    <>
      <select
        className="detail-write-select"
        aria-label={t('detailPanel.changePriority')}
        title={t('detailPanel.changePriority')}
        disabled={!unlocked || saving}
        value={String(issue.priority ?? 0)}
        onChange={(e) => {
          const next = Number(e.target.value) as Priority
          if (next === (issue.priority ?? 0)) return
          void setPriority(issue.identifier, next)
        }}
      >
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>{priorityLabelFor(p, locale)}</option>
        ))}
      </select>
      <WriteError identifier={issue.identifier} />
    </>
  )
}

/**
 * The × on a label chip. Rendered next to the existing filter chip rather than
 * replacing it, so the chip keeps meaning "filter to this label" and the ×
 * means "take it off" — the same two-verbs split as the state pill.
 */
export function LabelRemoveButton({
  issue,
  label,
}: {
  issue: NormalizedIssue
  label: NormalizedLabel
}) {
  const t = useT()
  const { show, unlocked } = useWriteGate()
  const removeLabel = useIssueWriteStore((s) => s.removeLabel)
  const saving = useIssueWriteStore((s) => s.status[issue.identifier] === 'saving')

  if (!show || !unlocked) return null

  return (
    <button
      type="button"
      className="detail-label-remove"
      disabled={saving}
      title={t('detailPanel.removeLabel', { value: label.name })}
      aria-label={t('detailPanel.removeLabel', { value: label.name })}
      onClick={() => void removeLabel(issue.identifier, label, issue.labels ?? [])}
    >
      ×
    </button>
  )
}

/** Its own row under the label sections. A select rather than a chip grid
 *  because a workspace can have dozens of labels and the panel is narrow. */
export function LabelAddControl({ issue }: { issue: NormalizedIssue }) {
  const t = useT()
  const { show, unlocked } = useWriteGate()
  const graph = useGraphStore((s) => s.graph)
  const addLabel = useIssueWriteStore((s) => s.addLabel)
  const saving = useIssueWriteStore((s) => s.status[issue.identifier] === 'saving')

  if (!show) return null

  const options = addableLabels(labelOptionsFrom(graph?.data.issues ?? []), issue.labels)
  // Nothing left to add — either the cache knows no other labels, or they are
  // all already on this issue. An empty dropdown would just be a dead control.
  if (options.length === 0) return null

  return (
    <div className="row">
      <span className="k">{t('detailPanel.addLabel')}</span>
      <span>
        <select
          className="detail-write-select"
          aria-label={t('detailPanel.addLabel')}
          title={t('detailPanel.addLabel')}
          disabled={!unlocked || saving}
          value=""
          onChange={(e) => {
            const next = options.find((o) => o.id === e.target.value)
            if (next) void addLabel(issue.identifier, next, issue.labels ?? [])
          }}
        >
          {/* Stays selected: this is an action list, not a current value. */}
          <option value="">{t('detailPanel.addLabelPlaceholder')}</option>
          {options.map((l) => (
            <option key={l.id} value={l.id}>
              {l.group ? `${l.group.name} / ${l.name}` : l.name}
            </option>
          ))}
        </select>
        <WriteError identifier={issue.identifier} />
      </span>
    </div>
  )
}

/**
 * One line, once per panel, explaining why the controls above are dead — and
 * taking the user to the fix.
 *
 * Deliberately not a tooltip: the controls it describes are `disabled`, and
 * browsers are inconsistent about surfacing `title` on a disabled form control
 * (and touch has no hover at all), so the one place the explanation lived was
 * the one place some users could never reach it.
 *
 * Deliberately not a modal either. The full explanation already exists in
 * Settings, next to the button — and the user has to end up there anyway,
 * because that is where the authorize redirect starts. A modal would duplicate
 * that prose (two copies to keep true) and still end with "now go to Settings".
 * This is the same information, reached on demand, one click from the control
 * it is about.
 *
 * Shown only for the recoverable state. When the *server* has no OAuth client
 * id the controls are hidden entirely and this stays quiet: nothing the user
 * can do in this browser would help, so a call to action would be a lie.
 */
export function WriteLockedHint() {
  const t = useT()
  const { show, unlocked } = useWriteGate()
  const openSettingsAt = useViewStore((s) => s.openSettingsAt)

  if (!show || unlocked) return null

  return (
    <div className="detail-write-locked">
      <span aria-hidden>🔒</span>
      <span>{t('detailPanel.writeLocked')}</span>
      <button type="button" className="detail-write-locked-cta" onClick={() => openSettingsAt('write-access')}>
        {t('detailPanel.writeLockedCta')}
      </button>
    </div>
  )
}
