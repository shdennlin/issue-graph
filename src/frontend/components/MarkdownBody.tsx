import { useEffect, useRef } from 'react'
import { renderMarkdownNodes, renderMermaidIn } from '../lib/markdown'

interface MarkdownBodyProps {
  body: string
  className?: string
}

export function MarkdownBody({ body, className }: MarkdownBodyProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const nodes = renderMarkdownNodes(body)
    if (nodes.length === 0 && body) {
      // Sanitizer stripped everything (e.g., Linear bot comment with raw HTML).
      // Fall back to plaintext so the card isn't blank.
      const pre = document.createElement('div')
      pre.style.whiteSpace = 'pre-wrap'
      pre.textContent = body
      el.replaceChildren(pre)
      return
    }
    el.replaceChildren(...nodes)
    // Nodes are now attached to `el`, which is in the live document — the
    // earliest point a ```mermaid block can actually be rendered (see
    // renderMermaidIn's own comment for why this can't happen earlier,
    // inside renderMarkdownNodes itself).
    void renderMermaidIn(el)
  }, [body])
  const cls = className ? `markdown-body ${className}` : 'markdown-body'
  return <div ref={ref} className={cls} />
}
