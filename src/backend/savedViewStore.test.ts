import { describe, expect, it } from 'vitest'
import {
  NAME_MAX,
  QUERY_MAX,
  nextSortOrder,
  normalizeSavedViewName,
  normalizeSavedViewQuery,
  savedViewRowToDTO,
} from './savedViewStore.js'

describe('normalizeSavedViewName', () => {
  it('trims and accepts a normal name', () => {
    expect(normalizeSavedViewName('  This week  ')).toBe('This week')
  })

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['a non-string', 42],
    ['over the length cap', 'x'.repeat(NAME_MAX + 1)],
  ])('rejects %s', (_name, raw) => {
    expect(normalizeSavedViewName(raw)).toBeNull()
  })

  it('accepts exactly the cap', () => {
    expect(normalizeSavedViewName('x'.repeat(NAME_MAX))).toHaveLength(NAME_MAX)
  })
})

describe('normalizeSavedViewQuery — security boundary', () => {
  // Recall feeds this to history.pushState, so anything that could read as a
  // URL rather than a query string is an open-redirect primitive.
  it.each([
    ['an absolute URL', 'http://evil.com/x'],
    ['a protocol-relative URL', '//evil.com'],
    ['an absolute path', '/admin'],
    ['a backslash variant', '\\\\evil.com'],
    ['a scheme buried mid-string', 'view=mix&x=javascript://evil'],
    ['a non-string', 123],
    ['an over-length query', `a=${'x'.repeat(QUERY_MAX)}`],
  ])('rejects %s', (_name, raw) => {
    expect(normalizeSavedViewQuery(raw)).toBeNull()
  })

  it('accepts a plain query and tolerates a leading ?', () => {
    expect(normalizeSavedViewQuery('view=mix&state=started')).toBe('view=mix&state=started')
    expect(normalizeSavedViewQuery('?view=mix')).toBe('view=mix')
  })
})

describe('normalizeSavedViewQuery — stripped params', () => {
  // A view lives in its workspace's own graph.db, so `w` is implied. Carrying
  // it would teleport someone opening the view from another workspace.
  it('strips the workspace param', () => {
    expect(normalizeSavedViewQuery('w=alpha&view=mix')).toBe('view=mix')
  })

  // A saved *view* is a filter/layout snapshot, not a bookmark to one record —
  // and those ids may have aged out of the cache window.
  it.each(['focus=ONE-1', 'detail=1', 'chain=ONE-1', 'note=3', 'notes=1'])('strips %s', (pair) => {
    expect(normalizeSavedViewQuery(`${pair}&view=mix`)).toBe('view=mix')
  })

  it('keeps every filter dimension untouched', () => {
    const q = 'view=mix&state=started&sname=Review+Spec&proj=p1&ms=p1%3A%3Am1&recent=7d&q=auth'
    const params = new URLSearchParams(normalizeSavedViewQuery(q) ?? '')
    expect(params.get('sname')).toBe('Review Spec')
    expect(params.get('ms')).toBe('p1::m1')
    expect(params.get('recent')).toBe('7d')
    expect(params.get('q')).toBe('auth')
  })

  it('can normalize down to an empty query', () => {
    expect(normalizeSavedViewQuery('w=alpha&focus=X')).toBe('')
  })
})

describe('row mapping', () => {
  it('maps snake_case columns to the DTO shape', () => {
    expect(
      savedViewRowToDTO({
        id: 1,
        name: 'A',
        query: 'view=mix',
        sort_order: 2,
        created_at: 100,
        updated_at: 200,
      }),
    ).toEqual({
      id: 1,
      name: 'A',
      query: 'view=mix',
      sortOrder: 2,
      createdAt: 100,
      updatedAt: 200,
    })
  })

  it('appends after the highest sort_order', () => {
    expect(nextSortOrder([])).toBe(0)
    expect(nextSortOrder([{ sort_order: 0 }, { sort_order: 5 }, { sort_order: 2 }])).toBe(6)
  })
})
