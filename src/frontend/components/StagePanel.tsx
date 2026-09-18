import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { RICH_LINK_KINDS } from '@shared/showTokens.js'
import { stageVisits } from '@shared/stageHistory.js'
import { api } from '../lib/api'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { useResizable } from '../hooks/useResizable'
import { compactAge } from '../lib/relativeTime'
import { useT, type DictKey } from '../i18n'

// Editing one workstream's occupancy of one stage, in a side panel.
//
// It began as a popover over the stage node, and that was the wrong shape: a
// stage is 340px wide, so the form had to be squeezed into it, the kind picker
// read as a label rather than a control, and there was nowhere to list what was
// already attached. A panel has room to show the stage's whole state and to
// edit it, which is what "add an item" actually needs.
//
// Same `<aside>` + useResizable shell as ProjectPanel, so it docks and resizes
// the way the other panels do.

const AGE_UNIT_KEYS: Record<'m' | 'h' | 'd', DictKey> = {
  m: 'issueNode.ageMinutes',
  h: 'issueNode.ageHours',
  d: 'issueNode.ageDays',
}

export function StagePanel() {
  const t = useT()
  const target = useViewStore((s) => s.stagePanel)
  const close = useViewStore((s) => s.closeStagePanel)
  const graph = useGraphStore((s) => s.graph)
  const refetchSilent = useGraphStore((s) => s.refetchSilent)

  const [viewportW, setViewportW] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  )
  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const sideMax = Math.max(360, Math.floor(viewportW * 0.5))
  const { width, startResize, resizing } = useResizable({
    storageKey: 'ig-stage-panel-w',
    defaultWidth: 380,
    min: 300,
    max: sideMax,
    side: 'right',
  })

  const workstream = (graph?.data.workstreams ?? []).find((w) => w.id === target?.workstreamId)
  const stage = (graph?.data.lifecycle ?? []).find((s) => s.key === target?.stageKey)

  // Draft state, keyed by the stage it was typed for. Adjusted during render
  // rather than synced in an effect: switching stages must not carry the
  // previous stage's half-written note across, and an effect that calls
  // setState is what `react-hooks` flags.
  const noteFromServer = workstream && stage ? (workstream.notes[stage.key] ?? '') : ''
  const [draft, setDraft] = useState(() => ({ key: target?.stageKey ?? '', note: noteFromServer }))
  const saveTimer = useRef<number | null>(null)
  // Free text, seeded from the rich kinds. `RICH_LINK_KINDS` are the ones the
  // app draws in their own box; any other name is accepted and drawn as a row
  // carrying that name, which is how a workstream defines its own fields.
  const [kind, setKind] = useState<string>('pr')
  const [kindSeededFor, setKindSeededFor] = useState<string | null>(null)
  const [customKind, setCustomKind] = useState(false)
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  // 'clean' once what is on screen matches what the server has. Saving is
  // automatic — an explicit Save on a free-text note is a step you can only
  // get wrong, and losing a paragraph because you clicked elsewhere is a
  // worse outcome than a redundant write.
  const [noteState, setNoteState] = useState<'clean' | 'dirty' | 'saving'>('clean')
  // Read once and refreshed on a timer, above the early return so the hook
  // order is stable. Reading the clock in the render body is the impurity
  // `react-hooks` flags, and it is right to — the same render would otherwise
  // produce a different age each time.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  // Flush a pending save when the panel closes or moves to another stage —
  // otherwise the last keystrokes before an Esc are lost, which is exactly the
  // moment someone finishes a thought.
  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    }
  }, [])

  if (target && draft.key !== target.stageKey) {
    setDraft({ key: target.stageKey, note: noteFromServer })
  }
  // Default to the first thing the stage says it expects, once per stage — a
  // CI stage should not open on "Pull request" when it declared `ci`.
  if (target && kindSeededFor !== target.stageKey) {
    setKindSeededFor(target.stageKey)
    const first = stage?.fields[0]
    if (first) {
      setKind(first)
      setCustomKind(!(RICH_LINK_KINDS as readonly string[]).includes(first))
    }
  }
  if (!target || !workstream || !stage) return null
  const note = draft.key === target.stageKey ? draft.note : noteFromServer

  const visit = stageVisits(workstream.stageEvents, now).get(stage.key)
  const age = visit ? compactAge(visit.enteredAt, visit.leftAt ?? now) : null
  const isCurrent = workstream.stage === stage.key
  const links = workstream.links.filter((l) => l.stageKey === stage.key)

  const saveNote = async (body: string) => {
    if (body.trim() === noteFromServer.trim()) {
      setNoteState('clean')
      return
    }
    setNoteState('saving')
    // An empty note is a DELETE, not an empty string: the server rejects a
    // blank body, and "I cleared it" is what the user meant either way.
    const trimmed = body.trim()
    await (trimmed.length === 0
      ? api.clearStageNote(workstream.id, stage.key)
      : api.setStageNote(workstream.id, stage.key, trimmed))
    await refetchSilent()
    setNoteState('clean')
  }

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await refetchSilent()
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside
      className={`stage-panel${resizing ? ' is-resizing' : ''}`}
      style={{ width: Math.min(width, sideMax), flexShrink: 0 }}
    >
      <div className="resize-handle resize-handle-left" onMouseDown={startResize} />
      <div className="stage-panel-header">
        <div>
          <div className="stage-panel-ws">{workstream.name}</div>
          <h2 className="stage-panel-title">{stage.name}</h2>
        </div>
        <button className="icon-only" onClick={close} aria-label={t('common.close')}>
          <X size={16} />
        </button>
      </div>

      <div className="stage-panel-body">
        <div className="stage-panel-meta">
          {isCurrent && <span className="stage-badge">{t('stage.current')}</span>}
          {age && (
            <span>
              {isCurrent
                ? t('stage.ageHere', { age: t(AGE_UNIT_KEYS[age.unit], { count: age.value }) })
                : t(AGE_UNIT_KEYS[age.unit], { count: age.value })}
            </span>
          )}
          {visit && visit.visits > 1 && <span>{t('stage.visitsHint', { n: visit.visits })}</span>}
        </div>

        {/* The states this stage expects — the thing that decides which issues
            land here at all, and the first place to look when one does not. */}
        <p className="stage-panel-states">
          {stage.states.length > 0
            ? t('stage.expectsStates', { states: stage.states.join(', ') })
            : t('lifecycle.constrainsNothing')}
        </p>

        {!isCurrent && (
          <button disabled={busy} onClick={() => void run(() => api.setBatchStage(workstream.id, stage.key))}>
            {t('stage.moveHere')}
          </button>
        )}

        <h4>{t('stage.notesTitle')}</h4>
        <textarea
          className="stage-panel-note"
          rows={5}
          value={note}
          placeholder={t('stage.attachNotePlaceholder')}
          onChange={(e) => {
            const next = e.target.value
            setDraft({ key: target.stageKey, note: next })
            setNoteState('dirty')
            if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
            // Debounced rather than per-keystroke: a note is written in
            // sentences, and one request per character would be absurd.
            saveTimer.current = window.setTimeout(() => void saveNote(next), 700)
          }}
          onBlur={() => {
            if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
            void saveNote(note)
          }}
        />
        <div className="stage-panel-row">
          <span className="stage-panel-savestate">{t(`stage.note_${noteState}` as 'stage.note_clean')}</span>
          {noteFromServer.length > 0 && (
            <button
              disabled={busy}
              onClick={() => void run(() => api.clearStageNote(workstream.id, stage.key))}
            >
              {t('stage.attachClear')}
            </button>
          )}
        </div>

        <h4>{t('stage.attachedTitle')}</h4>
        {links.length === 0 ? (
          <p className="settings-hint">{t('stage.attachedEmpty')}</p>
        ) : (
          <ul className="stage-panel-links">
            {links.map((l) => (
              <li key={`${l.kind}:${l.value}`}>
                <span className="stage-panel-kind">
                  {/* A custom kind has no dict entry, and should not: it is a
                      name the workstream chose, so it shows verbatim. */}
                  {(RICH_LINK_KINDS as readonly string[]).includes(l.kind)
                    ? t(`stage.attachKind_${l.kind}` as 'stage.attachKind_pr')
                    : l.kind}
                </span>
                {l.value.startsWith('http') ? (
                  <a href={l.value} target="_blank" rel="noreferrer">
                    {l.label ?? l.value}
                  </a>
                ) : (
                  <span>{l.label ?? l.value}</span>
                )}
                <button
                  className="icon-only"
                  disabled={busy}
                  title={t('stage.detach')}
                  onClick={() => void run(() => api.detachFromStage(workstream.id, stage.key, l.value))}
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <h4>{t('stage.attachAddTitle')}</h4>
        <p className="settings-hint">{t('stage.manualHint')}</p>
        <div className="stage-panel-add">
          {/* Radio-style buttons, not a <select>: in the popover the picker
              read as a label and nobody found the other five kinds. */}
          {/* The stage's own declared fields come FIRST: this stage said it
              expects a runbook, so offering it here is the difference between
              one field and five spellings of it across five workstreams. The
              rich kinds follow, and Custom is always last. */}
          <div className="stage-panel-kinds">
            {stage.fields
              .filter((f) => !(RICH_LINK_KINDS as readonly string[]).includes(f))
              .map((f) => (
                <button
                  key={f}
                  className={!customKind && kind === f ? 'is-on' : ''}
                  onClick={() => {
                    setCustomKind(false)
                    setKind(f)
                  }}
                  title={t('stage.expectedField')}
                >
                  {f}
                </button>
              ))}
            {RICH_LINK_KINDS.map((k) => (
              <button
                key={k}
                className={!customKind && kind === k ? 'is-on' : ''}
                onClick={() => {
                  setCustomKind(false)
                  setKind(k)
                }}
              >
                {t(`stage.attachKind_${k}` as 'stage.attachKind_pr')}
              </button>
            ))}
            <button
              className={customKind ? 'is-on' : ''}
              onClick={() => {
                setCustomKind(true)
                setKind('')
              }}
              title={t('stage.attachKindCustomHint')}
            >
              {t('stage.attachKindCustom')}
            </button>
          </div>
          {customKind && (
            <input
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              placeholder={t('stage.attachKindPlaceholder')}
            />
          )}
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={
              customKind
                ? t('stage.attachValuePlaceholder')
                : t(`stage.attachPlaceholder_${kind}` as 'stage.attachPlaceholder_pr')
            }
          />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('stage.attachLabel')} />
          <button
            className="stage-panel-primary"
            disabled={busy || value.trim().length === 0 || kind.trim().length === 0}
            onClick={() =>
              void run(async () => {
                await api.attachToStage(workstream.id, stage.key, kind, value.trim(), label.trim() || undefined)
                setValue('')
                setLabel('')
              })
            }
          >
            {t('stage.attachSave')}
          </button>
        </div>
      </div>
    </aside>
  )
}
