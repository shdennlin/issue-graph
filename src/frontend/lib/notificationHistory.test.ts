// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_ENTRIES, clearHistory, readHistory, writeHistory, type StoredEntry } from './notificationHistory'

function entry(over: Partial<StoredEntry> & { id: string }): StoredEntry {
  return {
    identifier: 'ENG-1',
    title: 'Title',
    kind: 'changed',
    fields: ['state'],
    to: { state: 'In Review' },
    at: 1_700_000_000_000,
    read: false,
    ...over,
  }
}

beforeEach(() => {
  localStorage.clear()
})

describe('notificationHistory — round trip', () => {
  it('stores and reads back a log', () => {
    const log = [entry({ id: 'a' }), entry({ id: 'b' })]
    writeHistory('ws1', log)
    expect(readHistory('ws1').map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('keeps each workspace log to itself', () => {
    // The bug this guards: entries from one workspace showing while you look
    // at another. Tolerable while it was memory-only, permanent once stored.
    writeHistory('ws1', [entry({ id: 'a', identifier: 'ONE-1' })])
    writeHistory('ws2', [entry({ id: 'b', identifier: 'TWO-1' })])
    expect(readHistory('ws1').map((e) => e.identifier)).toEqual(['ONE-1'])
    expect(readHistory('ws2').map((e) => e.identifier)).toEqual(['TWO-1'])
  })

  it('reads empty for an unknown workspace or a null id', () => {
    expect(readHistory('never-written')).toEqual([])
    expect(readHistory(null)).toEqual([])
  })

  it('clears one workspace without touching another', () => {
    writeHistory('ws1', [entry({ id: 'a' })])
    writeHistory('ws2', [entry({ id: 'b' })])
    clearHistory('ws1')
    expect(readHistory('ws1')).toEqual([])
    expect(readHistory('ws2')).toHaveLength(1)
  })
})

describe('notificationHistory — refusing to guess', () => {
  it('discards a payload written by a different version', () => {
    // A stored value can outlive the build that wrote it.
    localStorage.setItem('ig-notify-log:ws1', JSON.stringify({ version: 99, entries: [entry({ id: 'a' })] }))
    expect(readHistory('ws1')).toEqual([])
  })

  it('discards malformed JSON and non-object payloads', () => {
    localStorage.setItem('ig-notify-log:ws1', '{not json')
    expect(readHistory('ws1')).toEqual([])
    localStorage.setItem('ig-notify-log:ws1', '"a string"')
    expect(readHistory('ws1')).toEqual([])
  })

  it('drops individual entries that fail validation, keeping the rest', () => {
    localStorage.setItem(
      'ig-notify-log:ws1',
      JSON.stringify({ version: 1, entries: [entry({ id: 'a' }), { id: 'b' }, null, 7] }),
    )
    expect(readHistory('ws1').map((e) => e.id)).toEqual(['a'])
  })
})

describe('notificationHistory — bounds', () => {
  it('caps what it writes and what it reads at MAX_ENTRIES', () => {
    const many = Array.from({ length: MAX_ENTRIES + 50 }, (_, i) => entry({ id: `e${i}` }))
    writeHistory('ws1', many)
    const back = readHistory('ws1')
    expect(back).toHaveLength(MAX_ENTRIES)
    // Newest first, so it is the tail that goes.
    expect(back[0]?.id).toBe('e0')
  })

  it('trims an overlong title on the way to disk', () => {
    const long = 'x'.repeat(400)
    writeHistory('ws1', [entry({ id: 'a', title: long })])
    const back = readHistory('ws1')[0]
    expect(back?.title.length).toBeLessThan(long.length)
    expect(back?.title.endsWith('…')).toBe(true)
  })
})
