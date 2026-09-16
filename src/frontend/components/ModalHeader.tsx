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
  /** When true, the close button is omitted so the parent layout can render
   *  it elsewhere (e.g. flush-right on a multi-element header row). */
  hideClose?: boolean
}

export function ModalHeader({ title, onClose, hideClose = false }: Props) {
  const t = useT()
  return (
    <div className="modal-header">
      <h3 className="modal-title">{title}</h3>
      {!hideClose && (
        <button
          type="button"
          className="icon-only"
          onClick={onClose}
          title={t('common.closeEsc')}
          aria-label={t('common.close')}
        >
          <X size={16} />
        </button>
      )}
    </div>
  )
}
