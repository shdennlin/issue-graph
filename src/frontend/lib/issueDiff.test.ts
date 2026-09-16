import { describe, expect, it } from 'vitest'
import type { NormalizedIssue, NormalizedLabel } from '@shared/types.js'
import { diffIssues } from './issueDiff'

// Local factory, matching the house idiom — the repo has no shared fixture
// helper and every suite declares its own (see views/filters.test.ts).
function makeIssue(overrides: Partial<NormalizedIssue> = {}): NormalizedIssue {
  return {
    id: overrides.identifier ?? 'x',
    identifier: 'ENG-1',
    title: 'Title',
    url: 'about:blank',
    priority: 2,
    state: { name: 'Todo', type: 'unstarted' },
    assignee: null,
    labels: [],
    parent: null,
    children: [],
    relations: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    completedAt: null,
    ...overrides,
  }
}

function label(id: string): NormalizedLabel {
  return { id, name: id, color: '#000000', group: null }
}

function ids(changes: ReturnType<typeof diffIssues>): string[] {
  return changes.map((c) => c.identifier).sort()
}

describe('diffIssues — creation', () => {
  it('reports an identifier present in next but not prev', () => {
    const a = makeIssue({ identifier: 'ENG-1' })
    const b = makeIssue({ identifier: 'ENG-2', title: 'Brand new' })
    const out = diffIssues([a], [a, b])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'created', identifier: 'ENG-2', title: 'Brand new' })
    expect(out[0]?.before).toBeNull()
  })

  it('treats an empty prev as every issue being new', () => {
    const out = diffIssues([], [makeIssue({ identifier: 'ENG-1' }), makeIssue({ identifier: 'ENG-2' })])
    expect(ids(out)).toEqual(['ENG-1', 'ENG-2'])
    expect(out.every((c) => c.kind === 'created')).toBe(true)
  })
})

