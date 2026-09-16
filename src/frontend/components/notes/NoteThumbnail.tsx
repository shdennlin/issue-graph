import { useEffect, useRef } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { highlightTextNodes } from '../../lib/highlightDom'

interface Props {
  body: string
  /** When non-empty, matches in the rendered text are wrapped in
   *  <mark class="note-highlight">. */
  highlight?: string
}

/**
 * A compact rendered-markdown preview for grid cards. Strips the first
 * non-empty line (it's already shown as the card title) and renders the
 * rest. All inner content is non-interactive so the card itself stays
 * the click target. Content is clipped by CSS overflow + a fade mask.
 */
export function NoteThumbnail({ body, highlight = '' }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    // Skip the first non-empty line (the source of the title). Everything
    // else feeds the renderer.
    const lines = body.split('\n')
    let idx = 0
    while (idx < lines.length && (lines[idx] ?? '').trim().length === 0) idx++
    if (idx < lines.length) idx++ // skip the title line itself
    const rest = lines.slice(idx).join('\n').trim()
    if (rest.length === 0) {
      el.replaceChildren()
      return
    }
    const html = marked.parse(rest, { async: false }) as string
    const safe = DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] })
    const parsed = new DOMParser().parseFromString(safe, 'text/html')
    el.replaceChildren(...Array.from(parsed.body.childNodes))
    if (highlight.trim().length > 0) {
      highlightTextNodes(el, highlight, { className: 'note-highlight' })
    }
  }, [body, highlight])

  return <div ref={containerRef} className="note-card-thumbnail markdown-body" aria-hidden="true" />
}
