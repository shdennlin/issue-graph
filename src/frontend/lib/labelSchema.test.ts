import { describe, expect, it } from 'vitest'
import type { DetectedSchema, NormalizedIssue, NormalizedLabel } from '@shared/types.js'
import { groupIssueLabels } from './labelSchema'

function lab(id: string, name: string, group?: string): NormalizedLabel {
  return { id, name, color: '#000', group: group ? { id: `g-${group}`, name: group, exclusive: true } : null }
}

function issueWith(labels: NormalizedLabel[]): NormalizedIssue {
  return {
    id: 'x',
    identifier: 'X-1',
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

const EMPTY_SCHEMA: DetectedSchema = {
  primaryGroup: null,
  typeGroup: null,
  prefixes: [],
  orphans: [],
  otherGroups: [],
}

describe('groupIssueLabels', () => {
  it('orders sections primary, type, prefix, group, orphan', () => {
    const primary = lab('1', 'billing', 'Service')
    const type = lab('2', 'Bug', 'Type')
    const prefixed = lab('3', 'env: prod')
    const grouped = lab('4', 'iOS', 'Platform')
    const loose = lab('5', 'needs-triage')
    const schema: DetectedSchema = {
      primaryGroup: 'Service',
      typeGroup: 'Type',
      prefixes: [{ token: 'env', labels: [prefixed, lab('6', 'env: staging')] }],
      orphans: [loose],
      otherGroups: [{ name: 'Platform', labels: [grouped], exclusive: true }],
    }

    const sections = groupIssueLabels(issueWith([loose, grouped, prefixed, type, primary]), schema)

    expect(sections.map((s) => [s.kind, s.key])).toEqual([
      ['primary', 'Service'],
      ['type', 'Type'],
      ['prefix', 'env'],
      ['group', 'Platform'],
      ['orphan', ''],
    ])
  })

  it('keeps a label the schema does not classify at all', () => {
    const unknown = lab('9', 'mystery', 'BrandNewGroup')

    const sections = groupIssueLabels(issueWith([unknown]), EMPTY_SCHEMA)

    expect(sections).toEqual([{ kind: 'orphan', key: '', labels: [unknown] }])
  })

  it('assigns a prefix-shaped label inside a group to the prefix section only', () => {
    const dual = lab('1', 'env: prod', 'Environment')
    const schema: DetectedSchema = {
      ...EMPTY_SCHEMA,
      prefixes: [{ token: 'env', labels: [dual, lab('2', 'env: staging')] }],
      otherGroups: [{ name: 'Environment', labels: [dual], exclusive: true }],
    }

    const sections = groupIssueLabels(issueWith([dual]), schema)

    expect(sections).toEqual([{ kind: 'prefix', key: 'env', labels: [dual] }])
  })

  it('omits sections the issue has no labels for', () => {
    const primary = lab('1', 'billing', 'Service')
    const schema: DetectedSchema = {
      ...EMPTY_SCHEMA,
      primaryGroup: 'Service',
      typeGroup: 'Type',
      otherGroups: [{ name: 'Platform', labels: [lab('4', 'iOS', 'Platform')], exclusive: true }],
    }

    const sections = groupIssueLabels(issueWith([primary]), schema)

    expect(sections).toEqual([{ kind: 'primary', key: 'Service', labels: [primary] }])
  })

  it('returns every label of a non-exclusive group in one section', () => {
    const a = lab('1', 'iOS', 'Platform')
    const b = lab('2', 'Android', 'Platform')
    const schema: DetectedSchema = {
      ...EMPTY_SCHEMA,
      otherGroups: [{ name: 'Platform', labels: [a, b], exclusive: false }],
    }

    const sections = groupIssueLabels(issueWith([a, b]), schema)

    expect(sections).toEqual([{ kind: 'group', key: 'Platform', labels: [a, b] }])
  })
})
