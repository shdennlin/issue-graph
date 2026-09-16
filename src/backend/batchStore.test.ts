import { describe, it, expect } from 'vitest'
import type { NormalizedIssue } from '../shared/types.js'
import {
  BATCH_MEMBERS_MAX,
  BATCH_NAME_MAX,
  batchProgress,
  nextCandidate,
  normalizeBatchName,
  normalizeMembers,
  orderMembers,
  unfinishedBlockers,
  type BatchMemberRow,
} from './batchStore.js'

/** `blocks: ['X']` reads "this issue blocks X", so X depends on this one. */
const issue = (identifier: string, blocks: string[] = []): NormalizedIssue =>
  ({
    identifier,
    relations: blocks.map((t) => ({ type: 'blocks' as const, targetIdentifier: t })),
  }) as NormalizedIssue

const member = (identifier: string, over: Partial<BatchMemberRow> = {}): BatchMemberRow => ({
  batch_id: 1,
  identifier,
  claimed_by: null,
  claimed_at: null,
  done_at: null,
  ...over,
})

describe('normalizeBatchName', () => {
  it('trims a name', () => {
    expect(normalizeBatchName('  Ship auth  ')).toBe('Ship auth')
  })

  it.each([
    ['blank', '   '],
    ['over-long', 'x'.repeat(BATCH_NAME_MAX + 1)],
    ['non-string', 7],
  ])('rejects a %s name', (_l, input) => {
    expect(normalizeBatchName(input)).toBeNull()
  })
})

describe('normalizeMembers', () => {
  it('uppercases and de-duplicates', () => {
    // A member can arrive from a branch name (lowercase in practice) or from
    // the graph (uppercase); both must land on one row.
    expect(normalizeMembers(['one-1', 'ONE-1', 'one-2'])).toEqual(['ONE-1', 'ONE-2'])
  })

  it.each([
    ['an empty list', []],
    ['a non-array', 'ONE-1'],
    ['a non-string member', ['ONE-1', 5]],
    ['something that is not an identifier', ['not-an-id']],
    ['too many members', new Array(BATCH_MEMBERS_MAX + 1).fill('ONE-1')],
  ])('rejects %s', (_l, input) => {
    expect(normalizeMembers(input)).toBeNull()
  })
})

describe('orderMembers', () => {
  it('puts a blocker before what it blocks', () => {
    const issues = [issue('ONE-1', ['ONE-2']), issue('ONE-2')]
    expect(orderMembers(['ONE-2', 'ONE-1'], issues)).toEqual(['ONE-1', 'ONE-2'])
  })

  it('orders a three-deep chain', () => {
    const issues = [issue('ONE-1', ['ONE-2']), issue('ONE-2', ['ONE-3']), issue('ONE-3')]
    expect(orderMembers(['ONE-3', 'ONE-2', 'ONE-1'], issues)).toEqual(['ONE-1', 'ONE-2', 'ONE-3'])
  })

  it('keeps the caller’s order for unrelated members', () => {
    // A hand-picked selection should come back in the order it was picked, not
    // in an arbitrary one.
    const issues = [issue('ONE-1'), issue('ONE-2'), issue('ONE-3')]
    expect(orderMembers(['ONE-3', 'ONE-1', 'ONE-2'], issues)).toEqual(['ONE-3', 'ONE-1', 'ONE-2'])
  })

  it('ignores a blocker outside the batch', () => {
    // An outside blocker is a reason the issue is not ready, not a reason to
    // reorder the batch.
    const issues = [issue('OUT-9', ['ONE-1']), issue('ONE-1'), issue('ONE-2')]
    expect(orderMembers(['ONE-1', 'ONE-2'], issues)).toEqual(['ONE-1', 'ONE-2'])
  })

  it('appends a cycle rather than dropping its members', () => {
    // Dropping them would make the batch silently lose issues. They still get
    // worked; the ordering just cannot promise anything about them.
    const issues = [issue('ONE-1', ['ONE-2']), issue('ONE-2', ['ONE-1']), issue('ONE-3')]
    const out = orderMembers(['ONE-1', 'ONE-2', 'ONE-3'], issues)
    expect(out).toHaveLength(3)
    expect(out[0]).toBe('ONE-3')
    expect(out.slice(1).sort()).toEqual(['ONE-1', 'ONE-2'])
  })

  it('copes with a member that is not in the issue cache', () => {
    expect(orderMembers(['ONE-1', 'ONE-404'], [issue('ONE-1')])).toEqual(['ONE-1', 'ONE-404'])
  })
})

