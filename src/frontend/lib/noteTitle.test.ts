import { describe, it, expect } from 'vitest'
import { deriveSnippet, deriveTitle } from './noteTitle'

describe('deriveTitle', () => {
  it('returns Untitled note for empty body', () => {
    expect(deriveTitle('')).toBe('Untitled note')
    expect(deriveTitle('   \n\n  \n')).toBe('Untitled note')
  })

  it('uses H1 heading text when present on first non-empty line', () => {
    expect(deriveTitle('# My note\n\nbody')).toBe('My note')
  })

  it('strips deeper heading markers', () => {
    expect(deriveTitle('### A subsection')).toBe('A subsection')
  })

  it('handles trailing # in ATX-style headings', () => {
    expect(deriveTitle('# Title ###')).toBe('Title')
  })

  it('falls back to first non-empty line truncated to 60 chars', () => {
    const long = 'a'.repeat(80)
    const out = deriveTitle(long)
    expect(out.length).toBe(60)
    expect(out.endsWith('…')).toBe(true)
  })

  it('does not truncate short lines', () => {
    expect(deriveTitle('short body line\nmore')).toBe('short body line')
  })

  it('skips blank lines before finding content', () => {
    expect(deriveTitle('\n\n\n# Hello')).toBe('Hello')
  })
})

describe('deriveSnippet', () => {
  it('returns empty string for empty body', () => {
    expect(deriveSnippet('')).toBe('')
  })

  it('skips the first non-empty line (title) and returns subsequent content', () => {
    expect(deriveSnippet('# Title\n\nThis is the body')).toBe('This is the body')
  })

  it('strips bullet markers in preview', () => {
    expect(deriveSnippet('title\n- one\n- two')).toContain('• one')
  })

  it('truncates very long snippets', () => {
    const body = 'title\n' + 'x'.repeat(300)
    const snippet = deriveSnippet(body)
    expect(snippet.length).toBeLessThanOrEqual(180)
    expect(snippet.endsWith('…')).toBe(true)
  })

  it('returns empty when there is only a title', () => {
    expect(deriveSnippet('# Just a title')).toBe('')
  })
})
