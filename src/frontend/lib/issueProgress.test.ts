import { describe, expect, it } from 'vitest'
import type { IssueStateType, NormalizedIssue } from '@shared/types.js'
import { isCountedInTotal, isDoneState, rollupProgress } from './issueProgress'

function fakeIssue(state: IssueStateType): NormalizedIssue {
  return {
    id: 'x',
    identifier: 'X-1',
    title: '',
    state: { type: state, name: state },
    priority: 0,
    project: null,
    projectMilestone: null,
    relations: [],
    labels: [],
  } as unknown as NormalizedIssue
}

describe('isDoneState', () => {
  it('only completed is done', () => {
    expect(isDoneState('completed')).toBe(true)
    expect(isDoneState('canceled')).toBe(false)
    expect(isDoneState('started')).toBe(false)
    expect(isDoneState('backlog')).toBe(false)
  })
})

describe('isCountedInTotal', () => {
  it('excludes canceled, includes everything else', () => {
    expect(isCountedInTotal('canceled')).toBe(false)
    expect(isCountedInTotal('completed')).toBe(true)
    expect(isCountedInTotal('started')).toBe(true)
    expect(isCountedInTotal('backlog')).toBe(true)
    expect(isCountedInTotal('unstarted')).toBe(true)
    expect(isCountedInTotal('triage')).toBe(true)
  })
})

describe('rollupProgress', () => {
  it('counts completed as done, ignores canceled in both done and total', () => {
    const issues = [
      fakeIssue('completed'),
      fakeIssue('started'),
      fakeIssue('canceled'),
      fakeIssue('canceled'),
      fakeIssue('backlog'),
    ]
    // 3 counted (completed + started + backlog), 1 done (completed)
    expect(rollupProgress(issues)).toEqual({ done: 1, total: 3 })
  })

  it('all-canceled milestone reads 0/0', () => {
    const issues = [fakeIssue('canceled'), fakeIssue('canceled')]
    expect(rollupProgress(issues)).toEqual({ done: 0, total: 0 })
  })

  it('empty input returns 0/0', () => {
    expect(rollupProgress([])).toEqual({ done: 0, total: 0 })
  })
})
