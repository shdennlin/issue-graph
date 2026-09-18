import { X } from 'lucide-react'
import { useT } from '../i18n'
import { useViewStore } from '../store/viewStore'
import { LifecycleSettings } from './LifecycleSettings'

// The lifecycle editor, over the view it configures.
//
// It used to live in Settings. It moved because the pipeline is the subject of
// the Workstreams view, not a preference: you notice a stage is missing while
// looking at the board, and a round trip through a settings page to fix it is
// where "I'll do it later" comes from.
//
// There is exactly ONE editor. Leaving a copy behind in Settings would have
// been the kind thing to do for anyone used to finding it there, and it is also
// how two editors for one config drift apart — so Settings now has nothing, not
// a second copy.
export function LifecyclePanel() {
  const t = useT()
  const close = () => useViewStore.getState().setLifecycleEditorOpen(false)
  return (
    <div className="lifecycle-panel">
      <div className="lifecycle-panel-header">
        <h4>{t('lifecycle.title')}</h4>
        <button onClick={close} aria-label={t('common.close')}>
          <X size={16} />
        </button>
      </div>
      <div className="lifecycle-panel-body">
        <LifecycleSettings />
      </div>
    </div>
  )
}
