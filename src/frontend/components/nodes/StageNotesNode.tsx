import { memo } from 'react'
import type { NodeProps } from 'reactflow'
import { Handle, Position } from 'reactflow'
import { useT } from '../../i18n'

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
  notes: { stageKey: string; stageName: string; body: string }[]
}

function StageNotesImpl({ data }: NodeProps<StageNotesData>) {
  const t = useT()
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
            <div key={n.stageKey} className="stage-note-entry">
              <div className="stage-note-stage">{n.stageName}</div>
              <div className="stage-note-body">{n.body}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export const StageNotesNode = memo(StageNotesImpl)
