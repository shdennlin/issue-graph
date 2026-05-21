import { describe, expect, it } from 'vitest'
import {
  coerceProjectStateType,
  coerceStateType,
  normalizeIssue,
  normalizeProjectDetail,
  normalizeRelations,
  normalizeLabel,
} from './normalize.js'

describe('coerceStateType', () => {
  it("maps 'cancelled' (en-GB) → 'canceled' so workflowStates lookups stay safe", () => {
    expect(coerceStateType('cancelled')).toBe('canceled')
  })

  it('falls back to backlog for unknown values (FilterPanel groups lookup would otherwise crash)', () => {
    expect(coerceStateType('weird-new-type')).toBe('backlog')
    expect(coerceStateType(undefined)).toBe('backlog')
    expect(coerceStateType(null)).toBe('backlog')
  })
})

describe('normalizeRelations', () => {
  it('keeps blocks edges as-is', () => {
    const out = normalizeRelations([{ type: 'blocks', relatedIssue: { identifier: 'PROJ-2' } }])
    expect(out).toEqual([{ type: 'blocks', targetIdentifier: 'PROJ-2' }])
  })

  it('drops blocked_by edges (already represented by other side)', () => {
    const out = normalizeRelations([{ type: 'blocked_by', relatedIssue: { identifier: 'PROJ-1' } }])
    expect(out).toEqual([])
  })

  it('keeps duplicate and related symmetric edges', () => {
    const out = normalizeRelations([
      { type: 'duplicate', relatedIssue: { identifier: 'PROJ-3' } },
      { type: 'related', relatedIssue: { identifier: 'PROJ-4' } },
    ])
    expect(out).toEqual([
      { type: 'duplicate', targetIdentifier: 'PROJ-3' },
      { type: 'related', targetIdentifier: 'PROJ-4' },
    ])
  })

  it('dedupes within the same issue', () => {
    const out = normalizeRelations([
      { type: 'blocks', relatedIssue: { identifier: 'PROJ-2' } },
      { type: 'blocks', relatedIssue: { identifier: 'PROJ-2' } },
    ])
    expect(out).toEqual([{ type: 'blocks', targetIdentifier: 'PROJ-2' }])
  })

  it('handles empty / null input', () => {
    expect(normalizeRelations([])).toEqual([])
    expect(normalizeRelations(undefined)).toEqual([])
    expect(normalizeRelations(null)).toEqual([])
  })

  it('skips relations with missing targets', () => {
    expect(normalizeRelations([{ type: 'blocks', relatedIssue: null }])).toEqual([])
  })

  it('Linear pair: A blocks B, B blocked_by A → only A→B kept', () => {
    const aRels = normalizeRelations([{ type: 'blocks', relatedIssue: { identifier: 'B' } }])
    const bRels = normalizeRelations([{ type: 'blocked_by', relatedIssue: { identifier: 'A' } }])
    expect(aRels).toHaveLength(1)
    expect(bRels).toHaveLength(0)
  })
})

describe('normalizeLabel', () => {
  it('flattens parent into group', () => {
    const lab = normalizeLabel({ id: '1', name: 'foo', color: '#fff', parent: { id: 'p1', name: 'service' } })
    expect(lab.group?.name).toBe('service')
    expect(lab.group?.exclusive).toBe(true)
  })

  it('returns null group when no parent', () => {
    const lab = normalizeLabel({ id: '1', name: 'foo', color: '#fff' })
    expect(lab.group).toBeNull()
  })
})

describe('coerceProjectStateType', () => {
  it('passes through canonical values', () => {
    expect(coerceProjectStateType('backlog')).toBe('backlog')
    expect(coerceProjectStateType('planned')).toBe('planned')
    expect(coerceProjectStateType('started')).toBe('started')
    expect(coerceProjectStateType('paused')).toBe('paused')
    expect(coerceProjectStateType('completed')).toBe('completed')
    expect(coerceProjectStateType('canceled')).toBe('canceled')
  })

  it("maps 'cancelled' (en-GB) → 'canceled'", () => {
    expect(coerceProjectStateType('cancelled')).toBe('canceled')
  })

  it('falls back to backlog for unknown / missing input', () => {
    expect(coerceProjectStateType('mystery')).toBe('backlog')
    expect(coerceProjectStateType(undefined)).toBe('backlog')
    expect(coerceProjectStateType(null)).toBe('backlog')
  })

  it('is case-insensitive', () => {
    expect(coerceProjectStateType('Planned')).toBe('planned')
    expect(coerceProjectStateType('IN PROGRESS')).toBe('backlog') // not a value Linear sends; tested to confirm we don't try to "smart-map"
  })
})

