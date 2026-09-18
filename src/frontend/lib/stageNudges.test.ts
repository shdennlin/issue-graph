// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type {
  GraphData,
  IssueStateType,
  LifecycleStageDTO,
  NormalizedIssue,
  WorkstreamSummaryDTO,
} from '@shared/types.js'
import {
  computeNudges,
  nudgeKey,
  pruneDismissals,
  readDismissals,
  stageAdvanceEvidence,
  writeDismissals,
} from './stageNudges'

const DAY = 86_400_000
const NOW = 1_800_000_000_000

function issue(identifier: string, name = 'In Progress', type: IssueStateType = 'started'): NormalizedIssue {
  return {
    id: identifier,
    identifier,
    title: identifier,
    url: '',
    priority: 0,
    state: { name, type },
    assignee: null,
    labels: [],
    parent: null,
    children: [],
    relations: [],
    createdAt: '',
    updatedAt: '',
    completedAt: null,
  }
}

function stage(key: string, over: Partial<LifecycleStageDTO> = {}): LifecycleStageDTO {
  return {
    id: 1,
    key,
    name: key,
    sortOrder: 0,
    states: ['In Progress'],
    nextCommand: null,
    shows: [],
    staleAfterDays: null,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

function ws(id: number, over: Partial<WorkstreamSummaryDTO> = {}): WorkstreamSummaryDTO {
  return {
    id,
    name: `W${id}`,
    members: [],
    stage: 'impl',
    stageEnteredAt: NOW - DAY,
    stageEvents: [],
    status: 'active',
    assignees: [],
    notes: {},
    links: [],
    ...over,
  }
}

function graph(over: Partial<GraphData> = {}): GraphData {
  return { issues: [], labels: [], fetchedAt: 0, lifecycle: [stage('impl')], workstreams: [], ...over }
}

describe('stageAdvanceEvidence — proof, not suspicion', () => {
  const impl = stage('impl', { states: ['In Progress'] })

  it('fires when every member is finished and the stage expects something else', () => {
    expect(stageAdvanceEvidence([issue('A-1', 'Done', 'completed')], impl)).toBe(true)
  })

  it('counts a canceled member as finished', () => {
    // Canceled work is not coming back, so it cannot be what the stage is
    // waiting for.
    expect(stageAdvanceEvidence([issue('A-1', 'Canceled', 'canceled')], impl)).toBe(true)
  })

  it('stays silent while any member is unfinished', () => {
    expect(stageAdvanceEvidence([issue('A-1', 'Done', 'completed'), issue('A-2')], impl)).toBe(false)
  })

  it('stays silent on a stage that EXPECTS finished members', () => {
    // The rule this replaced excluded only the last stage, so a mid-pipeline
    // "Waiting merge" that expects Done — while its PR is still open — fired on
    // every workstream that reached it. A nudge that cries wolf trains people
    // to dismiss all of them.
    const waitingMerge = stage('merge', { states: ['Done'] })
    expect(stageAdvanceEvidence([issue('A-1', 'Done', 'completed')], waitingMerge)).toBe(false)
  })

  it('stays silent on a stage that expects any state at all', () => {
    // An empty `states` has opted out of the comparison entirely.
    expect(stageAdvanceEvidence([issue('A-1', 'Done', 'completed')], stage('x', { states: [] }))).toBe(false)
  })

  it('stays silent for a workstream with no members', () => {
    expect(stageAdvanceEvidence([], impl)).toBe(false)
  })
})

describe('computeNudges', () => {
  it('nudges when a workstream outsits its stage threshold', () => {
    const data = graph({
      lifecycle: [stage('impl', { staleAfterDays: 3 })],
      workstreams: [ws(1, { stageEnteredAt: NOW - 5 * DAY })],
    })
    expect(computeNudges(data, NOW)).toMatchObject([{ workstreamId: 1, kind: 'stale', days: 5 }])
  })

  it('never nudges on a stage with no threshold', () => {
    // Null is the honest setting for a Discuss stage that legitimately runs for
    // a fortnight, and it has to mean silence rather than some default.
    const data = graph({
      lifecycle: [stage('impl', { staleAfterDays: null })],
      workstreams: [ws(1, { stageEnteredAt: NOW - 400 * DAY })],
    })
    expect(computeNudges(data, NOW)).toEqual([])
  })

  it('prefers evidence over staleness for one workstream', () => {
    // Both are true here. Saying both about one row is saying it twice, and
    // "the stage is provably behind" is the better reason to go and look.
    const data = graph({
      issues: [issue('A-1', 'Done', 'completed')],
      lifecycle: [stage('impl', { staleAfterDays: 1 })],
      workstreams: [ws(1, { members: ['A-1'], stageEnteredAt: NOW - 9 * DAY })],
    })
    const out = computeNudges(data, NOW)
    expect(out).toHaveLength(1)
    expect(out[0]?.kind).toBe('evidence')
  })

  it('sorts evidence first, then by how long it has been stuck', () => {
    const data = graph({
      issues: [issue('A-1', 'Done', 'completed')],
      lifecycle: [stage('impl', { staleAfterDays: 1 })],
      workstreams: [
        ws(1, { stageEnteredAt: NOW - 2 * DAY }),
        ws(2, { stageEnteredAt: NOW - 30 * DAY }),
        ws(3, { members: ['A-1'], stageEnteredAt: NOW - 2 * DAY }),
      ],
    })
    expect(computeNudges(data, NOW).map((n) => [n.workstreamId, n.kind])).toEqual([
      [3, 'evidence'],
      [2, 'stale'],
      [1, 'stale'],
    ])
  })

  it('withholds evidence when a member is outside the synced range', () => {
    // An uncached member may be finished or untouched. Guessing would produce
    // exactly the false nudge that teaches people to ignore the bell.
    const data = graph({
      issues: [issue('A-1', 'Done', 'completed')],
      lifecycle: [stage('impl', { staleAfterDays: null })],
      workstreams: [ws(1, { members: ['A-1', 'GONE-9'] })],
    })
    expect(computeNudges(data, NOW)).toEqual([])
  })

  it('says nothing about an archived workstream', () => {
    // Archiving IS "stop showing me this"; nudging would take that back.
    const data = graph({
      lifecycle: [stage('impl', { staleAfterDays: 1 })],
      workstreams: [ws(1, { status: 'archived', stageEnteredAt: NOW - 99 * DAY })],
    })
    expect(computeNudges(data, NOW)).toEqual([])
  })

  it('says nothing about a workstream that is on no stage', () => {
    const data = graph({
      lifecycle: [stage('impl', { staleAfterDays: 1 })],
      workstreams: [ws(1, { stage: null, stageEnteredAt: null })],
    })
    expect(computeNudges(data, NOW)).toEqual([])
  })

  it('says nothing when no lifecycle is configured', () => {
    expect(computeNudges(graph({ lifecycle: [] }), NOW)).toEqual([])
  })

  it('drops a dismissed nudge', () => {
    const data = graph({
      lifecycle: [stage('impl', { staleAfterDays: 1 })],
      workstreams: [ws(1, { stageEnteredAt: NOW - 9 * DAY })],
    })
    const key = nudgeKey(1, 'impl', 'stale')
    expect(computeNudges(data, NOW, new Set([key]))).toEqual([])
  })

  it('brings the nudge back once the workstream moves on', () => {
    // A dismiss means "I know, not now" — never "stop telling me about this
    // workstream". The stage is part of the key, so moving changes it.
    const dismissed = new Set([nudgeKey(1, 'impl', 'stale')])
    const data = graph({
      lifecycle: [stage('impl', { staleAfterDays: 1 }), stage('review', { staleAfterDays: 1, sortOrder: 1 })],
      workstreams: [ws(1, { stage: 'review', stageEnteredAt: NOW - 9 * DAY })],
    })
    expect(computeNudges(data, NOW, dismissed)).toHaveLength(1)
  })
})

describe('pruneDismissals', () => {
  it('keeps keys whose workstream still exists and drops the rest', () => {
    const dismissed = new Set([nudgeKey(1, 'impl', 'stale'), nudgeKey(99, 'impl', 'stale')])
    expect(pruneDismissals(dismissed, [ws(1)])).toEqual([nudgeKey(1, 'impl', 'stale')])
  })

  it('keeps a key for a stage that no longer exists, since the workstream does', () => {
    // The stage half is allowed to be stale: the workstream may move back onto
    // a recreated stage, and forgetting the dismissal is harmless either way.
    const dismissed = new Set([nudgeKey(1, 'deleted-stage', 'evidence')])
    expect(pruneDismissals(dismissed, [ws(1)])).toHaveLength(1)
  })
})

describe('dismissal persistence', () => {
  it('round-trips, and reads nothing for an unknown workspace', () => {
    writeDismissals('alpha', [nudgeKey(1, 'impl', 'stale')])
    expect([...readDismissals('alpha')]).toEqual([nudgeKey(1, 'impl', 'stale')])
    expect(readDismissals('beta').size).toBe(0)
  })

  it('keeps workspaces apart', () => {
    // Workstream ids restart per workspace, so a shared key would quiet an
    // unrelated workstream that merely shares a number.
    writeDismissals('alpha', [nudgeKey(1, 'impl', 'stale')])
    writeDismissals('beta', [nudgeKey(2, 'impl', 'stale')])
    expect([...readDismissals('alpha')]).toEqual([nudgeKey(1, 'impl', 'stale')])
    expect([...readDismissals('beta')]).toEqual([nudgeKey(2, 'impl', 'stale')])
  })

  it('discards a stored value it does not recognise', () => {
    // A stored value outlives the build that wrote it.
    localStorage.setItem('ig-stage-nudge-dismissed:alpha', JSON.stringify({ version: 99, keys: ['x'] }))
    expect(readDismissals('alpha').size).toBe(0)
    localStorage.setItem('ig-stage-nudge-dismissed:alpha', 'not json')
    expect(readDismissals('alpha').size).toBe(0)
  })

  it('reads nothing rather than throwing with no workspace', () => {
    expect(readDismissals(null).size).toBe(0)
    expect(() => writeDismissals(null, ['x'])).not.toThrow()
  })
})
