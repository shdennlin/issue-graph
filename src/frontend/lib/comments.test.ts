import { describe, expect, it } from 'vitest'
import type { IssueComment } from '@shared/types.js'
import { sortCommentsOldestFirst } from './comments'

function comment(id: string, createdAt: string): IssueComment {
  return {
    id,
    body: id,
    createdAt,
    updatedAt: createdAt,
    user: null,
  }
}

describe('sortCommentsOldestFirst', () => {
  it('orders comments from oldest createdAt to newest createdAt', () => {
    const comments = [
      comment('new', '2026-05-14T12:00:00.000Z'),
      comment('old', '2026-05-12T12:00:00.000Z'),
      comment('middle', '2026-05-13T12:00:00.000Z'),
    ]

    expect(sortCommentsOldestFirst(comments).map((c) => c.id)).toEqual([
      'old',
      'middle',
      'new',
    ])
  })

  it('does not mutate the input array', () => {
    const comments = [
      comment('new', '2026-05-14T12:00:00.000Z'),
      comment('old', '2026-05-12T12:00:00.000Z'),
    ]

    sortCommentsOldestFirst(comments)

    expect(comments.map((c) => c.id)).toEqual(['new', 'old'])
  })
})
