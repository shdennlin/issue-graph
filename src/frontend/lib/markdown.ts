import DOMPurify from 'dompurify'
import { marked } from 'marked'

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
    pre?.setAttribute('data-language', language)
    code.classList.add('syntax-highlighted', `language-${language}`)
    appendHighlightedCode(code, code.textContent ?? '', language)
  })
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
