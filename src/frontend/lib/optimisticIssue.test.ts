import { describe, expect, it } from 'vitest'
import type { NormalizedIssue } from '@shared/types.js'
import { applyIssueDisplayPatch } from './optimisticIssue'

function issue(over: Partial<NormalizedIssue> & { identifier: string }): NormalizedIssue {
  return {
    id: `uuid-${over.identifier}`,
    title: 't',
    url: 'u',
    priority: 0,
    state: { name: 'In Progress', type: 'started' },
    assignee: null,
    labels: [],
    relations: [],
    ...over,
  } as NormalizedIssue
}

const ALICE = { id: 'u1', displayName: 'Alice' }

describe('applyIssueDisplayPatch', () => {
  const list = [
    issue({ identifier: 'ENG-1' }),
    issue({ identifier: 'ENG-2', assignee: ALICE }),
  ]

  it('repaints the state of the named issue', () => {
    const out = applyIssueDisplayPatch(list, 'ENG-1', {
      state: { name: 'Done', type: 'completed' },
    })
    expect(out[0]?.state).toEqual({ name: 'Done', type: 'completed' })
  })

  it('leaves every other issue alone', () => {
    const out = applyIssueDisplayPatch(list, 'ENG-1', {
      state: { name: 'Done', type: 'completed' },
    })
    expect(out[1]).toBe(list[1])
  })

  it('does not mutate the input array or its issues', () => {
    const before = JSON.parse(JSON.stringify(list))
    applyIssueDisplayPatch(list, 'ENG-1', { state: { name: 'Done', type: 'completed' } })
    expect(list).toEqual(before)
  })

  it('returns a new array so a store subscription actually fires', () => {
    const out = applyIssueDisplayPatch(list, 'ENG-1', {
      state: { name: 'Done', type: 'completed' },
    })
    expect(out).not.toBe(list)
  })

  it('assigns', () => {
    const out = applyIssueDisplayPatch(list, 'ENG-1', { assignee: ALICE })
    expect(out[0]?.assignee).toEqual(ALICE)
  })

  it('paints an explicit null as unassigned', () => {
    const out = applyIssueDisplayPatch(list, 'ENG-2', { assignee: null })
    expect(out[1]?.assignee).toBeNull()
  })

  // The absent-vs-null pair, mirroring the wire patch. A state-only change must
  // not wipe the assignee off the card.
  it('leaves the assignee alone when the patch does not mention it', () => {
    const out = applyIssueDisplayPatch(list, 'ENG-2', {
      state: { name: 'Done', type: 'completed' },
    })
    expect(out[1]?.assignee).toEqual(ALICE)
  })

  it('changes state and assignee together', () => {
    const out = applyIssueDisplayPatch(list, 'ENG-1', {
      state: { name: 'Done', type: 'completed' },
      assignee: ALICE,
    })
    expect(out[0]?.state.type).toBe('completed')
    expect(out[0]?.assignee).toEqual(ALICE)
  })

  // A reload can replace the issue list between the optimistic write and the
  // write's own response. Returning the same reference lets the caller skip a
  // pointless store write and re-render.
  it('returns the original reference when the identifier is gone', () => {
    expect(applyIssueDisplayPatch(list, 'GONE-9', { assignee: ALICE })).toBe(list)
  })

  it('returns the original reference for an empty patch', () => {
    const out = applyIssueDisplayPatch(list, 'ENG-1', {})
    expect(out[0]).toEqual(list[0])
  })

  // Priority 0 is "No priority" — a value, not an absence. A truthiness guard
  // would make it the one setting that cannot be painted.
  it.each([0, 1, 4] as const)('paints priority %i, including the falsy one', (priority) => {
    const out = applyIssueDisplayPatch(list, 'ENG-1', { priority })
    expect(out[0]?.priority).toBe(priority)
  })

  it('leaves priority alone when the patch omits it', () => {
    const withP = [issue({ identifier: 'ENG-9', priority: 2 })]
    const out = applyIssueDisplayPatch(withP, 'ENG-9', { assignee: ALICE })
    expect(out[0]?.priority).toBe(2)
  })

  // The wire sends a delta; the paint needs the resulting set, because that is
  // what the card renders.
  it('replaces the label set with the resolved one', () => {
    const labels = [{ id: 'l1', name: 'bug', color: '#fff', group: null }]
    const out = applyIssueDisplayPatch(list, 'ENG-1', { labels })
    expect(out[0]?.labels).toEqual(labels)
  })

  it('paints an emptied label set', () => {
    const withL = [issue({ identifier: 'ENG-9', labels: [{ id: 'l1', name: 'bug', color: '#fff', group: null }] })]
    const out = applyIssueDisplayPatch(withL, 'ENG-9', { labels: [] })
    expect(out[0]?.labels).toEqual([])
  })

  it('handles an empty list', () => {
    expect(applyIssueDisplayPatch([], 'ENG-1', { assignee: ALICE })).toEqual([])
  })
})
