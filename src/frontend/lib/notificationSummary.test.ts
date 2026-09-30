import { describe, expect, it } from 'vitest'
import { translate, type DictKey } from '../i18n'
import type { StoredEntry } from './notificationHistory'
import { summarizeEntry, toastPreview } from './notificationSummary'

const t = (k: DictKey, p?: Record<string, string | number>): string => translate('en', k, p)

function entry(over: Partial<StoredEntry> = {}): StoredEntry {
  return {
    id: 'ONE-1#1',
    identifier: 'ONE-1',
    title: 'A title',
    kind: 'changed',
    fields: [],
    to: {},
    at: 0,
    read: false,
    ...over,
  }
}

describe('summarizeEntry', () => {
  it('says "created" for a new issue', () => {
    expect(summarizeEntry(entry({ kind: 'created' }), t, 'en')).toBe('created')
  })

  it('names the value moved to, and the field where there is no value', () => {
    const e = entry({ fields: ['state', 'comment'], to: { state: 'In Review' } })
    expect(summarizeEntry(e, t, 'en')).toBe('→ In Review · new comment')
  })

  it('marks a cleared field with a dash', () => {
    const e = entry({ fields: ['assignee'], to: { assignee: null } })
    expect(summarizeEntry(e, t, 'en')).toBe('assignee —')
  })

  it('renders priority as its label, not its number', () => {
    const e = entry({ fields: ['priority'], to: { priority: '1' } })
    expect(summarizeEntry(e, t, 'en')).toBe('→ Urgent')
  })
})

describe('toastPreview', () => {
  const many = ['A', 'B', 'C', 'D', 'E'].map((id) => entry({ id, identifier: id }))

  it('shows every entry when the batch is small', () => {
    const p = toastPreview(many.slice(0, 2))
    expect(p.shown.map((e) => e.identifier)).toEqual(['A', 'B'])
    expect(p.more).toBe(0)
  })

  // The toast floats over the graph; a burst of twenty must not become a
  // column of twenty. The rest is one click away in the bell.
  it('caps the rows and counts the rest', () => {
    const p = toastPreview(many)
    expect(p.shown.map((e) => e.identifier)).toEqual(['A', 'B', 'C'])
    expect(p.more).toBe(2)
  })
})
