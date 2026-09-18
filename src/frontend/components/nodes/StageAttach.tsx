import { useState } from 'react'
import { api } from '../../lib/api'
import { useGraphStore } from '../../store/graphStore'
import { useT } from '../../i18n'
import { STAGE_LINK_KINDS } from '@shared/showTokens.js'

// Adding a note, or attaching something the automatic link missed.
//
// ABSOLUTELY POSITIONED, and that is load-bearing rather than cosmetic:
// views/workstream.ts computes each stage's height from its item count, and
// GraphCanvas only ever measures `.react-flow__node-issue` — a stage node
// never gets a corrected height. A form that grew the box in flow would
// silently overlap the row below with nothing to heal it.
//
// The note and the link kinds share one form because they are the same act
// from the user's side: "this stage needs something the projection cannot give
// it". Which kind decides only where it renders.
export function StageAttach({
  batchId,
  stageKey,
  existingNote,
  onClose,
}: {
  batchId: number
  stageKey: string
  existingNote: string
  onClose: () => void
}) {
  const t = useT()
  const refetchSilent = useGraphStore((s) => s.refetchSilent)
  const [kind, setKind] = useState<'note' | (typeof STAGE_LINK_KINDS)[number]>('note')
  const [value, setValue] = useState(existingNote)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const v = value.trim()
    if (v.length === 0) return
    setBusy(true)
    try {
      if (kind === 'note') await api.setStageNote(batchId, stageKey, v)
      else await api.attachToStage(batchId, stageKey, kind, v, label.trim() || undefined)
      await refetchSilent()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stage-attach" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="stage-attach-row">
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="note">{t('stage.attachNote')}</option>
          {STAGE_LINK_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`stage.attachKind_${k}` as 'stage.attachKind_pr')}
            </option>
          ))}
        </select>
        <button onClick={onClose} aria-label={t('common.close')}>
          {'×'}
        </button>
      </div>

      {kind === 'note' ? (
        <textarea
          className="stage-attach-note"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('stage.attachNotePlaceholder')}
          rows={3}
        />
      ) : (
        <>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t(`stage.attachPlaceholder_${kind}` as 'stage.attachPlaceholder_pr')}
          />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('stage.attachLabel')} />
        </>
      )}

      <div className="stage-attach-row">
        {/* Clearing is only offered for the note: a link is removed from its own
            row, where you can see which one you are removing. */}
        {kind === 'note' && existingNote.length > 0 && (
          <button
            className="stage-attach-clear"
            disabled={busy}
            onClick={() =>
              void api.clearStageNote(batchId, stageKey).then(async () => {
                await refetchSilent()
                onClose()
              })
            }
          >
            {t('stage.attachClear')}
          </button>
        )}
        <button className="stage-attach-save" disabled={busy || value.trim().length === 0} onClick={() => void save()}>
          {t('stage.attachSave')}
        </button>
      </div>
      <p className="stage-attach-hint">{t('stage.manualHint')}</p>
    </div>
  )
}
