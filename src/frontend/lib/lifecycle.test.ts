import { describe, it, expect } from 'vitest'
import type { IssueStageDTO, LifecycleStageDTO } from '@shared/types'
import {
  EMPTY_STAGE_VIEW,
  indexLifecycle,
  indexStages,
  nextStage,
  stageUsage,
  stageVerdict,
  stageViewFor,
} from './lifecycle'

const stage = (
  key: string,
  states: string[],
  sortOrder: number,
  nextCommand: string | null = null,
): LifecycleStageDTO => ({
  id: sortOrder + 1,
  key,
  name: key,
  sortOrder,
  states,
  nextCommand,
  createdAt: 0,
  updatedAt: 0,
})

const LIFECYCLE = [
  stage('spec', ['Review Spec'], 0, '/spectra-apply'),
  stage('impl', ['In Progress'], 1, '/spectra-verify'),
  stage('review', ['In Review'], 2),
  stage('parked', [], 3),
]

const assign = (identifier: string, stageKey: string): IssueStageDTO => ({
  identifier,
  stageKey,
  updatedAt: 0,
  updatedBy: null,
})

const issue = (identifier: string, stateName: string) =>
  ({ identifier, state: { name: stateName, type: 'started' } }) as const

const views = (stages: IssueStageDTO[], lifecycle = LIFECYCLE) => ({
  byIssue: indexStages(stages),
  byKey: indexLifecycle(lifecycle),
  ordered: lifecycle,
})

describe('stageVerdict', () => {
  it('agrees when the state is listed, case- and space-insensitively', () => {
    expect(stageVerdict({ states: ['In Progress'] }, 'In Progress')).toBe('ok')
    expect(stageVerdict({ states: ['In Progress'] }, '  in progress ')).toBe('ok')
  })

  it('reports a conflict when the stage names states and this is not one', () => {
    // The live case: Linear's GitHub automation moves an issue to Done when the
    // FIRST of several cross-repo PRs merges, while the stage still says the
    // work is in flight. Both writers are legitimate, so the app shows the
    // disagreement rather than picking one.
    expect(stageVerdict({ states: ['In Progress'] }, 'Done')).toBe('conflict')
  })

  it('never conflicts when the stage constrains nothing', () => {
    expect(stageVerdict({ states: [] }, 'Done')).toBe('ok')
  })

  it('is unknown — not a conflict — without a stage', () => {
    // On a freshly configured lifecycle every issue is unstaged. Reading that
    // as a conflict would light up the entire graph and mean nothing.
    expect(stageVerdict(null, 'Done')).toBe('unknown')
    expect(stageVerdict(undefined, 'Done')).toBe('unknown')
  })

  it('is unknown when the Linear state is missing or blank', () => {
    expect(stageVerdict({ states: ['In Progress'] }, null)).toBe('unknown')
    expect(stageVerdict({ states: ['In Progress'] }, '   ')).toBe('unknown')
  })
})

describe('stageViewFor', () => {
  it('resolves a stage with its position and next command', () => {
    const { byIssue, byKey, ordered } = views([assign('ONE-1', 'impl')])
    const v = stageViewFor(issue('ONE-1', 'In Progress'), byIssue, byKey, ordered)
    expect(v.stage?.key).toBe('impl')
    expect(v.verdict).toBe('ok')
    expect(v.nextCommand).toBe('/spectra-verify')
    expect(v.position).toBe(2)
    expect(v.total).toBe(4)
  })

  it('surfaces a conflict without altering either side', () => {
    const { byIssue, byKey, ordered } = views([assign('ONE-1', 'impl')])
    const v = stageViewFor(issue('ONE-1', 'Done'), byIssue, byKey, ordered)
    expect(v.verdict).toBe('conflict')
    // The stage is still reported as-is — the view never silently re-points it
    // at whatever stage would have matched the Linear state.
    expect(v.stage?.key).toBe('impl')
  })

  it('reports an unstaged issue as unknown, still carrying the pipeline size', () => {
    const { byIssue, byKey, ordered } = views([])
    const v = stageViewFor(issue('ONE-1', 'In Progress'), byIssue, byKey, ordered)
    expect(v).toEqual({ ...EMPTY_STAGE_VIEW, total: 4 })
  })

  it('degrades to unknown when the stage key no longer resolves', () => {
    // A deleted stage leaves its assignments behind on purpose, so they come
    // back if the key is re-created. Until then the issue is unclassified, not
    // in conflict.
    const { byIssue, byKey, ordered } = views([assign('ONE-1', 'deleted-stage')])
    const v = stageViewFor(issue('ONE-1', 'In Progress'), byIssue, byKey, ordered)
    expect(v.stage).toBeNull()
    expect(v.verdict).toBe('unknown')
  })

  it('treats a stage that constrains nothing as agreeing with any state', () => {
    const { byIssue, byKey, ordered } = views([assign('ONE-1', 'parked')])
    expect(stageViewFor(issue('ONE-1', 'Canceled'), byIssue, byKey, ordered).verdict).toBe('ok')
  })

  it('copes with an empty lifecycle', () => {
    const { byIssue, byKey } = views([assign('ONE-1', 'impl')], [])
    const v = stageViewFor(issue('ONE-1', 'In Progress'), byIssue, byKey, [])
    expect(v.stage).toBeNull()
    expect(v.total).toBe(0)
  })
})

describe('nextStage', () => {
  it('returns the following stage in pipeline order', () => {
    expect(nextStage(LIFECYCLE[1] ?? null, LIFECYCLE)?.key).toBe('review')
  })

  it('returns null at the end of the pipeline', () => {
    expect(nextStage(LIFECYCLE[3] ?? null, LIFECYCLE)).toBeNull()
  })

  it('returns null for no current stage or an unknown one', () => {
    expect(nextStage(null, LIFECYCLE)).toBeNull()
    expect(nextStage(stage('ghost', [], 9), LIFECYCLE)).toBeNull()
  })
})

describe('stageUsage', () => {
  it('counts assignments per stage key', () => {
    const counts = stageUsage([assign('ONE-1', 'impl'), assign('ONE-2', 'impl'), assign('ONE-3', 'spec')])
    expect(counts.get('impl')).toBe(2)
    expect(counts.get('spec')).toBe(1)
    expect(counts.get('review')).toBeUndefined()
  })

  it('handles an absent list', () => {
    expect(stageUsage(undefined).size).toBe(0)
  })
})

describe('indexers', () => {
  it('tolerate undefined input', () => {
    expect(indexStages(undefined).size).toBe(0)
    expect(indexLifecycle(undefined).size).toBe(0)
  })
})
