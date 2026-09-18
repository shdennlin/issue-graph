import { describe, it, expect } from 'vitest'
import type { NormalizedIssue, NormalizedPullRequest } from '../shared/types.js'
import {
  ASSIGNEES_MAX,
  BATCH_MEMBERS_MAX,
  BATCH_NAME_MAX,
  LINK_VALUE_MAX,
  SHOW_TOKENS,
  daysOnStage,
  isStale,
  normalizeAssignees,
  normalizeLinkKind,
  RICH_LINK_KINDS,
  normalizeLinkValue,
  normalizeShows,
  normalizeStaleAfterDays,
  normalizeStatus,
  parseStringArray,
  tallyPullRequests,
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

// ---------------------------------------------------------------------------
// The workstream's own fields
// ---------------------------------------------------------------------------

describe('normalizeStatus', () => {
  it('accepts exactly the two values', () => {
    expect(normalizeStatus('active')).toBe('active')
    expect(normalizeStatus('archived')).toBe('archived')
  })

  it('refuses anything else rather than coercing', () => {
    // A typo must surface. Coercing to a default would silently file a
    // workstream away, or silently un-file one.
    expect(normalizeStatus('paused')).toBeNull()
    expect(normalizeStatus('Archived')).toBeNull()
    expect(normalizeStatus(null)).toBeNull()
  })
})

describe('normalizeAssignees', () => {
  it('trims, drops blanks and de-duplicates', () => {
    expect(normalizeAssignees([' claude-1 ', 'claude-1', '', 'claude-2'])).toEqual([
      'claude-1',
      'claude-2',
    ])
  })

  it('treats absent as empty', () => {
    expect(normalizeAssignees(null)).toEqual([])
    expect(normalizeAssignees(undefined)).toEqual([])
  })

  it('rejects a non-array, a non-string member and an over-long list', () => {
    expect(normalizeAssignees('claude-1')).toBeNull()
    expect(normalizeAssignees([1])).toBeNull()
    expect(normalizeAssignees(new Array(ASSIGNEES_MAX + 1).fill('a'))).toBeNull()
  })
})

describe('normalizeShows', () => {
  it('accepts tokens from the vocabulary, de-duplicated and in order', () => {
    expect(normalizeShows(['pullRequests', 'note', 'pullRequests'])).toEqual([
      'pullRequests',
      'note',
    ])
  })

  it('accepts an empty list — a stage may draw its name and nothing else', () => {
    expect(normalizeShows([])).toEqual([])
    expect(normalizeShows(null)).toEqual([])
  })

  it('REJECTS an unknown token rather than dropping it', () => {
    // Dropping would leave the stage rendering nothing with no explanation, and
    // a typo would look exactly like a deliberately empty stage — which is
    // itself a valid configuration.
    expect(normalizeShows(['pullRequests', 'pulRequests'])).toBeNull()
    expect(normalizeShows(['checks'])).toBeNull()
  })

  it('covers every token the vocabulary declares', () => {
    expect(normalizeShows([...SHOW_TOKENS])).toEqual([...SHOW_TOKENS])
  })
})

describe('parseStringArray', () => {
  it('reads a stored array and degrades a bad column to empty', () => {
    expect(parseStringArray('["claude-1"]')).toEqual(['claude-1'])
    expect(parseStringArray('not json')).toEqual([])
    expect(parseStringArray('{"a":1}')).toEqual([])
    expect(parseStringArray('[1,"ok",null]')).toEqual(['ok'])
  })
})

describe('normalizeStaleAfterDays', () => {
  it('accepts a whole number of days, and null for "never"', () => {
    expect(normalizeStaleAfterDays(7)).toBe(7)
    expect(normalizeStaleAfterDays(0)).toBe(0)
    expect(normalizeStaleAfterDays(null)).toBeNull()
  })

  it('signals invalid input as undefined, distinct from a valid null', () => {
    // null means "this stage never goes stale" and is stored; undefined means
    // reject the request. Collapsing them would silently disable a nudge.
    expect(normalizeStaleAfterDays(1.5)).toBeUndefined()
    expect(normalizeStaleAfterDays(-1)).toBeUndefined()
    expect(normalizeStaleAfterDays('7')).toBeUndefined()
  })
})

describe('normalizeLinkKind / normalizeLinkValue', () => {
  it('accepts the kinds the app draws specially', () => {
    for (const kind of RICH_LINK_KINDS) expect(normalizeLinkKind(kind)).toBe(kind)
  })

  it('accepts a kind the app has never heard of', () => {
    // The list is an ENHANCEMENT, not a gate. A kind's value is what it NAMES,
    // not what it draws — `runbook` tells the reader, and the agent, something
    // a generic link does not, whether or not there is special handling.
    expect(normalizeLinkKind('runbook')).toBe('runbook')
    expect(normalizeLinkKind('incident-report')).toBe('incident-report')
  })

  it('normalises rather than merely checking, so one thing is not two kinds', () => {
    // Two agents writing "Pull Request" and "pull_request" must not create two
    // kinds that read the same.
    expect(normalizeLinkKind('Pull Request')).toBe('pull-request')
    expect(normalizeLinkKind('  RUNBOOK  ')).toBe('runbook')
    expect(normalizeLinkKind('design_doc')).toBe('design-doc')
  })

  it('still refuses what is not a kind at all', () => {
    expect(normalizeLinkKind('')).toBeNull()
    expect(normalizeLinkKind('  ')).toBeNull()
    expect(normalizeLinkKind(7)).toBeNull()
    expect(normalizeLinkKind('has/slash')).toBeNull()
    expect(normalizeLinkKind('x'.repeat(40))).toBeNull()
  })

  it('trims a value and refuses blank or over-long', () => {
    expect(normalizeLinkValue('  openspec/changes/x  ')).toBe('openspec/changes/x')
    expect(normalizeLinkValue('   ')).toBeNull()
    expect(normalizeLinkValue('x'.repeat(LINK_VALUE_MAX + 1))).toBeNull()
  })
})

describe('isStale', () => {
  const DAY = 86_400_000
  const now = 10 * DAY

  it('is stale past the stage’s own threshold', () => {
    expect(isStale(now - 6 * DAY, 5, now)).toBe(true)
    expect(isStale(now - 4 * DAY, 5, now)).toBe(false)
  })

  it('never goes stale when the stage sets no threshold', () => {
    // The honest setting for a Discuss stage, which can legitimately run for
    // weeks. Stalling is only wrong relative to the stage.
    expect(isStale(now - 100 * DAY, null, now)).toBe(false)
  })

  it('is not stale before any stage has been set', () => {
    expect(isStale(null, 1, now)).toBe(false)
  })

  it('reports whole days for the wording', () => {
    expect(daysOnStage(now - 9.5 * DAY, now)).toBe(9)
    expect(daysOnStage(now + DAY, now)).toBe(0)
    expect(daysOnStage(null, now)).toBeNull()
  })
})

describe('tallyPullRequests', () => {
  const pr = (url: string, over: Partial<NormalizedPullRequest> = {}): NormalizedPullRequest => ({
    url,
    number: null,
    repo: null,
    status: 'open',
    targetBranch: null,
    hasConflicts: null,
    linkKind: 'closes',
    mergedAt: null,
    ...over,
  })

  it('counts closes and contributes separately', () => {
    // A stack's middle PRs are linked as "contributes". Folding them into one
    // total makes "2 of 5 merged" say nothing about whether the feature is
    // finished — the closes figure is the one that answers that.
    const t = tallyPullRequests([
      { pullRequests: [pr('a', { status: 'merged' }), pr('b', { linkKind: 'contributes', status: 'merged' })] },
      { pullRequests: [pr('c')] },
    ])
    expect(t.total).toBe(3)
    expect(t.merged).toBe(2)
    expect(t.closesTotal).toBe(2)
    expect(t.closesMerged).toBe(1)
  })

  it('counts one PR once even when it is linked to two members', () => {
    // A single PR can close several issues; counting it twice would overstate
    // both the total and the work done.
    const t = tallyPullRequests([{ pullRequests: [pr('a')] }, { pullRequests: [pr('a')] }])
    expect(t.total).toBe(1)
  })

  it('splits open, draft and merged, and counts conflicts', () => {
    const t = tallyPullRequests([
      {
        pullRequests: [
          pr('a', { status: 'merged' }),
          pr('b', { status: 'draft' }),
          pr('c', { status: 'open', hasConflicts: true }),
        ],
      },
    ])
    expect(t).toMatchObject({ merged: 1, draft: 1, open: 1, conflicts: 1 })
  })

  it('treats an absent linkKind as closing', () => {
    // Linear's default magic words close. Reading an unknown as "contributes"
    // would understate how complete the feature is.
    const t = tallyPullRequests([{ pullRequests: [pr('a', { linkKind: null, status: 'merged' })] }])
    expect(t.closesMerged).toBe(1)
  })

  it('counts an unrecognised status as open rather than dropping it', () => {
    const t = tallyPullRequests([{ pullRequests: [pr('a', { status: 'queued' })] }])
    expect(t.open).toBe(1)
    expect(t.total).toBe(1)
  })

  it('handles members with no PRs at all', () => {
    expect(tallyPullRequests([{}, { pullRequests: [] }])).toMatchObject({ total: 0, closesTotal: 0 })
  })
})