describe('normalizeProjectDetail', () => {
  it('extracts canonical fields from a full Linear payload', () => {
    const detail = normalizeProjectDetail({
      id: 'proj-1',
      state: 'started',
      progress: 0.42,
      lead: { displayName: 'Shawn' },
      startDate: '2026-01-01',
      targetDate: '2026-06-30',
      description: 'Refactor X',
      content: '# Heading\n\nLong markdown body…',
      projectUpdates: {
        nodes: [
          { id: 'u1', body: 'Going well', createdAt: '2026-05-01', user: { displayName: 'Shawn' }, health: 'onTrack' },
        ],
      },
      projectMilestones: {
        nodes: [
          { id: 'm1', name: 'Alpha', targetDate: '2026-02-01', sortOrder: 1, description: 'Cut alpha build' },
          { id: 'm2', name: 'Beta', targetDate: null, sortOrder: 2 },
        ],
      },
    })

    expect(detail.id).toBe('proj-1')
    expect(detail.state).toBe('started')
    expect(detail.progress).toBe(0.42)
    expect(detail.lead?.displayName).toBe('Shawn')
    expect(detail.startDate).toBe('2026-01-01')
    expect(detail.targetDate).toBe('2026-06-30')
    expect(detail.description).toBe('Refactor X')
    expect(detail.content).toBe('# Heading\n\nLong markdown body…')
    expect(detail.updates).toHaveLength(1)
    expect(detail.updates[0]).toMatchObject({ id: 'u1', userName: 'Shawn', health: 'onTrack' })
    expect(detail.milestones).toHaveLength(2)
    expect(detail.milestones[0]).toMatchObject({ id: 'm1', name: 'Alpha', sortOrder: 1, description: 'Cut alpha build' })
    expect(detail.milestones[1]?.description).toBeNull()
  })

  it('handles missing / null collections gracefully', () => {
    const detail = normalizeProjectDetail({ id: 'proj-2', state: 'backlog', progress: 0 })
    expect(detail.lead).toBeNull()
    expect(detail.startDate).toBeNull()
    expect(detail.targetDate).toBeNull()
    expect(detail.description).toBeNull()
    expect(detail.content).toBeNull()
    expect(detail.updates).toEqual([])
    expect(detail.milestones).toEqual([])
  })

  it('coerces invalid progress to 0 and unknown state to backlog', () => {
    const detail = normalizeProjectDetail({ id: 'p', state: 'made-up', progress: 'not-a-number' })
    expect(detail.state).toBe('backlog')
    expect(detail.progress).toBe(0)
  })

  it('clamps progress to [0, 1]', () => {
    expect(normalizeProjectDetail({ id: 'p', state: 'backlog', progress: -0.5 }).progress).toBe(0)
    expect(normalizeProjectDetail({ id: 'p', state: 'backlog', progress: 1.5 }).progress).toBe(1)
  })
})

describe('normalizeIssue', () => {
  it('coerces unknown state types to backlog', () => {
    const i = normalizeIssue({
      id: 'x',
      identifier: 'X-1',
      title: 't',
      url: 'u',
      priority: 0,
      state: { name: 'Weird', type: 'mystery' },
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
    })
    expect(i.state.type).toBe('backlog')
  })

  it("translates 'cancelled' (en-GB) to 'canceled' (canonical)", () => {
    const i = normalizeIssue({
      id: 'x',
      identifier: 'X-1',
      title: 't',
      url: 'u',
      priority: 0,
      state: { name: 'Cancelled', type: 'cancelled' },
    })
    expect(i.state.type).toBe('canceled')
  })

  it('extracts children identifiers', () => {
    const i = normalizeIssue({
      id: 'x',
      identifier: 'X-1',
      title: 't',
      url: 'u',
      priority: 0,
      state: { name: 'Backlog', type: 'backlog' },
      children: { nodes: [{ identifier: 'Y-1' }, { identifier: 'Y-2' }] },
    })
    expect(i.children).toEqual(['Y-1', 'Y-2'])
  })
})
