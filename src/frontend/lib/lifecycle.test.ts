import { describe, it, expect } from 'vitest'
import type { LifecycleStageDTO } from '@shared/types'
import { indexLifecycle, stageVerdict } from './lifecycle'

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
  shows: [],
  staleAfterDays: null,
  createdAt: 0,
  updatedAt: 0,
})

const LIFECYCLE = [
  stage('spec', ['Review Spec'], 0, '/spectra-apply'),
  stage('impl', ['In Progress'], 1, '/spectra-verify'),
  stage('review', ['In Review'], 2),
  stage('parked', [], 3),
]

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


describe('indexLifecycle', () => {
  it('keys stages by their slug and tolerates no input', () => {
    const map = indexLifecycle(LIFECYCLE)
    expect(map.get('impl')?.name).toBe('impl')
    expect(map.get('nope')).toBeUndefined()
    expect(indexLifecycle(undefined).size).toBe(0)
  })
})
