import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { NormalizedIssue } from '@shared/types.js'
import { toggleChecklistAt } from '../../lib/checklist'
import { highlightTextNodes } from '../../lib/highlightDom'
import { decorateIssueLinksWithStatus, linkifyIssueIds } from '../../lib/issueLinks'
import { useGraphStore } from '../../store/graphStore'
import { useViewStore } from '../../store/viewStore'
import { getNoteScroll, setNoteScroll } from '../../lib/noteScrollMemory'
import { IssueHoverCard } from './IssueHoverCard'

interface Props {
  /** Identifier used to key per-note scroll restoration. */
  noteId: number
  body: string
  /** Called when the modal should close (after an issue link click). */
  onCloseModal: () => void
  /** Optional. When set, rendered task-list checkboxes become interactive
   *  and call this with the updated markdown body on each toggle. */
  onBodyChange?: (next: string) => void
  /** In-note find: text to highlight. Empty string disables highlighting. */
  highlightQuery?: string
  /** In-note find: the active match (0-based). Scrolled into view + given
   *  the `.note-find-match-active` class. */
  activeMatchIndex?: number
  /** Called whenever the highlight pipeline finishes with the new total match
   *  count. Useful for the find bar's `N / total` counter. */
  onMatchCountChange?: (count: number) => void
}

export function NotePreview({
  noteId,
  body,
  onCloseModal,
  onBodyChange,
  highlightQuery = '',
  activeMatchIndex = 0,
  onMatchCountChange,
}: Props) {
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

  // Content rendering runs as useLayoutEffect so the DOM is populated before
  // paint — required so the scroll restore at the end of this effect lands
  // on real content height instead of an empty container (which would reset
  // to 0 after the first post-paint repopulation).
  useLayoutEffect(() => {
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
    // In-note find highlighting runs AFTER linkify + decorate so it walks
    // the final text nodes. Skip the appended status badges so their state
    // labels aren't searchable.
    const count = highlightQuery.trim().length > 0
      ? highlightTextNodes(el, highlightQuery, {
          className: 'note-find-match',
          numbered: true,
          skipSelectors: ['.issue-status-badge'],
        })
      : 0
    if (count > 0) {
      const clamped = Math.max(0, Math.min(activeMatchIndex, count - 1))
      const active = el.querySelector<HTMLElement>(`mark[data-match-index="${clamped}"]`)
      if (active) {
        active.classList.add('note-find-match-active')
        active.scrollIntoView({ block: 'center', inline: 'nearest' })
      }
    }
    if (onMatchCountChange) onMatchCountChange(count)
    // Restore the user's last scroll position for this note when there's no
    // active find — otherwise scrollIntoView above is the authoritative
    // scroll. The onScroll handler keeps the stored value current, so
    // re-applying on body changes (e.g. checklist toggles) is a no-op rather
    // than a jump.
    if (count === 0) {
      el.scrollTop = getNoteScroll(noteId, 'preview')
    }
  }, [body, onBodyChange, noteId, highlightQuery, activeMatchIndex, onMatchCountChange])

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
        onScroll={(e) => setNoteScroll(noteId, 'preview', e.currentTarget.scrollTop)}
      />
      {hover && <IssueHoverCard issue={hover.issue} anchorRect={hover.rect} />}
    </>
  )
}
