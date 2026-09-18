import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useGraphStore } from '../store/graphStore'
import { useViewStore } from '../store/viewStore'
import { useT } from '../i18n'
import { stageVisits } from '@shared/stageHistory.js'
import { compactAge } from '../lib/relativeTime'
import type { DictKey } from '../i18n'
import { isStale } from '@shared/staleness.js'

// A standing index of what is in flight, over the top-right of the canvas.
//
// Every workstream is drawn on this canvas now, stacked, so the board can run
// several screens tall — and the thing you want is usually not the one on
// screen. Clicking a row pans to that block rather than isolating it: you
// nearly always want to see the one you picked NEXT TO the others, and an
// isolation that has to be undone to regain context is a worse default.
//
// Isolation is still there, on the second control, because sometimes one
// workstream really is the whole job.
const AGE_UNIT_KEYS: Record<'m' | 'h' | 'd', DictKey> = {
  m: 'issueNode.ageMinutes',
  h: 'issueNode.ageHours',
  d: 'issueNode.ageDays',
}

export function WorkstreamJumpList() {
  const t = useT()
  const graph = useGraphStore((s) => s.graph)
  const setJump = useViewStore((s) => s.setWorkstreamJumpId)
  const focused = useViewStore((s) => s.focusedWorkstreamId)
  const setFocused = useViewStore((s) => s.setFocusedWorkstreamId)
  const refetchSilent = useGraphStore((s) => s.refetchSilent)

  // Read once and refreshed on a timer, never in the render body: reading the
  // clock during render is the impurity `react-hooks` flags, and it is right to
  // — the same render could produce a different number each time.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const stages = graph?.data.lifecycle ?? []
  const streams = (graph?.data.workstreams ?? []).filter((w) => w.status !== 'archived')

  // Creating one was only possible by selecting issues on the graph and using
  // the context menu, which is the wrong way round when the workstream is the
  // thing you are thinking about — you often name the feature before you know
  // which issues belong to it. Members are added afterwards, from the panel or
  // that same context menu.
  const create = () => {
    const name = window.prompt(t('workstreams.namePrompt'))
    if (!name?.trim()) return
    void api.createBatch(name.trim(), []).then(() => refetchSilent())
  }

  return (
    <div className="ws-jump">
      <div className="ws-jump-head">
        <span>{t('workstreams.title')}</span>
        <button type="button" className="ws-jump-new" onClick={create} title={t('workstreams.create')}>
          +
        </button>
      </div>
      {streams.length === 0 && <div className="ws-jump-empty">{t('workstreams.empty')}</div>}
      {streams.map((w) => {
        const stage = stages.find((s) => s.key === w.stage) ?? null
        const visit = w.stage ? stageVisits(w.stageEvents, now).get(w.stage) : undefined
        const age = visit ? compactAge(visit.enteredAt, visit.leftAt ?? now) : null
        const stale = isStale(w.stageEnteredAt, stage?.staleAfterDays ?? null, now)
        return (
          <div key={w.id} className={`ws-jump-row${focused === w.id ? ' ws-jump-on' : ''}`}>
            <button type="button" className="ws-jump-main" onClick={() => setJump(w.id)} title={t('workstreams.jumpHint')}>
              <span className="ws-jump-name">{w.name}</span>
              <span className={`ws-jump-where${stale ? ' ws-jump-stale' : ''}`}>
                {stage
                  ? `${stage.name}${
                      age
                        ? ` · ${t('stage.ageHere', { age: t(AGE_UNIT_KEYS[age.unit], { count: age.value }) })}`
                        : ''
                    }`
                  : t('stage.notStarted')}
              </span>
            </button>
            <button
              type="button"
              className="ws-jump-iso"
              onClick={() => setFocused(focused === w.id ? null : w.id)}
              title={t('workstreams.isolate')}
            >
              {focused === w.id ? '×' : '⊕'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
