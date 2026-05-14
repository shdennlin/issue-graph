// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { renderMarkdownHtml } from './markdown'

describe('renderMarkdownHtml', () => {
  it('keeps the fenced code language and adds syntax spans', () => {
    const html = renderMarkdownHtml('```ts\nconst answer = 42\n```')
    const root = document.createElement('div')
    root.innerHTML = html

    const pre = root.querySelector('pre')!
    const code = root.querySelector('code')!

    expect(pre.getAttribute('data-language')).toBe('ts')
    expect(code.classList.contains('language-ts')).toBe(true)
    expect(code.querySelector('.syntax-keyword')?.textContent).toBe('const')
    expect(code.querySelector('.syntax-number')?.textContent).toBe('42')
  })

  it('sanitizes unsafe markdown html before returning rendered content', () => {
    const html = renderMarkdownHtml('<img src=x onerror=alert(1)>')
    const root = document.createElement('div')
    root.innerHTML = html

    expect(root.querySelector('script')).toBeNull()
    expect(root.querySelector('img')?.getAttribute('onerror')).toBeNull()
  })
})