describe('diffIssues — semantic fields', () => {
  it('detects a state transition by name, not just by type', () => {
    // Both are 'unstarted'; flattening to the canonical type would lose this.
    const before = makeIssue({ state: { name: 'Todo', type: 'unstarted' } })
    const after = makeIssue({ state: { name: 'Review Spec', type: 'unstarted' } })
    const out = diffIssues([before], [after])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'changed', fields: ['state'] })
  })

  it('detects assignee set, cleared, and swapped', () => {
    const none = makeIssue({ assignee: null })
    const shawn = makeIssue({ assignee: { id: 'u1', displayName: 'Shawn' } })
    const other = makeIssue({ assignee: { id: 'u2', displayName: 'Other' } })
    expect(diffIssues([none], [shawn])[0]).toMatchObject({ fields: ['assignee'] })
    expect(diffIssues([shawn], [none])[0]).toMatchObject({ fields: ['assignee'] })
    expect(diffIssues([shawn], [other])[0]).toMatchObject({ fields: ['assignee'] })
  })

  it('falls back to displayName when the adapter omits assignee ids', () => {
    const a = makeIssue({ assignee: { displayName: 'Shawn' } })
    const b = makeIssue({ assignee: { displayName: 'Other' } })
    expect(diffIssues([a], [b])[0]).toMatchObject({ fields: ['assignee'] })
    expect(diffIssues([a], [makeIssue({ assignee: { displayName: 'Shawn' } })])).toHaveLength(0)
  })

  it('treats priority 0 as a real value, not as absent', () => {
    // 0 is "No priority" — a value someone picks. A truthiness guard would
    // make moving to it undetectable.
    const before = makeIssue({ priority: 2 })
    const after = makeIssue({ priority: 0 })
    expect(diffIssues([before], [after])[0]).toMatchObject({ fields: ['priority'] })
  })

  it('ignores label reordering but catches membership changes', () => {
    const ab = makeIssue({ labels: [label('a'), label('b')] })
    const ba = makeIssue({ labels: [label('b'), label('a')] })
    const abc = makeIssue({ labels: [label('a'), label('b'), label('c')] })
    expect(diffIssues([ab], [ba])).toHaveLength(0)
    expect(diffIssues([ab], [abc])[0]).toMatchObject({ fields: ['labels'] })
  })

  it('detects a rename', () => {
    const before = makeIssue({ title: 'Old name' })
    const after = makeIssue({ title: 'New name' })
    expect(diffIssues([before], [after])[0]).toMatchObject({ fields: ['title'] })
  })

  it('detects a project move, including into and out of "no project"', () => {
    const none = makeIssue({})
    const a = makeIssue({ project: { id: 'p1', name: 'A' } })
    const b = makeIssue({ project: { id: 'p2', name: 'B' } })
    expect(diffIssues([none], [a])[0]).toMatchObject({ fields: ['project'] })
    expect(diffIssues([a], [b])[0]).toMatchObject({ fields: ['project'] })
    expect(diffIssues([a], [none])[0]).toMatchObject({ fields: ['project'] })
    // A renamed project with the same id is not a change to this issue.
    expect(diffIssues([a], [makeIssue({ project: { id: 'p1', name: 'Renamed' } })])).toHaveLength(0)
  })

  it('detects a milestone move', () => {
    const none = makeIssue({ project: { id: 'p1', name: 'A' } })
    const m = makeIssue({
      project: { id: 'p1', name: 'A' },
      projectMilestone: { id: 'm1', name: 'M1', targetDate: null, sortOrder: null },
    })
    expect(diffIssues([none], [m])[0]).toMatchObject({ fields: ['milestone'] })
    expect(diffIssues([m], [none])[0]).toMatchObject({ fields: ['milestone'] })
  })

  it('detects a due date being set, changed, and cleared', () => {
    const none = makeIssue({})
    const d1 = makeIssue({ dueDate: '2026-10-01' })
    const d2 = makeIssue({ dueDate: '2026-10-08' })
    expect(diffIssues([none], [d1])[0]).toMatchObject({ fields: ['dueDate'] })
    expect(diffIssues([d1], [d2])[0]).toMatchObject({ fields: ['dueDate'] })
    expect(diffIssues([d1], [none])[0]).toMatchObject({ fields: ['dueDate'] })
  })

  it('reports several moved fields on one issue as one change', () => {
    const before = makeIssue({ state: { name: 'Todo', type: 'unstarted' }, priority: 2 })
    const after = makeIssue({ state: { name: 'Done', type: 'completed' }, priority: 1 })
    const out = diffIssues([before], [after])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ fields: ['state', 'priority'] })
  })
})

describe('diffIssues — comments', () => {
  it('reports a first comment and a newer comment', () => {
    const none = makeIssue({})
    const first = makeIssue({ lastCommentAt: '2026-09-02T00:00:00.000Z' })
    const later = makeIssue({ lastCommentAt: '2026-09-03T00:00:00.000Z' })
    expect(diffIssues([none], [first])[0]).toMatchObject({ fields: ['comment'] })
    expect(diffIssues([first], [later])[0]).toMatchObject({ fields: ['comment'] })
  })

  it('stays silent when the newest comment goes away', () => {
    // lastCommentAt moves backwards when the newest comment is deleted.
    // "A comment vanished" is not worth interrupting anyone for.
    const later = makeIssue({ lastCommentAt: '2026-09-03T00:00:00.000Z' })
    const first = makeIssue({ lastCommentAt: '2026-09-02T00:00:00.000Z' })
    expect(diffIssues([later], [first])).toHaveLength(0)
    expect(diffIssues([later], [makeIssue({})])).toHaveLength(0)
  })
})

