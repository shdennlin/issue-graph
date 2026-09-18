import { memo, useMemo } from 'react'
import type { MouseEvent, PointerEvent } from 'react'
import type { NodeProps } from 'reactflow'
import { Handle, Position } from 'reactflow'
import { MoveRight } from 'lucide-react'
import { useT, type DictKey } from '../../i18n'
import { useViewStore } from '../../store/viewStore'
import { renderStage, type StageContext, type StageItem } from '../../lib/stageRender'
import { api } from '../../lib/api'
import { useGraphStore } from '../../store/graphStore'

// One step of the pipeline, drawn as a wide numbered BAR.
//
// Deliberately a different shape from an issue card rather than a different
// colour: shape is the one difference that survives both themes, a
// colour-blind reader and a screenshot. The ordinal on the left is what makes
// a row of these read as "step 3 of 8" instead of as eight more cards — and it
// is why this must not end up looking like `mixedContainer`, which is a
// container of cards and means something else entirely.
//
// The component decides nothing. `renderStage` in lib/ decides what appears,
// because vitest's glob excludes `.tsx` and a decision made here could not be
// tested at all.

/** Shared with IssueNode's badge: translated rather than concatenated, because
 *  both of this repo's relative-time helpers hardcoded English and a zh-TW
 *  session read "3d ago". */
const AGE_UNIT_KEYS: Record<'m' | 'h' | 'd', DictKey> = {
  m: 'issueNode.ageMinutes',
  h: 'issueNode.ageHours',
  d: 'issueNode.ageDays',
}

const HANDLES = [
  ['l', Position.Left],
  ['r', Position.Right],
  ['t', Position.Top],
  ['b', Position.Bottom],
] as const

export interface StageNodeData {
  /** 1-based position in the pipeline. The glyph that carries the "step" idea. */
  ordinal: number
  name: string
  /** Set when there is no stage to name: either the pipeline is empty, or this
   *  is the slot before it holding workstreams nobody has staged yet. Two
   *  different absences, so they are told apart rather than sharing a blank. */
  placeholder: 'notStarted' | 'noStages' | null
  /** The stage this workstream is on now, or — in the overview — the stage at
   *  least one workstream is sitting on. */
  current: boolean
  /** Focused mode: what to render for the one expanded workstream. Null in the
   *  overview, where a stage shows who is standing on it instead. */
  render: StageContext | null
  /** How long on this stage — still running for the one it is on, settled for
   *  one it has left. Already reduced to a number and a unit, because the view
   *  is where the clock is read. Null when it has never been here.
   *
   *  Minutes and hours matter: a pipeline is walked several times in an
   *  afternoon while it is being set up, and every stage reading `0d` told you
   *  nothing about which of them just happened. */
  age: { value: number; unit: 'm' | 'h' | 'd' } | null
  /** Has this workstream ever arrived here? Distinguishes "arrived a moment
   *  ago" from "never been", which `age` alone cannot. */
  visited: boolean
  /** How many separate arrivals. Reported in the tooltip rather than as a
   *  chip — `\u00d74` beside a duration reads as arithmetic on the duration. */
  visits: number
  /** True once `daysHere` passes the stage's own threshold. */
  stale: boolean
}

function ItemRow({ item, onDetach }: { item: StageItem; onDetach?: (value: string) => void }) {
  const t = useT()
  const setFocusedId = useViewStore((s) => s.setFocusedId)
  const setDetailPanelOpen = useViewStore((s) => s.setDetailPanelOpen)

  const open = (e: MouseEvent) => {
    e.stopPropagation()
    if (item.issue) {
      // This view draws no issue cards, so focusing alone would put the
      // highlight on nothing. The detail panel reads the focused issue out of
      // graph data by identifier, which works whether or not a card exists.
      setFocusedId(item.issue)
      setDetailPanelOpen(true)
    }
  }
  // React Flow starts a drag on pointerdown; without this, clicking an item
  // also drags the stage. Same trick as MixedContainerNode.
  const stop = (e: PointerEvent) => e.stopPropagation()

  const body = (
    <>
      <span className="stage-item-text">{item.text}</span>
      {item.hints.map((h) => (
        <span key={h} className="stage-item-hint">
          {h}
        </span>
      ))}
      {item.manual && onDetach && (
        <button
          type="button"
          className="stage-item-detach"
          title={t('stage.detach')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onDetach(item.url ?? item.text)
          }}
        >
          {'\u00d7'}
        </button>
      )}
      {item.manual && (
        // The mark exists so a hand attachment never looks as good as a
        // projected one — if it did it would quietly become the default and
        // the upstream convention would stop being maintained.
        <span className="stage-item-manual" title={t('stage.manualHint')}>
          {t('stage.manual')}
        </span>
      )}
    </>
  )

  const cls = `stage-item stage-item-${item.tone}${item.rows > 1 ? ' stage-item-wrap' : ''}`
  if (item.url) {
    return (
      <a className={cls} href={item.url} target="_blank" rel="noreferrer" onPointerDown={stop} onClick={(e) => e.stopPropagation()}>
        {body}
      </a>
    )
  }
  if (item.issue) {
    return (
      <button type="button" className={cls} onClick={open} onPointerDown={stop}>
        {body}
      </button>
    )
  }
  return <span className={cls}>{body}</span>
}

