import { useEffect, useState } from 'react'
import { useNotesStore } from '../../store/notesStore'

export function UndoToast() {
  const lastDeleted = useNotesStore((s) => s.lastDeleted)
  const undoDelete = useNotesStore((s) => s.undoDelete)
  // We track "now" via an interval rather than calling Date.now() during
  // render — react-hooks/purity (v7 plugin) rightly flags impure reads in
  // the render body, and this keeps the component deterministic.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!lastDeleted) return
    // The interval — and only the interval — advances `now`. We accept a
    // <500ms initial lag rather than calling setState() inside the effect
    // body (which trips react-hooks/set-state-in-effect).
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [lastDeleted])

  if (!lastDeleted) return null
  const remaining = Math.max(0, Math.ceil((lastDeleted.expiresAt - now) / 1000))
  if (remaining === 0) return null

  return (
    <div className="undo-toast" role="status">
      <span>Note deleted</span>
      <button type="button" className="undo-toast-action" onClick={() => undoDelete()}>
        Undo ({remaining}s)
      </button>
    </div>
  )
}
