import { useEffect, useRef } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { toggleChecklistAt } from '../../lib/checklist'
import { linkifyIssueIds } from '../../lib/issueLinks'
import { useViewStore } from '../../store/viewStore'

interface Props {
  body: string
  /** Called when the modal should close (after an issue link click). */
  onCloseModal: () => void
  /** Optional. When set, rendered task-list checkboxes become interactive
   *  and call this with the updated markdown body on each toggle. */
  onBodyChange?: (next: string) => void
}

export function NotePreview({ body, onCloseModal, onBodyChange }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const html = marked.parse(body || '*Empty note*', { async: false }) as string
    const safe = DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] })
    const parsed = new DOMParser().parseFromString(safe, 'text/html')
    el.replaceChildren(...Array.from(parsed.body.childNodes))
    // GFM checkboxes emitted by marked are `disabled` by default. When the
    // host provides an updater, re-enable them and tag with their index so
    // the click handler below knows which `[ ]` in source to flip.
    if (onBodyChange) {
      const boxes = el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      boxes.forEach((box, idx) => {
        box.disabled = false
        box.setAttribute('data-checkbox-index', String(idx))
        box.style.cursor = 'pointer'
      })
    }
    linkifyIssueIds(el)
  }, [body, onBodyChange])

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    // Checklist toggle: synthesize the new body and bubble it up.
    if (
      onBodyChange &&
      target.tagName === 'INPUT' &&
      (target as HTMLInputElement).type === 'checkbox'
    ) {
      const idxAttr = target.getAttribute('data-checkbox-index')
      if (idxAttr !== null) {
        const idx = Number(idxAttr)
        // Native checkbox click also flips `checked` state — we re-render
        // from source anyway, so don't fight the browser. preventDefault is
        // unnecessary; the body update will re-render to the new state.
        onBodyChange(toggleChecklistAt(body, idx))
        return
      }
    }
    const anchor = target.closest('a') as HTMLAnchorElement | null
    if (!anchor) return
    const issueId = anchor.getAttribute('data-issue-id')
    if (issueId) {
      e.preventDefault()
      const view = useViewStore.getState()
      view.setFocusedId(issueId)
      // Ask the canvas to pan onto the focused node. Bumped seq → GraphCanvas
      // Producer 4 → rf.setCenter. Safe if the issue isn't currently rendered
      // (the canvas no-ops on missing nodes).
      view.requestPanToFocused()
      onCloseModal()
      return
    }
    if (anchor.href && !anchor.href.startsWith(window.location.origin + '/#')) {
      anchor.target = '_blank'
      anchor.rel = 'noopener noreferrer'
    }
  }

  return (
    <div
      ref={containerRef}
      className="note-preview markdown-body"
      onClick={onClick}
    />
  )
}
