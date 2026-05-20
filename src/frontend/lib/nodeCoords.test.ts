import { describe, expect, it } from 'vitest'
import { resolveAbsolutePosition, type NodeLike } from './nodeCoords.js'

const makeLookup = (nodes: Record<string, NodeLike>) => (id: string) => nodes[id]

describe('resolveAbsolutePosition', () => {
  it('returns own position for a top-level node', () => {
    const n: NodeLike = { position: { x: 100, y: 200 } }
    expect(resolveAbsolutePosition(n, () => undefined)).toEqual({ x: 100, y: 200 })
  })

  it('adds parent offset for a 1-level child (mix/project view)', () => {
    const nodes: Record<string, NodeLike> = {
      bucket: { position: { x: 500, y: 1000 } },
    }
    const issue: NodeLike = { position: { x: 12, y: 44 }, parentNode: 'bucket' }
    expect(resolveAbsolutePosition(issue, makeLookup(nodes))).toEqual({ x: 512, y: 1044 })
  })

  it('walks the full chain for nested parents (milestone view: issue → milestone → backdrop)', () => {
    const nodes: Record<string, NodeLike> = {
      backdrop: { position: { x: 0, y: 1909 } },
      milestone: { position: { x: 18, y: 44 }, parentNode: 'backdrop' },
    }
    const issue: NodeLike = { position: { x: 8, y: 32 }, parentNode: 'milestone' }
    expect(resolveAbsolutePosition(issue, makeLookup(nodes))).toEqual({ x: 26, y: 1985 })
  })

  it('stops at a missing parent without crashing', () => {
    const issue: NodeLike = { position: { x: 5, y: 10 }, parentNode: 'gone' }
    expect(resolveAbsolutePosition(issue, () => undefined)).toEqual({ x: 5, y: 10 })
  })

  it('breaks parent cycles to avoid an infinite loop', () => {
    // Start at 'a' → visits 'b' (+10,+20) → follows back to 'a' (+1,+2) →
    // hits the cycle guard. We don't care about the exact total — the point
    // is the loop terminates instead of hanging.
    const nodes: Record<string, NodeLike> = {
      a: { position: { x: 1, y: 2 }, parentNode: 'b' },
      b: { position: { x: 10, y: 20 }, parentNode: 'a' },
    }
    const result = resolveAbsolutePosition(nodes.a!, makeLookup(nodes))
    expect(Number.isFinite(result.x) && Number.isFinite(result.y)).toBe(true)
  })
})
