import { describe, it, expect } from 'vitest'
import { buildCandidates } from './buildCandidates'
import type { NormalizedIssue, NoteDTO, GraphResponse } from '@shared/types.js'

function issue(id: string, identifier: string, title: string): NormalizedIssue {
  return {
    id, identifier, title,
    url: '', priority: 0 as any,
    state: { name: 'Backlog', type: 'backlog' as any },
    assignee: null, labels: [], parent: null, children: [], relations: [],
    createdAt: '', updatedAt: '', completedAt: null,
  } as NormalizedIssue
}

function graph(issues: NormalizedIssue[]): GraphResponse {
  return { data: { issues, labels: [] } } as unknown as GraphResponse
}

describe('buildCandidates', () => {
  it('flattens issues across tabs with scope labels', () => {
    const candidates = buildCandidates({
      tabs: [{ id: 't1', workspaceId: 'w1' }, { id: 't2', workspaceId: 'w2' }],
      activeTabId: 't1',
      workspaceName: (id) => (id === 'w1' ? 'Alpha' : 'Beta'),
      activeGraph: graph([issue('a', 'ONE-1', 'Fix login')]),
      snapshotGraph: (tid) => (tid === 't2' ? graph([issue('b', 'TWO-1', 'Bug')]) : null),
      notesByTab: { t1: [], t2: [] },
    })
    const issues = candidates.filter((c) => c.kind === 'issue')
    expect(issues).toHaveLength(2)
    expect(issues.find((c) => c.label.includes('ONE-1'))?.scopeLabel).toBe('Alpha')
    expect(issues.find((c) => c.label.includes('TWO-1'))?.scopeLabel).toBe('Beta')
  })

  it('emits a tab candidate for each open tab', () => {
    const candidates = buildCandidates({
      tabs: [{ id: 't1', workspaceId: 'w1' }],
      activeTabId: 't1',
      workspaceName: () => 'Alpha',
      activeGraph: null,
      snapshotGraph: () => null,
      notesByTab: { t1: [] },
    })
    expect(candidates.filter((c) => c.kind === 'tab')).toHaveLength(1)
  })

  it('derives note titles from the first non-empty line of body', () => {
    const note: NoteDTO = {
      id: 5, body: '\n  Plan for Q3\nDetails here', sortOrder: 0,
      archived: false, createdAt: 0, updatedAt: 0,
    }
    const [n] = buildCandidates({
      tabs: [{ id: 't1', workspaceId: 'w1' }],
      activeTabId: 't1',
      workspaceName: () => 'Alpha',
      activeGraph: null,
      snapshotGraph: () => null,
      notesByTab: { t1: [note] },
    }).filter((c) => c.kind === 'note')
    expect(n!.label).toBe('Plan for Q3')
  })

  it('skips archived notes', () => {
    const note: NoteDTO = {
      id: 5, body: 'Title', sortOrder: 0,
      archived: true, createdAt: 0, updatedAt: 0,
    }
    const cs = buildCandidates({
      tabs: [{ id: 't1', workspaceId: 'w1' }],
      activeTabId: 't1',
      workspaceName: () => 'Alpha',
      activeGraph: null,
      snapshotGraph: () => null,
      notesByTab: { t1: [note] },
    })
    expect(cs.filter((c) => c.kind === 'note')).toHaveLength(0)
  })
})

// Reported: every issue appeared twice in the palette. Two tabs were open on
// the same workspace — a supported setup, since tabs keep independent filters —
// and candidates are built one tab at a time, so each issue was emitted once
// per tab. The rows were indistinguishable: `scopeLabel` is the workspace name,
// which is by definition the same for both.
describe('buildCandidates — two tabs on one workspace', () => {
  const both = {
    tabs: [{ id: 't1', workspaceId: 'w1' }, { id: 't2', workspaceId: 'w1' }],
    workspaceName: () => 'Alpha',
    notesByTab: { t1: [], t2: [] },
  }
  const sameIssues = graph([issue('a', 'ONE-1', 'Fix login')])

  it('offers one row per issue, not one per tab', () => {
    const candidates = buildCandidates({
      ...both,
      activeTabId: 't1',
      activeGraph: sameIssues,
      snapshotGraph: () => sameIssues,
    })
    expect(candidates.filter((c) => c.kind === 'issue')).toHaveLength(1)
  })

  // Which copy survives is not arbitrary: opening the issue should land in the
  // tab you are already looking at.
  it('keeps the active tab’s copy', () => {
    const candidates = buildCandidates({
      ...both,
      activeTabId: 't2',
      activeGraph: sameIssues,
      snapshotGraph: () => sameIssues,
    })
    expect(candidates.find((c) => c.kind === 'issue')?.tabId).toBe('t2')
  })

  // When the active tab is on a different workspace there is no copy to prefer,
  // so the first tab holding it wins — deterministically.
  it('falls back to the first tab holding the issue', () => {
    const candidates = buildCandidates({
      tabs: [{ id: 't0', workspaceId: 'w9' }, { id: 't1', workspaceId: 'w1' }, { id: 't2', workspaceId: 'w1' }],
      activeTabId: 't0',
      workspaceName: (id) => (id === 'w9' ? 'Other' : 'Alpha'),
      activeGraph: graph([]),
      snapshotGraph: () => sameIssues,
      notesByTab: {},
    })
    const rows = candidates.filter((c) => c.kind === 'issue')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.tabId).toBe('t1')
  })

  // The dimension that is NOT a duplicate: the same identifier in two different
  // workspaces is two different issues, and the scope label tells them apart.
  it('keeps the same identifier from two different workspaces', () => {
    const candidates = buildCandidates({
      tabs: [{ id: 't1', workspaceId: 'w1' }, { id: 't2', workspaceId: 'w2' }],
      activeTabId: 't1',
      workspaceName: (id) => (id === 'w1' ? 'Alpha' : 'Beta'),
      activeGraph: sameIssues,
      snapshotGraph: () => sameIssues,
      notesByTab: {},
    })
    expect(candidates.filter((c) => c.kind === 'issue')).toHaveLength(2)
  })
})
