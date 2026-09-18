import { memo, useMemo } from 'react'
import type { MouseEvent, PointerEvent } from 'react'
import type { NodeProps } from 'reactflow'
import { Handle, Position } from 'reactflow'
import { useT } from '../../i18n'
import { useViewStore } from '../../store/viewStore'
import { renderStage, type StageContext, type StageItem } from '../../lib/stageRender'

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
  /** Days the expanded workstream has been on this stage — only ever set on
   *  the stage it is actually on, because it times the CURRENT occupancy. */
  daysHere: number | null
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
  const setFocusedWorkstreamId = useViewStore((s) => s.setFocusedWorkstreamId)
  // Wording never changes how many items there are, so the view's height
  // estimate and this stay in step — which matters more here than elsewhere,
  // because GraphCanvas only measures `.react-flow__node-issue` and a stage
  // node never gets a corrected height.
  const items = useMemo(() => (data.render ? renderStage(data.render, t) : []), [data.render, t])

  return (
    <div className={`stage-node${data.current ? ' stage-current' : ''}${data.stale ? ' stage-stale' : ''}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="stage-head">
        <span className="stage-ordinal">{data.ordinal}</span>
        <span className="stage-name">
          {data.placeholder ? t(`stage.${data.placeholder}`) : data.name}
        </span>
        {data.current && <span className="stage-badge">{t('stage.current')}</span>}
        {data.daysHere !== null && (
          <span className={`stage-days${data.stale ? ' stage-days-stale' : ''}`}>
            {t('stage.daysHere', { n: data.daysHere })}
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
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}

export const StageNode = memo(StageImpl)
