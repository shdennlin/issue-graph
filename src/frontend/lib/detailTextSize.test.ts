// @vitest-environment happy-dom
// For a real localStorage. There is no setupFiles and no shim in this repo;
// the DOM comes entirely from this pragma.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  TEXT_SIZE_KEY,
  TEXT_SIZES,
  isTextSize,
  nextTextSize,
  readTextSize,
  writeTextSize,
} from './detailTextSize'

beforeEach(() => localStorage.clear())

describe('nextTextSize', () => {
  it('walks the sizes in order and wraps', () => {
    // Wrapping is what makes this ONE control. Without it the button would
    // dead-end at xl and need a second one to get back.
    expect(TEXT_SIZES.map((s) => nextTextSize(s))).toEqual(['md', 'lg', 'xl', 'sm'])
  })
})

describe('readTextSize', () => {
  it('returns what was written', () => {
    writeTextSize('xl')
    expect(readTextSize()).toBe('xl')
  })

  it('falls back to md for an unset, empty or bogus value', () => {
    expect(readTextSize()).toBe('md')
    localStorage.setItem(TEXT_SIZE_KEY, '')
    expect(readTextSize()).toBe('md')
    localStorage.setItem(TEXT_SIZE_KEY, 'huge')
    expect(readTextSize()).toBe('md')
  })

  it('reads the key the detail panel has always used', () => {
    // Renaming it would silently reset every existing reader's preference.
    localStorage.setItem('ig-detail-text-size-v1', 'lg')
    expect(readTextSize()).toBe('lg')
  })
})

describe('isTextSize', () => {
  it.each([null, undefined, 42, 'SM', 'medium', ''])('rejects %p', (v) => {
    expect(isTextSize(v)).toBe(false)
  })
})
