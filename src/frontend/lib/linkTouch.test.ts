import { describe, expect, it } from 'vitest'
import type { NormalizedRelation } from '@shared/types.js'
import { buildLinkTouchIndex, linkOnlyTouchAt, LINK_TOUCH_TOLERANCE_MS } from './linkTouch'

const T = (iso: string) => iso

function src(identifier: string, relations: NormalizedRelation[] = []) {
  return { identifier, relations }
}

function rel(targetIdentifier: string, createdAt?: string): NormalizedRelation {
  return { type: 'related', targetIdentifier, createdAt }
}

function issue(identifier: string, updatedAt: string) {
  return { identifier, updatedAt }
}

describe('buildLinkTouchIndex', () => {
  it('records the target side of a relation, which the target itself never carries', () => {
    // Relations are one-directional in the payload: A -> B lives on A only.
    // B's own `relations` is empty, yet B is the one whose updatedAt moved.
    const index = buildLinkTouchIndex([
      src('A', [rel('B', T('2026-09-11T07:55:06.552Z'))]),
      src('B'),
    ])
    expect(index.pointedAt.get('B')).toBe('2026-09-11T07:55:06.552Z')
    expect(index.pointedAt.get('A')).toBeUndefined()
    expect(index.pointedFrom.get('A')).toBe('2026-09-11T07:55:06.552Z')
  })

  it('keeps the newest timestamp per issue when several links point at it', () => {
    const index = buildLinkTouchIndex([
      src('A', [rel('C', T('2026-09-01T00:00:00.000Z'))]),
      src('B', [rel('C', T('2026-09-11T00:00:00.000Z'))]),
    ])
    expect(index.pointedAt.get('C')).toBe('2026-09-11T00:00:00.000Z')
  })

  it('ignores relations with no timestamp rather than guessing one', () => {
    // Cached before NormalizedRelation.createdAt existed.
    const index = buildLinkTouchIndex([src('A', [rel('B')])])
    expect(index.pointedAt.get('B')).toBeUndefined()
  })
})

describe('linkOnlyTouchAt', () => {
  const at = '2026-09-11T07:55:06.552Z'

  it('flags an issue whose updatedAt is exactly when something pointed at it', () => {
    const index = buildLinkTouchIndex([src('A', [rel('B', at)]), src('B')])
    expect(linkOnlyTouchAt(issue('B', at), index)).toBe(at)
  })

  it('leaves the issue that drew the link alone — that side did the work', () => {
    const index = buildLinkTouchIndex([src('A', [rel('B', at)]), src('B')])
    expect(linkOnlyTouchAt(issue('A', at), index)).toBeNull()
  })

  it('does not flag an issue edited after it was pointed at', () => {
    const later = '2026-09-11T09:00:00.000Z'
    const index = buildLinkTouchIndex([src('A', [rel('B', at)]), src('B')])
    expect(linkOnlyTouchAt(issue('B', later), index)).toBeNull()
  })

  it('absorbs the backend writing the bump a beat off the link', () => {
    // Observed: same millisecond on the target side, but bursts drift by a
    // second or two. The tolerance covers that drift and nothing wider.
    const index = buildLinkTouchIndex([src('A', [rel('B', at)]), src('B')])
    const drifted = new Date(new Date(at).getTime() + LINK_TOUCH_TOLERANCE_MS).toISOString()
    const beyond = new Date(new Date(at).getTime() + LINK_TOUCH_TOLERANCE_MS + 1).toISOString()
    expect(linkOnlyTouchAt(issue('B', drifted), index)).toBe(at)
    expect(linkOnlyTouchAt(issue('B', beyond), index)).toBeNull()
  })

  it('fails open when the same moment is both pointed at and pointing out', () => {
    // Never observed in practice, and the safe reading is "this issue was
    // being worked on" — hiding it would be the worse error.
    const index = buildLinkTouchIndex([src('A', [rel('B', at)]), src('B', [rel('C', at)])])
    expect(linkOnlyTouchAt(issue('B', at), index)).toBeNull()
  })

  it('fails open on an unparseable updatedAt', () => {
    const index = buildLinkTouchIndex([src('A', [rel('B', at)]), src('B')])
    expect(linkOnlyTouchAt(issue('B', 'not-a-date'), index)).toBeNull()
  })

  it('returns null for an issue no link ever touched', () => {
    const index = buildLinkTouchIndex([src('A', [rel('B', at)]), src('B'), src('Z')])
    expect(linkOnlyTouchAt(issue('Z', at), index)).toBeNull()
  })
})
