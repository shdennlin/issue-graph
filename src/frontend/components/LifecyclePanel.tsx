import { X } from 'lucide-react'
import { useT } from '../i18n'
import { useViewStore } from '../store/viewStore'
import { LifecycleSettings } from './LifecycleSettings'

// The lifecycle editor, as a centred modal.
//
// It used to float over the top-right of the canvas, which put it in the same
// corner as the stage and workstream panels and had it landing on top of them.
// A dock was the wrong shape anyway: those panels INSPECT one thing while the
// board stays readable beside them, and this CONFIGURES the workspace's
// pipeline — you are not reading the board while rewriting the stages it is
// drawn from. A modal says that, and it has room for the stage list besides.
//
// There is exactly ONE editor. Leaving a copy in Settings would have been kind
// to anyone used to finding it there, and it is also how two editors for one
// config drift apart — so Settings has nothing, not a second copy.
export function LifecyclePanel() {
  const t = useT()
  const close = () => useViewStore.getState().setLifecycleEditorOpen(false)
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal lifecycle-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{t('lifecycle.title')}</h3>
          <button onClick={close} aria-label={t('common.close')}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <LifecycleSettings />
        </div>
      </div>
    </div>
  )
}