describe('unfinishedBlockers', () => {
  const issues = [issue('ONE-1', ['ONE-2']), issue('ONE-2')]

  it('names an in-batch blocker that is not done', () => {
    expect(unfinishedBlockers('ONE-2', [member('ONE-1'), member('ONE-2')], issues)).toEqual([
      'ONE-1',
    ])
  })

  it('clears once the blocker is done', () => {
    const members = [member('ONE-1', { done_at: 1 }), member('ONE-2')]
    expect(unfinishedBlockers('ONE-2', members, issues)).toEqual([])
  })

  it('counts a claimed-but-unfinished blocker as still blocking', () => {
    const members = [member('ONE-1', { claimed_by: 'other' }), member('ONE-2')]
    expect(unfinishedBlockers('ONE-2', members, issues)).toEqual(['ONE-1'])
  })
})

describe('nextCandidate', () => {
  const issues = [issue('ONE-1', ['ONE-2']), issue('ONE-2')]

  it('hands out the blocker first', () => {
    expect(nextCandidate([member('ONE-1'), member('ONE-2')], issues, 's1')).toBe('ONE-1')
  })

  it('will not hand out a blocked issue while its blocker is open', () => {
    const members = [member('ONE-1', { claimed_by: 'other' }), member('ONE-2')]
    expect(nextCandidate(members, issues, 's1')).toBeNull()
  })

  it('moves on once the blocker is done', () => {
    const members = [member('ONE-1', { done_at: 5 }), member('ONE-2')]
    expect(nextCandidate(members, issues, 's1')).toBe('ONE-2')
  })

  it('skips an issue another session holds instead of waiting for it', () => {
    // Blocking here would stall a whole batch on one slow issue.
    const indep = [issue('ONE-1'), issue('ONE-2')]
    const members = [member('ONE-1', { claimed_by: 'other' }), member('ONE-2')]
    expect(nextCandidate(members, indep, 's1')).toBe('ONE-2')
  })

  it('gives a session its own claim back', () => {
    // A session that reconnects should resume its issue, not pick up a second.
    const indep = [issue('ONE-1'), issue('ONE-2')]
    const members = [member('ONE-1', { claimed_by: 's1' }), member('ONE-2')]
    expect(nextCandidate(members, indep, 's1')).toBe('ONE-1')
  })

  it('returns null when everything is done', () => {
    const members = [member('ONE-1', { done_at: 1 }), member('ONE-2', { done_at: 2 })]
    expect(nextCandidate(members, issues, 's1')).toBeNull()
  })

  it('returns null for an empty batch', () => {
    expect(nextCandidate([], issues, 's1')).toBeNull()
  })
})

describe('batchProgress', () => {
  it('counts done and claimed separately', () => {
    expect(
      batchProgress([
        member('ONE-1', { done_at: 1 }),
        member('ONE-2', { claimed_by: 's1' }),
        member('ONE-3'),
      ]),
    ).toEqual({ total: 3, done: 1, claimed: 1 })
  })

  it('does not count a done member as also claimed', () => {
    expect(batchProgress([member('ONE-1', { done_at: 1, claimed_by: 's1' })])).toEqual({
      total: 1,
      done: 1,
      claimed: 0,
    })
  })
})
