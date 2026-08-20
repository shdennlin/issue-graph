import { describe, expect, it } from 'vitest'
import type { DetectedSchema, NormalizedIssue, NormalizedLabel } from '@shared/types.js'
import { labelForDimension, mixDimensions } from './mixGrouping'

function lab(id: string, name: string, group?: string): NormalizedLabel {
  return {
    id,
    name,
    color: '#000',
    group: group ? { id: `g-${group}`, name: group, exclusive: true } : null,
  }
}

function issueWith(identifier: string, labels: NormalizedLabel[]): NormalizedIssue {
  return {
    id: identifier,
    identifier,
    title: 't',
    url: 'u',
    priority: 0,
    state: { name: 'In Progress', type: 'started' },
    assignee: null,
    labels,
    parent: null,
    children: [],
    relations: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    completedAt: null,
  }
}

const svcA = lab('1', 'central', 'Service')
const svcB = lab('2', 'frontend', 'Service')
const typeA = lab('3', 'Bug', 'Type')
const riskA = lab('4', 'risk: migration')
const riskB = lab('5', 'risk: breaking-change')
const empty = lab('6', 'unused', 'Ghost')

const SCHEMA: DetectedSchema = {
  primaryGroup: 'Service',
  typeGroup: 'Type',
  prefixes: [{ token: 'risk', labels: [riskA, riskB] }],
  orphans: [],
  otherGroups: [{ name: 'Ghost', labels: [empty], exclusive: true }],
}

const ISSUES = [
  issueWith('A', [svcA, typeA, riskA, riskB]),
  issueWith('B', [svcB, riskA]),
  issueWith('C', []),
]

describe('mixDimensions', () => {
  it('offers every group and prefix that at least one issue uses', () => {
    expect(mixDimensions(ISSUES, SCHEMA).map((d) => d.key)).toEqual([
      'group:Service',
      'prefix:risk',
      'group:Type',
    ])
  })

  it('drops a dimension no issue carries a label for', () => {
    // 'Ghost' exists in the schema but buckets nothing — offering it would
    // reproduce the all-Unclassified failure this picker exists to fix.
    expect(mixDimensions(ISSUES, SCHEMA).map((d) => d.key)).not.toContain('group:Ghost')
  })

  it('reports how many issues each dimension classifies, most first', () => {
    expect(mixDimensions(ISSUES, SCHEMA).map((d) => [d.key, d.coverage])).toEqual([
      ['group:Service', 2],
      ['prefix:risk', 2],
      ['group:Type', 1],
    ])
  })

  it('titles a prefix dimension with its trailing colon', () => {
    const risk = mixDimensions(ISSUES, SCHEMA).find((d) => d.key === 'prefix:risk')
    expect(risk?.title).toBe('risk:')
  })
})

describe('labelForDimension', () => {
  const issueA = ISSUES[0]!

  it('falls back to the primary group when the key is null', () => {
    expect(labelForDimension(issueA, SCHEMA, null)?.name).toBe('central')
  })

  it('picks the label of the named group', () => {
    expect(labelForDimension(issueA, SCHEMA, 'group:Type')?.name).toBe('Bug')
  })

  it('picks a prefix label', () => {
    expect(labelForDimension(ISSUES[1]!, SCHEMA, 'prefix:risk')?.name).toBe('risk: migration')
  })

  it('takes the alphabetically first label when a dimension yields several', () => {
    // React Flow gives a node exactly one parent, so an issue lands in one
    // bucket. Sorting by name keeps that choice stable across renders.
    expect(labelForDimension(issueA, SCHEMA, 'prefix:risk')?.name).toBe('risk: breaking-change')
  })

  it('returns null when the issue has no label in that dimension', () => {
    expect(labelForDimension(ISSUES[2]!, SCHEMA, 'group:Service')).toBeNull()
  })

  it('falls back to auto when the key names a dimension this schema lacks', () => {
    // A key outlives the schema that minted it: switching workspace tabs, an
    // old shared URL, a renamed Linear group. Silently reverting to auto beats
    // bucketing every issue as Unclassified.
    expect(labelForDimension(issueA, SCHEMA, 'group:Domain')?.name).toBe('central')
    expect(labelForDimension(issueA, SCHEMA, 'prefix:nope')?.name).toBe('central')
    expect(labelForDimension(issueA, SCHEMA, 'garbage')?.name).toBe('central')
  })
})

describe('mixDimensions · overlapping group and prefix', () => {
  // A Linear group literally named 'type:*' holds labels named 'type: Bug' —
  // so the group and the detected `type:` prefix describe the same labels and
  // would bucket identically. Offering both is noise.
  const a = lab('1', 'type: Bug', 'type:*')
  const b = lab('2', 'type: Feature', 'type:*')
  const schema: DetectedSchema = {
    primaryGroup: null,
    typeGroup: null,
    prefixes: [{ token: 'type', labels: [a, b] }],
    orphans: [],
    otherGroups: [{ name: 'type:*', labels: [a, b], exclusive: true }],
  }
  const issues = [issueWith('A', [a]), issueWith('B', [b])]

  it('keeps only the prefix when a group adds no distinct labels', () => {
    expect(mixDimensions(issues, schema).map((d) => d.key)).toEqual(['prefix:type'])
  })

  it('keeps a group that has labels outside every prefix', () => {
    const extra = lab('3', 'Chore', 'type:*')
    const wider: DetectedSchema = {
      ...schema,
      otherGroups: [{ name: 'type:*', labels: [a, b, extra], exclusive: true }],
    }
    const keys = mixDimensions([...issues, issueWith('C', [extra])], wider).map((d) => d.key)
    expect(keys).toContain('group:type:*')
    expect(keys).toContain('prefix:type')
  })
})