describe('diffIssues — deliberate silences', () => {
  it('ignores updatedAt moving on its own', () => {
    // A relation pointed AT an issue bumps updatedAt (see linkTouch.ts).
    // Keying the diff on it would flood the user with phantom changes.
    const before = makeIssue({ updatedAt: '2026-09-01T00:00:00.000Z' })
    const after = makeIssue({ updatedAt: '2026-09-09T00:00:00.000Z' })
    expect(diffIssues([before], [after])).toHaveLength(0)
  })

  it('ignores relation changes', () => {
    const before = makeIssue({ relations: [] })
    const after = makeIssue({
      relations: [{ type: 'blocks', targetIdentifier: 'ENG-9' }],
    })
    expect(diffIssues([before], [after])).toHaveLength(0)
  })

  it('reports nothing when an issue disappears', () => {
    // The 24h reconcile runs deleteIssuesNotIn, so "disappeared" fires for
    // housekeeping far more often than for anything a person did.
    const a = makeIssue({ identifier: 'ENG-1' })
    const b = makeIssue({ identifier: 'ENG-2' })
    expect(diffIssues([a, b], [a])).toHaveLength(0)
  })

  it('reports nothing for two identical snapshots', () => {
    const list = [makeIssue({ identifier: 'ENG-1' }), makeIssue({ identifier: 'ENG-2' })]
    expect(diffIssues(list, list)).toHaveLength(0)
  })
})

describe('diffIssues — gate support', () => {
  it('carries both before and after so the scope gate can test each', () => {
    // The scope gate must notify when an issue moves INTO a filtered-out
    // state, so it runs applyFilters over both sides. That is only possible
    // if the change carries both issues, not just the field names.
    const before = makeIssue({ state: { name: 'Todo', type: 'unstarted' } })
    const after = makeIssue({ state: { name: 'Done', type: 'completed' } })
    const out = diffIssues([before], [after])
    expect(out[0]?.before).toBe(before)
    expect(out[0]?.after).toBe(after)
  })
})

describe('diffIssues — short "what it became"', () => {
  it('names the new state, assignee, project, milestone and due date', () => {
    const before = makeIssue({})
    const after = makeIssue({
      state: { name: 'In Review', type: 'started' },
      assignee: { id: 'u1', displayName: 'Shawn' },
      project: { id: 'p1', name: 'Core API' },
      projectMilestone: { id: 'm1', name: 'M2', targetDate: null, sortOrder: null },
      dueDate: '2026-10-08',
    })
    const out = diffIssues([before], [after])
    expect(out[0]).toMatchObject({
      to: {
        state: 'In Review',
        assignee: 'Shawn',
        project: 'Core API',
        milestone: 'M2',
        // Year trimmed — noise on a one-line summary.
        dueDate: '10-08',
      },
    })
  })

  it('uses null for a cleared field, which the UI renders as an em dash', () => {
    const before = makeIssue({
      assignee: { id: 'u1', displayName: 'Shawn' },
      dueDate: '2026-10-08',
      project: { id: 'p1', name: 'Core API' },
    })
    const after = makeIssue({})
    expect(out(before, after)).toMatchObject({
      to: { assignee: null, dueDate: null, project: null },
    })
  })

  it('renders labels as a signed delta, not the resulting set', () => {
    const before = makeIssue({ labels: [label('keep'), label('drop')] })
    const after = makeIssue({ labels: [label('keep'), label('add')] })
    expect(out(before, after).to?.labels).toBe('+add −drop')
  })

  it('carries priority as the raw number for the component to localise', () => {
    expect(out(makeIssue({ priority: 2 }), makeIssue({ priority: 1 })).to?.priority).toBe('1')
    // 0 is "No priority", a value someone picks — not a cleared field.
    expect(out(makeIssue({ priority: 2 }), makeIssue({ priority: 0 })).to?.priority).toBe('0')
  })

  it('offers no value for a rename or a comment', () => {
    // The row already shows the new title, and a comment's value is that it exists.
    expect(out(makeIssue({ title: 'a' }), makeIssue({ title: 'b' })).to).toEqual({})
    const commented = out(makeIssue({}), makeIssue({ lastCommentAt: '2026-09-02T00:00:00.000Z' }))
    expect(commented.to).toEqual({})
  })
})

function out(before: NormalizedIssue, after: NormalizedIssue) {
  const [first] = diffIssues([before], [after])
  if (!first || first.kind !== 'changed') throw new Error('expected one changed entry')
  return first
}
