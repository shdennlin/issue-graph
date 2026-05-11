// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { findIssueIds, isIssueId, linkifyIssueIds } from './issueLinks'

function mkDom(html: string): HTMLDivElement {
  const tpl = document.createElement('template')
  // Tests need to mount arbitrary fixture markup; using a <template> avoids
  // executing any inline scripts that would run with innerHTML on a live
  // element. Test-only helper.
  tpl.innerHTML = html
  const div = document.createElement('div')
  div.appendChild(tpl.content)
  return div
}

describe('isIssueId', () => {
  it('accepts valid linear ids', () => {
    expect(isIssueId('PROJ-1')).toBe(true)
    expect(isIssueId('ABC-12345')).toBe(true)
    expect(isIssueId('MOBILE-7')).toBe(true)
  })
  it('rejects malformed ids', () => {
    expect(isIssueId('A-1')).toBe(false)
    expect(isIssueId('proj-1')).toBe(false)
    expect(isIssueId('PROJ-')).toBe(false)
    expect(isIssueId('-1')).toBe(false)
    expect(isIssueId(' PROJ-1 ')).toBe(false)
  })
})

describe('findIssueIds', () => {
  it('finds ids embedded in prose', () => {
    expect(findIssueIds('See PROJ-123 and ABC-9 for details')).toEqual(['PROJ-123', 'ABC-9'])
  })
  it('ignores single-letter prefixes', () => {
    expect(findIssueIds('Skip A-1 but include AA-1')).toEqual(['AA-1'])
  })
  it('returns empty when no ids', () => {
    expect(findIssueIds('No ids here')).toEqual([])
  })
})

describe('linkifyIssueIds', () => {
  it('wraps issue ids in <a data-issue-id>', () => {
    const root = mkDom('<p>Look at PROJ-123 and MOBILE-7</p>')
    linkifyIssueIds(root)
    const anchors = root.querySelectorAll('a.issue-link')
    expect(anchors.length).toBe(2)
    expect(anchors[0]!.getAttribute('data-issue-id')).toBe('PROJ-123')
    expect(anchors[1]!.getAttribute('data-issue-id')).toBe('MOBILE-7')
    expect(anchors[0]!.textContent).toBe('PROJ-123')
  })

  it('does not double-wrap existing anchors', () => {
    const root = mkDom('<p><a href="x">PROJ-1</a></p>')
    linkifyIssueIds(root)
    expect(root.querySelectorAll('a.issue-link').length).toBe(0)
    expect(root.querySelectorAll('a').length).toBe(1)
  })

  it('skips code blocks', () => {
    const root = mkDom('<pre><code>PROJ-1</code></pre><p>And PROJ-2 in prose</p>')
    linkifyIssueIds(root)
    const anchors = root.querySelectorAll('a.issue-link')
    expect(anchors.length).toBe(1)
    expect(anchors[0]!.getAttribute('data-issue-id')).toBe('PROJ-2')
  })

  it('preserves surrounding text', () => {
    const root = document.createElement('div')
    root.textContent = 'see PROJ-1 then'
    linkifyIssueIds(root)
    expect(root.textContent).toBe('see PROJ-1 then')
  })

  it('handles multiple ids in one text node', () => {
    const root = document.createElement('div')
    root.textContent = 'PROJ-1 PROJ-2 PROJ-3'
    linkifyIssueIds(root)
    expect(root.querySelectorAll('a.issue-link').length).toBe(3)
  })
})
