import { memo, useMemo } from 'react'
import type { MouseEvent, PointerEvent } from 'react'
import type { NodeProps } from 'reactflow'
import { Handle, Position } from 'reactflow'
import { useT } from '../../i18n'
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
  /** Overview mode: the workstreams currently on this stage. */
  streams: { id: number; name: string; days: number | null; stale: boolean }[]
  /** Days on this stage — for the stage it is on now that is "still running",
   *  and for a stage it has left, how long it took. Null only when it has
   *  never been here. */
  daysHere: number | null
  /** Has this workstream ever arrived here? Distinguishes "0 days, arrived
   *  today" from "never been", which `daysHere` alone cannot. */
  visited: boolean
  /** How many separate arrivals. Shown above 1, because going round twice is
   *  the shape of a review that failed and is worth seeing. */
  visits: number
  /** True once `daysHere` passes the stage's own threshold. */
  stale: boolean
}

function ItemRow({ item }: { item: StageItem }) {
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

  const cls = `stage-item stage-item-${item.tone}`
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
  const setFocusedWorkstreamId = useViewStore((s) => s.setFocusedWorkstreamId)
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
        {moveTarget !== null ? (
          <button
            type="button"
            className="stage-name stage-name-btn"
            onClick={move}
            onPointerDown={(e) => e.stopPropagation()}
            title={t('stage.moveHere')}
          >
            {data.name}
          </button>
        ) : (
          <span className="stage-name">
            {data.placeholder ? t(`stage.${data.placeholder}`) : data.name}
          </span>
        )}
        {data.current && <span className="stage-badge">{t('stage.current')}</span>}
        {data.visits > 1 && (
          <span className="stage-visits" title={t('stage.visitsHint')}>
            {t('stage.visits', { n: data.visits })}
          </span>
        )}
        {data.visited && data.daysHere !== null && (
          <span className={`stage-days${data.stale ? ' stage-days-stale' : ''}`}>
            {/* "4d here" while it is still here, "4d" once it has moved on —
                the first is a duration still running, the second is settled. */}
            {data.current ? t('stage.daysHere', { n: data.daysHere }) : t('stage.daysTook', { n: data.daysHere })}
          </span>
        )}
      </div>

      {data.render && (
        <div className="stage-body">
          {items.length === 0 ? (
            <span className="stage-empty">{t('stage.nothingHere')}</span>
          ) : (
            items.map((item, i) => <ItemRow key={`${item.token}:${item.text}:${i}`} item={item} />)
          )}
        </div>
      )}

      {!data.render && (
        <div className="stage-body">
          {data.streams.length === 0 ? (
            <span className="stage-empty">{t('stage.noStreams')}</span>
          ) : (
            data.streams.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`stage-stream${s.stale ? ' stage-stream-stale' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setFocusedWorkstreamId(s.id)
                }}
                onPointerDown={(e) => e.stopPropagation()}
                title={t('stage.expandStream')}
              >
                <span className="stage-item-text">{s.name}</span>
                {s.days !== null && (
                  <span className="stage-item-hint">{t('stage.daysHere', { n: s.days })}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export const StageNode = memo(StageImpl)