function StageImpl({ data }: NodeProps<StageNodeData>) {
  const t = useT()
  const refetchSilent = useGraphStore((s) => s.refetchSilent)
  const openStagePanel = useViewStore((s) => s.openStagePanel)
  // Wording never changes how many items there are, so the view's height
  // estimate and this stay in step — which matters more here than elsewhere,
  // because GraphCanvas only measures `.react-flow__node-issue` and a stage
  // node never gets a corrected height.
  const items = useMemo(() => (data.render ? renderStage(data.render, t) : []), [data.render, t])

  // Only when this node belongs to a workstream and is not the one it is on.
  const moveTarget =
    data.render && !data.current ? { id: data.render.workstream.id, key: data.render.stage.key } : null
  const move = (e: MouseEvent) => {
    e.stopPropagation()
    if (!moveTarget) return
    // The server is authoritative and records the move; a refetch is cheaper
    // than reasoning about what an optimistic paint would owe the history.
    void api.setBatchStage(moveTarget.id, moveTarget.key).then(() => refetchSilent())
  }

  const detach = data.render
    ? (value: string) => {
        const ws = data.render!.workstream.id
        void api.detachFromStage(ws, data.render!.stage.key, value).then(() => refetchSilent())
      }
    : undefined

  return (
    <div className={`stage-node${data.current ? ' stage-current' : ''}${data.stale ? ' stage-stale' : ''}`}>
      {/* Four positions, each as both source and target, because the pipeline
          runs in boustrophedon: a row reads left-to-right, drops, and the next
          reads right-to-left, so an edge can leave any side. They are hidden in
          CSS — a visible dot on every side turned the flow into a row of
          disconnected boxes with beads between them. */}
      {HANDLES.map(([id, position]) => (
        <Handle key={`s-${id}`} id={`s-${id}`} type="source" position={position} isConnectable={false} />
      ))}
      {HANDLES.map(([id, position]) => (
        <Handle key={`t-${id}`} id={`t-${id}`} type="target" position={position} isConnectable={false} />
      ))}
      <div className="stage-head">
        <span className="stage-ordinal">{data.ordinal}</span>
        {/* The header is how you move a workstream. Clicking the stage you want
            is the shortest possible expression of "it is here now", and it was
            previously only reachable through the MCP or a hand-written PATCH.
            Only a stage it is NOT on is clickable — moving somewhere you
            already are should not restamp anything. */}
        <span className="stage-name">
          {data.placeholder ? t(`stage.${data.placeholder}`) : data.name}
        </span>
        {/* Moving is its OWN control, not the title. Making the title the
            button meant every stray click on a stage moved the workstream —
            the history filled with moves nobody meant, and `stage_entered_at`
            was restamped each time, so "how long has it been here" kept
            resetting to zero. */}
        {moveTarget !== null && (
          <button
            type="button"
            className="stage-move-btn"
            onClick={move}
            onPointerDown={(e) => e.stopPropagation()}
            title={t('stage.moveHere')}
            aria-label={t('stage.moveHere')}
          >
            <MoveRight size={13} />
          </button>
        )}
        {data.current && <span className="stage-badge">{t('stage.current')}</span>}
        {data.render && (
          <button
            type="button"
            className="stage-attach-btn"
            title={t('stage.attach')}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              if (data.render) openStagePanel(data.render.workstream.id, data.render.stage.key)
            }}
          >
            +
          </button>
        )}
        {data.visited && data.age !== null && (
          <span
            className={`stage-days${data.stale ? ' stage-days-stale' : ''}`}
            title={data.visits > 1 ? t('stage.visitsHint', { n: data.visits }) : undefined}
          >
            {/* "4d here" while it is still here, "4d" once it has moved on —
                the first is a duration still running, the second is settled. */}
            {data.current
              ? t('stage.ageHere', { age: t(AGE_UNIT_KEYS[data.age.unit], { count: data.age.value }) })
              : t(AGE_UNIT_KEYS[data.age.unit], { count: data.age.value })}
            {data.visits > 1 && <span className="stage-revisit" aria-hidden>{'\u21ba'}</span>}
          </span>
        )}
      </div>

      {data.render && (
        <div className="stage-body">
          {items.length === 0 ? (
            <span className="stage-empty">{t('stage.nothingHere')}</span>
          ) : (
            items.map((item, i) => (
              <ItemRow
                key={`${item.token}:${item.text}:${i}`}
                item={item}
                onDetach={detach}
              />
            ))
          )}
        </div>
      )}

    </div>
  )
}

export const StageNode = memo(StageImpl)
