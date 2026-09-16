import { describe, it, expect } from 'vitest'
import { computeHierarchyCounts, countVisibleChildren, resolveHierarchy } from './hierarchy'
import type { IssueStateType, NormalizedIssue } from '@shared/types.js'

function mk(
  id: string,
  opts: { parent?: string | null; children?: string[]; state?: IssueStateType } = {},
): NormalizedIssue {
  return {
    id,
    identifier: id,
    title: `title of ${id}`,
    url: '',
    priority: 0,
    state: { name: 'Backlog', type: opts.state ?? 'backlog' },
    assignee: null,
    labels: [],
    parent: opts.parent ?? null,
    children: opts.children ?? [],
    relations: [],
    createdAt: '',
    updatedAt: '',
    completedAt: null,
  }
}

function index(issues: NormalizedIssue[]): Map<string, NormalizedIssue> {
  return new Map(issues.map((i) => [i.identifier, i]))
}

describe('resolveHierarchy', () => {
  it('returns an empty result for an issue with no parent and no children', () => {
    const a = mk('A')
    const h = resolveHierarchy(a, index([a]))
    expect(h.parent).toBeNull()
    expect(h.children).toEqual([])
    expect(h).toMatchObject({ done: 0, total: 0, unresolved: 0, truncated: false })
  })

  it('resolves a cached parent to its issue so the title can be shown', () => {
    const parent = mk('P', { children: ['A'] })
    const a = mk('A', { parent: 'P' })
    const h = resolveHierarchy(a, index([parent, a]))
    expect(h.parent).toEqual({ identifier: 'P', issue: parent })
  })

  it('keeps an uncached parent as an identifier with a null issue', () => {
    const a = mk('A', { parent: 'GHOST' })
    const h = resolveHierarchy(a, index([a]))
    expect(h.parent).toEqual({ identifier: 'GHOST', issue: null })
  })

  it('resolves children in declaration order', () => {
    const c1 = mk('C1')
    const c2 = mk('C2')
    const p = mk('P', { children: ['C2', 'C1'] })
    const h = resolveHierarchy(p, index([p, c1, c2]))
    expect(h.children).toEqual([
      { identifier: 'C2', issue: c2 },
      { identifier: 'C1', issue: c1 },
    ])
  })

  it('counts completed children as done', () => {
    const p = mk('P', { children: ['C1', 'C2'] })
    const issues = [p, mk('C1', { state: 'completed' }), mk('C2', { state: 'started' })]
    const h = resolveHierarchy(p, index(issues))
    expect(h.done).toBe(1)
    expect(h.total).toBe(2)
  })

  it('counts canceled children as done — they are no longer outstanding work', () => {
    const p = mk('P', { children: ['C1', 'C2'] })
    const issues = [p, mk('C1', { state: 'canceled' }), mk('C2', { state: 'backlog' })]
    expect(resolveHierarchy(p, index(issues)).done).toBe(1)
  })

  it('counts uncached children in total but reports them as unresolved', () => {
    // A child pruned by the active+recent sync scope still represents work.
    // Dropping it from `total` would overstate progress.
    const p = mk('P', { children: ['C1', 'GHOST'] })
    const issues = [p, mk('C1', { state: 'completed' })]
    const h = resolveHierarchy(p, index(issues))
    expect(h.total).toBe(2)
    expect(h.done).toBe(1)
    expect(h.unresolved).toBe(1)
    expect(h.children[1]).toEqual({ identifier: 'GHOST', issue: null })
  })

  it('flags truncation when children hit the API first:20 cap', () => {
    const kids = Array.from({ length: 20 }, (_, n) => `C${n}`)
    const p = mk('P', { children: kids })
    expect(resolveHierarchy(p, index([p])).truncated).toBe(true)
  })

  it('does not flag truncation below the cap', () => {
    const kids = Array.from({ length: 19 }, (_, n) => `C${n}`)
    const p = mk('P', { children: kids })
    expect(resolveHierarchy(p, index([p])).truncated).toBe(false)
  })
})

describe('computeHierarchyCounts', () => {
  it('omits issues that have no children so the badge stays absent', () => {
    const counts = computeHierarchyCounts([mk('A'), mk('B', { parent: 'A' })])
    expect(counts.has('A')).toBe(false)
    expect(counts.has('B')).toBe(false)
  })

  it('reports done/total for a parent', () => {
    const issues = [
      mk('P', { children: ['C1', 'C2', 'C3'] }),
      mk('C1', { state: 'completed' }),
      mk('C2', { state: 'canceled' }),
      mk('C3', { state: 'started' }),
    ]
    expect(computeHierarchyCounts(issues).get('P')).toEqual({
      done: 2,
      total: 3,
      truncated: false,
    })
  })

  it('carries the truncation flag through', () => {
    const kids = Array.from({ length: 20 }, (_, n) => `C${n}`)
    const counts = computeHierarchyCounts([mk('P', { children: kids })])
    expect(counts.get('P')!.truncated).toBe(true)
  })
})

describe('countVisibleChildren', () => {
  it('counts only children present in the rendered view', () => {
    const p = mk('P', { children: ['C1', 'C2', 'C3'] })
    expect(countVisibleChildren(p, new Set(['P', 'C1', 'C3']))).toBe(2)
  })

  it('returns 0 when no children are rendered', () => {
    const p = mk('P', { children: ['C1'] })
    expect(countVisibleChildren(p, new Set(['P']))).toBe(0)
  })
})
