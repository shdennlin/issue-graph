import { memo } from 'react'
import type { NodeProps } from 'reactflow'
import { Handle, Position } from 'reactflow'
import { useT } from '../../i18n'
import { useViewStore } from '../../store/viewStore'

// The workstream's own note: what this feature IS, and what somebody needs to
// know before reading the pipeline at all.
//
// It used to collect every stage's note instead, which was two mistakes in
// one. It showed each note a second time beside the stage that already showed
// it — one fact in two places, the same defect as an issue drawn on seven
// stages. And it conflated two different questions: a stage note says what a
// STEP is waiting on ("the manifest-hash review has not come back"), while
// this says what the WHOLE THING is ("the decision from the call on the 17th",
// "blocked on legal until the 30th"). Neither is a substitute for the other.
//
// First cell of the serpentine walk, before stage 1, because that is where
// context belongs relative to a pipeline.
export interface StageNotesData {
  workstreamId: number
  workstreamName: string
  note: string | null
}

function StageNotesImpl({ data }: NodeProps<StageNotesData>) {
  const t = useT()
  const open = useViewStore((s) => s.openWorkstreamPanel)
  const body = (data.note ?? '').trim()

  return (
    <div className="stage-notes">
      <Handle id="t-l" type="target" position={Position.Left} isConnectable={false} />
      <Handle id="t-t" type="target" position={Position.Top} isConnectable={false} />
      <Handle id="t-r" type="target" position={Position.Right} isConnectable={false} />
      <div className="stage-head">
        <span className="stage-name">{t('stage.notesTitle')}</span>
      </div>
      {/* Editing happens in the panel, never in place: React Flow's default
          `deleteKeyCode` is Backspace, so a textarea inside a node would delete
          the node the first time anyone corrected a typo. */}
      <button
        type="button"
        className="stage-notes-body"
        onClick={(e) => {
          e.stopPropagation()
          open(data.workstreamId)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title={t('workstreams.openPanel')}
      >
        {body.length === 0 ? (
          <span className="stage-empty">{t('stage.notesEmpty')}</span>
        ) : (
          <span className="stage-note-body">{body}</span>
        )}
      </button>
    </div>
  )
}

export const StageNotesNode = memo(StageNotesImpl)
