import { describe, expect, it } from 'vitest'
import { moveInOrder, reorderPatches } from './savedViewsOrder'

/** Views as the server hands them back: already sorted, sort_order dense from 0. */
const views = [
  { id: 10, sortOrder: 0 },
  { id: 20, sortOrder: 1 },
  { id: 30, sortOrder: 2 },
]

describe('moveInOrder', () => {
  it('moves an item down', () => {
    expect(moveInOrder(views, 10, 2).map((v) => v.id)).toEqual([20, 30, 10])
  })

  it('moves an item up', () => {
    expect(moveInOrder(views, 30, 0).map((v) => v.id)).toEqual([30, 10, 20])
  })

  it('renumbers sortOrder densely from 0', () => {
    expect(moveInOrder(views, 30, 0).map((v) => v.sortOrder)).toEqual([0, 1, 2])
  })

  it('clamps an out-of-range target instead of dropping the item', () => {
    expect(moveInOrder(views, 10, 99).map((v) => v.id)).toEqual([20, 30, 10])
    expect(moveInOrder(views, 30, -5).map((v) => v.id)).toEqual([30, 10, 20])
  })

  it('returns the input unchanged when the id is unknown', () => {
    expect(moveInOrder(views, 999, 0)).toEqual(views)
  })

  it('preserves the other fields on each row', () => {
    const named = [
      { id: 1, sortOrder: 0, name: 'a' },
      { id: 2, sortOrder: 1, name: 'b' },
    ]
    expect(moveInOrder(named, 2, 0)).toEqual([
      { id: 2, sortOrder: 0, name: 'b' },
      { id: 1, sortOrder: 1, name: 'a' },
    ])
  })
})

describe('reorderPatches', () => {
  // The point of the function: every PATCH bumps updated_at server-side, so a
  // row whose position did not actually move must not be written.
  it('patches only the rows whose sortOrder changed', () => {
    const next = moveInOrder(views, 20, 2)
    expect(next.map((v) => v.id)).toEqual([10, 30, 20])
    expect(reorderPatches(views, next)).toEqual([
      { id: 30, sortOrder: 1 },
      { id: 20, sortOrder: 2 },
    ])
  })

  it('is empty when nothing moved', () => {
    expect(reorderPatches(views, moveInOrder(views, 10, 0))).toEqual([])
  })

  it('patches a row whose position is unchanged but whose stored sortOrder is sparse', () => {
    // Rows written before a delete can carry gaps (0, 5, 9). Renumbering them
    // densely is a real change and has to be persisted, or the next reorder
    // computes against numbers the server does not have.
    const sparse = [
      { id: 10, sortOrder: 0 },
      { id: 20, sortOrder: 5 },
      { id: 30, sortOrder: 9 },
    ]
    expect(reorderPatches(sparse, moveInOrder(sparse, 10, 0))).toEqual([
      { id: 20, sortOrder: 1 },
      { id: 30, sortOrder: 2 },
    ])
  })
})
