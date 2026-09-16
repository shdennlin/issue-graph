import { describe, it, expect } from 'vitest'
import type { AgentSessionDTO } from '@shared/types'
import { indexSessionsByIssue, sessionPresence } from './agentSession'

const NOW = 1_000_000

const s = (over: Partial<AgentSessionDTO> = {}): AgentSessionDTO => ({
  sessionId: 'a',
  identifier: 'ONE-1',
  branch: 'fix/one-1-x',
  cwd: '/repo',
  host: 'laptop',
  phase: null,
  status: 'active',
  lastSeen: NOW - 1000,
  ...over,
})

describe('indexSessionsByIssue', () => {
  it('groups by issue, keeping several sessions on one', () => {
    const map = indexSessionsByIssue([
      s({ sessionId: 'a' }),
      s({ sessionId: 'b' }),
      s({ sessionId: 'c', identifier: 'ONE-2' }),
    ])
    expect(map.get('ONE-1')).toHaveLength(2)
    expect(map.get('ONE-2')).toHaveLength(1)
  })

  it('drops sessions with no issue, and tolerates no input', () => {
    // A branch with no ticket is ordinary work — the session exists, it just
    // has no card to appear on.
    expect(indexSessionsByIssue([s({ identifier: null })]).size).toBe(0)
    expect(indexSessionsByIssue(undefined).size).toBe(0)
  })
})

describe('sessionPresence', () => {
  it('is none with no sessions', () => {
    expect(sessionPresence([])).toEqual({ kind: 'none' })
    expect(sessionPresence(undefined)).toEqual({ kind: 'none' })
  })

  it('reports an active session with its age and phase', () => {
    const p = sessionPresence([s({ lastSeen: NOW - 5000, phase: '/spectra-apply' })])
    expect(p).toEqual({ kind: 'active', lastSeen: NOW - 5000, count: 1, phase: '/spectra-apply' })
  })

  it('reports idle when every session has ended its turn', () => {
    expect(sessionPresence([s({ status: 'idle' })]).kind).toBe('idle')
  })

  it('lets active win over idle', () => {
    // If anything is still moving the issue is being worked on. Saying
    // "waiting for you" while a sibling session edits files would send the
    // reader to the wrong terminal.
    const p = sessionPresence([s({ sessionId: 'a', status: 'idle' }), s({ sessionId: 'b' })])
    expect(p.kind).toBe('active')
    expect(p.kind !== 'none' && p.count).toBe(1)
  })

  it('reports the newest heartbeat among the deciding group', () => {
    const p = sessionPresence(
      [
        s({ sessionId: 'old', lastSeen: NOW - 60_000, phase: '/old' }),
        s({ sessionId: 'new', lastSeen: NOW - 1_000, phase: '/new' }),
      ],
    )
    expect(p.kind !== 'none' && p.lastSeen).toBe(NOW - 1_000)
    expect(p.kind !== 'none' && p.phase).toBe('/new')
  })

  it('ignores an idle session’s newer heartbeat when an active one decides', () => {
    const p = sessionPresence(
      [
        s({ sessionId: 'idle', status: 'idle', lastSeen: NOW - 500, phase: '/idle' }),
        s({ sessionId: 'act', lastSeen: NOW - 9_000, phase: '/act' }),
      ],
    )
    expect(p.kind).toBe('active')
    expect(p.kind !== 'none' && p.phase).toBe('/act')
  })

  it('passes the raw heartbeat through, leaving clamping to compactAge', () => {
    // The hook reports from a laptop while the row is stamped by the server, so
    // a future timestamp is possible. compactAge already floors at zero, and
    // clamping twice would hide the skew from anything that wants to see it.
    const p = sessionPresence([s({ lastSeen: NOW + 30_000 })])
    expect(p.kind !== 'none' && p.lastSeen).toBe(NOW + 30_000)
  })
})
