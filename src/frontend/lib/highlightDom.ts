import { findMatchRanges } from './notesMatch'

export interface HighlightOptions {
  /** Class applied to each `<mark>` element. */
  className: string
  /** When true, sets `data-match-index="N"` on each mark in document order
   *  so an external scroller can address them by index. */
  numbered?: boolean
  /** CSS selectors whose contents are skipped (e.g. status badges that get
   *  appended after issue-link decoration). */
  skipSelectors?: readonly string[]
}

/**
 * Walk all text nodes under `root` and wrap case-insensitive occurrences of
 * `query` in `<mark>`. Mutates the DOM in place. Returns the total number
 * of matches inserted.
 */
export function highlightTextNodes(
  root: HTMLElement,
  query: string,
  opts: HighlightOptions,
): number {
  const q = query.trim()
  if (q.length === 0) return 0
  const skip = opts.skipSelectors ?? []
  const skipNode = (node: Node): boolean => {
    let cur: Node | null = node.parentNode
    while (cur && cur !== root) {
      if (cur.nodeType === Node.ELEMENT_NODE) {
        const el = cur as HTMLElement
        // Never re-wrap inside an existing mark (idempotent re-runs).
        if (el.tagName === 'MARK') return true
        for (const sel of skip) {
          if (el.matches(sel)) return true
        }
      }
      cur = cur.parentNode
    }
    return false
  }

  // Collect text nodes first; mutating during traversal confuses TreeWalker.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const targets: Text[] = []
  let n: Node | null = walker.nextNode()
  while (n) {
    const t = n as Text
    if (t.nodeValue && t.nodeValue.length > 0 && !skipNode(t)) targets.push(t)
    n = walker.nextNode()
  }

  let count = 0
  for (const text of targets) {
    const value = text.nodeValue ?? ''
    const ranges = findMatchRanges(q, value)
    if (ranges.length === 0) continue
    const parent = text.parentNode
    if (!parent) continue
    const frag = document.createDocumentFragment()
    let cursor = 0
    for (const [start, end] of ranges) {
      if (start > cursor) frag.appendChild(document.createTextNode(value.slice(cursor, start)))
      const mark = document.createElement('mark')
      mark.className = opts.className
      if (opts.numbered) mark.setAttribute('data-match-index', String(count))
      mark.textContent = value.slice(start, end)
      frag.appendChild(mark)
      cursor = end
      count++
    }
    if (cursor < value.length) frag.appendChild(document.createTextNode(value.slice(cursor)))
    parent.replaceChild(frag, text)
  }
  return count
}
