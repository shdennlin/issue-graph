import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { NormalizedIssue } from '@shared/types.js'
import { toggleChecklistAt } from '../../lib/checklist'
import { decorateIssueLinksWithStatus, linkifyIssueIds } from '../../lib/issueLinks'
import { useGraphStore } from '../../store/graphStore'
import { useViewStore } from '../../store/viewStore'
import { IssueHoverCard } from './IssueHoverCard'

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
  const [hover, setHover] = useState<{ issue: NormalizedIssue; rect: DOMRect } | null>(null)

  // Delegated hover on issue anchors. The badge that `decorateIssueLinksWithStatus`
  // appends sits adjacent to the anchor; we treat moving between them as the
  // same hover so the card doesn't flicker when the mouse crosses the seam.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const anchor =
        (target.closest('a[data-issue-id]') as HTMLAnchorElement | null) ??
        (target.closest('.issue-status-badge')?.previousElementSibling as HTMLAnchorElement | null)
      if (!anchor) return
      const id = anchor.getAttribute('data-issue-id')
      if (!id) return
      const issues = useGraphStore.getState().graph?.data.issues ?? []
      const iss = issues.find((i) => i.identifier === id)
      if (!iss) return
      setHover({ issue: iss, rect: anchor.getBoundingClientRect() })
    }
    const onOut = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const left = target.closest('a[data-issue-id], .issue-status-badge')
      if (!left) return
      const rt = e.relatedTarget as HTMLElement | null
      if (rt?.closest('a[data-issue-id], .issue-status-badge')) return
      setHover(null)
    }
    el.addEventListener('mouseover', onOver)
    el.addEventListener('mouseout', onOut)
    return () => {
      el.removeEventListener('mouseover', onOver)
      el.removeEventListener('mouseout', onOut)
      setHover(null)
    }
  }, [body])

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
    // O(1) lookup map built once per render — cheaper than `find` per anchor
    // when a note mentions many IDs in a large workspace.
    const issues = useGraphStore.getState().graph?.data.issues ?? []
    // Show Linear's actual state name (e.g. "Review") rather than the canonical
    // type label ("In Progress"). Linear users name custom states per their
    // workflow; collapsing to the type label is misleading when the workflow
    // distinguishes states the canonical labels don't (Review vs Code Review,
    // QA vs Live Verification, etc.). The hover-card already uses .state.name.
    const stateByIdentifier = new Map(
      issues.map((i) => [i.identifier, { type: i.state.type, name: i.state.name }] as const),
    )
    decorateIssueLinksWithStatus(el, (id) => {
      const s = stateByIdentifier.get(id)
      if (!s) return null
      return { type: s.type, label: s.name }
    })
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
    <>
      <div
        ref={containerRef}
        className="note-preview markdown-body"
        onClick={onClick}
      />
      {hover && <IssueHoverCard issue={hover.issue} anchorRect={hover.rect} />}
    </>
  )
}
