// Shared header for the app's modal dialogs. Centralizes title + close
// button layout so every modal has the same hit area and visual rhythm.
// Drop into a `.modal` body as the first child; Esc-to-close stays the
// responsibility of each modal (most already wire that up).

import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useT } from '../i18n'

interface Props {
  title: ReactNode
  onClose: () => void
}

export function ModalHeader({ title, onClose }: Props) {
  const t = useT()
  return (
    <div className="modal-header">
      <h3 className="modal-title">{title}</h3>
      <button
        type="button"
        className="icon-only"
        onClick={onClose}
        title={t('common.closeEsc')}
        aria-label={t('common.close')}
      >
        <X size={16} />
      </button>
    </div>
  )
}
