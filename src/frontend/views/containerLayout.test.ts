import { describe, expect, it } from 'vitest'
import { chooseColumnCount, packIntoColumns } from './containerLayout.js'

describe('chooseColumnCount', () => {
  it('uses exactly N columns when issue count is below the cap', () => {
    expect(chooseColumnCount(1)).toBe(1)
    expect(chooseColumnCount(3)).toBe(3)
    expect(chooseColumnCount(4)).toBe(4)
  })
  it('caps at 4 columns for larger containers', () => {
    expect(chooseColumnCount(5)).toBe(4)
    expect(chooseColumnCount(50)).toBe(4)
    expect(chooseColumnCount(500)).toBe(4)
  })
  it('defensively returns 1 for empty / non-positive input', () => {
    expect(chooseColumnCount(0)).toBe(1)
  })
  it('honors a custom maxCols cap (user-tunable via Settings)', () => {
    expect(chooseColumnCount(10, 6)).toBe(6)
    expect(chooseColumnCount(3, 6)).toBe(3) // still uses N when below cap
    expect(chooseColumnCount(20, 2)).toBe(2)
  })
})

describe('packIntoColumns (row-major)', () => {
  it('places items left-to-right within a row before wrapping', () => {
    const items = [
      { id: 'a', h: 100 },
      { id: 'b', h: 100 },
      { id: 'c', h: 100 },
      { id: 'd', h: 100 },
    ]
    const { placed } = packIntoColumns(items, 2, 10)
    expect(placed.map((p) => ({ id: p.id, col: p.col, y: p.y }))).toEqual([
      { id: 'a', col: 0, y: 0 },
      { id: 'b', col: 1, y: 0 },
      { id: 'c', col: 0, y: 110 },
      { id: 'd', col: 1, y: 110 },
    ])
  })

  it('row height = tallest card in that row (top-aligned, ragged bottom)', () => {
    const items = [
      { id: 'a', h: 100 },
      { id: 'b', h: 200 }, // taller — defines row 0 height
      { id: 'c', h: 80 },
      { id: 'd', h: 150 }, // taller — defines row 1 height
    ]
    const { placed, maxColumnHeight } = packIntoColumns(items, 2, 10)
    // Row 0 = 200 tall → row 1 starts at 200 + 10 (gap) = 210
    expect(placed.map((p) => p.y)).toEqual([0, 0, 210, 210])
    // Total content = 200 + 10 + 150 = 360
    expect(maxColumnHeight).toBe(360)
  })

  it('partial last row sizes correctly (5 items in 2 cols)', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ id: String(i), h: 100 }))
    const { placed, maxColumnHeight } = packIntoColumns(items, 2, 10)
    // Rows: [0,1], [2,3], [4] — 3 rows of 100, 2 gaps of 10
    expect(placed.map((p) => ({ col: p.col, y: p.y }))).toEqual([
      { col: 0, y: 0 },
      { col: 1, y: 0 },
      { col: 0, y: 110 },
      { col: 1, y: 110 },
      { col: 0, y: 220 },
    ])
    expect(maxColumnHeight).toBe(320)
  })

  it('single column degenerates to a vertical stack', () => {
    const items = [
      { id: 'a', h: 50 },
      { id: 'b', h: 60 },
      { id: 'c', h: 70 },
    ]
    const { placed, maxColumnHeight } = packIntoColumns(items, 1, 8)
    expect(placed.map((p) => ({ col: p.col, y: p.y }))).toEqual([
      { col: 0, y: 0 },
      { col: 0, y: 58 },
      { col: 0, y: 126 },
    ])
    expect(maxColumnHeight).toBe(196)
  })

  it('empty input returns zero height and no placements', () => {
    const { placed, maxColumnHeight } = packIntoColumns([], 3, 10)
    expect(placed).toEqual([])
    expect(maxColumnHeight).toBe(0)
  })
})
