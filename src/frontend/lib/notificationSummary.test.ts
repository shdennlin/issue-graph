import { describe, expect, it } from 'vitest'
import { translate, type DictKey } from '../i18n'
import type { StoredEntry } from './notificationHistory'
import { describeEntry, summarizeEntry, toastPreview } from './notificationSummary'

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

describe('describeEntry', () => {
  const lines = (e: StoredEntry) => describeEntry(e, t, 'en')

  it('names the field and shows both sides, coloured by state type', () => {
    const e = entry({
      fields: ['state'],
      from: { state: 'Todo' },
      to: { state: 'In Review' },
      stateType: { from: 'unstarted', to: 'started' },
    })
    expect(lines(e)).toEqual([
      {
        label: 'Status',
        from: { text: 'Todo', tone: 'unstarted' },
        to: { text: 'In Review', tone: 'started' },
      },
    ])
  })

  // Entries written before `from` existed are still on disk. They lose the
  // left-hand side, not the line.
  it('shows only the new value for an entry recorded without `from`', () => {
    const e = entry({ fields: ['state'], to: { state: 'In Review' } })
    expect(lines(e)).toEqual([{ label: 'Status', to: { text: 'In Review' } }])
  })

  it('renders a cleared field as a muted "none", not a dash', () => {
    const e = entry({ fields: ['assignee'], from: { assignee: 'Alice' }, to: { assignee: null } })
    expect(lines(e)).toEqual([
      { label: 'Assignee', from: { text: 'Alice' }, to: { text: 'none', tone: 'none' } },
    ])
  })

  it('localises priority and flags High and Urgent', () => {
    const e = entry({ fields: ['priority'], from: { priority: '3' }, to: { priority: '1' } })
    expect(lines(e)).toEqual([
      { label: 'Priority', from: { text: 'Medium' }, to: { text: 'Urgent', tone: 'danger' } },
    ])
    const high = entry({ fields: ['priority'], to: { priority: '2' } })
    expect(lines(high)[0]?.to).toEqual({ text: 'High', tone: 'warn' })
  })

  it('gives a comment and a rename a line of their own', () => {
    const e = entry({ fields: ['title', 'comment'] })
    expect(lines(e)).toEqual([
      { label: 'Renamed' },
      { label: 'Comment', to: { text: 'new' } },
    ])
  })

  it('keeps the label delta as the value', () => {
    const e = entry({ fields: ['labels'], to: { labels: '+bug −ux' } })
    expect(lines(e)).toEqual([{ label: 'Labels', to: { text: '+bug −ux' } }])
  })

  it('says where a created issue landed when it knows', () => {
    const e = entry({ kind: 'created', to: { state: 'Todo' }, stateType: { to: 'unstarted' } })
    expect(lines(e)).toEqual([{ label: 'Created', to: { text: 'Todo', tone: 'unstarted' } }])
    expect(lines(entry({ kind: 'created' }))).toEqual([{ label: 'Created' }])
  })

  it('reads in zh-TW', () => {
    const zt = (k: DictKey, p?: Record<string, string | number>) => translate('zh-TW', k, p)
    const e = entry({ fields: ['assignee'], from: { assignee: 'Alice' }, to: { assignee: null } })
    expect(describeEntry(e, zt, 'zh-TW')[0]).toMatchObject({ label: '指派對象', to: { text: '無' } })
  })
})
