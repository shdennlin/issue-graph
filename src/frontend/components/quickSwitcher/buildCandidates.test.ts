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
