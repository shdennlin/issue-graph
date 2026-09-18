import { memo } from 'react'
import type { NodeProps } from 'reactflow'
import { Handle, Position } from 'reactflow'
import { useT } from '../../i18n'
import { useViewStore } from '../../store/viewStore'

// Every note this workstream has written, in pipeline order.
//
// A note used to render as its FIRST LINE inside its stage, truncated with an
// ellipsis. That was almost useless: a note is prose — "waiting on review of
// the manifest-hash approach before ONE-380 can start" — and the one line you
// could see never carried the reason, which is the whole point of writing one.
//
// Collected into one card rather than one card per stage, because a stage that
// grew to fit its note would push the serpentine row below it out of
// alignment, and because reading the context of a workstream is one act, not
// seven. It sits in the cell after the last stage, so it costs no layout
// arithmetic at all — it is simply the next step in the walk.
export interface StageNotesData {
  /** The workstream these belong to — a note is edited as that workstream's
   *  occupancy of a stage, so the card cannot open an editor without it. */
  workstreamId: number
  notes: { stageKey: string; stageName: string; body: string }[]
}

function StageNotesImpl({ data }: NodeProps<StageNotesData>) {
  const t = useT()
  const openStagePanel = useViewStore((s) => s.openStagePanel)
  return (
    <div className="stage-notes">
      <Handle id="t-l" type="target" position={Position.Left} isConnectable={false} />
      <Handle id="t-t" type="target" position={Position.Top} isConnectable={false} />
      <Handle id="t-r" type="target" position={Position.Right} isConnectable={false} />
      <div className="stage-head">
        <span className="stage-name">{t('stage.notesTitle')}</span>
      </div>
      <div className="stage-notes-body">
        {data.notes.length === 0 ? (
          <span className="stage-empty">{t('stage.notesEmpty')}</span>
        ) : (
          data.notes.map((n) => (
            // Clicking an entry opens the stage that owns it. The card is
            // where you READ the notes together; the panel is where each one is
            // written, and having to find its stage on the board first was a
            // step with no purpose.
            <button
              key={n.stageKey}
              type="button"
              className="stage-note-entry"
              onClick={(e) => {
                e.stopPropagation()
                openStagePanel(data.workstreamId, n.stageKey)
              }}
              onPointerDown={(e) => e.stopPropagation()}
              title={t('stage.editNote')}
            >
              <div className="stage-note-stage">{n.stageName}</div>
              <div className="stage-note-body">{n.body}</div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

export const StageNotesNode = memo(StageNotesImpl)
