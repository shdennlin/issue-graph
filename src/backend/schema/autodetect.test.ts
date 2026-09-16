import { describe, expect, it } from 'vitest'
import { detectSchema } from './autodetect.js'
import type { NormalizedIssue, NormalizedLabel } from '@shared/types.js'

function lab(id: string, name: string, group?: string): NormalizedLabel {
  return {
    id,
    name,
    color: '#fff',
    group: group ? { id: `g:${group}`, name: group } : null,
  }
}

function iss(id: string, labels: NormalizedLabel[]): NormalizedIssue {
  return {
    id,
    identifier: id,
    title: id,
    url: 'u',
    priority: 0,
    state: { name: 'Backlog', type: 'backlog' },
    assignee: null,
    labels,
    parent: null,
    children: [],
    relations: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    completedAt: null,
  }
}

describe('detectSchema', () => {
  it('picks `service` as primary group', () => {
    const labels = [lab('1', 'central', 'service'), lab('2', 'core-api', 'service')]
    const issues = [iss('A', [labels[0]!]), iss('B', [labels[1]!])]
    const out = detectSchema({ labels, issues })
    expect(out.primaryGroup).toBe('service')
  })

  it('picks `Type` as type group', () => {
    const labels = [lab('1', 'Bug', 'Type'), lab('2', 'Feature', 'Type')]
    const issues = [iss('A', [labels[0]!]), iss('B', [labels[1]!])]
    const out = detectSchema({ labels, issues })
    expect(out.typeGroup).toBe('Type')
  })

  it('autodetects prefix groups used by ≥2 labels', () => {
    const labels = [
      lab('1', 'risk: security'),
      lab('2', 'risk: breaking-change'),
      lab('3', 'affects: api'),
      lab('4', 'affects: web'),
      lab('5', 'standalone'),
    ]
    const issues = [iss('A', labels)]
    const out = detectSchema({ labels, issues })
    const tokens = out.prefixes.map((p: { token: string }) => p.token).sort()
    expect(tokens).toEqual(['affects', 'risk'])
  })

  it('respects explicit overrides', () => {
    const labels = [lab('1', 'foo', 'team'), lab('2', 'bar', 'service')]
    const out = detectSchema({
      labels,
      issues: [],
      primaryGroupOverride: 'team',
    })
    expect(out.primaryGroup).toBe('team')
  })

  it('deems group non-exclusive when an issue carries 2+ labels from it', () => {
    const labels = [lab('1', 'a', 'service'), lab('2', 'b', 'service')]
    const issues = [iss('A', labels)]
    const out = detectSchema({ labels, issues })
    // 'service' is matched by name regex but exclusive=false, so primary should NOT be picked.
    expect(out.primaryGroup).toBeNull()
  })

  it('classifies orphans correctly', () => {
    const labels = [lab('1', 'foo'), lab('2', 'bar')]
    const out = detectSchema({ labels, issues: [] })
    expect(out.orphans.map((l: { id: string }) => l.id).sort()).toEqual(['1', '2'])
  })
})

// PREFIX_RE was lowercase-only while its two sibling regexes carry /i, so a
// label typed `Risk: high` in Linear was never recognized as a prefix family
// and fell out of the filter panel entirely.
describe('detectSchema · prefix case handling', () => {
  it('detects a prefix regardless of the label’s capitalization', () => {
    const labels = [lab('1', 'Risk: security'), lab('2', 'Risk: migration')]
    const out = detectSchema({ labels, issues: [iss('A', labels)] })
    expect(out.prefixes.map((p) => p.token)).toEqual(['risk'])
  })

  it('merges labels that differ only in the token’s case into one family', () => {
    const labels = [lab('1', 'Risk: security'), lab('2', 'risk: migration'), lab('3', 'RISK: legal')]
    const out = detectSchema({ labels, issues: [iss('A', labels)] })
    expect(out.prefixes).toHaveLength(1)
    expect(out.prefixes[0]?.token).toBe('risk')
    expect(out.prefixes[0]?.labels.map((l) => l.id).sort()).toEqual(['1', '2', '3'])
  })

  it('still needs two labels before a token becomes a family', () => {
    const labels = [lab('1', 'Risk: security'), lab('2', 'standalone')]
    const out = detectSchema({ labels, issues: [iss('A', labels)] })
    expect(out.prefixes).toEqual([])
  })

  it('keeps a single-member capitalized prefix label out of orphans’ way', () => {
    // Not a family, so it stays an orphan — same as the lowercase case.
    const labels = [lab('1', 'Risk: security'), lab('2', 'standalone')]
    const out = detectSchema({ labels, issues: [iss('A', labels)] })
    expect(out.orphans.map((l) => l.id).sort()).toEqual(['1', '2'])
  })
})
