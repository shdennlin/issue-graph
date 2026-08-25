import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_PINS, isPinned, readPins, togglePin, writePins } from './pinnedFilters'
import type { PinnedFilter } from '../components/facets/facetModel'

const pin = (facetId: string, value: string): PinnedFilter => ({ facetId, value })

// vitest runs environment:'node', so there is no localStorage. A minimal stub
// is enough — these functions only ever get/set/throw.
function installStorage(impl?: Partial<Storage>) {
  const store = new Map<string, string>()
  const base = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  }
  vi.stubGlobal('localStorage', { ...base, ...impl })
  return store
}

beforeEach(() => vi.unstubAllGlobals())

describe('per-workspace keying', () => {
  it('does not leak pins between workspaces', () => {
    installStorage()
    writePins('alpha', [pin('assignee', 'Shawn')])
    // Label / project ids and assignee names are meaningless in another
    // workspace, so a shared key would render chips that match nothing.
    expect(readPins('beta')).toEqual([])
    expect(readPins('alpha')).toEqual([pin('assignee', 'Shawn')])
  })

  it('is inert without a workspace id', () => {
    installStorage()
    writePins(null, [pin('a', 'b')])
    expect(readPins(null)).toEqual([])
  })
})

describe('defensive reads', () => {
  it.each([
    ['malformed JSON', '{not json'],
    ['a non-array', '{"facetId":"a"}'],
  ])('returns [] for %s', (_name, raw) => {
    installStorage({ getItem: () => raw })
    expect(readPins('w')).toEqual([])
  })

  it('drops entries that are not shaped like a pin', () => {
    installStorage({
      getItem: () => JSON.stringify([{ facetId: 'a', value: 'b' }, { nope: 1 }, null, 'x']),
    })
    expect(readPins('w')).toEqual([pin('a', 'b')])
  })

  it('survives a storage that throws on write', () => {
    installStorage({ setItem: () => { throw new Error('quota') } })
    expect(() => writePins('w', [pin('a', 'b')])).not.toThrow()
  })

  it('returns [] when localStorage is absent entirely', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(readPins('w')).toEqual([])
  })
})

describe('togglePin', () => {
  it('adds then removes the same pin', () => {
    const p = pin('due', 'overdue')
    const added = togglePin([], p)
    expect(isPinned(added, p)).toBe(true)
    expect(togglePin(added, p)).toEqual([])
  })

  it('treats facetId and value as a compound identity', () => {
    const pins = [pin('due', 'overdue')]
    expect(isPinned(pins, pin('due', 'soon7'))).toBe(false)
    expect(isPinned(pins, pin('time', 'overdue'))).toBe(false)
  })

  // Refuse rather than evict: dropping the oldest would silently discard a
  // choice the user made deliberately.
  it('refuses to exceed the cap instead of evicting', () => {
    const full = Array.from({ length: MAX_PINS }, (_, i) => pin('assignee', `u${i}`))
    expect(togglePin(full, pin('assignee', 'extra'))).toEqual(full)
    // Removing still works when full.
    expect(togglePin(full, full[0] as PinnedFilter)).toHaveLength(MAX_PINS - 1)
  })

  it('caps what it reads back even if storage holds more', () => {
    installStorage({
      getItem: () => JSON.stringify(Array.from({ length: 50 }, (_, i) => pin('a', `v${i}`))),
    })
    expect(readPins('w')).toHaveLength(MAX_PINS)
  })
})
