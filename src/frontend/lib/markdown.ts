import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { wireImagesIn, wireMermaidDiagram } from './mermaidPanZoom'

const KEYWORDS_BY_LANGUAGE: Record<string, Set<string>> = {
  js: new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'new', 'import', 'from', 'export', 'async', 'await', 'try', 'catch', 'throw']),
  jsx: new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'new', 'import', 'from', 'export', 'async', 'await', 'try', 'catch', 'throw']),
  ts: new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'new', 'import', 'from', 'export', 'async', 'await', 'try', 'catch', 'throw', 'type', 'interface', 'extends', 'implements']),
  tsx: new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'new', 'import', 'from', 'export', 'async', 'await', 'try', 'catch', 'throw', 'type', 'interface', 'extends', 'implements']),
  json: new Set(['true', 'false', 'null']),
  sh: new Set(['if', 'then', 'else', 'fi', 'for', 'do', 'done', 'case', 'esac', 'function', 'export']),
  bash: new Set(['if', 'then', 'else', 'fi', 'for', 'do', 'done', 'case', 'esac', 'function', 'export']),
  zsh: new Set(['if', 'then', 'else', 'fi', 'for', 'do', 'done', 'case', 'esac', 'function', 'export']),
  py: new Set(['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'class', 'import', 'from', 'as', 'try', 'except', 'raise', 'with', 'lambda', 'True', 'False', 'None']),
  python: new Set(['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'class', 'import', 'from', 'as', 'try', 'except', 'raise', 'with', 'lambda', 'True', 'False', 'None']),
}

function normalizeLanguage(raw: string | null): string {
  return (raw ?? '').trim().toLowerCase()
}

function languageFor(code: HTMLElement): string {
  for (const cls of Array.from(code.classList)) {
    if (cls.startsWith('language-')) return normalizeLanguage(cls.slice('language-'.length))
    if (cls.startsWith('lang-')) return normalizeLanguage(cls.slice('lang-'.length))
  }
  return ''
}

function tokenClass(token: string, language: string): string | null {
  if (/^\/\/|^#|^\/\*/.test(token)) return 'syntax-comment'
  if (/^['"`]/.test(token)) return 'syntax-string'
  if (/^\b\d+(?:\.\d+)?\b/.test(token)) return 'syntax-number'
  if (KEYWORDS_BY_LANGUAGE[language]?.has(token)) return 'syntax-keyword'
  return null
}

function appendHighlightedCode(code: HTMLElement, source: string, language: string) {
  const tokenPattern = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|`(?:\\[\s\S]|[^`\\])*`|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g
  let cursor = 0
  const nodes: Node[] = []

  for (const match of source.matchAll(tokenPattern)) {
    const token = match[0]
    const index = match.index ?? 0
    if (index > cursor) nodes.push(document.createTextNode(source.slice(cursor, index)))
    const cls = tokenClass(token, language)
    if (cls) {
      const span = document.createElement('span')
      span.className = cls
      span.textContent = token
      nodes.push(span)
    } else {
      nodes.push(document.createTextNode(token))
    }
    cursor = index + token.length
  }

  if (cursor < source.length) nodes.push(document.createTextNode(source.slice(cursor)))
  code.replaceChildren(...nodes)
}

function enhanceCodeBlocks(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('pre > code').forEach((code) => {
    const language = languageFor(code)
    if (!language) return

    const pre = code.parentElement
    if (!pre) return

    if (language === 'mermaid') {
      // Can't render the diagram here — mermaid.render() is async and this
      // function runs synchronously inside renderMarkdownHtml (which has to
      // stay a plain string-returning function; see its callers). Stash the
      // raw source as a data attribute and mark the block; renderMermaidIn
      // finds these once the HTML is actually in the live DOM and swaps
      // each one for its rendered SVG.
      pre.dataset.mermaidSource = code.textContent ?? ''
      pre.classList.add('mermaid-pending')
      return
    }

    pre.setAttribute('data-language', language)
    code.classList.add('syntax-highlighted', `language-${language}`)
    appendHighlightedCode(code, code.textContent ?? '', language)
  })
}

function isDarkTheme(): boolean {
  const explicit = document.documentElement.getAttribute('data-theme')
  if (explicit === 'dark') return true
  if (explicit === 'light') return false
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

let mermaidSeq = 0

/** Finishes what renderMarkdownHtml couldn't: renders any `.mermaid-pending`
 *  blocks into their diagrams, and wraps any large inline image, both with
 *  fit/pan/zoom/expand chrome (see mermaidPanZoom.ts). Call after the
 *  markdown HTML this produced is actually attached to the document —
 *  mermaid needs a live layout to measure text for sizing, and an <img>'s
 *  naturalWidth/Height needs it to have at least started loading. See
 *  MarkdownBody and DetailPanel's description/annotation effects for the
 *  call sites. Safe to call on a root with nothing to do (images are
 *  checked and resolved either way; the mermaid half short-circuits).
 *  Mermaid's theme is picked once per call from the current theme; doesn't
 *  re-render on a later theme flip, which would need every caller to track
 *  theme changes for a diagram that's usually read once and then scrolled
 *  past. */
export async function renderMermaidIn(root: ParentNode): Promise<void> {
  wireImagesIn(root)
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('pre.mermaid-pending'))
  if (blocks.length === 0) return
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: isDarkTheme() ? 'dark' : 'default',
    // Mermaid's default labels are <foreignObject><span>text</span></foreignObject>
    // — arbitrary embedded HTML, which DOMPurify's SVG profile (correctly)
    // strips as unsafe, leaving every node blank. The root-level htmlLabels
    // (the per-diagram flowchart.htmlLabels etc. are deprecated in favor of
    // this) forces native SVG <text> labels instead, which survive
    // sanitization without having to widen the allowlist to foreignObject.
    htmlLabels: false,
  })
  for (const pre of blocks) {
    const source = pre.dataset.mermaidSource ?? ''
    try {
      const { svg } = await mermaid.render(`mermaid-${++mermaidSeq}`, source)
      // The diagram SOURCE is issue/comment content (mermaid supports HTML
      // node labels and a themeCSS override), so the rendered SVG isn't any
      // more trustworthy than the markdown it came from — sanitize it the
      // same way, just with an SVG-aware profile instead of marked's
      // default HTML one.
      const sanitized = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })
      // Parsed into a <template>, not assigned as some light-DOM element's
      // innerHTML — a <template>'s content is an inert DocumentFragment, so
      // the <style> block mermaid embeds for theming never applies to the
      // real document even for an instant. wireMermaidDiagram mounts the
      // extracted <svg> (not this template) into a shadow root, where a
      // browser-enforced boundary keeps that CSS scoped to the diagram
      // regardless of what selectors are in it — DOMPurify sanitizes the
      // markup but can't know which selectors are "safe".
      const template = document.createElement('template')
      template.innerHTML = sanitized
      const svgEl = template.content.querySelector('svg')
      if (!svgEl) throw new Error('sanitized mermaid output had no <svg>')
      const wrapper = document.createElement('div')
      wrapper.className = 'mermaid-diagram'
      pre.replaceWith(wrapper)
      // Fit-to-viewport + drag/wheel pan-zoom + expand-to-overlay chrome —
      // a diagram this size is routinely bigger than the panel. See
      // mermaidPanZoom.ts.
      wireMermaidDiagram(wrapper, svgEl)
    } catch (err) {
      // Leave the source visible rather than an empty gap — a malformed
      // diagram is still useful as text, and the error names what broke.
      pre.classList.remove('mermaid-pending')
      pre.classList.add('mermaid-error')
      const notice = document.createElement('div')
      notice.className = 'mermaid-error-text'
      notice.textContent = `Mermaid: ${err instanceof Error ? err.message : 'failed to render'}`
      pre.before(notice)
    }
  }
}

export function renderMarkdownHtml(body: string, fallback = ''): string {
  const html = marked.parse(body || fallback, { async: false }) as string
  const safe = DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel', 'class', 'data-language'],
  })
  const template = document.createElement('template')
  template.innerHTML = safe
  enhanceCodeBlocks(template.content)

  const container = document.createElement('div')
  container.appendChild(template.content.cloneNode(true))
  return container.innerHTML
}

export function renderMarkdownNodes(body: string, fallback = ''): ChildNode[] {
  const template = document.createElement('template')
  template.innerHTML = renderMarkdownHtml(body, fallback)
  return Array.from(template.content.childNodes)
}
