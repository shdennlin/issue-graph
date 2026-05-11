/**
 * Linear issue identifier pattern, e.g. `ABC-123`, `PROJ-9`, `MOBILE-1234`.
 * Requires:
 *   - 2+ uppercase letters (team prefix)
 *   - hyphen
 *   - 1+ digits
 * Boundary-anchored so plain words like "ZZ-top-3" inside other text don't match.
 */
const ISSUE_ID_PATTERN = /\b([A-Z]{2,})-(\d+)\b/g

export function isIssueId(text: string): boolean {
  return /^[A-Z]{2,}-\d+$/.test(text)
}

export function findIssueIds(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(ISSUE_ID_PATTERN)) {
    out.push(`${m[1]}-${m[2]}`)
  }
  return out
}

/**
 * Walk `root`'s text nodes and wrap every Linear issue id in a clickable
 * anchor. Idempotent — anchors are skipped, so calling this twice is safe.
 *
 * The anchor carries `data-issue-id` so a single delegated click handler
 * on the container can navigate without per-anchor wiring.
 */
export function linkifyIssueIds(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let p: Node | null = node.parentNode
      while (p && p !== root) {
        if (p.nodeName === 'A') return NodeFilter.FILTER_REJECT
        if (p.nodeName === 'CODE' || p.nodeName === 'PRE') return NodeFilter.FILTER_REJECT
        p = p.parentNode
      }
      const text = node.nodeValue ?? ''
      return text.match(ISSUE_ID_PATTERN) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    },
  })
  const textNodes: Text[] = []
  let n = walker.nextNode()
  while (n) {
    textNodes.push(n as Text)
    n = walker.nextNode()
  }
  for (const node of textNodes) {
    const text = node.nodeValue ?? ''
    const matches = Array.from(text.matchAll(ISSUE_ID_PATTERN))
    if (matches.length === 0) continue
    const frag = document.createDocumentFragment()
    let lastIdx = 0
    for (const m of matches) {
      const start = m.index ?? 0
      const end = start + m[0].length
      if (start > lastIdx) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx, start)))
      }
      const a = document.createElement('a')
      a.href = '#' + m[0]
      a.className = 'issue-link'
      a.setAttribute('data-issue-id', m[0])
      a.textContent = m[0]
      frag.appendChild(a)
      lastIdx = end
    }
    if (lastIdx < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIdx)))
    }
    node.parentNode?.replaceChild(frag, node)
  }
}
